import { type Scene, Vector3 } from 'three'
import { Collider, RigidBody, type RigidBodyData, Transform } from '../components'
import type { System } from '../core/System'

/** Integrates gravity, damping and velocity for every non-kinematic body. */
export function createPhysicsSystem(): System {
  return {
    name: 'physics',
    phase: 'fixed',
    order: 0,
    run(engine, dt) {
      const gravity = engine.physics.gravity
      for (const body of engine.world.store(RigidBody).values) {
        body.previous.copy(body.position)
        body.grounded = false
        if (!body.kinematic) {
          body.velocity.addScaledVector(gravity, body.gravityScale * dt)
          if (body.damping > 0) body.velocity.multiplyScalar(1 / (1 + body.damping * dt))
        }
        body.position.addScaledVector(body.velocity, dt)
      }
    },
  }
}

/** Writes interpolated body positions to Transforms so motion is smooth at any refresh rate. */
export function createInterpolationSystem(): System {
  return {
    name: 'interpolation',
    phase: 'update',
    order: -1000,
    run(engine) {
      const { world, time } = engine
      const bodies = world.store(RigidBody)
      const transforms = world.store(Transform)
      const alpha = time.alpha
      for (const entity of world.query(RigidBody, Transform).entities) {
        const body = bodies.get(entity)!
        const object = transforms.get(entity)!
        if (body.interpolate) object.position.lerpVectors(body.previous, body.position, alpha)
        else object.position.copy(body.position)
      }
    },
  }
}

const DYNAMIC = 1
const TRIGGER = 2
const SPHERE = 4
/** Colliders spanning more cells than this skip the grid and are tested against everything. */
const MAX_CELLS = 64
const PAIR = 1 << 20
const ENTITY_PAIR = 1 << 24

/**
 * Broadphase (spatial hash) + narrowphase (box/sphere) collision with
 * penetration resolution for dynamic bodies and enter/exit events.
 * Boxes are axis aligned. Static-vs-static pairs are never tested.
 */
