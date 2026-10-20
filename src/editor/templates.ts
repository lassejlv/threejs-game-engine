import {
  componentDefaults,
  createEntity,
  createUiElement,
  defaultProjectSettings,
  defaultSettings,
  emptyProject,
  type EntityDoc,
  instantiatePrefab,
  type MeshDoc,
  newId,
  type PrefabDoc,
  type ProjectDoc,
  type ScriptDoc,
  type SpriteDoc,
  type Vec3,
} from './document'
import { sampleProject } from './sample'

export interface Template {
  id: string
  name: string
  description: string
  /** Start the editor in the 2D view. */
  view2D?: boolean
  create(): ProjectDoc
}

const at = (position: Vec3, rotation: Vec3 = [0, 0, 0], scale: Vec3 = [1, 1, 1]) => ({ position, rotation, scale })
const mesh = (patch: Partial<MeshDoc>): MeshDoc => ({ ...componentDefaults.mesh(), ...patch })
const sprite = (patch: Partial<SpriteDoc>): SpriteDoc => ({ ...componentDefaults.sprite(), ...patch })
const script = (name: string, source: string): ScriptDoc => ({ id: newId(), name, source })
function prefab(name: string, root: Partial<EntityDoc>): PrefabDoc {
  return { id: newId(), name, entities: [createEntity(name, root)] }
}
const place = (p: PrefabDoc, position: Vec3, extra: Partial<EntityDoc> = {}) => {
  const e = instantiatePrefab(p, extra)
  e.transform.position = position
  return e
}

// ---------------------------------------------------------------------------
// 2D platformer

const GOAL_SCRIPT = `// Shows a win message when the player reaches the flag. Needs a trigger collider.
/** @type {import('engine').Script} */
export default {
  params: { player: 'Player', message: 'You made it!' },
  onCollisionEnter(ctx, other) {
    if (other.name !== ctx.params.player || ctx.state.done) return
    ctx.state.done = true
    ctx.hud.message(ctx.params.message)
    ctx.sound.tone(523, 0.12, { type: 'triangle' })
    ctx.sound.tone(659, 0.12, { type: 'triangle', delay: 0.12 })
    ctx.sound.tone(784, 0.3, { type: 'triangle', delay: 0.24 })
  },
}
`

