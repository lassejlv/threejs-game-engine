import { type AnimationAction, type AnimationClip, AnimationMixer, LoopOnce, LoopRepeat, type Object3D } from 'three'

export interface PlayAnimationOptions {
  /** Cross-fade seconds from the current clip. Default 0.2. */
  fade?: number
  /** Default true. A non-looping clip holds its last frame. */
  loop?: boolean
  /** Playback speed multiplier. Default 1. */
  speed?: number
}

/** A state of the animation state machine: one clip, or a 1D blend of clips by a parameter. */
export interface AnimStateDef {
  name: string
  clip: string
  /** Blend by this parameter instead of playing `clip` (e.g. idle → walk → run by 'speed'). */
  blendParam: string
  blend: { clip: string; at: number }[]
  speed: number
  loop: boolean
}

export interface AnimTransitionDef {
  /** State name, or '*' for any state. */
  from: string
  to: string
  /** Condition such as `speed > 0.1 && grounded`, `!grounded` or `jump` (a trigger). Empty = always. */
  when: string
  /** Cross-fade seconds. */
  fade: number
  /** Only once the current clip has played to its end. */
  afterEnd: boolean
}

/** Script-facing animation control for a model (`ctx.animation`). */
export interface AnimationApi {
  /** Plays a clip, or enters a state of the state machine by name. */
  play(clip: string, options?: PlayAnimationOptions): void
  stop(fade?: number): void
  /** Sets a state-machine parameter (number or boolean). */
  set(param: string, value: number | boolean): void
  get(param: string): number | boolean | undefined
  /** A one-shot parameter: true until a transition that checks it fires. */
  trigger(name: string): void
  /** Clip names, once the model has loaded. */
  readonly clips: string[]
  /** The clip or state that is playing (fading in). */
  readonly current: string | null
}

type Condition = (params: Map<string, number | boolean>) => boolean

interface Transition extends AnimTransitionDef {
  test: Condition
  /** Trigger parameters this condition reads; consumed when it fires. */
  triggers: string[]
}

/** Something fading in or out: a single clip or a blend of clips. */
interface Entry {
  name: string
  state: AnimStateDef | null
  actions: { action: AnimationAction; at: number }[]
  weight: number
  target: number
  /** Weight change per second. */
  rate: number
  loop: boolean
}

const COMPARE = /^\s*(!?)\s*([A-Za-z_][\w]*)\s*(?:(>=|<=|==|!=|>|<)\s*(-?\d+(?:\.\d+)?|true|false))?\s*$/

/** Parses `a > 1 && !b && c == true` into a test; throws on bad syntax. */
export function parseCondition(text: string): { test: Condition; params: string[] } {
  if (!text.trim()) return { test: () => true, params: [] }
  const parts = text.split('&&').map((part) => {
    const m = COMPARE.exec(part)
    if (!m) throw new Error(`can't read condition "${part.trim()}"`)
    const [, not, name, op, raw] = m
    const value = raw === undefined ? undefined : raw === 'true' ? true : raw === 'false' ? false : Number(raw)
    const check = (params: Map<string, number | boolean>): boolean => {
      const v = params.get(name)
      if (op === undefined) return Boolean(v) !== Boolean(not)
      const a = typeof v === 'boolean' ? Number(v) : (v ?? 0)
      const b = typeof value === 'boolean' ? Number(value) : (value as number)
      switch (op) {
        case '>':
          return a > b
        case '<':
          return a < b
        case '>=':
          return a >= b
        case '<=':
          return a <= b
        case '==':
          return a === b
        default:
          return a !== b
      }
    }
    return { check, name }
  })
  return { test: (params) => parts.every((p) => p.check(params)), params: parts.map((p) => p.name) }
}

/**
 * Plays a model's glTF clips with cross-fades, optionally driven by a state
 * machine (states, parameter-driven transitions and 1D blends). Requests made
 * before the model finishes loading are applied on `attach`.
 */
