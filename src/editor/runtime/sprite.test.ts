import { Texture } from 'three'
import { describe, expect, it } from 'vitest'
import { componentDefaults } from '../document'
import { SpriteRenderer } from './sprite'

function sprite(patch: Partial<ReturnType<typeof componentDefaults.sprite>> = {}) {
  const renderer = new SpriteRenderer({ ...componentDefaults.sprite(), ...patch })
  renderer.setTexture(new Texture())
  return renderer
}

describe('SpriteRenderer', () => {
  it('sizes the quad and mirrors it when flipped', () => {
    const s = sprite({ size: [2, 3] })
    expect(s.mesh.scale.toArray()).toEqual([2, 3, 1])
    s.flipX = true
    expect(s.mesh.scale.toArray()).toEqual([-2, 3, 1])
  })

  it('shows sheet frames left to right, top to bottom', () => {
    const s = sprite({ sheetColumns: 4, sheetRows: 2 })
    const map = s.mesh.material.map!
    expect(map.repeat.toArray()).toEqual([0.25, 0.5])
    expect(map.offset.toArray()).toEqual([0, 0.5])
    s.frame = 5
    expect(map.offset.toArray()).toEqual([0.25, 0])
    s.frame = 8
    expect(s.frame).toBe(0)
  })

  it('animates at its frame rate and loops', () => {
    const s = sprite({ sheetColumns: 3, sheetRows: 1, fps: 10 })
    s.update(0.25)
    expect(s.frame).toBe(2)
    s.update(0.1)
    expect(s.frame).toBe(0)
  })

  it('keeps its own copy of a shared texture', () => {
    const shared = new Texture()
    const a = new SpriteRenderer({ ...componentDefaults.sprite(), sheetColumns: 2 })
    a.setTexture(shared)
    expect(a.mesh.material.map).not.toBe(shared)
    expect(shared.repeat.x).toBe(1)
  })
})