function platformer2D(): ProjectDoc {
  const goal = script('Goal', GOAL_SCRIPT)
  const player = prefab('Player', {
    transform: at([0, 2, 0]),
    sprite: sprite({ color: '#3d7bd9', size: [0.9, 1.3], order: 2 }),
    rigidBody: { ...componentDefaults.rigidBody(), type: 'character', planar: true },
    collider: { ...componentDefaults.collider(), shape: 'capsule', radius: 0.45, height: 1.3 },
    scripts: [
      { script: 'builtin:PlayerController2D', params: {} },
      { script: 'builtin:Health', params: { max: 3, respawn: true, hud: 'Health' } },
    ],
  })
  const coin = prefab('Coin', {
    sprite: sprite({ color: '#ffc83d', size: [0.6, 0.6], order: 1 }),
    collider: { ...componentDefaults.collider(), shape: 'sphere', radius: 0.45, trigger: true },
    scripts: [
      { script: 'builtin:Collectible', params: { winMessage: '' } },
      { script: 'builtin:Bob', params: { height: 0.12 } },
    ],
  })
  const spikes = prefab('Spikes', {
    sprite: sprite({ color: '#d9434b', size: [1.6, 0.4], order: 1 }),
    collider: { ...componentDefaults.collider(), size: [1.6, 0.4, 2], trigger: true },
    scripts: [{ script: 'builtin:Hazard', params: { target: 'Player', knockback: 9 } }],
  })

  const entities: EntityDoc[] = []
  const add = (e: EntityDoc) => (entities.push(e), e)
  add(
    createEntity('2D Camera', {
      transform: at([0, 3, 20]),
      camera: { ...componentDefaults.camera(), projection: 'orthographic', orthoSize: 7 },
      scripts: [{ script: 'builtin:FollowCamera2D', params: {} }],
    }),
  )
  const level = add(createEntity('Level'))
  const block = (name: string, x: number, y: number, w: number, h: number, color = '#5a8f3c') =>
    add(
      createEntity(name, {
        parent: level.id,
        transform: at([x, y, 0]),
        sprite: sprite({ color, size: [w, h] }),
        collider: { ...componentDefaults.collider(), size: [w, h, 2] },
      }),
    )
  block('Ground', 6, -1, 30, 2)
  const steps: [number, number, number][] = [
    [26, 1, 6],
    [33, 3, 4],
    [39, 5, 4],
    [46, 3, 5],
    [56, 4, 8],
  ]
  steps.forEach(([x, y, w], i) => block(`Platform ${i + 1}`, x, y, w, 1, '#6b9e4a'))
  const coins = add(createEntity('Coins'))
  for (const [x, y] of [[3, 1], [5, 1], [7, 1], [26, 2.5], [33, 4.5], [39, 6.5], [46, 4.5], [55, 5.5], [57, 5.5]]) {
    add({ ...place(coin, [x, y, 0]), parent: coins.id })
  }
  add(place(spikes, [12, 0.2, 0]))
  add(place(spikes, [17, 0.2, 0]))
  add(
    createEntity('Lift', {
      parent: level.id,
      transform: at([20.5, 0.5, 0]),
      sprite: sprite({ color: '#8e9bb0', size: [3, 0.5] }),
      rigidBody: { ...componentDefaults.rigidBody(), type: 'kinematic', planar: true },
      collider: { ...componentDefaults.collider(), size: [3, 0.5, 2] },
      scripts: [{ script: 'builtin:MovingPlatform', params: { x: 0, y: 3, z: 0, duration: 2.5, wait: 0.6 } }],
    }),
  )
  add(
    createEntity('Checkpoint', {
      transform: at([33, 4.2, 0]),
      sprite: sprite({ color: '#5cff8a', size: [0.25, 1.4] }),
      collider: { ...componentDefaults.collider(), shape: 'sphere', radius: 1, trigger: true },
      scripts: [{ script: 'builtin:Checkpoint', params: {} }],
    }),
  )
  add(
    createEntity('Goal Flag', {
      transform: at([59, 5.4, 0]),
      sprite: sprite({ color: '#ffffff', size: [0.9, 1.8] }),
      collider: { ...componentDefaults.collider(), size: [0.9, 1.8, 2], trigger: true },
      scripts: [{ script: goal.id, params: {} }],
    }),
  )
  add(place(player, [0, 1.5, 0]))

  return {
    version: 2,
    name: 'Sky Hopper',
    settings: defaultProjectSettings(),
    scripts: [goal],
    prefabs: [player, coin, spikes],
    scenes: [
      {
        id: newId(),
        name: 'Level 1',
        settings: { ...defaultSettings(), sky: 'gradient', skyTop: '#4f9be8', skyHorizon: '#bfe3ff', skyBottom: '#bfe3ff', shadows: 'off' },
        entities,
        ui: [
          { ...createUiElement('text', 'Title'), text: 'Sky Hopper', size: 22, background: 'none' },
          { ...createUiElement('text', 'Controls'), anchor: 'bottom', text: 'A/D move · Space jump · reach the flag', size: 13 },
        ],
      },
    ],
  }
}

// ---------------------------------------------------------------------------
// Top-down arena

const TOP_CAMERA_SCRIPT = `// Follows the target from above at a fixed angle.
/** @type {import('engine').Script} */
export default {
  params: { target: 'Player', height: 20, back: 12, smoothing: 6 },
  lateUpdate(ctx, dt) {
    const target = ctx.find(ctx.params.target)
    if (!target) return
    const p = target.object.position
    const o = ctx.object.position
    o.x = helpers.damp(o.x, p.x, ctx.params.smoothing, dt)
    o.y = helpers.damp(o.y, p.y + ctx.params.height, ctx.params.smoothing, dt)
    o.z = helpers.damp(o.z, p.z + ctx.params.back, ctx.params.smoothing, dt)
    ctx.object.lookAt(p.x, p.y, p.z)
    ctx.object.rotateY(Math.PI)
  },
}
`

