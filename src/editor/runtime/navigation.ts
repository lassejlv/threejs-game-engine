import { MathUtils, Vector3, type Vector3Like } from 'three'
import { dampAngle, type Entity, NavGrid, type NavSettings, type RapierPhysics } from '../../engine'
import type { Handle } from '../scripting'

export interface MoveOptions {
  /** Meters per second. Default 3.5. */
  speed?: number
  /** Stop this far from the goal. Default 0.3. */
  stoppingDistance?: number
  /** Turn to face the walking direction. Default true. */
  face?: boolean
}

/** Pathfinding for scripts (`ctx.nav`). */
export interface NavApi {
  /** Walkable waypoints from one point to another (snapped to the navigation grid), or null if unreachable. */
  findPath(from: Vector3Like, to: Vector3Like): Vector3[] | null
  /** Walks this entity to a point, or keeps following a moving entity, steering around moving bodies. Returns false when no path exists. */
  moveTo(target: Vector3Like | Handle, options?: MoveOptions): boolean
  stop(): void
  /** True while following a path. */
  readonly moving: boolean
  /** The remaining waypoints (empty when not moving). */
  readonly path: readonly Vector3[]
  /** A random walkable point, optionally within `radius` of this entity. */
  randomPoint(radius?: number): Vector3 | null
}

interface Agent {
  handle: Handle
  path: Vector3[]
  index: number
  speed: number
  stoppingDistance: number
  face: boolean
  /** A followed entity: the path is refreshed toward it every half second. */
  chase: Handle | null
  repath: number
  /** Height of the entity's origin above the floor when it started, kept while walking (body-less entities). */
  foot: number
  /** Where a moveTo to a point is headed (for re-planning around obstacles). */
  goal: Vector3
}

const REPATH_INTERVAL = 0.5
/** How often moving obstacles are looked up (seconds). */
const OBSTACLE_INTERVAL = 0.25
const toward = new Vector3()

/** Bakes the grid on first use and walks agents along their paths every fixed step. */
export class Navigation {
  private grid: NavGrid | null = null
  private readonly agents = new Map<Entity, Agent>()
  private obstacleTimer = 0
  private debugCache: Float32Array | null = null

  constructor(
    private readonly physics: RapierPhysics,
    private readonly settings: NavSettings,
    private readonly isAlive: (entity: Entity) => boolean,
  ) {}

  /** The baked grid (baking now if needed); null when the scene has no static colliders. */
  navGrid(): NavGrid | null {
    if (this.grid) return this.grid
    this.physics.flush()
    const bounds = this.physics.staticBounds()
    if (!bounds) return null
    // Keep baking bounded on huge levels.
    const half = 150
    bounds.min.clampScalar(-half, half)
    bounds.max.clampScalar(-half, half)
    this.grid = NavGrid.bake(this.physics.navQueries(), bounds, this.settings)
    return this.grid
  }

  api(handle: Handle): NavApi {
    const nav = this
    return {
      findPath: (from, to) => this.navGrid()?.findPath(new Vector3().copy(from), new Vector3().copy(to)) ?? null,
      moveTo: (target, options = {}) => this.moveTo(handle, target, options),
      stop: () => this.stop(handle.entity),
      get moving() {
        return nav.agents.has(handle.entity)
      },
      get path() {
        const agent = nav.agents.get(handle.entity)
        return agent ? agent.path.slice(agent.index) : []
      },
      randomPoint: (radius) => this.navGrid()?.randomPoint(Math.random, this.position(handle), radius) ?? null,
    }
  }

  stop(entity: Entity): void {
    const agent = this.agents.get(entity)
    if (!agent) return
    this.agents.delete(entity)
    const body = agent.handle.body
    if (body && !body.kinematic) body.velocity.x = body.velocity.z = 0
    else if (body) body.velocity.set(0, 0, 0)
  }

  /** Steps every agent (fixed rate, before physics). */
  update(dt: number): void {
    this.obstacleTimer -= dt
    if (this.grid && this.obstacleTimer <= 0) {
      this.obstacleTimer = OBSTACLE_INTERVAL
      this.avoidObstacles(this.grid)
    }
    for (const [entity, agent] of this.agents) {
      if (!this.isAlive(entity)) {
        this.agents.delete(entity)
        continue
      }
      if (agent.chase) {
        agent.repath -= dt
        if (agent.repath <= 0) {
          agent.repath = REPATH_INTERVAL
          if (!this.isAlive(agent.chase.entity)) {
            this.stop(entity)
            continue
          }
          const path = this.navGrid()?.findPath(this.position(agent.handle), this.position(agent.chase))
          if (path) {
            agent.path = path
            agent.index = 1
          }
        }
      }
      this.steer(agent, dt)
    }
  }

