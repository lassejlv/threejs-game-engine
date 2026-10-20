import { Vector3 } from 'three'

export interface NavSettings {
  /** Grid spacing in meters. Smaller is more precise and slower to bake. */
  cellSize: number
  /** Agents keep this far from walls. */
  agentRadius: number
  /** Headroom needed to stand somewhere. */
  agentHeight: number
  /** Highest ledge an agent can step up or down. */
  maxStep: number
  /** Steepest walkable slope, degrees. */
  maxSlope: number
}

export function defaultNavSettings(): NavSettings {
  return { cellSize: 0.5, agentRadius: 0.4, agentHeight: 1.8, maxStep: 0.45, maxSlope: 45 }
}

/** What baking needs from the physics world. */
export interface NavQueries {
  /** First solid surface straight below (x, fromY, z) within `maxDistance`: its height and up-facing normal component. */
  raycastDown(x: number, fromY: number, z: number, maxDistance: number): { y: number; normalY: number } | null
  /** True if an axis-aligned box (center, half extents) overlaps solid geometry. */
  blocked(center: Vector3, halfExtents: Vector3): boolean
}

export interface NavBounds {
  min: Vector3
  max: Vector3
}

interface NavNode {
  x: number
  y: number
  z: number
  /** Indices of reachable neighbor nodes. */
  links: number[]
}

const MAX_LAYERS = 4
/** Extra path cost (meters) for walking through a node a moving obstacle covers: avoided when there's a way around. */
const BLOCKED_COST = 25

/**
 * A walkable grid baked from static geometry: every cell column can hold
 * several stacked floors (bridges, balconies), linked to neighbors an agent
 * can step to. Paths come from A* and are then straightened.
 */
export class NavGrid {
  readonly nodes: NavNode[] = []
  /** Cell index → node indices, lowest floor first. */
  private readonly columns = new Map<number, number[]>()
  private readonly cols: number
  private readonly rows: number
  private readonly origin: Vector3
  /** Nodes covered by moving obstacles, from the last setObstacles call. */
  private blocked = new Set<number>()

  private constructor(
    readonly settings: NavSettings,
    bounds: NavBounds,
  ) {
    this.origin = bounds.min.clone()
    this.cols = Math.max(1, Math.ceil((bounds.max.x - bounds.min.x) / settings.cellSize))
    this.rows = Math.max(1, Math.ceil((bounds.max.z - bounds.min.z) / settings.cellSize))
  }

  static bake(queries: NavQueries, bounds: NavBounds, settings: NavSettings = defaultNavSettings()): NavGrid {
    const grid = new NavGrid(settings, bounds)
    grid.sample(queries, bounds)
    grid.link()
    return grid
  }

  get size(): number {
    return this.nodes.length
  }

  /** The walkable node nearest to a point (same floor preferred), or -1. */
  nearest(point: Vector3, searchRadius = 3): number {
    const { cellSize } = this.settings
    const ci = Math.floor((point.x - this.origin.x) / cellSize)
    const cj = Math.floor((point.z - this.origin.z) / cellSize)
    const reach = Math.ceil(searchRadius / cellSize)
    let best = -1
    let bestScore = Infinity
    for (let r = 0; r <= reach; r++) {
      for (let dj = -r; dj <= r; dj++) {
        for (let di = -r; di <= r; di++) {
          if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue // ring only
          for (const index of this.columns.get(this.cell(ci + di, cj + dj)) ?? []) {
            const n = this.nodes[index]
            // Height differences count triple, so a point on a bridge picks the bridge.
            const score = (n.x - point.x) ** 2 + (n.z - point.z) ** 2 + 9 * (n.y - point.y) ** 2
            if (score < bestScore) {
              bestScore = score
              best = index
            }
          }
        }
      }
      if (best >= 0 && r >= 1) break
    }
    return best
  }

  /** A walkable path from `from` to `to` (both snapped to the grid), straightened; null if unreachable. */
  findPath(from: Vector3, to: Vector3): Vector3[] | null {
    const start = this.nearest(from)
    const goal = this.nearest(to)
    if (start < 0 || goal < 0) return null
    const raw = this.astar(start, goal)
    if (!raw) return null
    const points = raw.map((i) => new Vector3(this.nodes[i].x, this.nodes[i].y, this.nodes[i].z))
    return this.straighten(points)
  }