const SHOOTER_SCRIPT = `// Fire (E or gamepad X) shoots a bullet the way the player faces.
/** @type {import('engine').Script} */
export default {
  params: { prefab: 'Bullet', speed: 22, cooldown: 0.2 },
  update(ctx, dt) {
    ctx.state.wait = Math.max(0, (ctx.state.wait ?? 0) - dt)
    if (!ctx.input.action('Fire') || ctx.state.wait > 0) return
    ctx.state.wait = ctx.params.cooldown
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(ctx.object.quaternion).setY(0).normalize()
    const position = ctx.object.position.clone().addScaledVector(forward, 1).setY(ctx.object.position.y + 0.3)
    const bullet = ctx.spawn(ctx.params.prefab, { position })
    if (bullet?.body) bullet.body.velocity.copy(forward.multiplyScalar(ctx.params.speed))
    ctx.sound.tone(880, 0.05, { type: 'square', volume: 0.08 })
  },
}
`

const BULLET_SCRIPT = `// Hurts what it hits (anything with Health), then disappears.
/** @type {import('engine').Script} */
export default {
  params: { damage: 1, life: 1.5 },
  start(ctx) {
    ctx.after(ctx.params.life, () => ctx.destroy())
  },
  onCollisionEnter(ctx, other) {
    if (other.name === 'Player' || other.name === 'Bullet') return
    ctx.emit('damage', { target: other, amount: ctx.params.damage })
    ctx.destroy()
  },
}
`

const WAVES_SCRIPT = `// Spawns enemies at the arena's edge, faster over time, and keeps score.
/** @type {import('engine').Script} */
export default {
  params: { prefab: 'Enemy', radius: 17, interval: 2.5 },
  start(ctx) {
    ctx.globals.score = 0
    ctx.state.wait = 1
    ctx.on('died', ({ target }) => {
      if (target.name === 'Enemy') ctx.globals.score += 10
      else if (target.name === 'Player') ctx.hud.message('Game over: ' + ctx.globals.score + ' points')
    })
  },
  update(ctx, dt) {
    ctx.state.wait -= dt
    if (ctx.state.wait > 0) return
    ctx.state.wait = Math.max(0.6, ctx.params.interval - ctx.time.elapsed * 0.02)
    const a = Math.random() * Math.PI * 2
    ctx.spawn(ctx.params.prefab, { position: { x: Math.cos(a) * ctx.params.radius, y: 0.8, z: Math.sin(a) * ctx.params.radius } })
  },
}
`

