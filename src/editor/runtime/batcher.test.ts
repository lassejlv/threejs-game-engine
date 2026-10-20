import { BoxGeometry, Group, InstancedMesh, Matrix4, Mesh, MeshStandardMaterial, Scene } from 'three'
import { describe, expect, it } from 'vitest'
import { MeshBatcher } from './batcher'

const geometry = new BoxGeometry()

function entity(scene: Scene, key = 'box:red', x = 0) {
  const node = new Group()
  node.position.x = x
  const visual = new Group()
  const mesh = new Mesh(geometry, new MeshStandardMaterial({ color: 'red' }))
  mesh.userData.batchKey = key
  visual.add(mesh)
  node.add(visual)
  scene.add(node)
  return { node, visual, mesh }
}

const batches = (scene: Scene) => scene.children.filter((c): c is InstancedMesh => c instanceof InstancedMesh)

describe('MeshBatcher', () => {
  it('draws identical meshes as one instanced mesh and hides the originals', () => {
    const scene = new Scene()
    const batcher = new MeshBatcher(scene)
    const items = [0, 1, 2].map((x) => entity(scene, 'box:red', x))
    for (const e of items) batcher.add(e.visual)
    batcher.update()
    const [batch] = batches(scene)
    expect(batches(scene)).toHaveLength(1)
    expect(batch.count).toBe(3)
    expect(items.every((e) => !e.mesh.visible)).toBe(true)
    const m = new Matrix4()
    batch.getMatrixAt(2, m)
    expect(m.elements[12]).toBe(2)
  })

  it('leaves a lone mesh alone and groups by key', () => {
    const scene = new Scene()
    const batcher = new MeshBatcher(scene)
    const lone = entity(scene, 'sphere')
    const pair = [entity(scene), entity(scene)]
    for (const e of [lone, ...pair]) batcher.add(e.visual)
    batcher.update()
    expect(batches(scene)).toHaveLength(1)
    expect(lone.mesh.visible).toBe(true)
  })

  it('drops destroyed members and hides members under hidden parents', () => {
    const scene = new Scene()
    const batcher = new MeshBatcher(scene)
    const items = [0, 1, 2].map((x) => entity(scene, 'box:red', x))
    for (const e of items) batcher.add(e.visual)
    batcher.update()
    items[0].node.removeFromParent()
    items[1].node.visible = false
    batcher.update()
    const [batch] = batches(scene)
    expect(batch.count).toBe(2)
    const scales = [0, 1].map((i) => {
      const m = new Matrix4()
      batch.getMatrixAt(i, m)
      return m.getMaxScaleOnAxis()
    })
    expect(scales.sort()).toEqual([0, 1])
  })

  it('releases a member whose material a script changed', () => {
    const scene = new Scene()
    const batcher = new MeshBatcher(scene)
    const items = [0, 1, 2].map((x) => entity(scene, 'box:red', x))
    for (const e of items) batcher.add(e.visual)
    batcher.update()
    ;(items[0].mesh.material as MeshStandardMaterial).color.set('blue')
    batcher.update()
    expect(items[0].mesh.visible).toBe(true)
    expect(batches(scene)[0].count).toBe(2)
    // The batch keeps its own copy of the material, so the others stay red.
    expect((batches(scene)[0].material as MeshStandardMaterial).color.getHexString()).toBe('ff0000')
  })

  it('grows when members are added later', () => {
    const scene = new Scene()
    const batcher = new MeshBatcher(scene)
    for (let i = 0; i < 20; i++) {
      batcher.add(entity(scene, 'box:red', i).visual)
      batcher.update()
    }
    expect(batches(scene)).toHaveLength(1)
    expect(batches(scene)[0].count).toBe(20)
  })
})
