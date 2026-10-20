import { mulberry32 } from '../engine'
import {
  componentDefaults,
  createEntity,
  defaultSettings,
  type EntityDoc,
  type MeshDoc,
  type ProjectDoc,
  type Vec3,
} from './document'

/** "Coin Rush": a small platformer built entirely from editor components and built-in scripts. */
export function sampleProject(): ProjectDoc {
  const random = mulberry32(7)
  const entities: EntityDoc[] = []
  const mesh = (patch: Partial<MeshDoc>): MeshDoc => ({ ...componentDefaults.mesh(), ...patch })
  const add = (e: EntityDoc) => (entities.push(e), e)

  add(
    createEntity('Main Camera', {
      transform: { position: [0, 6, 10], rotation: [-20, 0, 0], scale: [1, 1, 1] },
      camera: componentDefaults.camera(),
      scripts: [{ script: 'builtin:FollowCamera', params: {} }],
    }),
  )
  add(
    createEntity('Sun', {
      transform: { position: [12, 25, 10], rotation: [-60, 45, 0], scale: [1, 1, 1] },
      light: { ...componentDefaults.light(), type: 'directional', color: '#fff2dd', intensity: 2.4, castShadow: true, shadowArea: 70 },
    }),
  )
  add(
    createEntity('Sky Light', {
      light: { ...componentDefaults.light(), type: 'hemisphere', color: '#eaf4ff', groundColor: '#56663f', intensity: 1.2 },
    }),
  )

  const level = add(createEntity('Level'))
  const block = (name: string, size: Vec3, at: Vec3, color: string, parent = level.id) =>
    add(
      createEntity(name, {
        parent,
        transform: { position: at, rotation: [0, 0, 0], scale: size },
        mesh: mesh({ color, roughness: 0.85 }),
        collider: componentDefaults.collider(),
      }),
    )
  block('Ground', [60, 1, 60], [0, -0.5, 0], '#7fa65a')

  const coinSpots: Vec3[] = []
  const stairs = add(createEntity('Staircase', { parent: level.id }))
  for (let i = 0; i < 9; i++) {
    const angle = i * 0.42
    const x = Math.cos(angle) * 13
    const z = Math.sin(angle) * 13
    const h = 0.8 + i * 0.85
    block(`Step ${i + 1}`, [3, h, 3], [x, h / 2, z], i % 2 ? '#c9c2b4' : '#e0795b', stairs.id)
    coinSpots.push([x, h + 1, z])
  }
  const blocks = add(createEntity('Blocks', { parent: level.id }))
  for (let i = 0; i < 14; i++) {
    const x = (random() - 0.5) * 50
    const z = (random() - 0.5) * 50
    if (Math.hypot(x, z) < 6) continue
    const h = 0.6 + random() * 2
    block(`Block ${i + 1}`, [2 + random() * 3, h, 2 + random() * 3], [x, h / 2, z], '#c9c2b4', blocks.id)
    coinSpots.push([x, h + 1, z])
  }
  for (let i = 0; i < 10; i++) {
    const angle = (i / 10) * Math.PI * 2
    coinSpots.push([Math.cos(angle) * 6, 1, Math.sin(angle) * 6])
  }

  const coins = add(createEntity('Coins'))
  coinSpots.forEach((at, i) =>
    add(
      createEntity(`Coin ${i + 1}`, {
        parent: coins.id,
        transform: { position: at, rotation: [90, 0, 0], scale: [0.9, 0.1, 0.9] },
        mesh: mesh({ shape: 'cylinder', color: '#ffc83d', metalness: 0.7, roughness: 0.25, emissive: '#6b4a00' }),
        collider: { ...componentDefaults.collider(), shape: 'sphere', radius: 0.7, trigger: true },
        scripts: [
          { script: 'builtin:Rotate', params: { x: 0, y: 0, z: 180 } },
          { script: 'builtin:Bob', params: {} },
          { script: 'builtin:Collectible', params: {} },
        ],
      }),
    ),
  )

  const player = add(
    createEntity('Player', {
      transform: { position: [0, 1.5, 0], rotation: [0, 0, 0], scale: [0.8, 0.9, 0.8] },
      mesh: mesh({ shape: 'capsule', color: '#3d7bd9', roughness: 0.5 }),
      rigidBody: componentDefaults.rigidBody(),
      collider: { ...componentDefaults.collider(), size: [1, 2, 1] },
      scripts: [{ script: 'builtin:PlayerController', params: {} }],
    }),
  )
  add(
    createEntity('Visor', {
      parent: player.id,
      transform: { position: [0, 0.4, -0.42], rotation: [0, 0, 0], scale: [0.6, 0.2, 0.25] },
      mesh: mesh({ color: '#1b2433', roughness: 0.3 }),
    }),
  )

  return {
    version: 1,
    name: 'Coin Rush',
    settings: { ...defaultSettings(), fog: true, fogNear: 50, fogFar: 160 },
    entities,
    scripts: [],
  }
}
