/**
 * Unified keyboard / mouse / gamepad input, polled by systems.
 *
 * Every button is a string code:
 * - keyboard: `KeyboardEvent.code` (`KeyW`, `Space`, `ShiftLeft`, ...)
 * - mouse:    `Mouse0` (left), `Mouse1` (middle), `Mouse2` (right)
 * - gamepad:  `GamepadA`, `GamepadB`, ... (standard mapping, first pad)
 *
 * Edge queries (`wasPressed` / `wasReleased`) are phase-aware: in a fixed
 * step they report edges since the previous fixed step, otherwise since the
 * previous frame. So a jump read in a `fixed` system is never missed on a
 * frame that happened to run zero fixed steps.
 */
export type InputPhase = 'frame' | 'fixed'

interface AxisBinding {
  negative: readonly string[]
  positive: readonly string[]
  gamepadAxis: number
  invert: boolean
}

type Codes = string | readonly string[]

const GAMEPAD_BUTTONS = [
  'GamepadA', 'GamepadB', 'GamepadX', 'GamepadY',
  'GamepadLB', 'GamepadRB', 'GamepadLT', 'GamepadRT',
  'GamepadSelect', 'GamepadStart', 'GamepadL3', 'GamepadR3',
  'GamepadUp', 'GamepadDown', 'GamepadLeft', 'GamepadRight', 'GamepadHome',
] as const

const PREVENT_DEFAULT = new Set(['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'])

export interface PointerState {
  /** Normalized device coords (-1..1), +y up. */
  x: number
  y: number
  /** Pixel movement this frame (works under pointer lock). */
  dx: number
  dy: number
  /** Wheel delta this frame. */
  wheel: number
  locked: boolean
}

export interface GamepadState {
  connected: boolean
  /** Left stick x/y, right stick x/y, with deadzone applied. */
  axes: [number, number, number, number]
}

export class Input {
  phase: InputPhase = 'frame'
  deadzone = 0.15
  readonly pointer: PointerState = { x: 0, y: 0, dx: 0, dy: 0, wheel: 0, locked: false }
  readonly gamepad: GamepadState = { connected: false, axes: [0, 0, 0, 0] }

  private readonly down = new Set<string>()
  private readonly pressed = { frame: new Set<string>(), fixed: new Set<string>() }
  private readonly released = { frame: new Set<string>(), fixed: new Set<string>() }
  private readonly actions = new Map<string, readonly string[]>()
  private readonly axisBindings = new Map<string, AxisBinding>()
  /** Values pushed by on-screen controls (touch joysticks), added to bound axes. */
  private readonly virtualAxes = new Map<string, number>()
  private element: HTMLElement | null = null
  private abort: AbortController | null = null

  attach(element: HTMLElement): void {
    this.detach()
    this.element = element
    this.abort = new AbortController()
    const opts = { signal: this.abort.signal }

    window.addEventListener('keydown', this.onKeyDown, opts)
    window.addEventListener('keyup', this.onKeyUp, opts)
    window.addEventListener('blur', this.reset, opts)
    element.addEventListener('pointerdown', this.onPointerDown, opts)
    window.addEventListener('pointerup', this.onPointerUp, opts)
    window.addEventListener('pointermove', this.onPointerMove, opts)
    element.addEventListener('wheel', this.onWheel, { ...opts, passive: false })
    element.addEventListener('contextmenu', (e) => e.preventDefault(), opts)
    document.addEventListener(
      'pointerlockchange',
      () => (this.pointer.locked = document.pointerLockElement === element),
      opts,
    )
  }

  detach(): void {
    this.abort?.abort()
    this.abort = null
    this.element = null
    this.reset()
  }

  isDown(codes: Codes): boolean {
    if (typeof codes === 'string') return this.down.has(codes)
    for (const code of codes) if (this.down.has(code)) return true
    return false
  }

  wasPressed(codes: Codes): boolean {
    return hasAny(this.pressed[this.phase], codes)
  }

  wasReleased(codes: Codes): boolean {
    return hasAny(this.released[this.phase], codes)
  }

  /** -1, 0 or 1 from two sets of buttons. */
  axis(negative: Codes, positive: Codes): number {
    return (this.isDown(positive) ? 1 : 0) - (this.isDown(negative) ? 1 : 0)
  }

  /** Maps a named action to one or more codes, e.g. `bind('jump', ['Space', 'GamepadA'])`. */
  bind(action: string, codes: readonly string[]): void {
    this.actions.set(action, codes)
  }

  action(name: string): boolean {
    return this.isDown(this.codesFor(name))
  }

  actionPressed(name: string): boolean {
    return this.wasPressed(this.codesFor(name))
  }

  actionReleased(name: string): boolean {
    return this.wasReleased(this.codesFor(name))
  }

