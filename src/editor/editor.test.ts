// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createEntity, type EntityDoc } from './document'
import {
  addEntities,
  addEntity,
  beginTransaction,
  commit,
  createPrefab,
  deleteEntities,
  deletePrefab,
  duplicateEntities,
  editorStore,
  endTransaction,
  newProject,
  openPrefab,
  play,
  redo,
  reparent,
  select,
  stop,
  targetEntities,
  undo,
  unpackPrefab,
  updateEntity,
  updateProject,
} from './editor'

// play() resumes the shared Web Audio context, which jsdom doesn't provide.
beforeAll(() => {
  class FakeAudioContext {
    resume() {
      return Promise.resolve()
    }
  }
  vi.stubGlobal('AudioContext', FakeAudioContext)
})

const s = () => editorStore.get()
const sceneEntities = () => targetEntities(s().doc, s().editing)
const byName = (name: string) => sceneEntities().find((e) => e.name === name)
const names = () => sceneEntities().map((e) => e.name)

/** Walks undo all the way back. */
function undoAll() {
  while (s().canUndo) undo()
}

beforeEach(() => {
  // A blank project also clears undo history.
  newProject(true)
  endTransaction()
})

afterEach(() => {
  stop()
  endTransaction()
  vi.restoreAllMocks()
})

describe('editor history', () => {
  it('starts a new project with empty history', () => {
    expect(s().canUndo).toBe(false)
    expect(s().canRedo).toBe(false)
    expect(names()).toEqual(['Main Camera', 'Directional Light', 'Ground'])
  })

  it('undoes and redoes an added entity', () => {
    addEntity(createEntity('Cube'))
    expect(names()).toContain('Cube')
    expect(s().canUndo).toBe(true)
    expect(s().selection).toEqual([byName('Cube')!.id])

    undo()
    expect(names()).not.toContain('Cube')
    expect(s().canUndo).toBe(false)
    expect(s().canRedo).toBe(true)
    // The selection is reconciled with the restored doc.
    expect(s().selection).toEqual([])

    redo()
    expect(names()).toContain('Cube')
    expect(s().canRedo).toBe(false)
  })

  it('clears the redo stack on a new commit', () => {
    addEntity(createEntity('A'))
    undo()
    expect(s().canRedo).toBe(true)
    addEntity(createEntity('B'))
    expect(s().canRedo).toBe(false)
    redo() // no-op
    expect(names()).toContain('B')
    expect(names()).not.toContain('A')
  })

  it('ignores commits of the same document', () => {
    commit(s().doc)
    expect(s().canUndo).toBe(false)
  })

  it('collapses a transaction into a single undo step', () => {
    addEntity(createEntity('Cube'))
    const id = byName('Cube')!.id
    const before = s().doc

    beginTransaction()
    for (let x = 1; x <= 5; x++) updateEntity(id, (e) => ({ transform: { ...e.transform, position: [x, 0, 0] } }))
    endTransaction()
    expect(byName('Cube')!.transform.position).toEqual([5, 0, 0])

    undo()
    expect(s().doc).toBe(before)
    expect(byName('Cube')!.transform.position).toEqual([0, 0, 0])
    undo()
    expect(byName('Cube')).toBeUndefined()
    expect(s().canUndo).toBe(false)
  })

  it('nested beginTransaction calls join the open transaction', () => {
    addEntity(createEntity('Cube'))
    const id = byName('Cube')!.id
    beginTransaction()
    updateEntity(id, { name: 'One' })
    beginTransaction()
    updateEntity(id, { name: 'Two' })
    endTransaction()
    undo()
    expect(byName('Cube')).toBeDefined()
  })

  it('merges consecutive commits with the same merge key', () => {
    addEntity(createEntity('Cube'))
    const id = byName('Cube')!.id
    updateEntity(id, { name: 'C' }, { merge: 'rename' })
    updateEntity(id, { name: 'Cu' }, { merge: 'rename' })
    updateEntity(id, { name: 'Cub' }, { merge: 'rename' })
    expect(names()).toContain('Cub')

    undo()
    expect(names()).toContain('Cube')
    expect(names()).not.toContain('C')
  })

  it('does not merge commits with different keys or no key', () => {
    addEntity(createEntity('Cube'))
    const id = byName('Cube')!.id
    updateEntity(id, { name: 'A' }, { merge: 'x' })
    updateEntity(id, { name: 'B' }, { merge: 'y' })
    updateEntity(id, { name: 'C' })
    updateEntity(id, { name: 'D' })
    undo()
    expect(names()).toContain('C')
    undo()
    expect(names()).toContain('B')
    undo()
    expect(names()).toContain('A')
    undo()
    expect(names()).toContain('Cube')
  })

  it('stops merging once the merge window has passed', () => {
    let now = 1000
    vi.spyOn(performance, 'now').mockImplementation(() => now)
    addEntity(createEntity('Cube'))
    const id = byName('Cube')!.id
    updateEntity(id, { name: 'A' }, { merge: 'rename' })
    now += 100
    updateEntity(id, { name: 'B' }, { merge: 'rename' })
    now += 5000
    updateEntity(id, { name: 'C' }, { merge: 'rename' })
    undo()
    expect(names()).toContain('B')
    undo()
    expect(names()).toContain('Cube')
  })

  it('undo breaks a merge chain', () => {
    addEntity(createEntity('Cube'))
    const id = byName('Cube')!.id
    updateEntity(id, { name: 'A' }, { merge: 'rename' })
    updateEntity(id, { name: 'B' }, { merge: 'rename' })
    undo()
    expect(names()).toContain('Cube')
    updateEntity(id, { name: 'X' }, { merge: 'rename' })
    redo() // cleared by the commit
    expect(names()).toContain('X')
    undo()
    expect(names()).toContain('Cube')
  })

  it('blocks document edits during play except allowInPlay commits', () => {
    play()
    expect(s().mode).toBe('play')
    const before = s().doc
    addEntity(createEntity('Nope'))
    expect(s().doc).toBe(before)

    updateProject({ name: 'Renamed in play' }, { allowInPlay: true })
    expect(s().doc.name).toBe('Renamed in play')

    // Undo is disabled while playing.
    undo()
    expect(s().doc.name).toBe('Renamed in play')

    stop()
    expect(s().mode).toBe('edit')
    expect(s().playDoc).toBeNull()
  })

  it('play freezes a copy of the doc', () => {
    play()
    const { playDoc, doc } = s()
    expect(playDoc).not.toBe(doc)
    expect(playDoc).toEqual(doc)
    expect(s().playScene).toBe(doc.scenes[0].id)
  })
})

