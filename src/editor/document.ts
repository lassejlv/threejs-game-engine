/**
 * The serializable project format. The editor only ever edits this plain
 * data; edit mode and play mode are both built from it.
 */
import { defaultNavSettings, type NavSettings } from '../engine/navigation/NavGrid'
import type { AnimStateDef, AnimTransitionDef } from './runtime/animator'

export type Vec3 = [number, number, number]
export type Primitive = 'box' | 'sphere' | 'cylinder' | 'capsule' | 'plane' | 'cone' | 'torus'
export type LightType = 'directional' | 'point' | 'spot' | 'hemisphere'
export type ParamValue = number | string | boolean

export interface TransformDoc {
  position: Vec3
  /** Euler XYZ in degrees. */
  rotation: Vec3
  scale: Vec3
}

export interface MeshDoc {
  shape: Primitive
  color: string
  metalness: number
  roughness: number
  emissive: string
  emissiveIntensity: number
  /** Texture asset id (base color). */
  map: string | null
  /** Texture asset ids for the other PBR channels. */
  normalMap: string | null
  normalScale: number
  roughnessMap: string | null
  metalnessMap: string | null
  emissiveMap: string | null
  /** Texture repeats across the surface (U, V). */
  tiling: [number, number]
  /** Below 1 the surface is see-through. */
  opacity: number
  /** Render both faces (planes seen from below, leaves). */
  doubleSided: boolean
  castShadow: boolean
  receiveShadow: boolean
}

export interface ModelDoc {
  /** Model asset id. */
  asset: string | null
  castShadow: boolean
  receiveShadow: boolean
  /** Clip to play on start in play mode ('' = none). */
  animation: string
  animationSpeed: number
  animationLoop: boolean
  /** Simpler versions of the model, shown beyond each distance from the camera (static models). */
  lods: ModelLodDoc[]
  /** Hide the model beyond this distance; 0 = never. */
  cullDistance: number
  /** Animation state machine: the first state plays on start (instead of `animation`). Empty = off. */
  animStates: AnimStateDef[]
  animTransitions: AnimTransitionDef[]
}

export interface ModelLodDoc {
  /** Model asset id. */
  asset: string | null
  distance: number
}

export interface LightDoc {
  type: LightType
  color: string
  /** Hemisphere lights only. */
  groundColor: string
  intensity: number
  /** Point/spot range; 0 = infinite. */
  distance: number
  /** Spot cone angle in degrees. */
  angle: number
  castShadow: boolean
  /** Directional shadow coverage in world units. */
  shadowArea: number
}

export interface CameraDoc {
  fov: number
  near: number
  far: number
  /** The camera used in play mode. */
  main: boolean
  /** Orthographic: no perspective, for 2D games and isometric views. */
  projection: 'perspective' | 'orthographic'
  /** Orthographic: half the visible height in meters. */
  orthoSize: number
}

/** A flat textured (or plain colored) rectangle facing +Z: the building block of 2D games. */
export interface SpriteDoc {
  /** Texture asset id; none draws a plain rectangle. */
  texture: string | null
  /** Tint (multiplies the texture). */
  color: string
  /** Width and height in meters, before the entity's scale. */
  size: [number, number]
  flipX: boolean
  /** Crisp pixels (nearest filtering) instead of smoothing. */
  pixelArt: boolean
  /** Sprite sheet: columns × rows of frames in the texture. */
  sheetColumns: number
  sheetRows: number
  /** Frames per second to loop through the sheet; 0 shows `frame`. */
  fps: number
  frame: number
  /** Higher draws in front of lower among overlapping sprites. */
  order: number
}

export type BodyType = 'dynamic' | 'kinematic' | 'character'

export interface AudioSourceDoc {
  /** Audio asset id. */
  asset: string | null
  volume: number
  loop: boolean
  playOnStart: boolean
  /** 3D: volume falls off with distance from the listener (the active camera). */
  spatial: boolean
  /** Distance at which a spatial source starts to get quieter. */
  refDistance: number
}

export interface RigidBodyDoc {
  /** dynamic: simulated. kinematic: moved by scripts. character: walks with slopes/steps (for players, NPCs). */
  type: BodyType
  /** kg; 0 = derived from collider volume. */
  mass: number
  lockRotation: boolean
  gravityScale: number
  damping: number
  restitution: number
  /** 2D: moves only in the XY plane and turns only around Z. */
  planar: boolean
}

export type EmitterShape = 'point' | 'sphere' | 'box'
/** How a value moves from its start to its end setting over a particle's life. bump: start → end → start. */
export type LifeCurve = 'linear' | 'easeIn' | 'easeOut' | 'smooth' | 'bump'

