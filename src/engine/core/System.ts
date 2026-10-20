import type { Engine } from './Engine'

/**
 * - `fixed`  : fixed timestep simulation (physics, gameplay that must be deterministic)
 * - `update` : once per frame, variable dt (animation, input-driven visuals)
 * - `late`   : after update (cameras, followers)
 * - `render` : right before the frame is drawn
 */
export type Phase = 'fixed' | 'update' | 'late' | 'render'

export const PHASES: readonly Phase[] = ['fixed', 'update', 'late', 'render']

export interface System {
  readonly name: string
  /** Defaults to `update`. */
  readonly phase?: Phase
  /** Lower runs first within a phase. Defaults to 0. */
  readonly order?: number
  /** Called once when added. May return a cleanup function. */
  init?(engine: Engine): void | (() => void)
  run(engine: Engine, dt: number): void
}

export function defineSystem(system: System): System {
  return system
}
