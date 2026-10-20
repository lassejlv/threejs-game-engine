import { describe, expect, it } from 'vitest'
import {
  assetReferences,
  componentDefaults as defaults,
  createVariant,
  cloneSubtree,
  componentDefaults,
  createEntity,
  depthFirst,
  type EntityDoc,
  expandEntities,
  instantiatePrefab,
  ownerId,
  parseProject,
  type PrefabDoc,
  subtreeIds,
} from './document'
import { sampleProject } from './sample'
import { compileScript } from './scripting'

function tree(): EntityDoc[] {
  const root = createEntity('Root')
  const child = createEntity('Child', { parent: root.id })
  const grandchild = createEntity('Grandchild', { parent: child.id })
  const other = createEntity('Other')
  // Deliberately out of order: children before parents.
  return [grandchild, other, child, root]
}

describe('document', () => {
  it('collects a subtree', () => {
    const list = tree()
    const root = list.find((e) => e.name === 'Root')!
    expect([...subtreeIds(list, root.id)].map((id) => list.find((e) => e.id === id)!.name).sort()).toEqual([
      'Child',
      'Grandchild',
      'Root',
    ])
  })

  it('orders parents before children', () => {
    const names = depthFirst(tree()).map((e) => e.name)
    expect(names.indexOf('Root')).toBeLessThan(names.indexOf('Child'))
    expect(names.indexOf('Child')).toBeLessThan(names.indexOf('Grandchild'))
  })

  it('clones a subtree with fresh ids and remapped parents', () => {
    const list = tree()
    const root = list.find((e) => e.name === 'Root')!
    const copies = cloneSubtree(list, root.id)
    const ids = new Set(copies.map((c) => c.id))
    expect(copies).toHaveLength(3)
    expect(copies.some((c) => list.some((e) => e.id === c.id))).toBe(false)
    for (const c of copies) if (c.name !== 'Root (copy)') expect(ids.has(c.parent!)).toBe(true)
  })

  it('round-trips the sample project through JSON', () => {
    const doc = sampleProject()
    expect(parseProject(JSON.parse(JSON.stringify(doc)))).toEqual(doc)
  })

  it('upgrades version 1 files to a single scene', () => {
    const doc = parseProject({ version: 1, name: 'Old', settings: {}, entities: tree(), scripts: [] })
    expect(doc.version).toBe(2)
    expect(doc.scenes).toHaveLength(1)
    expect(doc.scenes[0].entities).toHaveLength(4)
  })

  it('expands prefab instances with derived ids and overrides', () => {
    const root = createEntity('Enemy', { scripts: [{ script: 'builtin:Rotate', params: { y: 10 } }] })
    const eye = createEntity('Eye', { parent: root.id })
    const prefab: PrefabDoc = { id: 'p1', name: 'Enemy', entities: [root, eye] }
    const instance = instantiatePrefab(prefab, { name: 'Boss', scripts: [{ script: 'builtin:Rotate', params: { y: 99 } }] })
    const out = expandEntities([instance], [prefab])
    expect(out.map((e) => e.name)).toEqual(['Boss', 'Eye'])
    expect(out[0].id).toBe(instance.id)
    expect(out[1].id).toBe(`${instance.id}/${eye.id}`)
    expect(out[1].parent).toBe(instance.id)
    expect(ownerId(out[1].id)).toBe(instance.id)
    expect(out[0].scripts[0].params.y).toBe(99)
  })

  it('stops expanding self-referencing prefabs', () => {
    const root = createEntity('Loop')
    const prefab: PrefabDoc = { id: 'loop', name: 'Loop', entities: [root] }
    prefab.entities.push(createEntity('Inner', { parent: root.id, prefab: 'loop' }))
    expect(expandEntities([instantiatePrefab(prefab)], [prefab]).length).toBeLessThan(20)
  })

  it('fills particle settings added after a file was saved', () => {
    const doc = sampleProject()
    const emitter = createEntity('Sparks', { particles: { rate: 5 } as never })
    doc.scenes[0].entities.push(emitter)
    const loaded = parseProject(JSON.parse(JSON.stringify(doc))).scenes[0].entities.find((e) => e.id === emitter.id)!
    expect(loaded.particles?.rate).toBe(5)
    expect(loaded.particles?.maxParticles).toBe(componentDefaults.particles().maxParticles)
  })

  it('rejects files that are not projects', () => {
    expect(() => parseProject({ hello: 1 })).toThrow()
  })
})