export interface ParticlesDoc {
  /** Play mode: start emitting when the entity is created. Scripts can call play/stop/burst. */
  playOnStart: boolean
  /** Particles per second while emitting. */
  rate: number
  /** Extra particles per meter the entity moves while emitting: trails behind moving objects. */
  rateOverDistance: number
  /** Particles emitted at once each time the emitter starts. */
  burst: number
  /** Seconds the emitter runs before it stops; 0 = forever. */
  duration: number
  maxParticles: number
  /** Seconds a particle lives. */
  lifetime: number
  /** 0..1: how much lifetime, speed and size vary between particles. */
  randomness: number
  /** Where particles start, in the entity's local space. */
  shape: EmitterShape
  /** Sphere shape radius. */
  radius: number
  /** Box shape size. */
  boxSize: Vec3
  speed: number
  /** Cone half-angle around the entity's up axis in degrees: 0 = straight up, 180 = every direction. */
  spread: number
  /** Downward acceleration in m/s²; negative values float up. */
  gravity: number
  /** Velocity lost per second. */
  drag: number
  /** World units. */
  startSize: number
  endSize: number
  startColor: string
  endColor: string
  startOpacity: number
  endOpacity: number
  sizeCurve: LifeCurve
  opacityCurve: LifeCurve
  /** Degrees per second each particle spins (direction and start angle are random). */
  spin: number
  /** Sprite sheet: the texture holds columns × rows frames. */
  sheetColumns: number
  sheetRows: number
  /** life: play the frames once over each particle's life. random: one random frame per particle. */
  sheetMode: 'life' | 'random'
  /**
   * Sub-emitter: instead of emitting on its own, emit `burst` particles wherever
   * the parent entity's emitter births or kills a particle (sparks off fireworks).
   */
  trigger: 'none' | 'parentBirth' | 'parentDeath'
  /** Additive glows (fire, sparks, magic); normal suits smoke and dust. */
  blending: 'additive' | 'normal'
  /** Texture asset id; none draws soft round dots. */
  texture: string | null
  /** Particles stay where they were emitted instead of moving with the entity (trails, smoke). */
  worldSpace: boolean
  /** Play mode ("Auto destroy"): destroy the entity once it has stopped emitting and its last particle is gone. */
  destroyWhenDone: boolean
}

/** mesh: the exact surface of the entity's mesh or model (static/kinematic). convex: its convex hull (any body). */
export interface TerrainDoc {
  /** Height samples per side (the grid is resolution × resolution). */
  resolution: number
  /** Width (x) and depth (z) in meters, before the entity's scale. */
  size: [number, number]
  /** Heights in meters: base64 of a Float32Array, row by row from -z to +z (see encodeHeights). */
  heights: string
  color: string
  /** Color on steep ground (cliffs). */
  slopeColor: string
  /** Steepness in degrees where the slope color takes over. */
  slopeAngle: number
  /** Texture asset id, tiled over the terrain. */
  texture: string | null
  tiling: number
}

export function encodeHeights(heights: Float32Array): string {
  const bytes = new Uint8Array(heights.buffer, heights.byteOffset, heights.byteLength)
  let text = ''
  for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(text)
}

export function decodeHeights(encoded: string, resolution: number): Float32Array {
  const out = new Float32Array(resolution * resolution)
  if (!encoded) return out
  const text = atob(encoded)
  const bytes = new Uint8Array(text.length)
  for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i)
  out.set(new Float32Array(bytes.buffer, 0, Math.min(out.length, Math.floor(bytes.length / 4))))
  return out
}

/** Smooth rolling hills (deterministic for a seed): a starting point for sculpting. */
export function generateHills(resolution: number, size: [number, number], height: number, seed = 1): Float32Array {
  const out = new Float32Array(resolution * resolution)
  let s = seed >>> 0
  const random = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296)
  const waves = Array.from({ length: 6 }, (_, i) => ({
    kx: ((random() - 0.5) * 2 * Math.PI * (i + 1)) / size[0],
    kz: ((random() - 0.5) * 2 * Math.PI * (i + 1)) / size[1],
    phase: random() * Math.PI * 2,
    amp: height / (i + 1.5),
  }))
  for (let z = 0; z < resolution; z++) {
    for (let x = 0; x < resolution; x++) {
      const px = (x / (resolution - 1) - 0.5) * size[0]
      const pz = (z / (resolution - 1) - 0.5) * size[1]
      let h = 0
      for (const w of waves) h += Math.sin(px * w.kx + pz * w.kz + w.phase) * w.amp
      out[z * resolution + x] = Math.max(0, h * 0.5 + height * 0.25)
    }
  }
  return out
}

export type ColliderShapeDoc = 'box' | 'sphere' | 'capsule' | 'cylinder' | 'mesh' | 'convex'

export interface ColliderDoc {
  shape: ColliderShapeDoc
  /** Box size in local units (multiplied by the entity's world scale). */
  size: Vec3
  /** Sphere/capsule/cylinder radius. */
  radius: number
  /** Capsule/cylinder total height. */
  height: number
  center: Vec3
  trigger: boolean
  friction: number
  /** Physics layer index (0-15); which layers collide is set in Project Settings. */
  layer: number
}

