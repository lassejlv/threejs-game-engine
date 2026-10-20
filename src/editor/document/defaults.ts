import { defaultNavSettings } from '../../engine/navigation/NavGrid'
import { encodeHeights, generateHills } from './terrain'
import {
  type AudioSourceDoc,
  type CameraDoc,
  type ColliderDoc,
  type ComponentKey,
  type EntityDoc,
  FORMAT_VERSION,
  type InputActionDoc,
  type InputAxisDoc,
  type JointDoc,
  type LightDoc,
  type MeshDoc,
  type ModelDoc,
  type ParticlesDoc,
  type Primitive,
  type ProjectDoc,
  type ProjectSettings,
  type RigidBodyDoc,
  type SceneDoc,
  type SceneSettings,
  type SpriteDoc,
  type TerrainDoc,
  type UiElementDoc,
} from './types'

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
  }
}

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
  return { version: FORMAT_VERSION, name: 'Untitled', settings: defaultProjectSettings(), scenes: [createScene('Main')], prefabs: [], scripts: [] }
}