describe('compileScript', () => {
  it('compiles export default with params', () => {
    const result = compileScript('Spin', 'export default { params: { speed: 2 }, update() {} }')
    expect(result).not.toBeInstanceOf(Error)
    if (!(result instanceof Error)) {
      expect(result.name).toBe('Spin')
      expect(result.params).toEqual({ speed: 2 })
    }
  })

  it('returns syntax errors instead of throwing', () => {
    expect(compileScript('Bad', 'export default { update( }')).toBeInstanceOf(Error)
  })

  it('finds every place an asset is used', () => {
    const doc = sampleProject()
    const crate = doc.scenes[0].entities.find((e) => e.mesh)!
    crate.mesh = { ...crate.mesh!, normalMap: 'tex1' }
    doc.scenes[1].settings.skyTexture = 'tex1'
    doc.scripts[0].source += `\nctx.sound.play('jump')`
    const uses = assetReferences(doc, 'tex1', 'bricks.png')
    expect(uses).toEqual([expect.stringContaining('Normal map'), 'Bonus Room: sky'])
    expect(assetReferences(doc, 'snd', 'jump.mp3')).toEqual([`Script ${doc.scripts[0].name}`])
    expect(assetReferences(doc, 'nothing', 'unused.glb')).toEqual([])
  })

  it('applies per-part overrides to prefab instances', () => {
    const root = createEntity('Lamp', { mesh: { ...defaults.mesh(), color: '#ffffff' } })
    const bulb = createEntity('Bulb', { parent: root.id, light: { ...defaults.light(), intensity: 1 } })
    const prefab: PrefabDoc = { id: 'lamp', name: 'Lamp', entities: [root, bulb] }
    const instance = instantiatePrefab(prefab, {
      overrides: { [root.id]: { mesh: { color: '#ff0000' } }, [bulb.id]: { light: { intensity: 5 }, name: 'Red bulb', camera: { fov: 10 } } },
    })
    const [outRoot, outBulb] = expandEntities([instance], [prefab])
    expect(outRoot.mesh?.color).toBe('#ff0000')
    expect(outRoot.mesh?.roughness).toBe(defaults.mesh().roughness) // untouched fields stay
    expect(outBulb.light?.intensity).toBe(5)
    expect(outBulb.name).toBe('Red bulb')
    expect(outBulb.camera).toBeUndefined() // overrides never add components
    expect(root.mesh?.color).toBe('#ffffff') // the prefab itself is unchanged
  })

  it('makes variants that inherit from their base until overridden', () => {
    const root = createEntity('Enemy', { mesh: { ...defaults.mesh(), color: '#00ff00', shape: 'sphere' } })
    const base: PrefabDoc = { id: 'enemy', name: 'Enemy', entities: [root] }
    const variant = createVariant(base, 'Boss')
    variant.entities[0].overrides = { [root.id]: { mesh: { color: '#000000' } } }
    const prefabs = [base, variant]
    const plain = expandEntities([instantiatePrefab(variant)], prefabs)[0]
    expect(plain.mesh?.color).toBe('#000000')
    expect(plain.mesh?.shape).toBe('sphere')
    // Changing the base shows up in the variant.
    root.mesh = { ...root.mesh!, shape: 'box' }
    expect(expandEntities([instantiatePrefab(variant)], prefabs)[0].mesh?.shape).toBe('box')
    // An instance of the variant can override again, keyed by the variant's own parts.
    const instance = instantiatePrefab(variant, { overrides: { [variant.entities[0].id]: { mesh: { color: '#ffffff' } } } })
    expect(expandEntities([instance], prefabs)[0].mesh?.color).toBe('#ffffff')
  })
})