export type JointTypeDoc = 'fixed' | 'hinge' | 'ball' | 'slider' | 'spring'

export interface JointDoc {
  type: JointTypeDoc
  /** Id of the entity whose rigid body this connects to; null = a fixed point in the world. */
  target: string | null
  /** Joint point relative to this entity (local units, before scale). */
  anchor: Vec3
  /** Hinge/slider axis in this entity's local space. */
  axis: Vec3
  limits: boolean
  /** Hinge: degrees. Slider: meters. */
  min: number
  max: number
  /** Spring: rest length in meters; -1 = the distance at start. */
  restLength: number
  stiffness: number
  damping: number
  /** Hinge (degrees/s) or slider (m/s) motor speed. */
  motorSpeed: number
  /** 0 = no motor. */
  motorStrength: number
}

export interface ScriptRefDoc {
  /** `builtin:Name` or a project script id. */
  script: string
  params: Record<string, ParamValue>
}

export interface EntityDoc {
  id: string
  name: string
  parent: string | null
  active: boolean
  transform: TransformDoc
  mesh?: MeshDoc
  model?: ModelDoc
  light?: LightDoc
  camera?: CameraDoc
  audio?: AudioSourceDoc
  particles?: ParticlesDoc
  sprite?: SpriteDoc
  rigidBody?: RigidBodyDoc
  collider?: ColliderDoc
  joint?: JointDoc
  /** Sculptable ground; it collides as a static heightfield unless the entity has its own Collider. */
  terrain?: TerrainDoc
  /**
   * On a prefab instance these are parameter overrides: entries whose script
   * matches one on the prefab root replace that script's params.
   */
  scripts: ScriptRefDoc[]
  /** Prefab id: this entity is an instance and its contents come from the prefab. */
  prefab?: string
  /**
   * On a prefab instance: per-part changes, keyed by the id of the entity inside
   * the (expanded) prefab. The root's transform, name and active flag live on the
   * instance itself; its component changes are keyed by the prefab root's id.
   */
  overrides?: Record<string, EntityOverride>
}

/** Field changes a prefab instance makes to one entity of its prefab. */
export type EntityOverride = { [K in ComponentKey]?: Partial<NonNullable<EntityDoc[K]>> } & {
  name?: string
  active?: boolean
  transform?: TransformDoc
}

const OVERRIDABLE: ComponentKey[] = ['mesh', 'model', 'sprite', 'light', 'camera', 'audio', 'particles', 'rigidBody', 'collider', 'joint', 'terrain']

/** An entity with an instance's overrides applied (only components it already has are changed). */
export function applyOverride(e: EntityDoc, override: EntityOverride | undefined, isRoot: boolean): EntityDoc {
  if (!override) return e
  const out: EntityDoc = { ...e }
  for (const key of OVERRIDABLE) {
    const patch = override[key]
    if (patch && out[key]) (out as unknown as Record<string, unknown>)[key] = { ...out[key], ...patch }
  }
  // The root's name/active/transform come from the instance itself.
  if (!isRoot) {
    if (override.name !== undefined) out.name = override.name
    if (override.active !== undefined) out.active = override.active
    if (override.transform) out.transform = override.transform
  }
  return out
}

export interface ScriptDoc {
  id: string
  name: string
  source: string
}

export interface SceneSettings {
  background: string
  ambientColor: string
  ambientIntensity: number
  fog: boolean
  fogColor: string
  fogNear: number
  fogFar: number
  /** Downward acceleration in m/s². */
  gravity: number
  /** color: flat background. gradient: three-color sky. texture: an equirectangular (360°) image asset. */
  sky: 'color' | 'gradient' | 'texture'
  skyTop: string
  skyHorizon: string
  skyBottom: string
  skyTexture: string | null
  /** Lights and reflects the scene with the sky (image-based lighting). */
  environment: boolean
  environmentIntensity: number
  shadows: ShadowQuality
  /** Tone-mapping exposure. */
  exposure: number
  bloom: boolean
  bloomStrength: number
  bloomRadius: number
  bloomThreshold: number
  /** Darkens the screen edges, 0..1. */
  vignette: number
  saturation: number
  contrast: number
  /** Pathfinding grid for ctx.nav, baked from static colliders when a script first needs it. */
  navigation: NavSettings
  /** Music when the scene starts: an audio asset id, '' to keep whatever is playing, or 'stop'. */
  music: string
  musicVolume: number
}

export type ShadowQuality = 'off' | 'low' | 'medium' | 'high'

export interface SceneDoc {
  id: string
  name: string
  settings: SceneSettings
  /** Flat list; array order is sibling order. */
  entities: EntityDoc[]
  /** Screen UI laid out in the editor, drawn above the game (array order = drawing order). */
  ui: UiElementDoc[]
}

