import { Object3D, PerspectiveCamera, Vector2 } from 'three'
import { describe, expect, it } from 'vitest'
import { componentDefaults } from '../document'
import { ColliderHandles } from './colliderHandles'

/** A camera looking down -Z at the origin from 10 m. */
function view() {
  const camera = new PerspectiveCamera(60, 1, 0.1, 100)
  camera.position.set(0, 0, 10)
  camera.lookAt(0, 0, 0)
  camera.updateMatrixWorld()
  return camera
}

/** Screen position (normalized device coordinates) of a world point. */
const ndc = (camera: PerspectiveCamera, x: number, y: number, z: number) => {
  const v = new Object3D().position.set(x, y, z).project(camera)
  return new Vector2(v.x, v.y)
}

describe('ColliderHandles', () => {
  it('resizes one face of a box and moves the center so the other face stays put', () => {
    const camera = view()
    const node = new Object3D()
    node.scale.set(2, 1, 1)
    node.updateMatrixWorld()
    const collider = componentDefaults.collider() // 1×1×1 box → 2 m wide in the world
    const handles = new ColliderHandles()
    handles.update(collider, node, camera)
    expect(handles.begin(ndc(camera, 1, 0, 0), camera, collider)).toBe(true) // the +X face
    const change = handles.move(ndc(camera, 2, 0, 0), camera)! // drag it 1 m right
    expect(change.size![0]).toBeCloseTo(1.5) // +1 m world = +0.5 local at scale 2
    expect(change.center![0]).toBeCloseTo(0.25)
    handles.end()
  })

  it('changes a sphere radius', () => {
    const camera = view()
    const node = new Object3D()
    node.updateMatrixWorld()
    const collider = { ...componentDefaults.collider(), shape: 'sphere' as const, radius: 1 }
    const handles = new ColliderHandles()
    handles.update(collider, node, camera)
    expect(handles.begin(ndc(camera, 0, 1, 0), camera, collider)).toBe(true)
    expect(handles.move(ndc(camera, 0, 1.5, 0), camera)!.radius).toBeCloseTo(1.5)
  })

  it('ignores clicks away from the handles and hides for mesh colliders', () => {
    const camera = view()
    const node = new Object3D()
    node.updateMatrixWorld()
    const handles = new ColliderHandles()
    const box = componentDefaults.collider()
    handles.update(box, node, camera)
    expect(handles.begin(ndc(camera, 3, 3, 0), camera, box)).toBe(false)
    handles.update({ ...box, shape: 'mesh' }, node, camera)
    expect(handles.group.visible).toBe(false)
  })
})
