import { componentDefaults, type EntityDoc, type LightType, PRIMITIVE_COLLIDER, type Primitive } from './document'

export interface Preset {
  label: string
  group: 'General' | '3D Object' | 'Light' | 'Effects'
  name: string
  create(): Partial<EntityDoc>
}

const primitive = (shape: Primitive, label: string): Preset => ({
  label,
  group: '3D Object',
  name: label,
  create: () => ({
    mesh: { ...componentDefaults.mesh(), shape },
    collider: { ...componentDefaults.collider(), ...structuredClone(PRIMITIVE_COLLIDER[shape]) },
    ...(shape === 'plane' ? { transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [10, 1, 10] } } : {}),
  }),
})

const light = (type: LightType, label: string, patch: Partial<NonNullable<EntityDoc['light']>> = {}): Preset => ({
  label,
  group: 'Light',
  name: label,
  create: () => ({
    light: { ...componentDefaults.light(), type, ...patch },
    transform: {
      position: [0, 3, 0],
      rotation: type === 'directional' || type === 'spot' ? [-60, 30, 0] : [0, 0, 0],
      scale: [1, 1, 1],
    },
  }),
})

export const PRESETS: Preset[] = [
  { label: 'Empty', group: 'General', name: 'Empty', create: () => ({}) },
  { label: 'Camera', group: 'General', name: 'Camera', create: () => ({ camera: { ...componentDefaults.camera(), main: false } }) },
  primitive('box', 'Cube'),
  primitive('sphere', 'Sphere'),
  primitive('cylinder', 'Cylinder'),
  primitive('capsule', 'Capsule'),
  primitive('plane', 'Plane'),
  primitive('cone', 'Cone'),
  primitive('torus', 'Torus'),
  light('directional', 'Directional Light', { intensity: 2, castShadow: true }),
  light('point', 'Point Light', { intensity: 20, distance: 20 }),
  light('spot', 'Spot Light', { intensity: 40, distance: 30 }),
  light('hemisphere', 'Hemisphere Light'),
  {
    label: 'Terrain',
    group: '3D Object',
    name: 'Terrain',
    create: () => ({ terrain: componentDefaults.terrain() }),
  },
  {
    label: 'Particle System',
    group: 'Effects',
    name: 'Particle System',
    create: () => ({ particles: componentDefaults.particles() }),
  },
]