export type UiAnchor = 'top-left' | 'top' | 'top-right' | 'left' | 'center' | 'right' | 'bottom-left' | 'bottom' | 'bottom-right'

export interface UiElementDoc {
  id: string
  type: 'text' | 'button' | 'bar' | 'image'
  /** Scripts address it by this name (ctx.ui.text(name, ...) replaces its text). */
  name: string
  visible: boolean
  anchor: UiAnchor
  /** Pixel offset from the anchor; positive is right/down. */
  x: number
  y: number
  /** Text or button label. `{key}` shows ctx.globals[key], updated live. */
  text: string
  size: number
  color: string
  /** Card color; empty = default card, 'none' = no card. */
  background: string
  /** Pixels; 0 = fit the content. */
  width: number
  /** Bar fill: a number, a globals key, or `key/key` for a ratio (e.g. `Coins:got/Coins:total`). */
  value: string
  fill: string
  /** Button: what a click does. */
  action: 'none' | 'loadScene' | 'emit'
  /** Scene name (loadScene) or event name (emit). */
  target: string
  /** Image: texture asset id. */
  image: string | null
}

export function createUiElement(type: UiElementDoc['type'], name: string): UiElementDoc {
  return {
    id: newId(),
    type,
    name,
    visible: true,
    anchor: type === 'button' ? 'center' : type === 'bar' ? 'top-left' : 'top',
    x: 0,
    y: type === 'bar' ? 80 : 0,
    text: type === 'button' ? 'Play' : type === 'text' ? 'Text' : '',
    size: type === 'text' ? 18 : 14,
    color: '#ffffff',
    background: '',
    width: type === 'image' ? 96 : 0,
    value: type === 'bar' ? '0.5' : '',
    fill: '#4cd97b',
    action: 'none',
    target: '',
    image: null,
  }
}

/** A reusable entity tree. Exactly one entity has `parent: null` (the root). */
export interface PrefabDoc {
  id: string
  name: string
  entities: EntityDoc[]
}

export interface ProjectSettings {
  /** Names of the 16 physics layers. */
  layerNames: string[]
  /** Per layer: bit mask of the layers it collides with (kept symmetric). */
  layerCollisions: number[]
  /** Named buttons scripts read with `ctx.input.action('Jump')`. */
  inputActions: InputActionDoc[]
  /** Named -1..1 axes scripts read with `ctx.input.getAxis('MoveX')`. */
  inputAxes: InputAxisDoc[]
  /** On-screen joystick and buttons: on touch screens only (auto), always, or never. */
  touchControls: 'auto' | 'always' | 'off'
  /** Actions that get an on-screen button. */
  touchButtons: string[]
  /** Exports leave out assets nothing references unless this is on. */
  exportIncludeUnused: boolean
  /** Exports compress models (meshopt) and re-encode textures (WebP). */
  exportCompress: boolean
  /** WebGPU draws through three's node-material renderer (WebGL 2 where WebGPU is missing). */
  renderer: 'webgl' | 'webgpu'
  /** WebSocket URL of the multiplayer relay (server/relay.mjs) that `ctx.net` joins. */
  multiplayerServer: string
}

export interface InputActionDoc {
  name: string
  /** KeyboardEvent.code values, 'Mouse0'-'Mouse2' or 'GamepadA' etc. */
  keys: string[]
}

export interface InputAxisDoc {
  name: string
  negative: string[]
  positive: string[]
  /** Gamepad stick axis: 0 left X, 1 left Y, 2 right X, 3 right Y; -1 = none. */
  gamepadAxis: number
  invert: boolean
}

/** Bindings every game starts with; the built-in scripts use these names. */
export function defaultInputActions(): InputActionDoc[] {
  return [
    { name: 'Jump', keys: ['Space', 'GamepadA'] },
    { name: 'Sprint', keys: ['ShiftLeft', 'ShiftRight', 'GamepadRB'] },
    { name: 'Fire', keys: ['KeyE', 'GamepadX'] },
    { name: 'Interact', keys: ['KeyF', 'GamepadY'] },
  ]
}

export function defaultInputAxes(): InputAxisDoc[] {
  return [
    { name: 'MoveX', negative: ['KeyA', 'ArrowLeft'], positive: ['KeyD', 'ArrowRight'], gamepadAxis: 0, invert: false },
    { name: 'MoveY', negative: ['KeyS', 'ArrowDown'], positive: ['KeyW', 'ArrowUp'], gamepadAxis: 1, invert: true },
    { name: 'LookX', negative: [], positive: [], gamepadAxis: 2, invert: false },
    { name: 'LookY', negative: [], positive: [], gamepadAxis: 3, invert: false },
  ]
}

export const LAYER_COUNT = 16

