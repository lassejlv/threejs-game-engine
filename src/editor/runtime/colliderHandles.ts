import { Group, Mesh, MeshBasicMaterial, type Object3D, type PerspectiveCamera, Quaternion, Raycaster, SphereGeometry, Vector2, Vector3 } from 'three'
import type { ColliderDoc, Vec3 } from '../document'

/** One draggable handle: which collider dimension it changes, along which local axis and side. */
interface Handle {
  mesh: Mesh
  axis: 0 | 1 | 2
  sign: 1 | -1
  kind: 'size' | 'radius' | 'height'
}

export interface ColliderEdit {
  size?: Vec3
  center?: Vec3
  radius?: number
  height?: number
}

const geometry = new SphereGeometry(0.09, 12, 8)
const material = new MeshBasicMaterial({ color: 0x5cff8a, depthTest: false, transparent: true, fog: false })
const hotMaterial = new MeshBasicMaterial({ color: 0xffffff, depthTest: false, transparent: true, fog: false })
const AXES = [new Vector3(1, 0, 0), new Vector3(0, 1, 0), new Vector3(0, 0, 1)]
const round = (v: number) => Math.round(v * 1000) / 1000

/**
 * Handles on a selected collider's faces (box) or radius/height (round shapes).
 * Dragging one resizes that side and moves the center, so the opposite side stays put.
 */
export class ColliderHandles {
  readonly group = new Group()
  private handles: Handle[] = []
  private shape: string | null = null
  private readonly position = new Vector3()
  private readonly rotation = new Quaternion()
  private readonly scale = new Vector3()
  private drag: { handle: Handle; start: ColliderDoc; origin: Vector3; direction: Vector3; startOffset: number } | null = null

  constructor() {
    this.group.name = 'Collider handles'
    this.group.userData.editorOnly = true
    this.group.renderOrder = 1000
  }

  /** Places handles for the collider of `node`, or hides them (null). */
  update(collider: ColliderDoc | null, node: Object3D | null, camera: PerspectiveCamera): void {
    const editable = collider && node && collider.shape !== 'mesh' && collider.shape !== 'convex'
    this.group.visible = !!editable
    if (!editable) return
    if (this.shape !== collider.shape) this.rebuild(collider.shape)
    node.updateWorldMatrix(true, false)
    node.matrixWorld.decompose(this.position, this.rotation, this.scale)
    const center = new Vector3(...collider.center).multiply(this.scale)
    for (const h of this.handles) {
      const local = new Vector3()
      const extent = this.extent(collider, h)
      local.setComponent(h.axis, h.sign * extent)
      h.mesh.position.copy(local.add(center).applyQuaternion(this.rotation).add(this.position))
      // Constant on-screen size.
      h.mesh.scale.setScalar(Math.max(0.05, camera.position.distanceTo(h.mesh.position) * 0.06))
      h.mesh.material = this.drag?.handle === h ? hotMaterial : material
    }
  }

  /** Starts a drag if the pointer is on a handle. */
  begin(pointer: Vector2, camera: PerspectiveCamera, collider: ColliderDoc): boolean {
    if (!this.group.visible) return false
    this.group.updateMatrixWorld(true)
    const raycaster = new Raycaster()
    raycaster.setFromCamera(pointer, camera)
    const hit = raycaster.intersectObjects(this.handles.map((h) => h.mesh), false)[0]
    const handle = hit && this.handles.find((h) => h.mesh === hit.object)
    if (!handle) return false
    const origin = handle.mesh.position.clone()
    const direction = AXES[handle.axis].clone().multiplyScalar(handle.sign).applyQuaternion(this.rotation).normalize()
    this.drag = { handle, start: structuredClone(collider), origin, direction, startOffset: this.along(raycaster, origin, direction) }
    return true
  }

  /** The collider change for the current pointer position. */
  move(pointer: Vector2, camera: PerspectiveCamera): ColliderEdit | null {
    if (!this.drag) return null
    const raycaster = new Raycaster()
    raycaster.setFromCamera(pointer, camera)
    const { handle, start, origin, direction, startOffset } = this.drag
    const world = this.along(raycaster, origin, direction) - startOffset
    const s = this.scale
    const axisScale = [s.x, s.y, s.z][handle.axis] || 1
    if (handle.kind === 'size') {
      const delta = world / axisScale
      const size = [...start.size] as Vec3
      const center = [...start.center] as Vec3
      const grown = Math.max(0.01, size[handle.axis] + delta)
      center[handle.axis] = round(center[handle.axis] + (handle.sign * (grown - size[handle.axis])) / 2)
      size[handle.axis] = round(grown)
      return { size, center }
    }
    if (handle.kind === 'radius') {
      const radial = start.shape === 'sphere' ? Math.max(s.x, s.y, s.z) : Math.max(s.x, s.z)
      return { radius: round(Math.max(0.01, start.radius + world / radial)) }
    }
    const height = Math.max(0.01, start.height + world / s.y)
    const center = [...start.center] as Vec3
    center[1] = round(center[1] + (handle.sign * (height - start.height)) / 2)
    return { height: round(height), center }
  }

  end(): void {
    this.drag = null
  }

  get dragging(): boolean {
    return this.drag !== null
  }

  dispose(): void {
    this.group.removeFromParent()
  }

  private extent(c: ColliderDoc, h: Handle): number {
    const s = [this.scale.x, this.scale.y, this.scale.z]
    if (h.kind === 'size') return (c.size[h.axis] * s[h.axis]) / 2
    if (h.kind === 'radius') return c.radius * (c.shape === 'sphere' ? Math.max(...s) : Math.max(s[0], s[2]))
    return (c.height * s[1]) / 2
  }

  private rebuild(shape: string): void {
    this.shape = shape
    for (const h of this.handles) h.mesh.removeFromParent()
    const make = (axis: 0 | 1 | 2, sign: 1 | -1, kind: Handle['kind']): Handle => {
      const mesh = new Mesh(geometry, material)
      mesh.renderOrder = 1000
      mesh.userData.editorOnly = true
      this.group.add(mesh)
      return { mesh, axis, sign, kind }
    }
    const signs = [1, -1] as const
    if (shape === 'box') this.handles = ([0, 1, 2] as const).flatMap((axis) => signs.map((sign) => make(axis, sign, 'size')))
    else if (shape === 'sphere') this.handles = ([0, 1, 2] as const).flatMap((axis) => signs.map((sign) => make(axis, sign, 'radius')))
    else this.handles = [...([0, 2] as const).flatMap((axis) => signs.map((sign) => make(axis, sign, 'radius'))), ...signs.map((sign) => make(1, sign, 'height'))]
  }

  /** Distance along the handle's axis line closest to the pointer ray. */
  private along(raycaster: Raycaster, origin: Vector3, direction: Vector3): number {
    const r = raycaster.ray.direction
    const w0 = origin.clone().sub(raycaster.ray.origin)
    const b = direction.dot(r)
    const denominator = 1 - b * b
    if (Math.abs(denominator) < 1e-6) return 0 // looking straight down the axis
    return (b * r.dot(w0) - direction.dot(w0)) / denominator
  }
}
