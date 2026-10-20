/**
 * The serializable project format. The editor only ever edits this plain
 * data; edit mode and play mode are both built from it.
 */
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
  /** Texture asset id. */
  map: string | null
  castShadow: boolean
  receiveShadow: boolean
}

export interface ModelDoc {
  /** Model asset id. */
  asset: string | null
  castShadow: boolean
  receiveShadow: boolean
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
}

export type BodyType = 'dynamic' | 'kinematic' | 'character'

export interface RigidBodyDoc {
  /** dynamic: simulated. kinematic: moved by scripts. character: walks with slopes/steps (for players, NPCs). */
  type: BodyType
  /** kg; 0 = derived from collider volume. */
  mass: number
  lockRotation: boolean
  gravityScale: number
  damping: number
  restitution: number
}

export type ColliderShapeDoc = 'box' | 'sphere' | 'capsule' | 'cylinder'

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
  rigidBody?: RigidBodyDoc
  collider?: ColliderDoc
  scripts: ScriptRefDoc[]
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
}

export interface ProjectDoc {
  version: 1
  name: string
  settings: SceneSettings
  /** Flat list; array order is sibling order. */
  entities: EntityDoc[]
  scripts: ScriptDoc[]
}

export type ComponentKey = 'mesh' | 'model' | 'light' | 'camera' | 'rigidBody' | 'collider'

export const COMPONENT_LABELS: Record<ComponentKey, string> = {
  mesh: 'Mesh Renderer',
  model: 'Model',
  light: 'Light',
  camera: 'Camera',
  rigidBody: 'Rigid Body',
  collider: 'Collider',
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
    castShadow: true,
    receiveShadow: true,
  }),
  model: (): ModelDoc => ({ asset: null, castShadow: true, receiveShadow: true }),
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
  camera: (): CameraDoc => ({ fov: 60, near: 0.1, far: 1000, main: true }),
  rigidBody: (): RigidBodyDoc => ({
    type: 'dynamic',
    mass: 0,
    lockRotation: false,
    gravityScale: 1,
    damping: 0,
    restitution: 0,
  }),
  collider: (): ColliderDoc => ({
    shape: 'box',
    size: [1, 1, 1],
    radius: 0.5,
    height: 1,
    center: [0, 0, 0],
    trigger: false,
    friction: 0.5,
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
  }
}

export function emptyProject(): ProjectDoc {
  const sun = createEntity('Directional Light', {
    transform: { position: [8, 14, 6], rotation: [-55, 40, 0], scale: [1, 1, 1] },
    light: { ...componentDefaults.light(), type: 'directional', intensity: 2, castShadow: true },
  })
  const camera = createEntity('Main Camera', {
    transform: { position: [0, 4, 10], rotation: [-15, 0, 0], scale: [1, 1, 1] },
    camera: componentDefaults.camera(),
  })
  return { version: 1, name: 'Untitled', settings: defaultSettings(), entities: [camera, sun], scripts: [] }
}

export function childrenOf(doc: ProjectDoc, parent: string | null): EntityDoc[] {
  return doc.entities.filter((e) => e.parent === parent)
}

/** The entity and all its descendants. */
export function subtreeIds(doc: ProjectDoc, id: string): Set<string> {
  const ids = new Set([id])
  let grew = true
  while (grew) {
    grew = false
    for (const e of doc.entities) {
      if (e.parent && ids.has(e.parent) && !ids.has(e.id)) {
        ids.add(e.id)
        grew = true
      }
    }
  }
  return ids
}

/** Entities ordered so every parent precedes its children. */
export function depthFirst(doc: ProjectDoc): EntityDoc[] {
  const byParent = new Map<string | null, EntityDoc[]>()
  for (const e of doc.entities) {
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
export function cloneSubtree(doc: ProjectDoc, id: string): EntityDoc[] {
  const ids = subtreeIds(doc, id)
  const remap = new Map<string, string>()
  for (const old of ids) remap.set(old, newId())
  return doc.entities
    .filter((e) => ids.has(e.id))
    .map((e) => ({
      ...structuredClone(e),
      id: remap.get(e.id)!,
      parent: e.id === id ? e.parent : remap.get(e.parent!)!,
      name: e.id === id ? `${e.name} (copy)` : e.name,
    }))
}

export function parseProject(json: unknown): ProjectDoc {
  const doc = json as Partial<ProjectDoc>
  if (!doc || doc.version !== 1 || !Array.isArray(doc.entities)) throw new Error('Not a project file (version 1)')
  return {
    version: 1,
    name: doc.name ?? 'Untitled',
    settings: { ...defaultSettings(), ...doc.settings },
    entities: doc.entities.map(migrateEntity),
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
  if (e.collider) e.collider = { ...componentDefaults.collider(), ...e.collider }
  return e
}
