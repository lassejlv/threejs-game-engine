export class Time {
  /** Scaled seconds since the engine started (stops while paused). */
  elapsed = 0
  /** Scaled seconds since the previous frame (0 while paused). */
  delta = 0
  /** Fixed simulation step in seconds. */
  readonly fixedDelta: number
  /** How far (0..1) the render frame sits between the last two fixed steps. */
  alpha = 0
  /** Rendered frames. */
  frame = 0
  /** Fixed steps run. */
  fixedFrame = 0
  /** Multiplier on simulation speed. */
  scale = 1

  constructor(fixedDelta: number) {
    this.fixedDelta = fixedDelta
  }
}