  /**
   * Marks the nodes that moving obstacles (world-space boxes) cover, grown by the agent
   * radius. Paths go around them when they can. Returns whether the covered nodes changed.
   */
  setObstacles(boxes: readonly NavBounds[]): boolean {
    const { cellSize, agentRadius, agentHeight, maxStep } = this.settings
    const next = new Set<number>()
    for (const { min, max } of boxes) {
      const i0 = Math.floor((min.x - agentRadius - this.origin.x) / cellSize)
      const i1 = Math.floor((max.x + agentRadius - this.origin.x) / cellSize)
      const j0 = Math.floor((min.z - agentRadius - this.origin.z) / cellSize)
      const j1 = Math.floor((max.z + agentRadius - this.origin.z) / cellSize)
      for (let j = Math.max(0, j0); j <= Math.min(this.rows - 1, j1); j++) {
        for (let i = Math.max(0, i0); i <= Math.min(this.cols - 1, i1); i++) {
          for (const index of this.columns.get(this.cell(i, j)) ?? []) {
            const y = this.nodes[index].y
            // In the way: taller than a step above this floor, and lower than the agent's head.
            if (max.y > y + maxStep && min.y < y + agentHeight) next.add(index)
          }
        }
      }
    }
    const changed = next.size !== this.blocked.size || [...next].some((i) => !this.blocked.has(i))
    this.blocked = next
    return changed
  }

  /** Whether a moving obstacle covers this node (for the debug view). */
  isBlocked(node: number): boolean {
    return this.blocked.has(node)
  }

  /** A random walkable point (optionally within `radius` of `around`). */
  randomPoint(random: () => number = Math.random, around?: Vector3, radius = Infinity): Vector3 | null {
    if (this.nodes.length === 0) return null
    for (let attempt = 0; attempt < 64; attempt++) {
      const n = this.nodes[Math.floor(random() * this.nodes.length)]
      if (!around || (n.x - around.x) ** 2 + (n.z - around.z) ** 2 <= radius * radius) return new Vector3(n.x, n.y, n.z)
    }
    return null
  }

  private cell(i: number, j: number): number {
    if (i < 0 || j < 0 || i >= this.cols || j >= this.rows) return -1
    return j * this.cols + i
  }

  private sample(queries: NavQueries, bounds: NavBounds): void {
    const { cellSize, agentRadius, agentHeight, maxStep, maxSlope } = this.settings
    const minNormalY = Math.cos((maxSlope * Math.PI) / 180)
    const half = new Vector3(Math.max(0.05, agentRadius), Math.max(0.05, (agentHeight - maxStep) / 2), Math.max(0.05, agentRadius))
    const center = new Vector3()
    const top = bounds.max.y + 1
    const depth = top - bounds.min.y + 1
    for (let j = 0; j < this.rows; j++) {
      for (let i = 0; i < this.cols; i++) {
        const x = this.origin.x + (i + 0.5) * cellSize
        const z = this.origin.z + (j + 0.5) * cellSize
        const floors: number[] = []
        let from = top
        for (let layer = 0; layer < MAX_LAYERS; layer++) {
          const hit = queries.raycastDown(x, from, z, from - (top - depth))
          if (!hit) break
          if (hit.normalY >= minNormalY) {
            // Headroom: the agent's body above step height must be free of geometry.
            center.set(x, hit.y + maxStep + half.y + 0.02, z)
            if (!queries.blocked(center, half)) floors.push(hit.y)
          }
          // Anything closer below than the agent's height has no headroom anyway.
          from = hit.y - agentHeight
          if (from < top - depth) break
        }
        if (floors.length === 0) continue
        const list: number[] = []
        for (const y of floors.reverse()) {
          list.push(this.nodes.length)
          this.nodes.push({ x, y, z, links: [] })
        }
        this.columns.set(this.cell(i, j), list)
      }
    }
  }

  private link(): void {
    const { maxStep } = this.settings
    const offsets = [
      [1, 0],
      [0, 1],
      [1, 1],
      [-1, 1],
    ]
    for (let j = 0; j < this.rows; j++) {
      for (let i = 0; i < this.cols; i++) {
        const here = this.columns.get(this.cell(i, j))
        if (!here) continue
        for (const [di, dj] of offsets) {
          const there = this.columns.get(this.cell(i + di, j + dj))
          if (!there) continue
          for (const a of here) {
            for (const b of there) {
              if (Math.abs(this.nodes[a].y - this.nodes[b].y) > maxStep) continue
              // Diagonals only where both side cells are walkable too (no corner cutting).
              if (di !== 0 && dj !== 0 && !(this.stepTo(i + di, j, this.nodes[a].y) && this.stepTo(i, j + dj, this.nodes[a].y))) continue
              this.nodes[a].links.push(b)
              this.nodes[b].links.push(a)
            }
          }
        }
      }
    }
  }