function topDown(): ProjectDoc {
  const camera = script('TopDownCamera', TOP_CAMERA_SCRIPT)
  const shooter = script('Shooter', SHOOTER_SCRIPT)
  const bulletScript = script('Bullet', BULLET_SCRIPT)
  const waves = script('Waves', WAVES_SCRIPT)
  const enemy = prefab('Enemy', {
    transform: at([0, 0.8, 0], [0, 0, 0], [0.9, 0.9, 0.9]),
    mesh: mesh({ shape: 'sphere', color: '#d9434b', emissive: '#4a0a0f', roughness: 0.4 }),
    collider: { ...componentDefaults.collider(), shape: 'sphere', trigger: true },
    scripts: [
      { script: 'builtin:Chase', params: { range: 60, giveUp: 80, speed: 3, stopAt: 0.2 } },
      { script: 'builtin:Hazard', params: { target: 'Player', knockback: 10 } },
      { script: 'builtin:Health', params: { max: 1, invincibleTime: 0 } },
    ],
  })
  const bullet = prefab('Bullet', {
    transform: at([0, 0, 0], [0, 0, 0], [0.3, 0.3, 0.3]),
    mesh: mesh({ shape: 'sphere', color: '#ffe680', emissive: '#ffb21a', emissiveIntensity: 2 }),
    rigidBody: { ...componentDefaults.rigidBody(), gravityScale: 0, mass: 0.2 },
    collider: { ...componentDefaults.collider(), shape: 'sphere' },
    scripts: [{ script: bulletScript.id, params: {} }],
  })

  const entities: EntityDoc[] = [
    createEntity('Camera', {
      transform: at([0, 20, 12], [-58, 0, 0]),
      camera: { ...componentDefaults.camera(), fov: 50 },
      scripts: [{ script: camera.id, params: {} }],
    }),
    createEntity('Sun', {
      transform: at([10, 25, 8], [-60, 30, 0]),
      light: { ...componentDefaults.light(), type: 'directional', intensity: 2.2, castShadow: true, shadowArea: 60 },
    }),
    createEntity('Sky Light', { light: { ...componentDefaults.light(), type: 'hemisphere', color: '#dfe8ff', groundColor: '#3a3a4a', intensity: 1 } }),
    createEntity('Floor', {
      transform: at([0, -0.5, 0], [0, 0, 0], [40, 1, 40]),
      mesh: mesh({ color: '#3c4252', roughness: 0.9 }),
      collider: componentDefaults.collider(),
    }),
  ]
  for (const [x, z, w, d] of [[0, 20, 41, 1], [0, -20, 41, 1], [20, 0, 1, 41], [-20, 0, 1, 41]]) {
    entities.push(createEntity('Wall', { transform: at([x, 1, z], [0, 0, 0], [w, 2, d]), mesh: mesh({ color: '#5b6478' }), collider: componentDefaults.collider() }))
  }
  for (const [x, z] of [[-7, -6], [8, 5], [-5, 9], [6, -9]]) {
    entities.push(createEntity('Pillar', { transform: at([x, 1.5, z], [0, 0, 0], [1.6, 3, 1.6]), mesh: mesh({ color: '#7a8399' }), collider: componentDefaults.collider() }))
  }
  entities.push(
    createEntity('Player', {
      transform: at([0, 1, 0], [0, 0, 0], [0.8, 0.9, 0.8]),
      mesh: mesh({ shape: 'capsule', color: '#4cd97b', roughness: 0.5 }),
      rigidBody: { ...componentDefaults.rigidBody(), type: 'character' },
      collider: { ...componentDefaults.collider(), shape: 'capsule', radius: 0.5, height: 2 },
      scripts: [
        { script: 'builtin:PlayerController', params: { speed: 8, sprintSpeed: 11 } },
        { script: shooter.id, params: {} },
        { script: 'builtin:Health', params: { max: 5, hud: 'Health' } },
      ],
    }),
    createEntity('Waves', { scripts: [{ script: waves.id, params: {} }] }),
  )

  return {
    version: 2,
    name: 'Arena',
    settings: defaultProjectSettings(),
    scripts: [camera, shooter, bulletScript, waves],
    prefabs: [enemy, bullet],
    scenes: [
      {
        id: newId(),
        name: 'Arena',
        settings: { ...defaultSettings(), background: '#1d2130', ambientIntensity: 0.3, bloom: true, bloomStrength: 0.7, bloomThreshold: 0.85, vignette: 0.35 },
        entities,
        ui: [
          { ...createUiElement('text', 'Score'), anchor: 'top-right', text: 'Score {score}', size: 20 },
          { ...createUiElement('text', 'Controls'), anchor: 'bottom', text: 'WASD move · E shoot · survive the waves', size: 13 },
        ],
      },
    ],
  }
}

// ---------------------------------------------------------------------------
// Racing

const KART_SCRIPT = `// Arcade kart: MoveY throttles and brakes, MoveX steers. Needs a character Rigid Body.
/** @type {import('engine').Script} */
export default {
  params: { maxSpeed: 26, accel: 18, brake: 30, turnRate: 2.2, grip: 6 },
  start(ctx) {
    ctx.state.speed = 0
    ctx.state.heading = ctx.object.rotation.y
  },
  fixedUpdate(ctx, dt) {
    const p = ctx.params
    const s = ctx.state
    const throttle = ctx.input.getAxis('MoveY')
    if (throttle > 0) s.speed = Math.min(p.maxSpeed, s.speed + p.accel * throttle * dt)
    else if (throttle < 0) s.speed = Math.max(-p.maxSpeed * 0.4, s.speed + p.brake * throttle * dt)
    else s.speed = helpers.moveTowards(s.speed, 0, p.accel * 0.5 * dt)
    // Steering scales with speed, and flips when reversing.
    const steer = -ctx.input.getAxis('MoveX') * p.turnRate * Math.min(1, Math.abs(s.speed) / 8) * Math.sign(s.speed || 1)
    s.heading += steer * dt
    const body = ctx.body
    if (!body) return
    const vx = -Math.sin(s.heading) * s.speed
    const vz = -Math.cos(s.heading) * s.speed
    body.velocity.x = helpers.damp(body.velocity.x, vx, p.grip, dt)
    body.velocity.z = helpers.damp(body.velocity.z, vz, p.grip, dt)
  },
  update(ctx) {
    ctx.object.rotation.y = ctx.state.heading
  },
}
`

