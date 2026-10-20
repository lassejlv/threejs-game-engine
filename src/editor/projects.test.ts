// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AssetMeta } from './assetLibrary'
import { emptyProject } from './document'
import { assetLibrary, editorStore, updateProject } from './editor'
import { bootProjects, createProject, deleteProject, openProject, projectStore, resetProjectsForTests, saveNow } from './projects'
import { BrowserStore } from './storage/browserStore'

let dbCounter = 0
const freshStore = () => new BrowserStore(`ge-projects-test-${dbCounter++}`)
const s = () => editorStore.get()
/** jsdom's Blob has no arrayBuffer(); FileReader works. */
const bytes = (blob: Blob) =>
  new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as ArrayBuffer)
    reader.onerror = () => reject(reader.error)
    reader.readAsArrayBuffer(blob)
  })

beforeEach(() => {
  localStorage.clear()
  // jsdom lacks object URLs; assets only need them for previews.
  URL.createObjectURL ??= () => 'blob:test'
  URL.revokeObjectURL ??= () => {}
})

afterEach(() => {
  resetProjectsForTests()
  vi.restoreAllMocks()
})

describe('projects', () => {
  it('creates Coin Rush on first run and opens it', async () => {
    const store = freshStore()
    await bootProjects({ store })
    expect(s().storage).toMatchObject({ kind: 'browser', projectId: 'coin-rush', state: 'saved' })
    expect(s().doc.name).toBe('Coin Rush')
    expect(s().projects.map((p) => p.id)).toEqual(['coin-rush'])
  })

  it('autosaves edits to the open project', async () => {
    const store = freshStore()
    await bootProjects({ store })
    updateProject({ name: 'Renamed' })
    await saveNow()
    expect(s().storage.state).toBe('saved')
    expect((await store.load('coin-rush')) as { name: string }).toMatchObject({ name: 'Renamed' })
    expect(s().projects[0]).toMatchObject({ id: 'coin-rush', name: 'Renamed' })
  })

  it('reopens the last project after a reload', async () => {
    const store = freshStore()
    await bootProjects({ store })
    await createProject({ ...emptyProject(), name: 'Second' })
    resetProjectsForTests()
    await bootProjects({ store })
    expect(s().doc.name).toBe('Second')
  })

  it('keeps each project its own assets', async () => {
    const store = freshStore()
    await bootProjects({ store })
    const meta = await assetLibrary.import(new File([new Uint8Array([1, 2, 3])], 'grass.png'))
    editorStore.set((st) => ({ assets: [...st.assets, meta] }))
    await createProject({ ...emptyProject(), name: 'Other' })
    expect(s().assets).toEqual([])
    expect(assetLibrary.blob(meta.id)).toBeNull()
    await openProject('coin-rush')
    expect(s().assets.map((a) => a.name)).toEqual(['grass.png'])
    expect(new Uint8Array(await bytes(assetLibrary.blob(meta.id)!))).toEqual(new Uint8Array([1, 2, 3]))
  })

  it('saves and reloads a 20 MB project', async () => {
    const store = freshStore()
    await bootProjects({ store })
    const big = 'x'.repeat(20 * 1024 * 1024)
    updateProject({ scripts: [{ id: 'big', name: 'Big', source: big }] })
    await saveNow()
    expect(s().storage.state).toBe('saved')
    resetProjectsForTests()
    await bootProjects({ store })
    expect(s().doc.scripts[0].source.length).toBe(big.length)
  })

  it('shows a failed save and refuses to switch projects until it works', async () => {
    const store = freshStore()
    await bootProjects({ store })
    await createProject({ ...emptyProject(), name: 'Other' })
    vi.spyOn(store, 'save').mockRejectedValue(Object.assign(new Error('quota'), { name: 'QuotaExceededError' }))
    updateProject({ name: 'Unsaved' })
    await saveNow()
    expect(s().storage).toMatchObject({ state: 'error', error: 'The browser is out of storage space for this site.' })
    await expect(openProject('coin-rush')).rejects.toThrow(/couldn't be saved/)
    expect(s().doc.name).toBe('Unsaved')
  })

  it('does not keep retrying a failed save on its own', async () => {
    const store = freshStore()
    await bootProjects({ store })
    const save = vi.spyOn(store, 'save').mockRejectedValue(new Error('disk full'))
    updateProject({ name: 'Edit' })
    await new Promise((r) => setTimeout(r, 1500))
    expect(s().storage.state).toBe('error')
    expect(save).toHaveBeenCalledTimes(1)
  })

  it('opens another project when the open one is deleted', async () => {
    const store = freshStore()
    await bootProjects({ store })
    await createProject({ ...emptyProject(), name: 'Doomed' })
    await deleteProject('doomed')
    expect(s().storage.projectId).toBe('coin-rush')
    expect(s().projects.map((p) => p.id)).toEqual(['coin-rush'])
  })

  it('moves the old single-project storage in once, leaving the old data in place', async () => {
    localStorage.setItem('ge-project-v1', JSON.stringify({ ...emptyProject(), name: 'Old Game' }))
    await new Promise<void>((resolve) => {
      const req = indexedDB.open('ge-assets', 1)
      req.onupgradeneeded = () => req.result.createObjectStore('assets', { keyPath: 'id' })
      req.onsuccess = () => {
        const tx = req.result.transaction('assets', 'readwrite')
        const meta: AssetMeta = { id: 'old1', name: 'stone.png', kind: 'texture', size: 2 }
        // Old editors stored Blobs; under fake-indexeddb a byte array stands in for one.
        tx.objectStore('assets').put({ ...meta, blob: new Uint8Array([9, 9]) })
        tx.oncomplete = () => {
          req.result.close()
          resolve()
        }
      }
    })
    const store = freshStore()
    await bootProjects({ store })
    expect(s().doc.name).toBe('Old Game')
    expect(s().assets.map((a) => a.name)).toEqual(['stone.png'])
    expect(localStorage.getItem('ge-project-v1')).not.toBeNull()

    // Second boot: not migrated again.
    resetProjectsForTests()
    await bootProjects({ store })
    expect((await projectStore()!.list()).filter((p) => p.name === 'Old Game')).toHaveLength(1)
  })
})
