import type { AssetMeta } from './assetLibrary'
import { log } from './console'
import type { ProjectDoc } from './document'
import { checkReferences, parseProject, serializableProject } from './projectFormat'
import { buildBundle, readBundle } from './bundle'
import { assetLibrary, download, editorStore, newFromTemplate, replaceDoc, slug } from './editor'
import { sampleProject } from './sample'
import { BrowserStore, readBytes, readLegacyProject } from './storage/browserStore'
import { DiskStore } from './storage/diskStore'
import type { ProjectStore, ProjectSummary } from './storage/types'
import type { Template } from './templates'

/**
 * Projects: picks where they are stored (the local file server's projects/
 * folder when it runs, otherwise this browser), opens one, and autosaves it.
 */

const SAVE_DELAY = 400
const LAST_PROJECT = 'ge-last-project'
const LEGACY_MIGRATED = 'ge-legacy-migrated'

let store: ProjectStore | null = null
let saveTimer: ReturnType<typeof setTimeout> | null = null
/** The document as last written (or loaded), so unchanged docs aren't saved again. */
let lastSaved: ProjectDoc | null = null
let saving: Promise<void> | null = null
let unsubscribe: (() => void) | null = null
let pageListeners = false

function setStorage(patch: Partial<ReturnType<typeof editorStore.get>['storage']>): void {
  editorStore.set((s) => ({ storage: { ...s.storage, ...patch } }))
}

function remember(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    // Storage unavailable: only a convenience is lost.
  }
}