export class Animator implements AnimationApi {
  private mixer: AnimationMixer | null = null
  private clipList: AnimationClip[] = []
  private root: Object3D | null = null
  private entries: Entry[] = []
  private pending: { name: string; options: PlayAnimationOptions } | null = null
  private readonly params = new Map<string, number | boolean>()
  private readonly triggers = new Set<string>()
  private states: AnimStateDef[] = []
  private transitions: Transition[] = []
  /** Problems found while configuring (bad conditions, unknown states), for the console. */
  readonly errors: string[] = []

  get clips(): string[] {
    return this.clipList.map((c) => c.name)
  }

  get current(): string | null {
    return this.active()?.name ?? null
  }

  /** Sets up the state machine. The first state is the starting one. */
  configure(states: AnimStateDef[], transitions: AnimTransitionDef[]): void {
    this.states = states
    this.transitions = []
    for (const t of transitions) {
      if (t.from !== '*' && !states.some((s) => s.name === t.from)) this.errors.push(`transition from unknown state "${t.from}"`)
      if (!states.some((s) => s.name === t.to)) {
        this.errors.push(`transition to unknown state "${t.to}"`)
        continue
      }
      try {
        const { test, params } = parseCondition(t.when)
        this.transitions.push({ ...t, test, triggers: params })
      } catch (error) {
        this.errors.push(`${t.from} → ${t.to}: ${(error as Error).message}`)
      }
    }
    if (states.length && !this.pending) this.pending = { name: states[0].name, options: { fade: 0 } }
  }

  attach(root: Object3D, clips: AnimationClip[]): void {
    this.root = root
    this.mixer = new AnimationMixer(root)
    this.clipList = clips
    if (this.pending) {
      const { name, options } = this.pending
      this.pending = null
      this.play(name, options)
    }
  }

  set(param: string, value: number | boolean): void {
    this.params.set(param, value)
  }

  get(param: string): number | boolean | undefined {
    return this.params.get(param)
  }

  trigger(name: string): void {
    this.params.set(name, true)
    this.triggers.add(name)
  }

  play(name: string, { fade = 0.2, loop = true, speed = 1 }: PlayAnimationOptions = {}): void {
    if (!this.mixer) {
      this.pending = { name, options: { fade, loop, speed } }
      return
    }
    const state = this.states.find((s) => s.name === name)
    if (state) {
      this.enter(state, fade)
      return
    }
    const clip = this.findClip(name)
    if (!clip) return
    const current = this.active()
    if (current && !current.state && current.actions[0].action.getClip() === clip) {
      // Same clip again: restart a one-shot, otherwise just make sure it plays.
      const { action } = current.actions[0]
      action.timeScale = speed
      if (!loop) action.reset()
      action.play()
      return
    }
    this.start({ name: clip.name, state: null, actions: [{ action: this.action(clip, loop, speed), at: 0 }], loop }, fade)
  }

  stop(fade = 0.2): void {
    this.pending = null
    for (const e of this.entries) this.fadeTo(e, 0, fade)
  }

  update(dt: number): void {
    if (!this.mixer) return
    this.evaluate()
    for (const e of this.entries) {
      e.weight = e.rate === Infinity ? e.target : moveTowards(e.weight, e.target, e.rate * dt)
      const blend = e.state?.blendParam ? this.blendWeights(e) : null
      e.actions.forEach(({ action }, i) => action.setEffectiveWeight(e.weight * (blend ? blend[i] : 1)))
    }
    // Drop what has faded out.
    this.entries = this.entries.filter((e) => {
      if (e.target > 0 || e.weight > 0) return true
      for (const { action } of e.actions) action.stop()
      return false
    })
    this.mixer.update(dt)
  }

  /** False once the model has been removed from `scene` (e.g. its entity was destroyed). */
  isIn(scene: Object3D): boolean {
    if (!this.root) return true // still loading
    let o: Object3D | null = this.root
    while (o.parent) o = o.parent
    return o === scene
  }