describe('editor entity actions', () => {
  function tree() {
    const root = createEntity('Root')
    const child = createEntity('Child', { parent: root.id })
    const grandchild = createEntity('Grandchild', { parent: child.id })
    addEntities([root, child, grandchild])
    return { root, child, grandchild }
  }

  it('adds several entities as one undo step and selects the given ids', () => {
    const { root, child } = tree()
    expect(s().selection).toEqual([root.id])
    expect(names()).toEqual(expect.arrayContaining(['Root', 'Child', 'Grandchild']))
    addEntities([createEntity('X'), createEntity('Y')], [child.id])
    expect(s().selection).toEqual([child.id])
    undo()
    undo()
    expect(names()).not.toContain('Root')
  })

  it('deletes entities with their descendants and drops them from the selection', () => {
    const { root } = tree()
    const other = createEntity('Other')
    addEntity(other)
    select(root.id)
    select(other.id, true)
    deleteEntities([root.id])
    expect(names()).not.toContain('Root')
    expect(names()).not.toContain('Child')
    expect(names()).not.toContain('Grandchild')
    expect(names()).toContain('Other')
    expect(s().selection).toEqual([other.id])

    undo()
    expect(names()).toEqual(expect.arrayContaining(['Root', 'Child', 'Grandchild']))
  })

  it('deletes the selection by default', () => {
    addEntity(createEntity('Doomed'))
    deleteEntities()
    expect(names()).not.toContain('Doomed')
  })

  it('duplicates a subtree with fresh ids next to the original', () => {
    const { root, child } = tree()
    // Selecting a parent and its child duplicates the subtree once.
    select(root.id)
    select(child.id, true)
    duplicateEntities()

    const list = sceneEntities()
    const copy = list.find((e) => e.name === 'Root (copy)')!
    expect(copy).toBeDefined()
    expect(copy.id).not.toBe(root.id)
    expect(s().selection).toEqual([copy.id])
    // The copy sits right after the original root.
    expect(list.indexOf(copy)).toBe(list.findIndex((e) => e.id === root.id) + 1)

    const copiedChild = list.find((e) => e.parent === copy.id)!
    expect(copiedChild.name).toBe('Child')
    expect(copiedChild.id).not.toBe(child.id)
    expect(list.find((e) => e.parent === copiedChild.id)?.name).toBe('Grandchild')
    expect(list.filter((e) => e.name === 'Grandchild')).toHaveLength(2)

    undo()
    expect(names()).not.toContain('Root (copy)')
  })

  it('reparents but refuses cycles', () => {
    const { root, grandchild } = tree()
    const other = createEntity('Other')
    addEntity(other)

    reparent(root.id, grandchild.id) // would create a cycle
    expect(byName('Root')!.parent).toBeNull()
    reparent(root.id, root.id)
    expect(byName('Root')!.parent).toBeNull()

    reparent(grandchild.id, other.id)
    expect(byName('Grandchild')!.parent).toBe(other.id)
    undo()
    expect(byName('Grandchild')!.parent).not.toBe(other.id)
  })
})