export function defaultProjectSettings(): ProjectSettings {
  return {
    layerNames: ['Default', 'Player', 'Enemy', 'Projectile', 'Pickup', ...Array.from({ length: LAYER_COUNT - 5 }, (_, i) => `Layer ${i + 5}`)],
    layerCollisions: Array.from({ length: LAYER_COUNT }, () => 0xffff),
    inputActions: defaultInputActions(),
    inputAxes: defaultInputAxes(),
    touchControls: 'auto',
    touchButtons: ['Jump', 'Fire', 'Sprint'],
    exportIncludeUnused: false,
    exportCompress: true,
    renderer: 'webgl',
    multiplayerServer: 'ws://localhost:8787',
  }
}

export interface ProjectDoc {
  version: 2
  name: string
  settings: ProjectSettings
  /** The first scene is where an exported game starts. */
  scenes: SceneDoc[]
  prefabs: PrefabDoc[]
  scripts: ScriptDoc[]
}

export type ComponentKey = 'mesh' | 'model' | 'sprite' | 'light' | 'camera' | 'audio' | 'particles' | 'rigidBody' | 'collider' | 'joint' | 'terrain'

export const COMPONENT_LABELS: Record<ComponentKey, string> = {
  mesh: 'Mesh Renderer',
  model: 'Model',
  sprite: 'Sprite',
  light: 'Light',
  camera: 'Camera',
  audio: 'Audio Source',
  particles: 'Particle Emitter',
  rigidBody: 'Rigid Body',
  collider: 'Collider',
  joint: 'Joint',
  terrain: 'Terrain',
}

export const PRIMITIVE_COLLIDER: Record<Primitive, Pick<ColliderDoc, 'shape' | 'size' | 'radius' | 'height'>> = {
  box: { shape: 'box', size: [1, 1, 1], radius: 0.5, height: 1 },
  sphere: { shape: 'sphere', size: [1, 1, 1], radius: 0.5, height: 1 },
  cylinder: { shape: 'cylinder', size: [1, 1, 1], radius: 0.5, height: 1 },
  capsule: { shape: 'capsule', size: [1, 2, 1], radius: 0.5, height: 2 },
  plane: { shape: 'box', size: [1, 0.02, 1], radius: 0.5, height: 1 },
  cone: { shape: 'cylinder', size: [1, 1, 1], radius: 0.35, height: 1 },
  torus: { shape: 'box', size: [1.1, 0.3, 1.1], radius: 0.55, height: 0.3 },
}

export const componentDefaults = {
  mesh: (): MeshDoc => ({
    shape: 'box',
    color: '#c8ccd4',
    metalness: 0,
    roughness: 0.7,
    emissive: '#000000',
    emissiveIntensity: 1,
    map: null,
    normalMap: null,
    normalScale: 1,
    roughnessMap: null,
    metalnessMap: null,
    emissiveMap: null,
    tiling: [1, 1],
    opacity: 1,
    doubleSided: false,
    castShadow: true,
    receiveShadow: true,
  }),
  model: (): ModelDoc => ({
    asset: null,
    castShadow: true,
    receiveShadow: true,
    animation: '',
    animationSpeed: 1,
    animationLoop: true,
    lods: [],
    cullDistance: 0,
    animStates: [],
    animTransitions: [],
  }),
  light: (): LightDoc => ({
    type: 'point',
    color: '#ffffff',
    groundColor: '#444444',
    intensity: 1,
    distance: 0,
    angle: 30,
    castShadow: false,
    shadowArea: 40,
  }),
  camera: (): CameraDoc => ({ fov: 60, near: 0.1, far: 1000, main: true, projection: 'perspective', orthoSize: 6 }),
  sprite: (): SpriteDoc => ({
    texture: null,
    color: '#ffffff',
    size: [1, 1],
    flipX: false,
    pixelArt: true,
    sheetColumns: 1,
    sheetRows: 1,
    fps: 0,
    frame: 0,
    order: 0,
  }),
  audio: (): AudioSourceDoc => ({ asset: null, volume: 1, loop: false, playOnStart: true, spatial: true, refDistance: 5 }),
  particles: (): ParticlesDoc => ({
    playOnStart: true,
    rate: 20,
    rateOverDistance: 0,
    burst: 0,
    duration: 0,
    maxParticles: 500,
    lifetime: 1.5,
    randomness: 0.3,
    shape: 'point',
    radius: 0.5,
    boxSize: [1, 1, 1],
    speed: 2,
    spread: 25,
    gravity: 0,
    drag: 0,
    startSize: 0.3,
    endSize: 0.1,
    startColor: '#ffd27a',
    endColor: '#ff5a2a',
    startOpacity: 1,
    endOpacity: 0,
    sizeCurve: 'linear',
    opacityCurve: 'linear',
    spin: 0,
    sheetColumns: 1,
    sheetRows: 1,
    sheetMode: 'life',
    trigger: 'none',
    blending: 'additive',
    texture: null,
    worldSpace: true,
    destroyWhenDone: false,
  }),
  rigidBody: (): RigidBodyDoc => ({
    type: 'dynamic',
    mass: 0,
    lockRotation: false,
    gravityScale: 1,
    damping: 0,
    restitution: 0,
    planar: false,
  }),
  collider: (): ColliderDoc => ({
    shape: 'box',
    size: [1, 1, 1],
    radius: 0.5,
    height: 1,
    center: [0, 0, 0],
    trigger: false,
    friction: 0.5,
    layer: 0,
  }),
  terrain: (): TerrainDoc => ({
    resolution: 65,
    size: [64, 64],
    heights: encodeHeights(generateHills(65, [64, 64], 4)),
    color: '#6f9b4f',
    slopeColor: '#8a7a64',
    slopeAngle: 35,
    texture: null,
    tiling: 16,
  }),
  joint: (): JointDoc => ({
    type: 'hinge',
    target: null,
    anchor: [0, 0, 0],
    axis: [0, 1, 0],
    limits: false,
    min: -90,
    max: 90,
    restLength: -1,
    stiffness: 50,
    damping: 2,
    motorSpeed: 0,
    motorStrength: 0,
  }),
} satisfies { [K in ComponentKey]: () => NonNullable<EntityDoc[K]> }

