import { mulberry32 } from '../engine'
import {
  componentDefaults,
  createEntity,
  defaultSettings,
  type EntityDoc,
  instantiatePrefab,
  type MeshDoc,
  newId,
  type PrefabDoc,
  type ProjectDoc,
  type SceneDoc,
  type ScriptDoc,
  type Vec3,
} from './document'

const mesh = (patch: Partial<MeshDoc>): MeshDoc => ({ ...componentDefaults.mesh(), ...patch })
const at = (position: Vec3, rotation: Vec3 = [0, 0, 0], scale: Vec3 = [1, 1, 1]) => ({ position, rotation, scale })

function prefab(name: string, root: Partial<EntityDoc>, children: ((rootId: string) => EntityDoc)[] = []): PrefabDoc {
  const rootEntity = createEntity(name, root)
  return { id: newId(), name, entities: [rootEntity, ...children.map((c) => c(rootEntity.id))] }
}

const PORTAL_SCRIPT = `// Loads another scene when the player walks in. Needs a trigger collider.
export default {
  params: { scene: 'Bonus Room', player: 'Player' },

  update(ctx, dt) {
    ctx.object.rotation.y += dt
  },

  onCollisionEnter(ctx, other) {
    if (other.name === ctx.params.player) ctx.loadScene(ctx.params.scene)
  },
}
`

const LAUNCHER_SCRIPT = `// Press E to throw a ball (spawns the "Ball" prefab).
export default {
  params: { prefab: 'Ball', force: 9 },

  update(ctx) {
    if (!ctx.input.wasPressed('KeyE')) return
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(ctx.object.quaternion)
    const position = ctx.object.position.clone().addScaledVector(forward, 1.2)
    position.y += 0.6
    const ball = ctx.spawn(ctx.params.prefab, { position })
    if (ball) ctx.physics.applyImpulse(ball, forward.multiplyScalar(ctx.params.force).setY(3))
  },
}
`

/**
 * "Coin Rush": a small platformer built entirely from editor features:
 * prefabs, two scenes, built-in scripts and two project scripts.
 */
