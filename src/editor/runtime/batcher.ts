import { InstancedMesh, Matrix4, type Mesh, type MeshStandardMaterial, type Object3D, type Scene } from 'three'

interface BatchGroup {
  members: Mesh[]
  /** Created once a second member joins; a lone mesh draws itself. */
  instanced: InstancedMesh | null
  /** The batch's own copy of the shared look; a member whose material diverges from it is released. */
  material: MeshStandardMaterial
  /** First member's material: textures load into it asynchronously and are copied over. */
  source: MeshStandardMaterial
}

const TEXTURE_SLOTS = ['map', 'emissiveMap', 'normalMap', 'roughnessMap', 'metalnessMap'] as const

const hidden = new Matrix4().makeScale(0, 0, 0)

/**
 * Play mode: draws identical meshes (same primitive and material settings,
 * see `materialKey`) with one InstancedMesh per group instead of one draw
 * call each. The original meshes stay in the scene graph, hidden, and keep
 * driving the instance transforms, so scripts and physics are unaffected.
 */
export class MeshBatcher {
  private readonly groups = new Map<string, BatchGroup>()

  constructor(private readonly scene: Scene) {}

  /** Takes over drawing of eligible meshes in `root` (an entity's visual group). */
  add(root: Object3D): void {
    root.traverse((object) => {
      const mesh = object as Mesh
      const key = mesh.userData.batchKey as string | undefined
      if (!mesh.isMesh || !key || mesh.userData.batched) return
      let group = this.groups.get(key)
      if (!group) {
        const source = mesh.material as MeshStandardMaterial
        group = { members: [], instanced: null, material: source.clone(), source }
        this.groups.set(key, group)
      }
      mesh.userData.batched = true
      group.members.push(mesh)
    })
  }

  /** Total draw calls the batches replace (for tests and stats). */
  get batchedMeshes(): number {
    let n = 0
    for (const g of this.groups.values()) if (g.instanced) n += g.members.length
    return n
  }

  /** Copies member transforms into their instances. Run once per frame, before rendering. */
  update(): void {
    this.scene.updateMatrixWorld()
    for (const group of this.groups.values()) {
      const { members } = group
      let i = 0
      while (i < members.length) {
        const mesh = members[i]
        const state = this.memberState(mesh, group.material)
        if (state === 'gone' || state === 'diverged') {
          this.release(mesh, state === 'diverged')
          members[i] = members[members.length - 1]
          members.pop()
          continue
        }
        i++
      }
      if (members.length < 2 && !group.instanced) continue
      syncTextures(group)
      const instanced = this.ensureCapacity(group)
      for (let k = 0; k < members.length; k++) {
        const mesh = members[k]
        mesh.visible = false
        instanced.setMatrixAt(k, this.visibleInWorld(mesh) ? mesh.matrixWorld : hidden)
      }
      instanced.count = members.length
      instanced.instanceMatrix.needsUpdate = true
    }
  }

  private memberState(mesh: Mesh, base: MeshStandardMaterial): 'ok' | 'gone' | 'diverged' {
    let root: Object3D = mesh
    while (root.parent) root = root.parent
    if (root !== this.scene) return 'gone'
    const m = mesh.material as MeshStandardMaterial
    // A script recolored or swapped the material: draw this one on its own again.
    const same =
      m.color?.equals(base.color) && m.emissive?.equals(base.emissive) && m.emissiveIntensity === base.emissiveIntensity && m.opacity === base.opacity
    return same ? 'ok' : 'diverged'
  }

  private release(mesh: Mesh, keepDrawing: boolean): void {
    mesh.userData.batched = false
    if (keepDrawing) mesh.visible = true
  }

  /** Visible if every ancestor is (the mesh itself is hidden while batched). */
  private visibleInWorld(mesh: Mesh): boolean {
    for (let o = mesh.parent; o; o = o.parent) if (!o.visible) return false
    return true
  }

  private ensureCapacity(group: BatchGroup): InstancedMesh {
    const needed = group.members.length
    let instanced = group.instanced
    if (instanced && instanced.instanceMatrix.count >= needed) return instanced
    const first = group.members[0]
    const capacity = Math.max(8, needed * 2)
    const next = new InstancedMesh(first.geometry, group.material, capacity)
    next.name = 'Batch'
    next.frustumCulled = false // instances move; their bounds aren't tracked
    next.castShadow = first.castShadow
    next.receiveShadow = first.receiveShadow
    if (instanced) {
      instanced.removeFromParent()
      instanced.dispose()
    }
    this.scene.add(next)
    group.instanced = next
    instanced = next
    return instanced
  }
}

function syncTextures(group: BatchGroup): void {
  const { material, source } = group
  for (const slot of TEXTURE_SLOTS) {
    if (material[slot] !== source[slot]) {
      material[slot] = source[slot]
      material.needsUpdate = true
    }
  }
}
