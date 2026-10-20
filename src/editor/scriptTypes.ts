/**
 * Type declarations for the script editor (Monaco). Scripts annotate their
 * default export with `@type {import('engine').Script}`, so `ctx` and
 * lifecycle hooks are fully typed. THREE's common classes are typed (as
 * namespace T3); anything else on THREE falls back to `any`.
 */
export const SCRIPT_TYPES = `
declare module 'engine' {
  type ParamValue = number | string | boolean
  interface Vec3Like { x: number; y: number; z: number }

  interface Handle {
    readonly entity: number
    readonly name: string
    readonly object: T3.Object3D
    /** Rigid body state (position, velocity, grounded...) when the entity has one. */
    readonly body: RigidBody | undefined
  }

  interface RigidBody {
    position: T3.Vector3
    velocity: T3.Vector3
    rotation: T3.Quaternion
    grounded: boolean
    gravityScale: number
    kinematic: boolean
    character: boolean
  }

  interface Input {
    /** KeyboardEvent.code ('KeyW', 'Space'), 'Mouse0'..'Mouse2' or 'GamepadA' etc. */
    isDown(codes: string | string[]): boolean
    wasPressed(codes: string | string[]): boolean
    wasReleased(codes: string | string[]): boolean
    /** -1, 0 or 1. */
    axis(negative: string | string[], positive: string | string[]): number
    bind(action: string, codes: string[]): void
    /** Held: a named action from Project Settings → Input (Jump, Sprint, Fire, Interact...). */
    action(name: string): boolean
    actionPressed(name: string): boolean
    actionReleased(name: string): boolean
    hasAction(name: string): boolean
    /** -1..1 from a named axis in Project Settings → Input (MoveX, MoveY, LookX, LookY): keys, gamepad and touch combined. */
    getAxis(name: string): number
    requestPointerLock(): void
    exitPointerLock(): void
    readonly pointer: { x: number; y: number; dx: number; dy: number; wheel: number; locked: boolean }
    readonly gamepad: { connected: boolean; axes: [number, number, number, number] }
  }

  interface Time {
    /** Seconds since the scene started (scaled). */
    readonly elapsed: number
    readonly delta: number
    readonly fixedDelta: number
    readonly frame: number
    scale: number
  }

  type Anchor = 'top-left' | 'top' | 'top-right' | 'left' | 'center' | 'right' | 'bottom-left' | 'bottom' | 'bottom-right'
  interface UiStyle { anchor?: Anchor; x?: number; y?: number; size?: number; color?: string; background?: string; width?: number }

  interface Ui {
    text(id: string, text: string | number, style?: UiStyle): void
    button(id: string, label: string, onClick: () => void, style?: UiStyle): void
    /** value is 0..1 */
    bar(id: string, value: number, style?: UiStyle & { label?: string; fill?: string }): void
    /** Text that follows an entity in the world. */
    label(id: string, text: string | number, target: Handle, style?: { offsetY?: number; size?: number; color?: string }): void
    remove(id: string): void
    clear(): void
  }

  interface Hud {
    set(key: string, value: string | number): void
    remove(key: string): void
    message(text: string | null): void
  }

  interface PhysicsHit { handle: Handle; point: T3.Vector3; normal: T3.Vector3; distance: number }
  interface Physics {
    raycast(origin: T3.Vector3, direction: T3.Vector3, maxDistance?: number, options?: { triggers?: boolean; ignoreSelf?: boolean }): PhysicsHit | null
    applyImpulse(target: Handle, impulse: T3.Vector3): void
    /** Pushes a dynamic body for this step; call it every fixedUpdate for a steady push. */
    addForce(target: Handle, force: T3.Vector3): void
    /** Spins a dynamic body for this step; call it every fixedUpdate. */
    addTorque(target: Handle, torque: T3.Vector3): void
    applyTorqueImpulse(target: Handle, impulse: T3.Vector3): void
    /** Radians per second around each world axis. */
    angularVelocity(target: Handle): T3.Vector3
    setAngularVelocity(target: Handle, velocity: T3.Vector3): void
    /** Entities touching a sphere (radius) or box (half extents) at a point. */
    overlap(center: T3.Vector3, size: number | T3.Vector3, options?: { triggers?: boolean; ignoreSelf?: boolean }): Handle[]
    /** A raycast with thickness. */
    sphereCast(origin: T3.Vector3, radius: number, direction: T3.Vector3, maxDistance?: number, options?: { triggers?: boolean; ignoreSelf?: boolean }): PhysicsHit | null
  }

  interface Sound {
    /** One-shot from an audio asset name; at makes it 3D. */
    play(asset: string, options?: { volume?: number; at?: Vec3Like }): void
    tone(frequency: number, duration?: number, options?: { type?: 'sine' | 'square' | 'sawtooth' | 'triangle'; volume?: number; delay?: number }): void
  }

  interface AudioSource { play(): void; stop(): void; setVolume(volume: number): void; readonly playing: boolean }

  interface Animation {
    /** Plays a clip, or enters a state-machine state by name. */
    play(clip: string, options?: { fade?: number; loop?: boolean; speed?: number }): void
    stop(fade?: number): void
    /** Sets a state-machine parameter used by transition conditions and blends. */
    set(param: string, value: number | boolean): void
    get(param: string): number | boolean | undefined
    /** One-shot parameter, true until a transition that checks it fires. */
    trigger(name: string): void
    readonly clips: string[]
    readonly current: string | null
  }

  interface Particles {
    /** Restarts the emitter: fires its burst and emits for its duration. */
    play(): void
    /** Stops emitting; live particles finish their lifetime. */
    stop(): void
    /** Emits count particles at once (default: the emitter's burst count). */
    burst(count?: number): void
    /** Removes every live particle. */
    clear(): void
    readonly emitting: boolean
    /** Live particles. */
    readonly count: number
  }

  interface Timer { cancel(): void; readonly done: boolean }

  interface Nav {
    /** Walkable waypoints between two points, or null if unreachable. The grid is baked from static colliders on first use. */
    findPath(from: Vec3Like, to: Vec3Like): T3.Vector3[] | null
    /** Walks this entity to a point, or keeps following a moving entity. Returns false if there's no path. */
    moveTo(target: Vec3Like | Handle, options?: { speed?: number; stoppingDistance?: number; face?: boolean }): boolean
    stop(): void
    readonly moving: boolean
    readonly path: readonly T3.Vector3[]
    /** A random walkable point, optionally within radius of this entity. */
    randomPoint(radius?: number): T3.Vector3 | null
  }
  type Ease = 'linear' | 'easeIn' | 'easeOut' | 'easeInOut' | 'backOut' | 'bounceOut' | 'elasticOut'
  interface TweenOptions {
    ease?: Ease
    delay?: number
    loop?: boolean
    /** With loop: go back and forth. */
    yoyo?: boolean
    onComplete?: () => void
  }

  interface Context<P = Record<string, any>> extends Handle {
    /** Inspector-editable values declared in params. */
    readonly params: P
    readonly input: Input
    readonly time: Time
    /** Per-instance scratch space. */
    readonly state: Record<string, any>
    /** Shared by every script in the scene. */
    readonly globals: Record<string, any>
    readonly hud: Hud
    readonly ui: Ui
    readonly physics: Physics
    readonly sound: Sound
    readonly audio: AudioSource | undefined
    readonly animation: Animation | undefined
    /** Present when the entity has a Particle Emitter. */
    readonly particles: Particles | undefined
    /** Pathfinding over the scene's static colliders. */
    readonly nav: Nav
    readonly sceneName: string
    readonly engine: any
    find(name: string): Handle | undefined
    spawn(prefab: string, options?: { position?: Vec3Like; rotation?: Vec3Like; parent?: Handle }): Handle | undefined
    loadScene(name: string): void
    destroy(target?: Handle): void
    /** Calls fn once after some seconds of game time. Cancelled if this entity is destroyed. */
    after(seconds: number, fn: () => void): Timer
    /** Calls fn every few seconds until cancelled or this entity is destroyed. */
    every(seconds: number, fn: () => void): Timer
    /** Animates numeric properties: ctx.tween(ctx.object.position, { y: 3 }, 0.5, { ease: 'backOut' }) */
    tween<T extends object>(target: T, to: Partial<Record<keyof T, number>>, duration: number, options?: TweenOptions): Timer
    /** Listens for an event from any script; returns a function that stops listening. */
    on(name: string, fn: (data: any) => void): () => void
    /** Sends an event to every listener right away, e.g. ctx.emit('damage', { target: other, amount: 1 }). */
    emit(name: string, data?: unknown): void
    /** Stores a JSON value that survives reloads (high scores, progress). */
    save(key: string, value: unknown): void
    load<T>(key: string, fallback: T): T
    deleteSave(key: string): void
    log(...args: unknown[]): void
    warn(...args: unknown[]): void
    error(...args: unknown[]): void
  }

  interface Script<P extends Record<string, ParamValue> = Record<string, any>> {
    /** Defaults for inspector fields; the type comes from the value ('#rrggbb' = color). */
    params?: P
    start?(ctx: Context<P>): void
    /** Fixed 60 Hz step, before physics. */
    fixedUpdate?(ctx: Context<P>, dt: number): void
    update?(ctx: Context<P>, dt: number): void
    /** After update (cameras, followers). */
    lateUpdate?(ctx: Context<P>, dt: number): void
    onCollisionEnter?(ctx: Context<P>, other: Handle): void
    onCollisionExit?(ctx: Context<P>, other: Handle): void
    onDestroy?(ctx: Context<P>): void
  }
}

declare namespace T3 {
  class Vector3 {
    constructor(x?: number, y?: number, z?: number)
    x: number; y: number; z: number
    set(x: number, y: number, z: number): this
    setScalar(s: number): this
    setX(x: number): this; setY(y: number): this; setZ(z: number): this
    copy(v: Vector3): this
    clone(): Vector3
    add(v: Vector3): this
    sub(v: Vector3): this
    addScaledVector(v: Vector3, s: number): this
    multiplyScalar(s: number): this
    multiply(v: Vector3): this
    divideScalar(s: number): this
    negate(): this
    normalize(): this
    length(): number
    lengthSq(): number
    setLength(l: number): this
    dot(v: Vector3): number
    cross(v: Vector3): this
    crossVectors(a: Vector3, b: Vector3): this
    distanceTo(v: Vector3): number
    lerp(v: Vector3, alpha: number): this
    lerpVectors(a: Vector3, b: Vector3, alpha: number): this
    applyQuaternion(q: Quaternion): this
    applyEuler(e: Euler): this
    equals(v: Vector3): boolean
    toArray(): [number, number, number]
  }
  class Vector2 {
    constructor(x?: number, y?: number)
    x: number; y: number
    set(x: number, y: number): this
    clone(): Vector2
    length(): number
  }
  class Quaternion {
    constructor(x?: number, y?: number, z?: number, w?: number)
    x: number; y: number; z: number; w: number
    setFromAxisAngle(axis: Vector3, angle: number): this
    setFromEuler(e: Euler): this
    multiply(q: Quaternion): this
    slerp(q: Quaternion, t: number): this
    copy(q: Quaternion): this
    clone(): Quaternion
    invert(): this
  }
  class Euler {
    constructor(x?: number, y?: number, z?: number, order?: string)
    x: number; y: number; z: number
    set(x: number, y: number, z: number): this
    copy(e: Euler): this
  }
  class Color {
    constructor(color?: string | number)
    r: number; g: number; b: number
    set(color: string | number): this
    setHSL(h: number, s: number, l: number): this
    lerp(c: Color, alpha: number): this
    getHexString(): string
  }
  class Object3D {
    name: string
    visible: boolean
    position: Vector3
    rotation: Euler
    quaternion: Quaternion
    scale: Vector3
    parent: Object3D | null
    children: Object3D[]
    userData: Record<string, any>
    add(...objects: Object3D[]): this
    remove(...objects: Object3D[]): this
    lookAt(x: number | Vector3, y?: number, z?: number): void
    rotateX(angle: number): this
    rotateY(angle: number): this
    rotateZ(angle: number): this
    translateX(d: number): this
    translateY(d: number): this
    translateZ(d: number): this
    getWorldPosition(target: Vector3): Vector3
    getWorldQuaternion(target: Quaternion): Quaternion
    getWorldDirection(target: Vector3): Vector3
    traverse(callback: (object: Object3D) => void): void
    getObjectByName(name: string): Object3D | undefined
    [key: string]: any
  }
  const MathUtils: {
    degToRad(degrees: number): number
    radToDeg(radians: number): number
    clamp(value: number, min: number, max: number): number
    lerp(a: number, b: number, t: number): number
    damp(x: number, y: number, lambda: number, dt: number): number
    randFloat(low: number, high: number): number
    randInt(low: number, high: number): number
    smoothstep(x: number, min: number, max: number): number
    [key: string]: any
  }
}

/** three.js. Common classes are typed; everything else is any. */
declare const THREE: {
  Vector3: typeof T3.Vector3
  Vector2: typeof T3.Vector2
  Quaternion: typeof T3.Quaternion
  Euler: typeof T3.Euler
  Color: typeof T3.Color
  Object3D: typeof T3.Object3D
  MathUtils: typeof T3.MathUtils
  [key: string]: any
}

/** Damping and movement helpers from the engine. */
declare const helpers: {
  damp(current: number, target: number, lambda: number, dt: number): number
  dampAngle(current: number, target: number, lambda: number, dt: number): number
  moveTowards(current: number, target: number, maxDelta: number): number
  teleport(body: import('engine').RigidBody, position: T3.Vector3): void
}
`
