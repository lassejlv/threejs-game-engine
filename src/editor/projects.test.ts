// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AssetMeta } from './assetLibrary'
import { emptyProject } from './document'
import { assetLibrary, editorStore, updateProject } from './editor'
import {
  answerTrust,
  bootProjects,
  createProject,
  deleteProject,
  importProjectFile,
  openProject,
  projectStore,
  requestRun,
  resetProjectsForTests,
  saveNow,
} from './projects'
import { compileScript, ScriptsPausedError } from './scripting'
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

  it('skips a broken project file at startup and says why', async () => {
    const store = freshStore()
    await store.create({ ...emptyProject(), name: 'Good' })
    const bad = await store.create({ ...emptyProject(), name: 'Bad' })
    await store.save(bad.id, { version: 3, name: 'Bad', scenes: 'oops' })
    localStorage.setItem('ge-last-project:browser', bad.id)
    const errors: string[] = []
    const { logListeners } = await import('./console')
    const listener = (level: string, message: string) => level === 'error' && errors.push(message)
    logListeners.add(listener)
    await bootProjects({ store })
    logListeners.delete(listener)
    expect(s().doc.name).toBe('Good')
    expect(errors.join('\n')).toContain('The project has no scenes')
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

  describe('trust', () => {
    // Compiling a script runs its top-level code: this one counts how often that happens.
    const SOURCE = (tag: string) => `globalThis.__ran = (globalThis.__ran ?? 0) + 1 // ${tag}\nexport default { params: { speed: 2 } }`
    const ran = () => (globalThis as { __ran?: number }).__ran ?? 0
    const importDoc = (doc: object) => importProjectFile(new File([JSON.stringify(doc)], 'shared.json'))

    it("never evaluates an imported project's scripts until the user trusts it", async () => {
      await bootProjects({ store: freshStore() })
      const before = ran()
      await importDoc({ ...emptyProject(), name: 'Shared', scripts: [{ id: 'evil', name: 'Evil', source: SOURCE('a') }] })
      expect(s().storage.trusted).toBe(false)
      expect(compileScript('Evil', SOURCE('a'))).toBeInstanceOf(ScriptsPausedError)
      expect(ran()).toBe(before)

      const first = requestRun()
      expect(s().trustPrompt).toEqual({ project: 'Shared', scripts: ['Evil'] })
      answerTrust(false)
      expect(await first).toBe(false)
      expect(compileScript('Evil', SOURCE('a'))).toBeInstanceOf(ScriptsPausedError)
      expect(ran()).toBe(before)

      const second = requestRun()
      answerTrust(true)
      expect(await second).toBe(true)
      expect(compileScript('Evil', SOURCE('a'))).not.toBeInstanceOf(Error)
      expect(ran()).toBe(before + 1)
    })

    it('remembers trust per project, and trusts what is made here', async () => {
      const store = freshStore()
      await bootProjects({ store })
      expect(s().storage.trusted).toBe(true) // the sample
      await importDoc({ ...emptyProject(), name: 'Shared', scripts: [{ id: 'x', name: 'X', source: SOURCE('b') }] })
      const shared = s().storage.projectId!
      const run = requestRun()
      answerTrust(true)
      await run
      await createProject({ ...emptyProject(), name: 'Mine', scripts: [{ id: 'y', name: 'Y', source: SOURCE('c') }] })
      expect(s().storage.trusted).toBe(true)
      await openProject(shared)
      expect(s().storage.trusted).toBe(true)
      // Imports without project scripts have nothing to run, so nothing to ask.
      await importDoc({ ...emptyProject(), name: 'Plain' })
      expect(s().storage.trusted).toBe(true)
      expect(await requestRun()).toBe(true)
    })

    it('trusts projects that existed before trust tracking, but not ones that appear later', async () => {
      const store = freshStore()
      const old = await store.create({ ...emptyProject(), name: 'Old', scripts: [{ id: 'o', name: 'O', source: SOURCE('d') }] })
      localStorage.setItem('ge-last-project:browser', old.id)
      await bootProjects({ store })
      expect(s().storage).toMatchObject({ projectId: old.id, trusted: true })

      resetProjectsForTests()
      const copied = await store.create({ ...emptyProject(), name: 'Copied in', scripts: [{ id: 'c', name: 'C', source: SOURCE('e') }] })
      localStorage.setItem('ge-last-project:browser', copied.id)
      await bootProjects({ store })
      expect(s().storage).toMatchObject({ projectId: copied.id, trusted: false })
    })
  })
})
