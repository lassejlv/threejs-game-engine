/**
 * The serializable project format. The editor only ever edits this plain
 * data; edit mode and play mode are both built from it. Defaults, prefab
 * expansion and the rest live next to this file; ../document.ts re-exports all.
 */
import type { NavSettings } from '../../engine/navigation/NavGrid'
import type { AnimStateDef, AnimTransitionDef } from '../runtime/animator'

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

/** The project file format this editor writes (see projectFormat.ts for migrations). */
export const FORMAT_VERSION = 3

export interface ProjectDoc {
  version: typeof FORMAT_VERSION
  /** Engine version that last saved the file (format 3+). */
  engine?: string
  name: string
  settings: ProjectSettings
  /** The first scene is where an exported game starts. */
  scenes: SceneDoc[]
  prefabs: PrefabDoc[]
  scripts: ScriptDoc[]
}

export type ComponentKey = 'mesh' | 'model' | 'sprite' | 'light' | 'camera' | 'audio' | 'particles' | 'rigidBody' | 'collider' | 'joint' | 'terrain'
