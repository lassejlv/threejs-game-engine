import { createStore, type Engine } from '../engine'
import { type AssetMeta, AssetLibrary } from './assetLibrary'
import { log } from './console'
import {
  cloneSubtree,
  createEntity,
  emptyProject,
  type EntityDoc,
  newId,
  parseProject,
  type ProjectDoc,
  type ScriptDoc,
  subtreeIds,
} from './document'
import { sampleProject } from './sample'
import { SCRIPT_TEMPLATE } from './scripting'

export type Tool = 'translate' | 'rotate' | 'scale'
export type Mode = 'edit' | 'play'

export interface EditorState {
  doc: ProjectDoc
  selection: string | null
  tool: Tool
  snap: boolean
  mode: Mode
  paused: boolean
  /** Frozen copy of the doc that play mode was started from. */
  playDoc: ProjectDoc | null
  canUndo: boolean
  canRedo: boolean
  openScript: string | null
  assets: AssetMeta[]
  bottomTab: 'project' | 'console'
}

const STORAGE_KEY = 'ge-project-v1'
const HISTORY_LIMIT = 200
const MERGE_WINDOW_MS = 600

function loadInitialDoc(): ProjectDoc {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return parseProject(JSON.parse(raw))
  } catch (error) {
    console.warn('[editor] could not restore project', error)
  }
  return sampleProject()
}

export const editorStore = createStore<EditorState>({
  doc: loadInitialDoc(),
  selection: null,
  tool: 'translate',
  snap: false,
  mode: 'edit',
  paused: false,
  playDoc: null,
  canUndo: false,
  canRedo: false,
  openScript: null,
  assets: [],
  bottomTab: 'project',
})

export const assetLibrary = new AssetLibrary()
void assetLibrary
  .list()
  .then((assets) => editorStore.set({ assets }))
  .catch((error: unknown) => log('warn', 'Asset library unavailable:', error))

let engineRef: Engine | null = null
export function attachEngine(engine: Engine): void {
  engineRef = engine
  engine.events.on('dispose', () => {
    if (engineRef === engine) engineRef = null
  })
  engine.events.on('error', ({ error }) => {
    log('error', 'Engine paused after an error:', error)
    editorStore.set({ paused: true })
  })
}
export function getEngine(): Engine | null {
  return engineRef
}

// ---------------------------------------------------------------------------
// History

const past: ProjectDoc[] = []
const future: ProjectDoc[] = []
let mergeKey: string | null = null
let mergeTime = 0
let transaction: { recorded: boolean } | null = null

/**
 * Groups every commit until `endTransaction()` into one undo step.
 * Used for continuous gestures (gizmo drags, number scrubbing).
 */
export function beginTransaction(): void {
  transaction ??= { recorded: false }
}

export function endTransaction(): void {
  transaction = null
  mergeKey = null
}

export interface CommitOptions {
  /** Consecutive commits with the same key (within a short window) become one undo step. */
  merge?: string
}

/** Applies a new document and records the previous one for undo. */
export function commit(next: ProjectDoc, { merge }: CommitOptions = {}): void {
  const state = editorStore.get()
  if (state.mode === 'play' || next === state.doc) return
  const now = performance.now()
  const merging = transaction
    ? transaction.recorded
    : merge !== undefined && merge === mergeKey && now - mergeTime < MERGE_WINDOW_MS
  if (transaction) transaction.recorded = true
  if (!merging) {
    past.push(state.doc)
    if (past.length > HISTORY_LIMIT) past.shift()
  }
  mergeKey = merge ?? null
  mergeTime = now
  future.length = 0
  editorStore.set({ doc: next, canUndo: past.length > 0, canRedo: false })
}

export function undo(): void {
  const state = editorStore.get()
  const prev = past.pop()
  if (!prev || state.mode === 'play') return
  future.push(state.doc)
  mergeKey = null
  editorStore.set({ doc: prev, canUndo: past.length > 0, canRedo: true, selection: keepSelection(prev) })
}

export function redo(): void {
  const state = editorStore.get()
  const next = future.pop()
  if (!next || state.mode === 'play') return
  past.push(state.doc)
  mergeKey = null
  editorStore.set({ doc: next, canUndo: true, canRedo: future.length > 0, selection: keepSelection(next) })
}

function keepSelection(doc: ProjectDoc): string | null {
  const id = editorStore.get().selection
  return id && doc.entities.some((e) => e.id === id) ? id : null
}

function resetHistory(): void {
  past.length = 0
  future.length = 0
  mergeKey = null
}

// ---------------------------------------------------------------------------
// Entity actions

const doc = () => editorStore.get().doc

export function select(id: string | null): void {
  editorStore.set({ selection: id })
}

export function updateEntity(
  id: string,
  update: Partial<EntityDoc> | ((entity: EntityDoc) => Partial<EntityDoc>),
  options?: CommitOptions,
): void {
  const d = doc()
  const entities = d.entities.map((e) => {
    if (e.id !== id) return e
    const patch = typeof update === 'function' ? update(e) : update
    return { ...e, ...patch }
  })
  commit({ ...d, entities }, options)
}

export function addEntity(entity: EntityDoc): void {
  commit({ ...doc(), entities: [...doc().entities, entity] })
  select(entity.id)
}

