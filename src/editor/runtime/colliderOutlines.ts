import {
  BufferGeometry,
  EdgesGeometry,
  BoxGeometry,
  Float32BufferAttribute,
  Group,
  LineBasicMaterial,
  LineSegments,
  type Mesh,
  Object3D,
  Vector3,
} from 'three'
import type { ColliderDoc, EntityDoc } from '../document'
import { visualGeometry } from './visualGeometry'

const material = new LineBasicMaterial({ color: 0x5cff8a, depthTest: false, transparent: true, opacity: 0.85, fog: false })
const triggerMaterial = new LineBasicMaterial({ color: 0x5cc8ff, depthTest: false, transparent: true, opacity: 0.85, fog: false })
const boxEdges = new EdgesGeometry(new BoxGeometry(1, 1, 1))

/** Three orthogonal unit circles (radius 1), used for spheres and capsule caps. */
function circles(segments = 32): number[] {
  const points: number[] = []
  for (const axis of [0, 1, 2]) {
    for (let i = 0; i < segments; i++) {
      for (const k of [i, i + 1]) {
        const a = (k / segments) * Math.PI * 2
        const c = Math.cos(a)
        const s = Math.sin(a)
        points.push(...(axis === 0 ? [0, c, s] : axis === 1 ? [c, 0, s] : [c, s, 0]))
      }
    }
  }
  return points
}

/** Capsule or cylinder wireframe in local collider units. */
function roundShape(c: ColliderDoc): BufferGeometry {
  const r = c.radius
  const half = c.height / 2
  const body = c.shape === 'capsule' ? Math.max(0, half - r) : half
  const points: number[] = []
  const ring = (y: number) => {
    for (let i = 0; i < 32; i++) {
      for (const k of [i, i + 1]) {
        const a = (k / 32) * Math.PI * 2
        points.push(Math.cos(a) * r, y, Math.sin(a) * r)
      }
    }
  }
  ring(body)
  ring(-body)
  for (const [x, z] of [[r, 0], [-r, 0], [0, r], [0, -r]]) points.push(x, body, z, x, -body, z)
  if (c.shape === 'capsule') {
    // Half-circle arcs for the caps in the two vertical planes.
    for (const sign of [1, -1]) {
      for (const plane of [0, 1]) {
        for (let i = 0; i < 16; i++) {
          for (const k of [i, i + 1]) {
            const a = (k / 16) * Math.PI
            const h = Math.cos(a) * r
            const y = sign * (body + Math.sin(a) * r)
            points.push(plane ? 0 : h, y, plane ? h : 0)
          }
        }
      }
    }
  }
  return new BufferGeometry().setAttribute('position', new Float32BufferAttribute(points, 3))
}

const sphereGeometry = new BufferGeometry().setAttribute('position', new Float32BufferAttribute(circles(), 3))
const scale = new Vector3()
const line0 = new Object3D()

function meshCount(node: Object3D): number {
  let n = 0
  ;(node.userData.visual as Object3D | undefined)?.traverse((o) => {
    if ((o as Mesh).isMesh) n++
  })
  return n
}

/** Feature edges of the entity's visual (creases over 20°), so dense models stay readable. */
function meshEdges(node: Object3D, worldScale: Vector3): BufferGeometry {
  const { vertices, indices } = visualGeometry(node, worldScale)
  const surface = new BufferGeometry().setAttribute('position', new Float32BufferAttribute(vertices, 3)).setIndex([...indices])
  const edges = new EdgesGeometry(surface, 20)
  surface.dispose()
  return edges
}

/** Draws collider shapes on top of the scene (edit mode). Rebuilds only when collider data changes. */
export class ColliderOutlines {
  readonly group = new Group()
  private readonly lines = new Map<string, { collider: ColliderDoc; line: LineSegments; key: string }>()

  update(entities: EntityDoc[], nodes: Map<string, Object3D>): void {
    const wanted = new Set<string>()
    for (const entity of entities) {
      const c = entity.collider!
      const node = nodes.get(entity.id)
      if (!node) continue
      wanted.add(entity.id)
      let entry = this.lines.get(entity.id)
      const fromVisual = c.shape === 'mesh' || c.shape === 'convex'
      // Mesh shapes follow the visual, which may still be loading or change scale.
      node.updateWorldMatrix(true, false)
      node.matrixWorld.decompose(line0.position, line0.quaternion, scale)
      const key = fromVisual ? `${meshCount(node)}:${scale.toArray().join(',')}` : ''
      if (!entry || entry.collider !== c || entry.key !== key) {
        if (entry) this.drop(entity.id)
        const geometry = fromVisual
          ? meshEdges(node, scale)
          : c.shape === 'box'
            ? boxEdges
            : c.shape === 'sphere'
              ? sphereGeometry
              : roundShape(c)
        const line = new LineSegments(geometry, c.trigger ? triggerMaterial : material)
        line.renderOrder = 999
        line.userData.editorOnly = true
        this.group.add(line)
        entry = { collider: c, line, key }
        this.lines.set(entity.id, entry)
      }
      // Match the entity's world transform, baking shape size like play mode does.
      const { line } = entry
      node.updateWorldMatrix(true, false)
      node.matrixWorld.decompose(line.position, line.quaternion, scale)
      const offset = new Vector3(...c.center).multiply(scale).applyQuaternion(line.quaternion)
      line.position.add(offset)
      if (fromVisual) line.scale.setScalar(1) // vertices already carry the scale
      else if (c.shape === 'box') line.scale.set(c.size[0] * scale.x, c.size[1] * scale.y, c.size[2] * scale.z)
      else if (c.shape === 'sphere') line.scale.setScalar(c.radius * Math.max(scale.x, scale.y, scale.z))
      else {
        const radial = Math.max(scale.x, scale.z)
        line.scale.set(radial, scale.y, radial)
      }
    }
    for (const id of [...this.lines.keys()]) if (!wanted.has(id)) this.drop(id)
  }

  dispose(): void {
    for (const id of [...this.lines.keys()]) this.drop(id)
  }

  private drop(id: string): void {
    const entry = this.lines.get(id)
    if (!entry) return
    entry.line.removeFromParent()
    if (entry.line.geometry !== boxEdges && entry.line.geometry !== sphereGeometry) entry.line.geometry.dispose()
    this.lines.delete(id)
  }
}
