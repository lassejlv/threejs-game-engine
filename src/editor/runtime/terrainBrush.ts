import { BufferGeometry, Float32BufferAttribute, LineBasicMaterial, LineLoop, type Mesh, type Object3D, type PerspectiveCamera, Raycaster, Vector2, Vector3 } from 'three'
import { decodeHeights, encodeHeights, type EntityDoc } from '../document'
import { editorStore, updateEntity } from '../editor'
import { applyBrush, sampleHeight, updateTerrainMesh } from './terrain'

const ring = (() => {
  const points: number[] = []
  for (let i = 0; i < 64; i++) {
    const a = (i / 64) * Math.PI * 2
    points.push(Math.cos(a), 0, Math.sin(a))
  }
  return new BufferGeometry().setAttribute('position', new Float32BufferAttribute(points, 3))
})()

/**
 * Sculpting for the selected Terrain in the Scene view: raise, lower, smooth or
 * flatten under a circular brush. A stroke edits the mesh live and becomes one
 * undo step when the pointer is released.
 */
export class TerrainBrush {
  readonly cursor = new LineLoop(ring, new LineBasicMaterial({ color: 0xffd25a, depthTest: false, transparent: true, fog: false }))
  private stroke: { entity: EntityDoc; node: Object3D; heights: Float32Array; target: number } | null = null
  private readonly raycaster = new Raycaster()
  private readonly local = new Vector3()

  constructor(
    private readonly camera: PerspectiveCamera,
    private readonly target: () => { entity: EntityDoc; node: Object3D } | null,
  ) {
    this.cursor.renderOrder = 1000
    this.cursor.userData.editorOnly = true
    this.cursor.visible = false
  }

  /** Moves the brush ring under the pointer; returns the local hit point (or null). */
  hover(pointer: Vector2): Vector3 | null {
    const found = this.target()
    const tool = editorStore.get().terrainTool
    const hit = found && tool ? this.hit(found.node, pointer) : null
    this.cursor.visible = !!hit
    if (!hit || !found) return null
    const { brushRadius } = editorStore.get()
    found.node.updateWorldMatrix(true, false)
    const world = hit.clone().applyMatrix4(found.node.matrixWorld)
    this.cursor.position.copy(world).add(new Vector3(0, 0.05, 0))
    const s = found.node.getWorldScale(new Vector3())
    this.cursor.scale.set(brushRadius * s.x, 1, brushRadius * s.z)
    return hit
  }

  /** Starts a stroke if the pointer is over the selected terrain. */
  begin(pointer: Vector2): boolean {
    const found = this.target()
    if (!found?.entity.terrain || !editorStore.get().terrainTool) return false
    const hit = this.hover(pointer)
    if (!hit) return false
    const t = found.entity.terrain
    const heights = decodeHeights(t.heights, t.resolution)
    this.stroke = { entity: found.entity, node: found.node, heights, target: sampleHeight(t, heights, hit.x, hit.z) }
    this.dab(hit)
    return true
  }

  move(pointer: Vector2): void {
    const hit = this.hover(pointer)
    if (this.stroke && hit) this.dab(hit)
  }

  end(): void {
    const stroke = this.stroke
    this.stroke = null
    if (!stroke) return
    const heights = encodeHeights(stroke.heights)
    updateEntity(stroke.entity.id, (e) => (e.terrain ? { terrain: { ...e.terrain, heights } } : {}), { label: `Sculpt ${stroke.entity.name}` })
  }

  get active(): boolean {
    return this.stroke !== null
  }

  private dab(local: Vector3): void {
    const stroke = this.stroke!
    const t = stroke.entity.terrain!
    const { terrainTool, brushRadius, brushStrength } = editorStore.get()
    if (!terrainTool) return
    if (applyBrush(t, stroke.heights, terrainTool, local.x, local.z, brushRadius, brushStrength, stroke.target)) {
      const mesh = stroke.node.userData.terrain as Mesh | undefined
      if (mesh) updateTerrainMesh(mesh, t, stroke.heights)
    }
  }

  /** The pointer's hit on the terrain mesh, in the entity's local space. */
  private hit(node: Object3D, pointer: Vector2): Vector3 | null {
    const mesh = node.userData.terrain as Mesh | undefined
    if (!mesh) return null
    this.raycaster.setFromCamera(pointer, this.camera)
    const hit = this.raycaster.intersectObject(mesh, false)[0]
    if (!hit) return null
    node.updateWorldMatrix(true, false)
    return this.local.copy(hit.point).applyMatrix4(node.matrixWorld.clone().invert()).clone()
  }
}