  /** Whether cell (i, j) has a floor within step height of `y`. */
  private stepTo(i: number, j: number, y: number): boolean {
    return (this.columns.get(this.cell(i, j)) ?? []).some((n) => Math.abs(this.nodes[n].y - y) <= this.settings.maxStep)
  }

  private astar(start: number, goal: number): number[] | null {
    const nodes = this.nodes
    const g = new Map<number, number>([[start, 0]])
    const came = new Map<number, number>()
    const open = new MinHeap()
    const h = (i: number) => Math.hypot(nodes[i].x - nodes[goal].x, nodes[i].y - nodes[goal].y, nodes[i].z - nodes[goal].z)
    open.push(start, h(start))
    const closed = new Set<number>()
    while (open.size > 0) {
      const current = open.pop()
      if (current === goal) {
        const path = [current]
        let c = current
        while (came.has(c)) {
          c = came.get(c)!
          path.push(c)
        }
        return path.reverse()
      }
      if (closed.has(current)) continue
      closed.add(current)
      const a = nodes[current]
      for (const next of a.links) {
        if (closed.has(next)) continue
        const b = nodes[next]
        const cost = g.get(current)! + Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) + (this.blocked.has(next) ? BLOCKED_COST : 0)
        if (cost < (g.get(next) ?? Infinity)) {
          g.set(next, cost)
          came.set(next, current)
          open.push(next, cost + h(next))
        }
      }
    }
    return null
  }

  /** Drops waypoints that a straight walk can skip (every cell along the way has a floor at the right height). */
  private straighten(points: Vector3[]): Vector3[] {
    if (points.length <= 2) return points
    const out = [points[0]]
    let anchor = 0
    for (let k = 2; k < points.length; k++) {
      if (!this.clearLine(points[anchor], points[k])) {
        anchor = k - 1
        out.push(points[anchor])
      }
    }
    out.push(points[points.length - 1])
    return out
  }

  private clearLine(a: Vector3, b: Vector3): boolean {
    const { cellSize, maxStep } = this.settings
    const steps = Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / (cellSize * 0.5))
    let y = a.y
    for (let s = 1; s < steps; s++) {
      const t = s / steps
      const x = a.x + (b.x - a.x) * t
      const z = a.z + (b.z - a.z) * t
      const i = Math.floor((x - this.origin.x) / cellSize)
      const j = Math.floor((z - this.origin.z) / cellSize)
      // Follow the floor: each sample must be within a step of the previous one.
      let found = false
      for (const n of this.columns.get(this.cell(i, j)) ?? []) {
        if (Math.abs(this.nodes[n].y - y) <= maxStep) {
          y = this.nodes[n].y
          found = true
          break
        }
      }
      if (!found) return false
      if (this.blocked.size > 0 && this.columns.get(this.cell(i, j))!.some((n) => this.blocked.has(n) && this.nodes[n].y === y)) return false
      // Also stay clear of neighboring holes so agents don't clip edges.
      if (!this.stepTo(i + 1, j, y) || !this.stepTo(i - 1, j, y) || !this.stepTo(i, j + 1, y) || !this.stepTo(i, j - 1, y)) return false
    }
    return true
  }
}

/** Binary min-heap of (id, priority). */
class MinHeap {
  private ids: number[] = []
  private priorities: number[] = []

  get size(): number {
    return this.ids.length
  }

  push(id: number, priority: number): void {
    const { ids, priorities } = this
    ids.push(id)
    priorities.push(priority)
    let i = ids.length - 1
    while (i > 0) {
      const parent = (i - 1) >> 1
      if (priorities[parent] <= priorities[i]) break
      this.swap(i, parent)
      i = parent
    }
  }

  pop(): number {
    const { ids, priorities } = this
    const top = ids[0]
    const lastId = ids.pop()!
    const lastPriority = priorities.pop()!
    if (ids.length > 0) {
      ids[0] = lastId
      priorities[0] = lastPriority
      let i = 0
      for (;;) {
        const l = i * 2 + 1
        const r = l + 1
        let m = i
        if (l < ids.length && priorities[l] < priorities[m]) m = l
        if (r < ids.length && priorities[r] < priorities[m]) m = r
        if (m === i) break
        this.swap(i, m)
        i = m
      }
    }
    return top
  }

  private swap(a: number, b: number): void {
    ;[this.ids[a], this.ids[b]] = [this.ids[b], this.ids[a]]
    ;[this.priorities[a], this.priorities[b]] = [this.priorities[b], this.priorities[a]]
  }
}