export function defaultCollider(entity: EntityDoc): ColliderDoc {
  const base = componentDefaults.collider()
  return entity.mesh ? { ...base, ...structuredClone(PRIMITIVE_COLLIDER[entity.mesh.shape]) } : base
}

export function newId(): string {
  return crypto.randomUUID().slice(0, 8)
}

export function createEntity(name: string, partial: Partial<EntityDoc> = {}): EntityDoc {
  return {
    id: newId(),
    name,
    parent: null,
    active: true,
    transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
    scripts: [],
    ...partial,
  }
}

export function defaultSettings(): SceneSettings {
  return {
    background: '#a8cbe8',
    ambientColor: '#ffffff',
    ambientIntensity: 0.4,
    fog: false,
    fogColor: '#a8cbe8',
    fogNear: 50,
    fogFar: 200,
    gravity: 25,
    sky: 'color',
    skyTop: '#4f86d1',
    skyHorizon: '#cfe2f3',
    skyBottom: '#5e6b55',
    skyTexture: null,
    environment: false,
    environmentIntensity: 1,
    shadows: 'medium',
    exposure: 1,
    bloom: false,
    bloomStrength: 0.6,
    bloomRadius: 0.4,
    bloomThreshold: 0.9,
    vignette: 0,
    saturation: 1,
    contrast: 1,
    navigation: defaultNavSettings(),
    music: '',
    musicVolume: 0.8,
  }
}

export function createScene(name: string): SceneDoc {
  const sun = createEntity('Directional Light', {
    transform: { position: [8, 14, 6], rotation: [-55, 40, 0], scale: [1, 1, 1] },
    light: { ...componentDefaults.light(), type: 'directional', intensity: 2, castShadow: true },
  })
  const camera = createEntity('Main Camera', {
    transform: { position: [0, 4, 10], rotation: [-15, 0, 0], scale: [1, 1, 1] },
    camera: componentDefaults.camera(),
  })
  const ground = createEntity('Ground', {
    transform: { position: [0, -0.5, 0], rotation: [0, 0, 0], scale: [30, 1, 30] },
    mesh: { ...componentDefaults.mesh(), color: '#7a8a6a' },
    collider: componentDefaults.collider(),
  })
  return { id: newId(), name, settings: defaultSettings(), entities: [camera, sun, ground], ui: [] }
}

export function emptyProject(): ProjectDoc {
  return { version: 2, name: 'Untitled', settings: defaultProjectSettings(), scenes: [createScene('Main')], prefabs: [], scripts: [] }
}

export function prefabRoot(prefab: PrefabDoc): EntityDoc | undefined {
  return prefab.entities.find((e) => e.parent === null)
}

/** For an id produced by `expandEntities`, the top-level entity it belongs to. */
export function ownerId(id: string): string {
  const slash = id.indexOf('/')
  return slash === -1 ? id : id.slice(0, slash)
}

const MAX_PREFAB_DEPTH = 8

/**
 * Replaces prefab instances with the prefab's entities. The root keeps the
 * instance's id, name, parent, active flag and transform; inner entities get
 * ids of the form `instanceId/prefabEntityId`. Nested prefabs expand recursively.
 */
export function expandEntities(entities: EntityDoc[], prefabs: PrefabDoc[], depth = 0): EntityDoc[] {
  if (!entities.some((e) => e.prefab)) return entities
  const out: EntityDoc[] = []
  for (const e of entities) {
    if (e.prefab) out.push(...expandInstance(e, prefabs, depth))
    else out.push(e)
  }
  return out
}