describe('editor prefabs', () => {
  function makePrefab() {
    const root = createEntity('Coin', { transform: { position: [1, 2, 3], rotation: [0, 0, 0], scale: [1, 1, 1] } })
    const child = createEntity('Sparkle', { parent: root.id })
    addEntities([root, child])
    createPrefab(root.id)
    const prefab = s().doc.prefabs.find((p) => p.name === 'Coin')!
    return { root, child, prefab }
  }

  it('turns a subtree into a prefab and replaces it with an instance', () => {
    const { root, child, prefab } = makePrefab()
    expect(prefab).toBeDefined()
    expect(prefab.entities.map((e) => e.name).sort()).toEqual(['Coin', 'Sparkle'])
    expect(prefab.entities.find((e) => e.id === root.id)!.parent).toBeNull()

    const instance = byName('Coin')!
    expect(instance.id).toBe(root.id)
    expect(instance.prefab).toBe(prefab.id)
    expect(instance.transform.position).toEqual([1, 2, 3])
    // The child now lives only in the prefab.
    expect(sceneEntities().some((e) => e.id === child.id)).toBe(false)

    undo()
    expect(s().doc.prefabs).toHaveLength(0)
    expect(byName('Coin')!.prefab).toBeUndefined()
    expect(byName('Sparkle')).toBeDefined()
  })

  it('unpacks an instance into plain entities with fresh child ids', () => {
    const { root, child } = makePrefab()
    unpackPrefab(root.id)

    const unpacked = byName('Coin')!
    expect(unpacked.id).toBe(root.id)
    expect(unpacked.prefab).toBeUndefined()
    const sparkle = byName('Sparkle')!
    expect(sparkle.parent).toBe(root.id)
    expect(sparkle.id).not.toBe(child.id)
    expect(sparkle.id).not.toContain('/')

    undo()
    expect(byName('Coin')!.prefab).toBeDefined()
    expect(byName('Sparkle')).toBeUndefined()
  })

  it('deleting a prefab removes its instances', () => {
    const { prefab } = makePrefab()
    deletePrefab(prefab.id)
    expect(s().doc.prefabs).toHaveLength(0)
    expect(byName('Coin')).toBeUndefined()
  })

  it('keeps the prefab root when editing a prefab', () => {
    const { prefab } = makePrefab()
    openPrefab(prefab.id)
    expect(s().editing).toEqual({ kind: 'prefab', id: prefab.id })
    const root = sceneEntities().find((e) => e.parent === null)!
    expect(s().selection).toEqual([root.id])

    deleteEntities([root.id])
    expect(sceneEntities().some((e) => e.id === root.id)).toBe(true)

    // New entities are parented under the root.
    addEntity(createEntity('Extra'))
    expect(sceneEntities().find((e: EntityDoc) => e.name === 'Extra')!.parent).toBe(root.id)
  })

  it('undo across all steps restores the starting scene', () => {
    makePrefab()
    unpackPrefab(byName('Coin')!.id)
    undoAll()
    expect(names()).toEqual(['Main Camera', 'Directional Light', 'Ground'])
    expect(s().doc.prefabs).toHaveLength(0)
  })
})