  dispose(): void {
    this.mixer?.stopAllAction()
    this.mixer = null
    this.entries = []
  }

  private active(): Entry | undefined {
    return this.entries.find((e) => e.target > 0)
  }

  private findClip(name: string): AnimationClip | undefined {
    return this.clipList.find((c) => c.name === name) ?? this.clipList[Number(name)]
  }

  private action(clip: AnimationClip, loop: boolean, speed: number): AnimationAction {
    const action = this.mixer!.clipAction(clip)
    action.setLoop(loop ? LoopRepeat : LoopOnce, Infinity)
    action.clampWhenFinished = !loop
    action.timeScale = speed
    return action
  }

  private enter(state: AnimStateDef, fade: number): void {
    const clips = state.blendParam && state.blend.length ? state.blend : [{ clip: state.clip, at: 0 }]
    const actions = clips.flatMap(({ clip, at }) => {
      const found = this.findClip(clip)
      return found ? [{ action: this.action(found, state.loop, state.speed), at }] : []
    })
    if (actions.length === 0) return
    // Re-entering the state that is already playing keeps it running.
    if (this.active()?.state === state) return
    this.start({ name: state.name, state, actions, loop: state.loop }, fade)
  }

  private start(entry: Omit<Entry, 'weight' | 'target' | 'rate'>, fade: number): void {
    for (const e of this.entries) this.fadeTo(e, 0, fade)
    // A clip that is still fading out gets its own action back: reuse rather than restart from zero weight.
    const actions = new Set(entry.actions.map((a) => a.action))
    this.entries = this.entries.filter((e) => !e.actions.some((a) => actions.has(a.action)))
    const next: Entry = { ...entry, weight: fade > 0 ? 0 : 1, target: 1, rate: fade > 0 ? 1 / fade : Infinity }
    for (const { action } of next.actions) action.reset().play()
    this.entries.push(next)
  }

  private fadeTo(e: Entry, target: number, fade: number): void {
    e.target = target
    e.rate = fade > 0 ? 1 / fade : Infinity
  }

  /** Fires the first transition whose condition holds from the current state. */
  private evaluate(): void {
    if (!this.transitions.length) return
    const current = this.active()
    const from = current?.state?.name ?? null
    for (const t of this.transitions) {
      if (t.from !== '*' && t.from !== from) continue
      if (t.from === '*' && t.to === from) continue
      if (t.afterEnd && !this.ended(current)) continue
      if (!t.test(this.params)) continue
      for (const name of t.triggers) {
        if (this.triggers.delete(name)) this.params.set(name, false)
      }
      const state = this.states.find((s) => s.name === t.to)
      if (state) this.enter(state, t.fade)
      return
    }
  }

  private ended(entry: Entry | undefined): boolean {
    if (!entry) return true
    const { action } = entry.actions[0]
    const duration = action.getClip().duration
    return !entry.loop ? action.time >= duration - 1e-3 : action.time >= duration - 0.05 || action.time < 0.05
  }

  /** Weights for a 1D blend: the two clips around the parameter value share it linearly. */
  private blendWeights(e: Entry): number[] {
    const v = Number(this.params.get(e.state!.blendParam) ?? 0)
    const points = e.actions.map((a) => a.at)
    const weights = points.map(() => 0)
    const order = points.map((_, i) => i).sort((a, b) => points[a] - points[b])
    if (v <= points[order[0]]) weights[order[0]] = 1
    else if (v >= points[order[order.length - 1]]) weights[order[order.length - 1]] = 1
    else {
      for (let k = 0; k < order.length - 1; k++) {
        const a = order[k]
        const b = order[k + 1]
        if (v >= points[a] && v <= points[b]) {
          const t = points[b] === points[a] ? 0 : (v - points[a]) / (points[b] - points[a])
          weights[a] = 1 - t
          weights[b] = t
          break
        }
      }
    }
    return weights
  }
}

function moveTowards(value: number, target: number, step: number): number {
  return value < target ? Math.min(target, value + step) : Math.max(target, value - step)
}