function recall(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

/** The active store (null before boot). */
export function projectStore(): ProjectStore | null {
  return store
}

/**
 * Finds the store, migrates the old single-project storage once, and opens the
 * last project (creating Coin Rush when there are none). `options.store` is for tests.
 */
export async function bootProjects(options: { store?: ProjectStore } = {}): Promise<void> {
  // Nothing is open yet: never save whatever the editor shows into the store being picked.
  lastSaved = null
  setStorage({ kind: null, projectId: null, state: 'loading', error: null })
  try {
    store = options.store ?? ((await DiskStore.available()) ? new DiskStore() : new BrowserStore())
    setStorage({ kind: store.kind, label: store.label })
    await migrateLegacy(store)
    let projects = await store.list()
    if (projects.length === 0) {
      await store.create(sampleProject())
      projects = await store.list()
    }
    const last = recall(`${LAST_PROJECT}:${store.kind}`)
    // The last project first; if a file is broken, say why and open the next one.
    const order = [...projects].sort((a, b) => Number(b.id === last) - Number(a.id === last))
    let opened = false
    for (const project of order) {
      try {
        await openProject(project.id)
        opened = true
        break
      } catch (error) {
        log('error', `Could not open "${project.name}" (${project.id}):`, error instanceof Error ? error.message : error)
      }
    }
    if (!opened) await createProject(sampleProject())
    startAutosave()
  } catch (error) {
    setStorage({ state: 'error', error: describe(error) })
    log('error', 'Could not open projects:', error)
  }
}

/** Copies the pre-multi-project data (one localStorage project + shared assets) into the store, once per store kind. */
async function migrateLegacy(target: ProjectStore): Promise<void> {
  const flag = `${LEGACY_MIGRATED}:${target.kind}`
  if (recall(flag)) return
  const legacy = await readLegacyProject()
  if (legacy) {
    const doc = parseProject(legacy.doc)
    const summary = await target.create(doc)
    for (const { meta, blob } of legacy.assets) await target.writeAsset(summary.id, meta, blob)
    log('log', `Moved your project "${doc.name}" into ${target.label}.`)
  }
  remember(flag, '1')
}

export async function refreshProjects(): Promise<ProjectSummary[]> {
  if (!store) return []
  const projects = await store.list()
  editorStore.set({ projects })
  return projects
}

/** Saves the current project, then opens another one. */
export async function openProject(id: string): Promise<void> {
  if (!store) throw new Error('Projects are not ready yet')
  await ensureSaved()
  setStorage({ state: 'loading', error: null })
  const doc = parseProject(await store.load(id))
  for (const warning of checkReferences(doc)) log('warn', warning)
  const assets = await assetLibrary.open(store, id)
  lastSaved = doc // before replaceDoc, so opening isn't mistaken for an edit
  replaceDoc(doc)
  editorStore.set({ assets })
  setStorage({ projectId: id, state: 'saved', error: null })
  remember(`${LAST_PROJECT}:${store.kind}`, id)
  await refreshProjects()
}

/** Stores `doc` as a new project and opens it. */
export async function createProject(doc: ProjectDoc, assets: { meta: AssetMeta; blob: Blob }[] = []): Promise<void> {
  if (!store) throw new Error('Projects are not ready yet')
  await ensureSaved()
  const summary = await store.create(serializableProject(doc))
  for (const { meta, blob } of assets) await store.writeAsset(summary.id, meta, blob)
  await openProject(summary.id)
  log('log', `Created "${doc.name}" in ${store.label}.`)
}

/** File → New project: a new stored project from a template (or a plain replace before boot). */
export async function newProjectFromTemplate(template: Template): Promise<void> {
  if (!store) return newFromTemplate(template)
  await createProject(template.create())
  editorStore.set({ view2D: !!template.view2D })
}

/**
 * File → Import: a bundle (.zip with assets) or a document (.json) becomes a
 * new project; the open one is kept. Throws with a readable reason on bad files.
 */
export async function importProjectFile(file: File): Promise<void> {
  const bytes = new Uint8Array(await readBytes(file))
  const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b // "PK"
  let raw: unknown
  let assets: { meta: AssetMeta; blob: Blob }[] = []
  if (isZip) {
    try {
      ;({ doc: raw, assets } = await readBundle(bytes))
    } catch (error) {
      throw new Error(`${file.name}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  else {
    try {
      raw = JSON.parse(new TextDecoder().decode(bytes))
    } catch {
      throw new Error(`${file.name} is neither a project bundle (.zip) nor a project file (.json).`)
    }
  }
  const doc = parseProject(raw)
  if (store) await createProject(doc, assets)
  else {
    replaceDoc(doc)
    assetLibrary.clear()
    for (const { meta, blob } of assets) await assetLibrary.put(meta, blob)
    editorStore.set({ assets: assets.map((a) => a.meta) })
  }
  log('log', `Imported ${file.name}${assets.length ? ` with ${assets.length} asset${assets.length === 1 ? '' : 's'}` : ''}`)
}

/** File → Export project: the document and every asset in one .zip. */
export async function exportBundle(): Promise<void> {
  const { doc } = editorStore.get()
  download(`${slug(doc.name)}.zip`, await buildBundle(serializableProject(doc), assetLibrary.entries()))
}

export async function duplicateProject(id: string): Promise<ProjectSummary | null> {
  if (!store) return null
  await flushSave()
  const copy = await store.duplicate(id)
  await refreshProjects()
  return copy
}

/** Deletes a project (the file server keeps it in projects/.trash). Opens another one if it was open. */
export async function deleteProject(id: string): Promise<void> {
  if (!store) return
  const current = editorStore.get().storage.projectId === id
  if (current) {
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = null
    await saving
  }
  await store.remove(id)
  const projects = await refreshProjects()
  if (!current) return
  if (projects.length) await openProject(projects[0].id)
  else await createProject(sampleProject())
}

function startAutosave(): void {
  unsubscribe?.()
  let seen = editorStore.get().doc
  unsubscribe = editorStore.subscribe(() => {
    const { doc, storage } = editorStore.get()
    // Only edits schedule a save, not other state changes (such as a failed save's status).
    if (doc === seen) return
    seen = doc
    if (doc === lastSaved || !storage.projectId || storage.state === 'loading') return
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(() => void saveNow(), SAVE_DELAY)
  })
  if (pageListeners) return
  pageListeners = true
  // Leaving the page: save right away rather than after the debounce.
  window.addEventListener('pagehide', () => void flushSave())
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') void flushSave()
  })
  window.addEventListener('beforeunload', (event) => {
    if (saveTimer || saving) event.preventDefault()
  })
}

/** Writes the current document now (waiting for a save in flight first). */
export async function saveNow(): Promise<void> {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = null
  if (saving) await saving
  const { doc, storage } = editorStore.get()
  if (!store || !storage.projectId || doc === lastSaved) return
  const target = store
  const id = storage.projectId
  setStorage({ state: 'saving' })
  saving = (async () => {
    try {
      await target.save(id, serializableProject(doc))
      lastSaved = doc
      if (editorStore.get().storage.projectId === id) setStorage({ state: 'saved', error: null })
      // Keep the project list's names and order current.
      editorStore.set((s) => ({
        projects: [{ id, name: doc.name, modified: Date.now() }, ...s.projects.filter((p) => p.id !== id)],
      }))
    } catch (error) {
      setStorage({ state: 'error', error: describe(error) })
      log('error', 'Saving failed:', error)
    } finally {
      saving = null
    }
  })()
  await saving
  // Edits made while saving get their own save.
  if (editorStore.get().doc !== lastSaved && editorStore.get().storage.state !== 'error') await saveNow()
}

/** Saves pending changes and refuses to continue if that failed, so switching projects never drops edits. */
async function ensureSaved(): Promise<void> {
  await flushSave()
  const { storage } = editorStore.get()
  if (storage.state === 'error' && storage.projectId) throw new Error(`The open project couldn't be saved (${storage.error}). Fix that or export it first.`)
}

/** Saves pending changes, if any. */
export async function flushSave(): Promise<void> {
  if (saveTimer || saving || (store && editorStore.get().doc !== lastSaved && editorStore.get().storage.projectId)) await saveNow()
}

function describe(error: unknown): string {
  if (error instanceof Error) {
    if (error.name === 'QuotaExceededError') return 'The browser is out of storage space for this site.'
    return error.message
  }
  return String(error)
}

/** Test hook: forget the store and stop autosaving. */
export function resetProjectsForTests(): void {
  unsubscribe?.()
  unsubscribe = null
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = null
  store = null
  lastSaved = null
  saving = null
  editorStore.set({ storage: { kind: null, label: '', projectId: null, state: 'idle', error: null }, projects: [] })
}