export function createCollisionSystem({ cellSize = 4 } = {}): System {
  let capacity = 0
  let entity = new Int32Array(0)
  let cx = new Float64Array(0), cy = new Float64Array(0), cz = new Float64Array(0)
  let hx = new Float64Array(0), hy = new Float64Array(0), hz = new Float64Array(0)
  let flags = new Uint8Array(0)
  let layer = new Uint32Array(0), mask = new Uint32Array(0)
  const bodyAt: (RigidBodyData | undefined)[] = []
  const worldPosition = new Vector3()

  const cells = new Map<number, number[]>()
  const cellPool: number[][] = []
  const large: number[] = []
  const tested = new Set<number>()
  let contacts = new Set<number>()
  let previousContacts = new Set<number>()

  // Narrowphase output: normal points from i to j.
  let nx = 0, ny = 0, nz = 0, depth = 0

  function ensure(n: number): void {
    if (n <= capacity) return
    capacity = Math.max(n, capacity * 2, 64)
    entity = new Int32Array(capacity)
    cx = new Float64Array(capacity); cy = new Float64Array(capacity); cz = new Float64Array(capacity)
    hx = new Float64Array(capacity); hy = new Float64Array(capacity); hz = new Float64Array(capacity)
    flags = new Uint8Array(capacity)
    layer = new Uint32Array(capacity); mask = new Uint32Array(capacity)
  }

  function boxBox(i: number, j: number): boolean {
    const dx = cx[j] - cx[i], dy = cy[j] - cy[i], dz = cz[j] - cz[i]
    const px = hx[i] + hx[j] - Math.abs(dx)
    if (px <= 0) return false
    const py = hy[i] + hy[j] - Math.abs(dy)
    if (py <= 0) return false
    const pz = hz[i] + hz[j] - Math.abs(dz)
    if (pz <= 0) return false
    nx = ny = nz = 0
    if (px < py && px < pz) { nx = dx < 0 ? -1 : 1; depth = px }
    else if (py < pz) { ny = dy < 0 ? -1 : 1; depth = py }
    else { nz = dz < 0 ? -1 : 1; depth = pz }
    return true
  }

  function sphereSphere(i: number, j: number): boolean {
    const dx = cx[j] - cx[i], dy = cy[j] - cy[i], dz = cz[j] - cz[i]
    const r = hx[i] + hx[j]
    const d2 = dx * dx + dy * dy + dz * dz
    if (d2 >= r * r) return false
    const d = Math.sqrt(d2)
    if (d > 1e-9) { nx = dx / d; ny = dy / d; nz = dz / d }
    else { nx = 0; ny = 1; nz = 0 }
    depth = r - d
    return true
  }

  /** s is the sphere, b the box. Normal points from s to b. */
  function sphereBox(s: number, b: number): boolean {
    const qx = clamp(cx[s], cx[b] - hx[b], cx[b] + hx[b])
    const qy = clamp(cy[s], cy[b] - hy[b], cy[b] + hy[b])
    const qz = clamp(cz[s], cz[b] - hz[b], cz[b] + hz[b])
    const dx = qx - cx[s], dy = qy - cy[s], dz = qz - cz[s]
    const d2 = dx * dx + dy * dy + dz * dz
    const r = hx[s]
    if (d2 >= r * r) return false
    if (d2 < 1e-12) return boxBox(s, b) // center inside the box
    const d = Math.sqrt(d2)
    nx = dx / d; ny = dy / d; nz = dz / d
    depth = r - d
    return true
  }

  function contact(i: number, j: number): boolean {
    const si = flags[i] & SPHERE, sj = flags[j] & SPHERE
    if (si && sj) return sphereSphere(i, j)
    if (!si && !sj) return boxBox(i, j)
    if (si) return sphereBox(i, j)
    if (!sphereBox(j, i)) return false
    nx = -nx; ny = -ny; nz = -nz
    return true
  }

  function test(i: number, j: number): void {
    const fi = flags[i], fj = flags[j]
    if (!((fi | fj) & DYNAMIC)) return
    if (!(layer[i] & mask[j]) || !(layer[j] & mask[i])) return
    const key = i < j ? i * PAIR + j : j * PAIR + i
    if (tested.has(key)) return
    tested.add(key)
    if (Math.abs(cx[i] - cx[j]) > hx[i] + hx[j]) return
    if (Math.abs(cy[i] - cy[j]) > hy[i] + hy[j]) return
    if (Math.abs(cz[i] - cz[j]) > hz[i] + hz[j]) return
    if (!contact(i, j)) return

    const a = entity[i], b = entity[j]
    contacts.add(a < b ? a * ENTITY_PAIR + b : b * ENTITY_PAIR + a)
    if ((fi | fj) & TRIGGER) return

    const di = fi & DYNAMIC, dj = fj & DYNAMIC
    const share = di && dj ? 0.5 : 1
    if (di) {
      const body = bodyAt[i]!
      const push = depth * share
      body.position.x -= nx * push; body.position.y -= ny * push; body.position.z -= nz * push
      cx[i] -= nx * push; cy[i] -= ny * push; cz[i] -= nz * push
      const v = body.velocity
      const vn = v.x * nx + v.y * ny + v.z * nz
      if (vn > 0) {
        const k = vn * (1 + body.restitution)
        v.x -= nx * k; v.y -= ny * k; v.z -= nz * k
      }
      if (ny < -0.5) body.grounded = true
    }
    if (dj) {
      const body = bodyAt[j]!
      const push = depth * share
      body.position.x += nx * push; body.position.y += ny * push; body.position.z += nz * push
      cx[j] += nx * push; cy[j] += ny * push; cz[j] += nz * push
      const v = body.velocity
      const vn = v.x * nx + v.y * ny + v.z * nz
      if (vn < 0) {
        const k = vn * (1 + body.restitution)
        v.x -= nx * k; v.y -= ny * k; v.z -= nz * k
      }
      if (ny > 0.5) body.grounded = true
    }
  }

  return {
    name: 'collision',
    phase: 'fixed',
    order: 100,
    run(engine) {
      const { world, events } = engine
      const query = world.query(Collider, Transform)
      const colliders = world.store(Collider)
      const transforms = world.store(Transform)
      const bodies = world.store(RigidBody)
      const list = query.entities
      const n = list.length
      ensure(n)

      // Gather into flat arrays.
      for (let i = 0; i < n; i++) {
        const e = list[i]
        const c = colliders.get(e)!
        const body = bodies.get(e)
        const object = transforms.get(e)!
        // Static colliders may be nested in a hierarchy; bodies are simulated in world space.
        const p = body
          ? body.position
          : !object.parent || (object.parent as Scene).isScene
            ? object.position
            : object.getWorldPosition(worldPosition)
        entity[i] = e
        bodyAt[i] = body
        cx[i] = p.x + c.offset.x; cy[i] = p.y + c.offset.y; cz[i] = p.z + c.offset.z
        let f = 0
        if (c.shape === 'sphere') {
          hx[i] = hy[i] = hz[i] = c.radius
          f |= SPHERE
        } else {
          hx[i] = c.halfExtents.x; hy[i] = c.halfExtents.y; hz[i] = c.halfExtents.z
        }
        if (body && !body.kinematic) f |= DYNAMIC
        if (c.trigger) f |= TRIGGER
        flags[i] = f
        layer[i] = c.layer
        mask[i] = c.mask
      }
      bodyAt.length = n

      // Broadphase: uniform spatial hash.
      const inv = 1 / cellSize
      for (let i = 0; i < n; i++) {
        const x0 = Math.floor((cx[i] - hx[i]) * inv), x1 = Math.floor((cx[i] + hx[i]) * inv)
        const y0 = Math.floor((cy[i] - hy[i]) * inv), y1 = Math.floor((cy[i] + hy[i]) * inv)
        const z0 = Math.floor((cz[i] - hz[i]) * inv), z1 = Math.floor((cz[i] + hz[i]) * inv)
        if ((x1 - x0 + 1) * (y1 - y0 + 1) * (z1 - z0 + 1) > MAX_CELLS) {
          large.push(i)
          continue
        }
        for (let x = x0; x <= x1; x++)
          for (let y = y0; y <= y1; y++)
            for (let z = z0; z <= z1; z++) {
              const key = Math.imul(x, 73856093) ^ Math.imul(y, 19349663) ^ Math.imul(z, 83492791)
              let cell = cells.get(key)
              if (!cell) {
                cell = cellPool.pop() ?? []
                cells.set(key, cell)
              }
              cell.push(i)
            }
      }

      // Narrowphase + resolution.
      for (const cell of cells.values()) {
        for (let a = 0; a < cell.length; a++)
          for (let b = a + 1; b < cell.length; b++) test(cell[a], cell[b])
      }
      for (const i of large) for (let j = 0; j < n; j++) if (j !== i) test(i, j)

      // Recycle scratch.
      for (const cell of cells.values()) {
        cell.length = 0
        cellPool.push(cell)
      }
      cells.clear()
      large.length = 0
      tested.clear()

      // Enter / exit events.
      for (const key of contacts) {
        if (!previousContacts.has(key)) events.emit('collisionEnter', decode(key))
      }
      for (const key of previousContacts) {
        if (!contacts.has(key)) events.emit('collisionExit', decode(key))
      }
      const swap = previousContacts
      previousContacts = contacts
      contacts = swap
      contacts.clear()
    },
  }
}

function decode(key: number): { a: number; b: number } {
  return { a: Math.floor(key / ENTITY_PAIR), b: key % ENTITY_PAIR }
}

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v
}