function expandInstance(instance: EntityDoc, prefabs: PrefabDoc[], depth: number): EntityDoc[] {
  const prefab = prefabs.find((p) => p.id === instance.prefab)
  const root = prefab && prefabRoot(prefab)
  if (!prefab || !root || depth >= MAX_PREFAB_DEPTH) return [{ ...instance, prefab: undefined }]
  const inner = expandEntities(prefab.entities, prefabs, depth + 1)
  const innerIds = new Set(inner.map((e) => e.id))
  const mapId = (id: string) => (id === root.id ? instance.id : `${instance.id}/${id}`)
  // Joints between entities of the same prefab must point at this instance's copies.
  const remapJoint = (e: EntityDoc): EntityDoc =>
    e.joint?.target && innerIds.has(e.joint.target) ? { ...e, joint: { ...e.joint, target: mapId(e.joint.target) } } : e
  const overridden = (e: EntityDoc) => applyOverride(e, instance.overrides?.[e.id], e.id === root.id)
  return inner.map(overridden).map(remapJoint).map((e) =>
    e.id === root.id
      ? {
          ...e,
          id: instance.id,
          name: instance.name,
          parent: instance.parent,
          active: instance.active,
          transform: instance.transform,
          prefab: undefined,
          scripts: e.scripts.map((ref) => {
            const override = instance.scripts.find((o) => o.script === ref.script)
            return override ? { ...ref, params: { ...ref.params, ...override.params } } : ref
          }),
        }
      : { ...e, id: mapId(e.id), parent: e.parent ? mapId(e.parent) : instance.id },
  )
}

/** The entities of a prefab as instances see them (nested prefabs expanded): the keys `overrides` use. */
export function prefabParts(prefab: PrefabDoc, prefabs: PrefabDoc[]): EntityDoc[] {
  return expandEntities(prefab.entities, prefabs)
}

/** A prefab based on another: its root is an instance of `base`, so it inherits everything until overridden. */
export function createVariant(base: PrefabDoc, name = `${base.name} Variant`): PrefabDoc {
  const root = prefabRoot(base)
  return {
    id: newId(),
    name,
    entities: [createEntity(name, { transform: structuredClone(root?.transform ?? { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] }), prefab: base.id })],
  }
}

/** A new, unparented instance of `prefab` using the prefab root's transform. */
export function instantiatePrefab(prefab: PrefabDoc, partial: Partial<EntityDoc> = {}): EntityDoc {
  // `scripts` on an instance holds parameter overrides only (see EntityDoc.scripts).
  const root = prefabRoot(prefab)
  return createEntity(prefab.name, {
    transform: structuredClone(root?.transform ?? { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] }),
    prefab: prefab.id,
    ...partial,
  })
}

export function childrenOf(entities: EntityDoc[], parent: string | null): EntityDoc[] {
  return entities.filter((e) => e.parent === parent)
}

/** The entity and all its descendants. */
export function subtreeIds(entities: EntityDoc[], id: string): Set<string> {
  const ids = new Set([id])
  let grew = true
  while (grew) {
    grew = false
    for (const e of entities) {
      if (e.parent && ids.has(e.parent) && !ids.has(e.id)) {
        ids.add(e.id)
        grew = true
      }
    }
  }
  return ids
}

/** Entities ordered so every parent precedes its children. */
export function depthFirst(entities: EntityDoc[]): EntityDoc[] {
  const byParent = new Map<string | null, EntityDoc[]>()
  for (const e of entities) {
    const list = byParent.get(e.parent) ?? []
    list.push(e)
    byParent.set(e.parent, list)
  }
  const out: EntityDoc[] = []
  const visit = (parent: string | null) => {
    for (const e of byParent.get(parent) ?? []) {
      out.push(e)
      visit(e.id)
    }
  }
  visit(null)
  return out
}

/** Deep-copies an entity subtree with fresh ids. The copy's root keeps the original parent. */
export function cloneSubtree(entities: EntityDoc[], id: string, suffix = ' (copy)'): EntityDoc[] {
  const ids = subtreeIds(entities, id)
  const remap = new Map<string, string>()
  for (const old of ids) remap.set(old, newId())
  return entities
    .filter((e) => ids.has(e.id))
    .map((e) => {
      const copy: EntityDoc = {
        ...structuredClone(e),
        id: remap.get(e.id)!,
        parent: e.id === id ? e.parent : remap.get(e.parent!)!,
        name: e.id === id ? `${e.name}${suffix}` : e.name,
      }
      // A joint to another entity in the copied subtree connects to that entity's copy.
      if (copy.joint?.target && remap.has(copy.joint.target)) copy.joint.target = remap.get(copy.joint.target)!
      return copy
    })
}