export function sampleProject(): ProjectDoc {
  const random = mulberry32(7)
  const scripts: ScriptDoc[] = [
    { id: newId(), name: 'Portal', source: PORTAL_SCRIPT },
    { id: newId(), name: 'BallLauncher', source: LAUNCHER_SCRIPT },
  ]
  const [portalScript, launcherScript] = scripts

  const player = prefab(
    'Player',
    {
      transform: at([0, 1.5, 0], [0, 0, 0], [0.8, 0.9, 0.8]),
      mesh: mesh({ shape: 'capsule', color: '#3d7bd9', roughness: 0.5 }),
      rigidBody: { ...componentDefaults.rigidBody(), type: 'character' },
      collider: { ...componentDefaults.collider(), shape: 'capsule', radius: 0.5, height: 2 },
      scripts: [
        { script: 'builtin:PlayerController', params: {} },
        { script: launcherScript.id, params: {} },
      ],
    },
    [
      (root) =>
        createEntity('Visor', {
          parent: root,
          transform: at([0, 0.4, -0.42], [0, 0, 0], [0.6, 0.2, 0.25]),
          mesh: mesh({ color: '#1b2433', roughness: 0.3 }),
        }),
    ],
  )
  const camera = prefab('Player Camera', {
    transform: at([0, 6, 10], [-20, 0, 0]),
    camera: componentDefaults.camera(),
    scripts: [{ script: 'builtin:FollowCamera', params: {} }],
  })
  const coin = prefab('Coin', {
    transform: at([0, 1, 0], [90, 0, 0], [0.9, 0.1, 0.9]),
    mesh: mesh({ shape: 'cylinder', color: '#ffc83d', metalness: 0.7, roughness: 0.25, emissive: '#6b4a00' }),
    collider: { ...componentDefaults.collider(), shape: 'sphere', radius: 0.7, trigger: true },
    scripts: [
      { script: 'builtin:Rotate', params: { x: 0, y: 0, z: 180 } },
      { script: 'builtin:Bob', params: {} },
      { script: 'builtin:Collectible', params: {} },
    ],
  })
  const crate = prefab('Crate', {
    transform: at([0, 0.5, 0]),
    mesh: mesh({ color: '#b07a45', roughness: 0.9 }),
    rigidBody: { ...componentDefaults.rigidBody(), mass: 2 },
    collider: componentDefaults.collider(),
  })
  const ball = prefab('Ball', {
    transform: at([0, 1, 0], [0, 0, 0], [0.6, 0.6, 0.6]),
    mesh: mesh({ shape: 'sphere', color: '#e05b8a', roughness: 0.4 }),
    rigidBody: { ...componentDefaults.rigidBody(), restitution: 0.6, mass: 1 },
    collider: { ...componentDefaults.collider(), shape: 'sphere' },
    scripts: [{ script: 'builtin:DestroyBelow', params: {} }],
  })
  const portal = prefab('Portal', {
    transform: at([0, 1.6, 0], [0, 0, 0], [1.4, 1.4, 1.4]),
    mesh: mesh({ shape: 'torus', color: '#7a5cff', emissive: '#5a3cff', emissiveIntensity: 1.5, roughness: 0.3 }),
    collider: { ...componentDefaults.collider(), shape: 'sphere', radius: 0.45, trigger: true },
    scripts: [{ script: portalScript.id, params: {} }],
  })
  const prefabs = [player, camera, coin, crate, ball, portal]
  const instance = (p: PrefabDoc, position: Vec3, parent: string | null = null, extra: Partial<EntityDoc> = {}) => {
    const e = instantiatePrefab(p, { parent, ...extra })
    e.transform.position = position
    return e
  }

  // --- Scene 1: Coin Rush --------------------------------------------------
  const entities: EntityDoc[] = []
  const add = (e: EntityDoc) => (entities.push(e), e)
  add(instance(camera, [0, 6, 10]))
  add(
    createEntity('Sun', {
      transform: at([12, 25, 10], [-60, 45, 0]),
      light: { ...componentDefaults.light(), type: 'directional', color: '#fff2dd', intensity: 2.4, castShadow: true, shadowArea: 70 },
    }),
  )
  add(
    createEntity('Sky Light', {
      light: { ...componentDefaults.light(), type: 'hemisphere', color: '#eaf4ff', groundColor: '#56663f', intensity: 1.2 },
    }),
  )
  const level = add(createEntity('Level'))
  const block = (name: string, size: Vec3, position: Vec3, color: string, parent = level.id) =>
    add(
      createEntity(name, {
        parent,
        transform: at(position, [0, 0, 0], size),
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
    if (x > -3 && x < 15 && z > -25 && z < -12) continue // keep the physics playground clear
    const h = 0.6 + random() * 2
    block(`Block ${i + 1}`, [2 + random() * 3, h, 2 + random() * 3], [x, h / 2, z], '#c9c2b4', blocks.id)
    coinSpots.push([x, h + 1, z])
  }
  for (let i = 0; i < 10; i++) {
    const angle = (i / 10) * Math.PI * 2
    coinSpots.push([Math.cos(angle) * 6, 1, Math.sin(angle) * 6])
  }

  // Physics playground: a ramp up to a ledge, a crate stack and a ball.
  const playground = add(createEntity('Playground', { parent: level.id, transform: at([4, 0, -20]) }))
  add(
    createEntity('Ramp', {
      parent: playground.id,
      transform: at([0, 1.2, 0], [0, 0, 22], [7, 0.4, 3]),
      mesh: mesh({ color: '#8e9bb0', roughness: 0.8 }),
      collider: componentDefaults.collider(),
    }),
  )
  block('Ledge', [4, 2.6, 3], [5.2, 1.3, 0], '#c9c2b4', playground.id)
  coinSpots.push([9.2, 3.6, -20])
  const stack: Vec3[] = [[4, 0.5, 4], [5.05, 0.5, 4], [6.1, 0.5, 4], [4.5, 1.5, 4], [5.55, 1.5, 4], [5.05, 2.5, 4]]
  for (const p of stack) add(instance(crate, p, playground.id))
  add(instance(ball, [0, 4, -4], playground.id))
  add(instance(portal, [-20, 1.6, -20], null, { name: 'Portal to Bonus Room' }))

  const coins = add(createEntity('Coins'))
  for (const p of coinSpots) add(instance(coin, p, coins.id))
  add(instance(player, [0, 1.5, 0]))

  const coinRush: SceneDoc = {
    id: newId(),
    name: 'Coin Rush',
    settings: { ...defaultSettings(), fog: true, fogNear: 50, fogFar: 160 },
    entities,
  }

  // --- Scene 2: Bonus Room -------------------------------------------------
  const bonus: EntityDoc[] = [
    instance(camera, [0, 6, 10]),
    createEntity('Lamp', {
      transform: at([0, 8, 0]),
      light: { ...componentDefaults.light(), type: 'point', color: '#ffd9a8', intensity: 150, distance: 40, castShadow: true },
    }),
    createEntity('Floor', {
      transform: at([0, -0.5, 0], [0, 0, 0], [20, 1, 20]),
      mesh: mesh({ color: '#4a3f6b', roughness: 0.9 }),
      collider: componentDefaults.collider(),
    }),
    instance(player, [0, 1.5, 0]),
    // Instance-level script parameter override: this portal leads back.
    instance(portal, [0, 1.6, -7], null, {
      name: 'Portal back',
      scripts: [{ script: portalScript.id, params: { scene: 'Coin Rush' } }],
    }),
  ]
  for (let i = 0; i < 8; i++) {
    const angle = (i / 8) * Math.PI * 2
    bonus.push(instance(coin, [Math.cos(angle) * 5, 1, Math.sin(angle) * 5]))
  }
  const bonusRoom: SceneDoc = {
    id: newId(),
    name: 'Bonus Room',
    settings: { ...defaultSettings(), background: '#1d1830', ambientIntensity: 0.25 },
    entities: bonus,
  }

  return { version: 2, name: 'Coin Rush', scenes: [coinRush, bonusRoom], prefabs, scripts }
}