  /** Tells the grid where moving bodies are; when that changes, agents plan again (around them, or straighter once they've gone). */
  private avoidObstacles(grid: NavGrid): void {
    // Agents don't block themselves, and a chased entity doesn't block the way to itself.
    const ignore = new Set<Entity>()
    for (const [entity, agent] of this.agents) {
      ignore.add(entity)
      if (agent.chase) ignore.add(agent.chase.entity)
    }
    if (!grid.setObstacles(this.physics.movingObstacles(ignore))) return
    this.debugCache = null
    for (const agent of this.agents.values()) {
      if (agent.chase) {
        agent.repath = 0
        continue
      }
      const path = grid.findPath(this.position(agent.handle), agent.goal)
      if (path) {
        agent.path = path
        agent.index = 1
      }
    }
  }

  /** Walkable grid nodes as points (x, y, z...), for the debug view; nodes moving obstacles cover are left out. */
  debugPoints(): Float32Array | null {
    const grid = this.grid
    if (!grid || this.debugCache) return this.debugCache
    const out: number[] = []
    grid.nodes.forEach((n, i) => {
      if (!grid.isBlocked(i)) out.push(n.x, n.y + 0.05, n.z)
    })
    this.debugCache = new Float32Array(out)
    return this.debugCache
  }

  private moveTo(handle: Handle, target: Vector3Like | Handle, options: MoveOptions): boolean {
    const chase = isHandle(target) ? target : null
    const goal = chase ? this.position(chase) : new Vector3().copy(target as Vector3Like)
    const path = this.navGrid()?.findPath(this.position(handle), goal)
    if (!path) {
      this.stop(handle.entity)
      return false
    }
    this.agents.set(handle.entity, {
      handle,
      path,
      index: 1,
      speed: options.speed ?? 3.5,
      stoppingDistance: options.stoppingDistance ?? 0.3,
      face: options.face ?? true,
      chase,
      repath: REPATH_INTERVAL,
      foot: this.position(handle).y - path[0].y,
      goal,
    })
    return true
  }

  private steer(agent: Agent, dt: number): void {
    const { handle } = agent
    const here = this.position(handle)
    const last = agent.index >= agent.path.length - 1
    const waypoint = agent.path[Math.min(agent.index, agent.path.length - 1)]
    toward.set(waypoint.x - here.x, 0, waypoint.z - here.z)
    const distance = toward.length()
    const arrive = last ? agent.stoppingDistance : 0.25
    if (distance <= arrive || agent.path.length < 2) {
      if (last) {
        if (!agent.chase) this.stop(handle.entity)
        else if (handle.body) handle.body.velocity.x = handle.body.velocity.z = 0
        return
      }
      agent.index++
      return
    }
    toward.divideScalar(distance)
    const step = Math.min(agent.speed, distance / dt)
    const body = handle.body
    if (body) {
      // Characters and dynamic bodies keep their vertical velocity (gravity, jumps).
      body.velocity.x = toward.x * step
      body.velocity.z = toward.z * step
      if (body.kinematic && !body.character) body.velocity.y = ((waypoint.y - here.y) / Math.max(distance, 1e-3)) * step
    } else {
      handle.object.position.x += toward.x * step * dt
      handle.object.position.z += toward.z * step * dt
      handle.object.position.y = MathUtils.lerp(handle.object.position.y, waypoint.y + agent.foot, Math.min(1, dt * 10))
    }
    if (agent.face) handle.object.rotation.y = dampAngle(handle.object.rotation.y, Math.atan2(-toward.x, -toward.z), 10, dt)
  }

  private position(handle: Handle): Vector3 {
    if (handle.body) return handle.body.position.clone()
    return handle.object.getWorldPosition(new Vector3())
  }
}

function isHandle(value: unknown): value is Handle {
  return typeof value === 'object' && value !== null && 'entity' in value && 'object' in value
}
