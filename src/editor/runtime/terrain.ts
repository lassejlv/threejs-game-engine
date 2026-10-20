import { BufferAttribute, Color, MathUtils, Mesh, MeshStandardMaterial, PlaneGeometry } from 'three'
import type { TerrainDoc } from '../document'

const low = new Color()
const steep = new Color()

/** A terrain mesh: a plane displaced by the heights, colored by slope. Entity-local, centered. */
export function createTerrainMesh(t: TerrainDoc, heights: Float32Array): Mesh {
  const n = t.resolution
  const geometry = new PlaneGeometry(t.size[0], t.size[1], n - 1, n - 1).rotateX(-Math.PI / 2)
  geometry.setAttribute('color', new BufferAttribute(new Float32Array(n * n * 3), 3))
  const material = new MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 })
  const mesh = new Mesh(geometry, material)
  mesh.name = 'Terrain'
  mesh.castShadow = true
  mesh.receiveShadow = true
  mesh.userData.terrain = true
  updateTerrainMesh(mesh, t, heights)
  return mesh
}

/**
 * Writes heights into the mesh (rows from -z to +z, matching the plane's
 * vertex order) and recolors by slope. Fast enough to run on every brush stroke.
 */
export function updateTerrainMesh(mesh: Mesh, t: TerrainDoc, heights: Float32Array): void {
  const geometry = mesh.geometry
  const position = geometry.getAttribute('position') as BufferAttribute
  for (let i = 0; i < position.count; i++) position.setY(i, heights[i] ?? 0)
  position.needsUpdate = true
  geometry.computeVertexNormals()
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()
  const normal = geometry.getAttribute('normal') as BufferAttribute
  const color = geometry.getAttribute('color') as BufferAttribute
  low.set(t.color)
  steep.set(t.slopeColor)
  for (let i = 0; i < normal.count; i++) {
    const angle = MathUtils.radToDeg(Math.acos(MathUtils.clamp(normal.getY(i), -1, 1)))
    const k = MathUtils.smoothstep(angle, t.slopeAngle - 6, t.slopeAngle + 6)
    color.setXYZ(i, low.r + (steep.r - low.r) * k, low.g + (steep.g - low.g) * k, low.b + (steep.b - low.b) * k)
  }
  color.needsUpdate = true
}

/** Height (entity-local) at a local x/z point, bilinear between samples; 0 outside. */
export function sampleHeight(t: TerrainDoc, heights: Float32Array, x: number, z: number): number {
  const n = t.resolution
  const fx = (x / t.size[0] + 0.5) * (n - 1)
  const fz = (z / t.size[1] + 0.5) * (n - 1)
  if (fx < 0 || fz < 0 || fx > n - 1 || fz > n - 1) return 0
  const x0 = Math.min(n - 2, Math.floor(fx))
  const z0 = Math.min(n - 2, Math.floor(fz))
  const tx = fx - x0
  const tz = fz - z0
  const h = (ix: number, iz: number) => heights[iz * n + ix]
  return (h(x0, z0) * (1 - tx) + h(x0 + 1, z0) * tx) * (1 - tz) + (h(x0, z0 + 1) * (1 - tx) + h(x0 + 1, z0 + 1) * tx) * tz
}

export type BrushTool = 'raise' | 'lower' | 'smooth' | 'flatten'

/**
 * Applies one brush dab at a local point. `target` is the flatten height.
 * Returns whether anything changed.
 */
export function applyBrush(
  t: TerrainDoc,
  heights: Float32Array,
  tool: BrushTool,
  x: number,
  z: number,
  radius: number,
  strength: number,
  target: number,
): boolean {
  const n = t.resolution
  const cellX = t.size[0] / (n - 1)
  const cellZ = t.size[1] / (n - 1)
  const cx = (x / t.size[0] + 0.5) * (n - 1)
  const cz = (z / t.size[1] + 0.5) * (n - 1)
  const rx = Math.ceil(radius / cellX)
  const rz = Math.ceil(radius / cellZ)
  const source = tool === 'smooth' ? heights.slice() : heights
  let changed = false
  for (let iz = Math.max(0, Math.floor(cz - rz)); iz <= Math.min(n - 1, Math.ceil(cz + rz)); iz++) {
    for (let ix = Math.max(0, Math.floor(cx - rx)); ix <= Math.min(n - 1, Math.ceil(cx + rx)); ix++) {
      const d = Math.hypot((ix - cx) * cellX, (iz - cz) * cellZ)
      if (d > radius) continue
      const falloff = 1 - MathUtils.smoothstep(d, radius * 0.3, radius)
      const i = iz * n + ix
      const before = heights[i]
      if (tool === 'raise') heights[i] += strength * 0.15 * falloff
      else if (tool === 'lower') heights[i] -= strength * 0.15 * falloff
      else if (tool === 'flatten') heights[i] += (target - heights[i]) * Math.min(1, strength * 0.25 * falloff)
      else {
        let sum = 0
        let count = 0
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const jx = ix + dx
          const jz = iz + dz
          if (jx < 0 || jz < 0 || jx >= n || jz >= n) continue
          sum += source[jz * n + jx]
          count++
        }
        heights[i] += (sum / count - source[i]) * Math.min(1, strength * 0.5 * falloff)
      }
      if (heights[i] !== before) changed = true
    }
  }
  return changed
}