const CHASE_CAM_SCRIPT = `// Sits behind and above the target, turning with it.
/** @type {import('engine').Script} */
export default {
  params: { target: 'Kart', distance: 9, height: 4, smoothing: 5 },
  lateUpdate(ctx, dt) {
    const t = ctx.find(ctx.params.target)
    if (!t) return
    const back = new THREE.Vector3(0, 0, 1).applyQuaternion(t.object.quaternion).multiplyScalar(ctx.params.distance)
    const goal = t.object.position.clone().add(back).setY(t.object.position.y + ctx.params.height)
    ctx.object.position.lerp(goal, 1 - Math.exp(-ctx.params.smoothing * dt))
    ctx.object.lookAt(t.object.position.x, t.object.position.y + 1, t.object.position.z)
    ctx.object.rotateY(Math.PI)
  },
}
`

const GATE_SCRIPT = `// Checkpoint gates must be passed in order; gate 0 is the finish line.
/** @type {import('engine').Script} */
export default {
  params: { index: 0, gates: 3, laps: 3, kart: 'Kart' },
  start(ctx) {
    ctx.globals.lap ??= 1
    ctx.globals.next ??= 1
    ctx.globals.lapTime ??= 0
    ctx.globals.best ??= ctx.load('bestLap', null)
    ctx.globals.bestText = ctx.globals.best ? ctx.globals.best.toFixed(2) + ' s' : '–'
  },
  update(ctx, dt) {
    if (ctx.params.index === 0 && !ctx.globals.finished) ctx.globals.lapTime += dt
  },
  onCollisionEnter(ctx, other) {
    const g = ctx.globals
    if (other.name !== ctx.params.kart || g.finished || g.next !== ctx.params.index) return
    g.next = (ctx.params.index + 1) % ctx.params.gates
    if (ctx.params.index !== 0) return
    // Crossed the finish line after every other gate: a lap.
    if (!g.best || g.lapTime < g.best) {
      g.best = g.lapTime
      g.bestText = g.best.toFixed(2) + ' s'
      ctx.save('bestLap', g.best)
    }
    g.lapTime = 0
    if (g.lap >= ctx.params.laps) {
      g.finished = true
      ctx.hud.message('Finished! Best lap ' + g.bestText)
    } else g.lap++
    ctx.sound.tone(880, 0.15, { type: 'triangle' })
  },
}
`

