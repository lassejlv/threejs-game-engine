export type Ease = 'linear' | 'easeIn' | 'easeOut' | 'easeInOut' | 'backOut' | 'bounceOut' | 'elasticOut'

export interface TweenOptions {
  ease?: Ease
  /** Seconds before it starts. */
  delay?: number
  /** Repeat forever. */
  loop?: boolean
  /** With loop: go back and forth instead of jumping back to the start. */
  yoyo?: boolean
  onComplete?: () => void
}

/** A running timer or tween. */
export interface TimerHandle {
  cancel(): void
  readonly done: boolean
}

export const EASES: Record<Ease, (t: number) => number> = {
  linear: (t) => t,
  easeIn: (t) => t * t * t,
  easeOut: (t) => 1 - (1 - t) ** 3,
  easeInOut: (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2),
  backOut: (t) => 1 + 2.70158 * (t - 1) ** 3 + 1.70158 * (t - 1) ** 2,
  bounceOut: (t) => {
    const n = 7.5625
    const d = 2.75
    if (t < 1 / d) return n * t * t
    if (t < 2 / d) return n * (t -= 1.5 / d) * t + 0.75
    if (t < 2.5 / d) return n * (t -= 2.25 / d) * t + 0.9375
    return n * (t -= 2.625 / d) * t + 0.984375
  },
  elasticOut: (t) => (t === 0 || t === 1 ? t : 2 ** (-10 * t) * Math.sin(((t * 10 - 0.75) * 2 * Math.PI) / 3) + 1),
}

interface Job {
  owner: unknown
  /** Seconds until the next step (or the start, for a delayed tween). */
  wait: number
  /** Runs once the wait is over; returns true when the job is finished. */
  step(dt: number): boolean
  done: boolean
}

/**
 * Delayed calls, repeating calls and tweens for scripts, advanced with game
 * time (so they pause with the game). Jobs belong to an owner (an entity) and
 * are cancelled together when it is destroyed.
 */
export class Timers {
  private jobs: Job[] = []

  /** `guard` runs every callback; it should report errors and return false when one threw. */
  constructor(private readonly guard: (fn: () => void, owner?: unknown) => boolean = (fn) => (fn(), true)) {}

  after(owner: unknown, seconds: number, fn: () => void): TimerHandle {
    return this.add(owner, Math.max(0, seconds), () => {
      this.guard(fn, owner)
      return true
    })
  }

  every(owner: unknown, seconds: number, fn: () => void): TimerHandle {
    const interval = Math.max(1e-3, seconds)
    const job = this.add(owner, interval, (overshoot) => {
      job.wait = interval - overshoot // keep the rhythm instead of drifting by a frame each time
      return !this.guard(fn, owner) // a throwing callback stops repeating
    })
    return job
  }

  /** Animates numeric properties of `target` (e.g. a Vector3 or a material) to the values in `to`. */
  tween<T extends object>(owner: unknown, target: T, to: Partial<Record<keyof T, number>>, duration: number, options: TweenOptions = {}): TimerHandle {
    const ease = EASES[options.ease ?? 'easeInOut'] ?? EASES.easeInOut
    const keys = Object.keys(to) as (keyof T)[]
    const record = target as Record<keyof T, number>
    let from: number[] | null = null
    let elapsed = 0
    let forward = true
    const length = Math.max(1e-3, duration)
    return this.add(owner, Math.max(0, options.delay ?? 0), (dt) => {
      // Start values are read when the tween begins, after any delay.
      from ??= keys.map((k) => Number(record[k]))
      elapsed += dt
      const t = Math.min(1, elapsed / length)
      const k = ease(forward ? t : 1 - t)
      keys.forEach((key, i) => {
        record[key] = from![i] + ((to[key] as number) - from![i]) * k
      })
      if (t < 1) return false
      if (options.loop) {
        elapsed = 0
        if (options.yoyo) forward = !forward
        return false
      }
      if (options.onComplete) this.guard(options.onComplete, owner)
      return true
    })
  }

  /** Advances every job; call once per frame with game time. */
  update(dt: number): void {
    const running = this.jobs
    this.jobs = []
    for (const job of running) {
      if (job.done) continue
      let remaining = dt
      if (job.wait > 0) {
        job.wait -= dt
        if (job.wait > 1e-9) {
          this.jobs.push(job)
          continue
        }
        remaining = Math.max(0, -job.wait) // time past the wait counts toward the first step
        job.wait = 0
      }
      job.done = job.step(remaining)
      if (!job.done) this.jobs.push(job)
    }
  }

  cancelOwner(owner: unknown): void {
    for (const job of this.jobs) if (job.owner === owner) job.done = true
  }

  clear(): void {
    for (const job of this.jobs) job.done = true
    this.jobs = []
  }

  get count(): number {
    return this.jobs.filter((j) => !j.done).length
  }

  private add(owner: unknown, wait: number, step: (dt: number) => boolean): Job & TimerHandle {
    const job: Job & TimerHandle = {
      owner,
      wait,
      step,
      done: false,
      cancel: () => {
        job.done = true
      },
    }
    // Jobs added while updating start on the next update.
    this.jobs.push(job)
    return job
  }
}