export function createAndAdd(name: string, partial: Partial<EntityDoc>): void {
  addEntity(createEntity(name, partial))
}

export function deleteEntity(id: string): void {
  const ids = subtreeIds(doc(), id)
  commit({ ...doc(), entities: doc().entities.filter((e) => !ids.has(e.id)) })
  if (ids.has(editorStore.get().selection ?? '')) select(null)
}

export function duplicateEntity(id: string): void {
  const copies = cloneSubtree(doc(), id)
  if (!copies.length) return
  const d = doc()
  const index = d.entities.findIndex((e) => e.id === id)
  const entities = [...d.entities]
  entities.splice(index + 1, 0, ...copies)
  commit({ ...d, entities })
  select(copies[0].id)
}

/** Moves `id` under `parent` (null = root). Refuses to create cycles. */
export function reparent(id: string, parent: string | null): void {
  if (id === parent) return
  if (parent && subtreeIds(doc(), id).has(parent)) return
  const d = doc()
  const entity = d.entities.find((e) => e.id === id)
  if (!entity || entity.parent === parent) return
  // Move to the end so it becomes the last sibling.
  const entities = d.entities.filter((e) => e.id !== id)
  entities.push({ ...entity, parent })
  commit({ ...d, entities })
}

export function updateProject(patch: Partial<ProjectDoc>, options?: CommitOptions): void {
  commit({ ...doc(), ...patch }, options)
}

// ---------------------------------------------------------------------------
// Scripts

export function createScript(): ScriptDoc {
  const existing = new Set(doc().scripts.map((s) => s.name))
  let name = 'NewScript'
  for (let i = 1; existing.has(name); i++) name = `NewScript${i}`
  const script: ScriptDoc = { id: newId(), name, source: SCRIPT_TEMPLATE }
  updateProject({ scripts: [...doc().scripts, script] })
  editorStore.set({ openScript: script.id })
  return script
}

export function updateScript(id: string, patch: Partial<ScriptDoc>): void {
  updateProject({ scripts: doc().scripts.map((s) => (s.id === id ? { ...s, ...patch } : s)) })
}

export function deleteScript(id: string): void {
  const d = doc()
  commit({
    ...d,
    scripts: d.scripts.filter((s) => s.id !== id),
    entities: d.entities.map((e) =>
      e.scripts.some((s) => s.script === id) ? { ...e, scripts: e.scripts.filter((s) => s.script !== id) } : e,
    ),
  })
  if (editorStore.get().openScript === id) editorStore.set({ openScript: null })
}

// ---------------------------------------------------------------------------
// Assets

export async function importAssets(files: FileList | File[]): Promise<void> {
  for (const file of files) {
    try {
      const meta = await assetLibrary.import(file)
      editorStore.set((s) => ({ assets: [...s.assets, meta] }))
      log('log', `Imported ${meta.name}`)
    } catch (error) {
      log('error', error)
    }
  }
}

export async function deleteAsset(id: string): Promise<void> {
  await assetLibrary.remove(id)
  editorStore.set((s) => ({ assets: s.assets.filter((a) => a.id !== id) }))
}

// ---------------------------------------------------------------------------
// Play mode

export function play(): void {
  const state = editorStore.get()
  if (state.mode === 'play') return
  engineRef?.resume()
  editorStore.set({ mode: 'play', paused: false, playDoc: structuredClone(state.doc) })
}

export function stop(): void {
  if (editorStore.get().mode !== 'play') return
  engineRef?.resume()
  editorStore.set({ mode: 'edit', paused: false, playDoc: null })
}

export function togglePause(): void {
  const engine = engineRef
  if (!engine || editorStore.get().mode !== 'play') return
  if (engine.paused) engine.resume()
  else engine.pause()
  editorStore.set({ paused: engine.paused })
}

export function stepFrame(): void {
  const engine = engineRef
  if (!engine || editorStore.get().mode !== 'play') return
  if (!engine.paused) engine.pause()
  engine.step()
  editorStore.set({ paused: true })
}

// ---------------------------------------------------------------------------
// Project files

export function newProject(blank: boolean): void {
  stop()
  resetHistory()
  editorStore.set({ doc: blank ? emptyProject() : sampleProject(), selection: null, canUndo: false, canRedo: false })
}

export function exportProject(): void {
  const d = doc()
  const blob = new Blob([JSON.stringify(d, null, 2)], { type: 'application/json' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `${d.name.replace(/[^\w-]+/g, '_') || 'project'}.json`
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}

export async function importProject(file: File): Promise<void> {
  try {
    const parsed = parseProject(JSON.parse(await file.text()))
    stop()
    resetHistory()
    editorStore.set({ doc: parsed, selection: null, canUndo: false, canRedo: false })
    log('log', `Opened ${file.name}`)
  } catch (error) {
    log('error', `Could not open ${file.name}:`, error)
  }
}

// Autosave (debounced). Play-mode changes never touch the doc.
let saveTimer: ReturnType<typeof setTimeout> | null = null
let lastSaved = editorStore.get().doc
editorStore.subscribe(() => {
  const current = editorStore.get().doc
  if (current === lastSaved) return
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    lastSaved = editorStore.get().doc
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(lastSaved))
    } catch (error) {
      log('warn', 'Autosave failed:', error)
    }
  }, 400)
})
