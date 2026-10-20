import { describe, expect, it } from 'vitest'
import { cloneSubtree, createEntity, depthFirst, parseProject, type ProjectDoc, subtreeIds } from './document'
import { sampleProject } from './sample'
import { compileScript } from './scripting'

function tree(): ProjectDoc {
  const root = createEntity('Root')
  const child = createEntity('Child', { parent: root.id })
  const grandchild = createEntity('Grandchild', { parent: child.id })
  const other = createEntity('Other')
  // Deliberately out of order: children before parents.
  return parseProject({ version: 1, name: 't', entities: [grandchild, other, child, root], scripts: [] })
}

describe('document', () => {
  it('collects a subtree', () => {
    const doc = tree()
    const root = doc.entities.find((e) => e.name === 'Root')!
    expect([...subtreeIds(doc, root.id)].map((id) => doc.entities.find((e) => e.id === id)!.name).sort()).toEqual([
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
    const doc = tree()
    const root = doc.entities.find((e) => e.name === 'Root')!
    const copies = cloneSubtree(doc, root.id)
    const ids = new Set(copies.map((c) => c.id))
    expect(copies).toHaveLength(3)
    expect(copies.some((c) => doc.entities.some((e) => e.id === c.id))).toBe(false)
    for (const c of copies) if (c.name !== 'Root (copy)') expect(ids.has(c.parent!)).toBe(true)
  })

  it('round-trips the sample project through JSON', () => {
    const doc = sampleProject()
    expect(parseProject(JSON.parse(JSON.stringify(doc)))).toEqual(doc)
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
})