  /**
   * Maps a named axis to keys and, optionally, a gamepad stick axis (0-3), e.g.
   * `bindAxis('MoveX', ['KeyA'], ['KeyD'], 0)`. `invert` flips the stick (gamepad Y is down-positive).
   */
  bindAxis(name: string, negative: readonly string[], positive: readonly string[], gamepadAxis = -1, invert = false): void {
    this.axisBindings.set(name, { negative, positive, gamepadAxis, invert })
  }

  /** -1..1 from a bound axis: keys, gamepad stick and on-screen controls combined. */
  getAxis(name: string): number {
    const binding = this.axisBindings.get(name)
    let value = this.virtualAxes.get(name) ?? 0
    if (binding) {
      value += this.axis(binding.negative, binding.positive)
      if (binding.gamepadAxis >= 0) value += (this.gamepad.axes[binding.gamepadAxis] ?? 0) * (binding.invert ? -1 : 1)
    }
    return Math.max(-1, Math.min(1, value))
  }

  /** On-screen controls (e.g. a touch joystick) drive axes through this. */
  setVirtualAxis(name: string, value: number): void {
    if (value === 0) this.virtualAxes.delete(name)
    else this.virtualAxes.set(name, value)
  }

  /** On-screen buttons press and release a code (e.g. 'Touch:Jump') like a key. */
  setVirtualButton(code: string, down: boolean): void {
    if (down && !this.down.has(code)) this.press(code)
    else if (!down && this.down.has(code)) this.release(code)
  }

  /** Whether an action name has bindings. */
  hasAction(name: string): boolean {
    return this.actions.has(name)
  }

  requestPointerLock(): void {
    void this.element?.requestPointerLock()
  }

  exitPointerLock(): void {
    if (document.pointerLockElement) document.exitPointerLock()
  }

  /** @internal Called by the engine at the start of every frame. */
  poll(): void {
    const pads = typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : []
    let pad: Gamepad | null = null
    for (const p of pads) {
      if (p?.connected) {
        pad = p
        break
      }
    }
    this.gamepad.connected = pad !== null
    if (!pad) return

    for (let i = 0; i < GAMEPAD_BUTTONS.length; i++) {
      const pressed = pad.buttons[i]?.pressed ?? false
      const code = GAMEPAD_BUTTONS[i]
      if (pressed && !this.down.has(code)) this.press(code)
      else if (!pressed && this.down.has(code)) this.release(code)
    }
    for (let i = 0; i < 4; i++) {
      const v = pad.axes[i] ?? 0
      this.gamepad.axes[i] =
        Math.abs(v) < this.deadzone ? 0 : (v - Math.sign(v) * this.deadzone) / (1 - this.deadzone)
    }
  }

  /** @internal */
  endFixedStep(): void {
    this.pressed.fixed.clear()
    this.released.fixed.clear()
  }

  /** @internal */
  endFrame(): void {
    this.pressed.frame.clear()
    this.released.frame.clear()
    this.pointer.dx = 0
    this.pointer.dy = 0
    this.pointer.wheel = 0
  }

  /** Releases everything (used on blur so keys never get stuck). */
  readonly reset = (): void => {
    this.down.clear()
    this.endFixedStep()
    this.endFrame()
  }

  private codesFor(action: string): readonly string[] {
    return this.actions.get(action) ?? []
  }

  private press(code: string): void {
    this.down.add(code)
    this.pressed.frame.add(code)
    this.pressed.fixed.add(code)
  }

  private release(code: string): void {
    this.down.delete(code)
    this.released.frame.add(code)
    this.released.fixed.add(code)
  }

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (isTyping(e.target)) return
    if (PREVENT_DEFAULT.has(e.code)) e.preventDefault()
    if (!e.repeat) this.press(e.code)
  }

  private readonly onKeyUp = (e: KeyboardEvent): void => {
    if (this.down.has(e.code)) this.release(e.code)
  }

  private readonly onPointerDown = (e: PointerEvent): void => {
    this.updatePointer(e)
    this.press(`Mouse${e.button}`)
  }

  private readonly onPointerUp = (e: PointerEvent): void => {
    const code = `Mouse${e.button}`
    if (this.down.has(code)) this.release(code)
  }

  private readonly onPointerMove = (e: PointerEvent): void => {
    this.updatePointer(e)
    this.pointer.dx += e.movementX
    this.pointer.dy += e.movementY
  }

  private readonly onWheel = (e: WheelEvent): void => {
    e.preventDefault()
    this.pointer.wheel += e.deltaY
  }

  private updatePointer(e: PointerEvent): void {
    if (!this.element) return
    const rect = this.element.getBoundingClientRect()
    this.pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1
    this.pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1
  }
}

function hasAny(set: Set<string>, codes: Codes): boolean {
  if (typeof codes === 'string') return set.has(codes)
  for (const code of codes) if (set.has(code)) return true
  return false
}

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return target.isContentEditable || target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT'
}
