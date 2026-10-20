import { type BufferGeometry, Matrix4, type Mesh, type Object3D, Vector3 } from 'three'

const toNode = new Matrix4()
const vertex = new Vector3()

/**
 * The vertices (and triangles) of an entity's own visual (mesh or model, first LOD
 * level only), relative to the entity with its world scale applied.
 */
export function visualGeometry(node: Object3D, worldScale: Vector3): { vertices: Float32Array; indices: Uint32Array } {
  node.updateWorldMatrix(true, true)
  const inverse = node.matrixWorld.clone().invert()
  const vertices: number[] = []
  const indices: number[] = []
  const visit = (object: Object3D) => {
    if (object.userData.editorOnly || object.name === 'Particles' || object.name === 'Batch') return
    if ((object as { isLOD?: boolean }).isLOD) {
      const first = (object as unknown as { levels: { object: Object3D }[] }).levels[0]
      if (first) visit(first.object)
      return
    }
    const mesh = object as Mesh
    const geometry = mesh.isMesh ? (mesh.geometry as BufferGeometry) : null
    const positions = geometry?.getAttribute('position')
    if (geometry && positions) {
      toNode.multiplyMatrices(inverse, mesh.matrixWorld)
      const base = vertices.length / 3
      for (let i = 0; i < positions.count; i++) {
        vertex.fromBufferAttribute(positions, i).applyMatrix4(toNode).multiply(worldScale)
        vertices.push(vertex.x, vertex.y, vertex.z)
      }
      const index = geometry.getIndex()
      if (index) for (let i = 0; i < index.count; i++) indices.push(base + index.getX(i))
      else for (let i = 0; i < positions.count; i++) indices.push(base + i)
    }
    for (const child of object.children) if (!child.userData.docId) visit(child)
  }
  const visual = node.userData.visual as Object3D | undefined
  if (visual) visit(visual)
  return { vertices: new Float32Array(vertices), indices: new Uint32Array(indices) }
}