function racing(): ProjectDoc {
  const kart = script('KartController', KART_SCRIPT)
  const chase = script('ChaseCamera', CHASE_CAM_SCRIPT)
  const gate = script('Gate', GATE_SCRIPT)
  const entities: EntityDoc[] = [
    createEntity('Camera', {
      transform: at([0, 6, -14]),
      camera: { ...componentDefaults.camera(), fov: 65 },
      scripts: [{ script: chase.id, params: {} }],
    }),
    createEntity('Sun', {
      transform: at([20, 40, 10], [-55, 35, 0]),
      light: { ...componentDefaults.light(), type: 'directional', intensity: 2.4, castShadow: true, shadowArea: 120 },
    }),
    createEntity('Sky Light', { light: { ...componentDefaults.light(), type: 'hemisphere', color: '#eaf4ff', groundColor: '#55663f', intensity: 1.1 } }),
    createEntity('Ground', {
      transform: at([0, -0.5, 0], [0, 0, 0], [140, 1, 140]),
      mesh: mesh({ color: '#6f9b4f', roughness: 0.95 }),
      collider: componentDefaults.collider(),
    }),
    createEntity('Track', {
      transform: at([0, 0.01, 0], [0, 0, 0], [72, 1, 72]),
      mesh: mesh({ shape: 'cylinder', color: '#3a3d45', roughness: 0.8 }),
    }),
    createEntity('Infield', {
      transform: at([0, 0.02, 0], [0, 0, 0], [40, 1, 40]),
      mesh: mesh({ shape: 'cylinder', color: '#6f9b4f', roughness: 0.95 }),
    }),
  ]
  // Barriers: rings of boxes inside and outside the track.
  const ring = (radius: number, count: number, name: string, color: string) => {
    const group = createEntity(name)
    entities.push(group)
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2
      const length = ((2 * Math.PI * radius) / count) * 1.05
      entities.push(
        createEntity('Barrier', {
          parent: group.id,
          transform: at([Math.cos(a) * radius, 0.6, Math.sin(a) * radius], [0, (-a * 180) / Math.PI + 90, 0], [length, 1.2, 0.6]),
          mesh: mesh({ color: i % 2 ? '#e8e8e8' : color }),
          collider: componentDefaults.collider(),
        }),
      )
    }
  }
  ring(36.5, 48, 'Outer Wall', '#d9434b')
  ring(19.5, 28, 'Inner Wall', '#d9434b')
  // Gates across the track at 0°, 120° and 240°; the kart drives counterclockwise from gate 0.
  const gates = createEntity('Gates')
  entities.push(gates)
  for (let i = 0; i < 3; i++) {
    const a = (i * -2 * Math.PI) / 3 + 0 // + 0 keeps -0 out of the saved file
    entities.push(
      createEntity(i === 0 ? 'Finish Line' : `Gate ${i}`, {
        parent: gates.id,
        transform: at([Math.cos(a) * 28, 1.5, Math.sin(a) * 28], [0, (-a * 180) / Math.PI + 0, 0], [17, 3, 1]),
        ...(i === 0 && { mesh: mesh({ shape: 'plane', color: '#ffffff', opacity: 0.35, castShadow: false }) }),
        collider: { ...componentDefaults.collider(), trigger: true },
        scripts: [{ script: gate.id, params: { index: i } }],
      }),
    )
  }
  entities.push(
    createEntity('Kart', {
      transform: at([28, 0.7, 4], [0, 0, 0]),
      mesh: mesh({ color: '#3d7bd9', metalness: 0.4, roughness: 0.35 }),
      rigidBody: { ...componentDefaults.rigidBody(), type: 'character' },
      collider: { ...componentDefaults.collider(), size: [1, 1, 1] },
      scripts: [{ script: kart.id, params: {} }],
    }),
  )
  const kartEntity = entities[entities.length - 1]
  kartEntity.transform.scale = [1.6, 0.7, 2.6]
  entities.push(
    createEntity('Cockpit', {
      parent: kartEntity.id,
      transform: at([0, 0.8, 0.1], [0, 0, 0], [0.5, 0.8, 0.35]),
      mesh: mesh({ color: '#1b2433', roughness: 0.3 }),
    }),
  )

  return {
    version: 2,
    name: 'Kart Loop',
    settings: defaultProjectSettings(),
    scripts: [kart, chase, gate],
    prefabs: [],
    scenes: [
      {
        id: newId(),
        name: 'Circuit',
        settings: {
          ...defaultSettings(),
          sky: 'gradient',
          skyTop: '#3f78c9',
          skyHorizon: '#cfe2f3',
          skyBottom: '#6d7f5a',
          environment: true,
          environmentIntensity: 0.5,
          fog: true,
          fogColor: '#cfe2f3',
          fogNear: 60,
          fogFar: 180,
        },
        entities,
        ui: [
          { ...createUiElement('text', 'Lap'), anchor: 'top-left', text: 'Lap {lap} / 3', size: 20 },
          { ...createUiElement('text', 'Time'), anchor: 'top-left', y: 48, text: 'Time {lapTime}', size: 16 },
          { ...createUiElement('text', 'Best'), anchor: 'top-left', y: 86, text: 'Best {bestText}', size: 14 },
          { ...createUiElement('text', 'Controls'), anchor: 'bottom', text: 'W/S throttle and brake · A/D steer · drive through the gates', size: 13 },
        ],
      },
    ],
  }
}

export const TEMPLATES: Template[] = [
  { id: 'coin-rush', name: 'Coin Rush', description: '3D platformer: collect coins, prefabs and variants, portals between two scenes, joints, particles.', create: sampleProject },
  { id: 'platformer-2d', name: 'Sky Hopper', description: '2D platformer: sprites, an orthographic camera, planar physics, a lift, spikes and a goal flag.', view2D: true, create: platformer2D },
  { id: 'top-down', name: 'Arena', description: 'Top-down survival: shoot waves of enemies that find their way to you (pathfinding), score UI.', create: topDown },
  { id: 'racing', name: 'Kart Loop', description: 'Racing: an arcade kart, a walled circuit, checkpoint gates, laps and a saved best lap.', create: racing },
  { id: 'empty', name: 'Empty', description: 'A camera, a light and the ground.', create: emptyProject },
]
