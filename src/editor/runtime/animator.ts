import { type AnimationAction, type AnimationClip, AnimationMixer, LoopOnce, LoopRepeat, type Object3D } from 'three'

export interface PlayAnimationOptions {
  /** Cross-fade seconds from the current clip. Default 0.2. */
  fade?: number
  /** Default true. A non-looping clip holds its last frame. */
  loop?: boolean
  /** Playback speed multiplier. Default 1. */
  speed?: number
}

/** Script-facing animation control for a model (`ctx.animation`). */
export interface AnimationApi {
  play(clip: string, options?: PlayAnimationOptions): void
  stop(fade?: number): void
  /** Clip names, once the model has loaded. */
  readonly clips: string[]
  readonly current: string | null
}

/**
 * Wraps an AnimationMixer for one model instance. Requests made before the
 * model finishes loading are queued and applied on `attach`.
 */
export class Animator implements AnimationApi {
  private mixer: AnimationMixer | null = null
  private clipList: AnimationClip[] = []
  private action: AnimationAction | null = null
  private pending: { clip: string; options: PlayAnimationOptions } | null = null
  private root: Object3D | null = null

  get clips(): string[] {
    return this.clipList.map((c) => c.name)
  }

  get current(): string | null {
    return this.action?.getClip().name ?? null
  }

  attach(root: Object3D, clips: AnimationClip[]): void {
    this.root = root
    this.mixer = new AnimationMixer(root)
    this.clipList = clips
    if (this.pending) {
      const { clip, options } = this.pending
      this.pending = null
      this.play(clip, options)
    }
  }

  play(name: string, { fade = 0.2, loop = true, speed = 1 }: PlayAnimationOptions = {}): void {
    if (!this.mixer) {
      this.pending = { clip: name, options: { fade, loop, speed } }
      return
    }
    const clip = this.clipList.find((c) => c.name === name) ?? this.clipList[Number(name)]
    if (!clip) return
    const next = this.mixer.clipAction(clip)
    next.setLoop(loop ? LoopRepeat : LoopOnce, Infinity)
    next.clampWhenFinished = !loop
    next.timeScale = speed
    if (next === this.action) {
      if (!loop) next.reset()
      next.play()
      return
    }
    next.reset().fadeIn(this.action ? fade : 0).play()
    this.action?.fadeOut(fade)
    this.action = next
  }

  stop(fade = 0.2): void {
    this.pending = null
    this.action?.fadeOut(fade)
    this.action = null
  }

  update(dt: number): void {
    this.mixer?.update(dt)
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
  }
}