/** Reads a saved project, upgrading older versions. */
export function parseProject(json: unknown): ProjectDoc {
  const raw = json as Record<string, unknown> | null
  if (!raw || typeof raw !== 'object') throw new Error('Not a project file')
  if (raw.version === 1 && Array.isArray(raw.entities)) {
    return parseProject({
      version: 2,
      name: raw.name,
      scenes: [{ id: newId(), name: 'Main', settings: raw.settings, entities: raw.entities }],
      prefabs: [],
      scripts: raw.scripts,
    })
  }
  if (raw.version !== 2 || !Array.isArray(raw.scenes) || raw.scenes.length === 0) throw new Error('Not a project file')
  const doc = raw as unknown as ProjectDoc
  const defaults = defaultProjectSettings()
  return {
    version: 2,
    name: doc.name ?? 'Untitled',
    settings: { ...defaults, ...doc.settings },
    scenes: doc.scenes.map((scene) => ({
      id: scene.id ?? newId(),
      name: scene.name ?? 'Scene',
      settings: { ...defaultSettings(), ...scene.settings, navigation: { ...defaultNavSettings(), ...scene.settings?.navigation } },
      entities: (scene.entities ?? []).map(migrateEntity),
      ui: (scene.ui ?? []).map((el) => ({ ...createUiElement(el.type ?? 'text', el.name ?? 'UI'), ...el })),
    })),
    prefabs: (doc.prefabs ?? []).map((p) => ({ ...p, entities: p.entities.map(migrateEntity) })),
    scripts: doc.scripts ?? [],
  }
}

/** Fills fields added after a file was saved. */
function migrateEntity(raw: EntityDoc): EntityDoc {
  const e: EntityDoc = { ...createEntity(raw.name ?? 'Entity'), ...raw, scripts: raw.scripts ?? [] }
  if (e.rigidBody) {
    const legacy = e.rigidBody as Partial<RigidBodyDoc> & { kinematic?: boolean }
    const { kinematic, ...rest } = legacy
    e.rigidBody = { ...componentDefaults.rigidBody(), type: kinematic ? 'kinematic' : 'dynamic', ...rest }
  }
  if (e.mesh) e.mesh = { ...componentDefaults.mesh(), ...e.mesh }
  if (e.collider) e.collider = { ...componentDefaults.collider(), ...e.collider }
  if (e.joint) e.joint = { ...componentDefaults.joint(), ...e.joint }
  if (e.terrain) e.terrain = { ...componentDefaults.terrain(), ...e.terrain }
  if (e.camera) e.camera = { ...componentDefaults.camera(), ...e.camera }
  if (e.sprite) e.sprite = { ...componentDefaults.sprite(), ...e.sprite }
  if (e.audio) e.audio = { ...componentDefaults.audio(), ...e.audio }
  if (e.model) e.model = { ...componentDefaults.model(), ...e.model }
  if (e.particles) e.particles = { ...componentDefaults.particles(), ...e.particles }
  return e
}

/**
 * Where an asset is used, as readable descriptions ("Coin Rush › Ground: Mesh texture").
 * Covers component fields, scene skies, and scripts that name it (sound.play('jump')).
 */
export function assetReferences(doc: ProjectDoc, id: string, fileName: string): string[] {
  const names = new Set([fileName, fileName.replace(/\.\w+$/, '')])
  const out: string[] = []
  const check = (where: string, e: EntityDoc) => {
    const uses: string[] = []
    const m = e.mesh
    if (m) {
      const slots: [string | null, string][] = [
        [m.map, 'Mesh texture'],
        [m.normalMap, 'Normal map'],
        [m.roughnessMap, 'Roughness map'],
        [m.metalnessMap, 'Metalness map'],
        [m.emissiveMap, 'Emissive map'],
      ]
      for (const [value, label] of slots) if (value === id) uses.push(label)
    }
    if (e.model?.asset === id) uses.push('Model')
    if (e.model?.lods.some((l) => l.asset === id)) uses.push('Model LOD')
    if (e.audio?.asset === id) uses.push('Audio Source')
    if (e.particles?.texture === id) uses.push('Particle texture')
    if (e.terrain?.texture === id) uses.push('Terrain texture')
    if (e.sprite?.texture === id) uses.push('Sprite')
    for (const ref of e.scripts) {
      if (Object.values(ref.params).some((v) => typeof v === 'string' && names.has(v))) uses.push('script parameter')
    }
    if (uses.length) out.push(`${where} › ${e.name}: ${uses.join(', ')}`)
  }
  for (const scene of doc.scenes) {
    if (scene.settings.skyTexture === id) out.push(`${scene.name}: sky`)
    if (scene.settings.music === id) out.push(`${scene.name}: music`)
    for (const el of scene.ui) if (el.image === id) out.push(`${scene.name} › UI ${el.name}: image`)
    for (const e of scene.entities) check(scene.name, e)
  }
  for (const prefab of doc.prefabs) for (const e of prefab.entities) check(`Prefab ${prefab.name}`, e)
  for (const script of doc.scripts) {
    if ([...names].some((n) => script.source.includes(`'${n}'`) || script.source.includes(`"${n}"`))) out.push(`Script ${script.name}`)
  }
  return out
}
