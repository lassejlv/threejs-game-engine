import { describe, expect, it } from 'vitest'
import { componentDefaults, decodeHeights, encodeHeights } from '../document'
import { applyBrush, createTerrainMesh, sampleHeight } from './terrain'

const flat = () => ({ ...componentDefaults.terrain(), resolution: 33, size: [32, 32] as [number, number] })

describe('terrain', () => {
  it('round-trips heights through the document encoding', () => {
    const heights = Float32Array.from({ length: 33 * 33 }, (_, i) => Math.sin(i))
    expect(Array.from(decodeHeights(encodeHeights(heights), 33))).toEqual(Array.from(heights))
    expect(decodeHeights('', 4)).toEqual(new Float32Array(16))
  })

  it('raises, lowers, flattens and smooths under the brush only', () => {
    const t = flat()
    const h = new Float32Array(33 * 33)
    applyBrush(t, h, 'raise', 0, 0, 3, 1, 0)
    expect(sampleHeight(t, h, 0, 0)).toBeGreaterThan(0)
    expect(sampleHeight(t, h, 10, 10)).toBe(0) // outside the radius
    const peak = sampleHeight(t, h, 0, 0)
    applyBrush(t, h, 'lower', 0, 0, 3, 1, 0)
    expect(sampleHeight(t, h, 0, 0)).toBeLessThan(peak)
    for (let i = 0; i < 40; i++) applyBrush(t, h, 'raise', 0, 0, 3, 1, 0)
    const before = sampleHeight(t, h, 0, 0)
    for (let i = 0; i < 20; i++) applyBrush(t, h, 'smooth', 0, 0, 6, 1, 0)
    expect(sampleHeight(t, h, 0, 0)).toBeLessThan(before)
    for (let i = 0; i < 60; i++) applyBrush(t, h, 'flatten', 0, 0, 8, 2, 0.5)
    expect(sampleHeight(t, h, 0, 0)).toBeCloseTo(0.5, 1)
  })

  it('builds a mesh whose vertices follow the heights, rows from -z to +z', () => {
    const t = { ...flat(), resolution: 3, size: [10, 10] as [number, number] }
    const h = new Float32Array(9)
    h[2] = 2 // row z = -5, column x = +5 (same layout as the physics heightfield)
    const position = createTerrainMesh(t, h).geometry.getAttribute('position')
    expect([position.getX(2), position.getY(2), position.getZ(2)]).toEqual([5, 2, -5])
  })
})
