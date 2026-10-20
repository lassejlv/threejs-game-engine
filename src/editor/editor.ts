import { createStore, type Engine } from '../engine'
import { type AssetMeta, AssetLibrary } from './assetLibrary'
import { log } from './console'
import {
  cloneSubtree,
  createScene,
  emptyProject,
  type EntityDoc,
  expandEntities,
  instantiatePrefab,
  newId,
  parseProject,
  type PrefabDoc,
  type ProjectDoc,
  type SceneDoc,
  type ScriptDoc,
  subtreeIds,
} from './document'
import { sampleProject } from './sample'
import { SCRIPT_TEMPLATE } from './scripting'

export type Tool = 'translate' | 'rotate' | 'scale'
export type Mode = 'edit' | 'play'
/** What the hierarchy/inspector/scene view are editing. */
export type EditTarget = { kind: 'scene' | 'prefab'; id: string }

export interface EditorState {
  doc: ProjectDoc
  editing: EditTarget
  /** Scene to return to (and play) while a prefab is open. */
  lastScene: string
  /** Selected entity ids; the last one is the primary (gizmo, inspector). */
  selection: string[]
  tool: Tool
  snap: boolean
  /** Draw collider outlines for every entity (the selection's are always drawn). */
  showColliders: boolean
  /** Scene view (free editor camera) or Game view (through the main camera). */
  view: 'scene' | 'game'
  mode: Mode
  paused: boolean
  /** Frozen copy of the doc that play mode was started from. */
  playDoc: ProjectDoc | null
  /** Scene currently running in play mode (changes when scripts call loadScene). */
  playScene: string | null
  /** Bumped on every scene (re)load in play mode, so reloading the same scene restarts it. */
  playRun: number
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

const initialDoc = loadInitialDoc()

export const editorStore = createStore<EditorState>({
  doc: initialDoc,
  editing: { kind: 'scene', id: initialDoc.scenes[0].id },
  lastScene: initialDoc.scenes[0].id,
  selection: [],
  tool: 'translate',
  snap: false,
  showColliders: false,
  view: 'scene',
  mode: 'edit',
  paused: false,
  playDoc: null,
  playScene: null,
  playRun: 0,
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
// Edit targets

export function targetEntities(doc: ProjectDoc, target: EditTarget): EntityDoc[] {
  const owner = target.kind === 'scene' ? doc.scenes.find((s) => s.id === target.id) : doc.prefabs.find((p) => p.id === target.id)
  return owner?.entities ?? []
}

/** Target entities with prefab instances expanded (what the scene view shows). */
const expandCache = { entities: null as EntityDoc[] | null, prefabs: null as PrefabDoc[] | null, out: [] as EntityDoc[] }
export function expandedTarget(doc: ProjectDoc, target: EditTarget): EntityDoc[] {
  const entities = targetEntities(doc, target)
  if (expandCache.entities !== entities || expandCache.prefabs !== doc.prefabs) {
    expandCache.entities = entities
    expandCache.prefabs = doc.prefabs
    expandCache.out = expandEntities(entities, doc.prefabs)
  }
  return expandCache.out
}

export function currentScene(state: EditorState = editorStore.get()): SceneDoc {
  const { doc } = state
  const id = state.editing.kind === 'scene' ? state.editing.id : state.lastScene
  return doc.scenes.find((s) => s.id === id) ?? doc.scenes[0]
}

function withEntities(doc: ProjectDoc, target: EditTarget, entities: EntityDoc[]): ProjectDoc {
  if (target.kind === 'scene') {
    return { ...doc, scenes: doc.scenes.map((s) => (s.id === target.id ? { ...s, entities } : s)) }
  }
  return { ...doc, prefabs: doc.prefabs.map((p) => (p.id === target.id ? { ...p, entities } : p)) }
}

/** Keeps the edit target and selection valid after the doc is replaced (undo, open file). */
function reconcile(doc: ProjectDoc): Partial<EditorState> {
  const state = editorStore.get()
  const exists = (t: EditTarget) =>
    t.kind === 'scene' ? doc.scenes.some((s) => s.id === t.id) : doc.prefabs.some((p) => p.id === t.id)
  const lastScene = doc.scenes.some((s) => s.id === state.lastScene) ? state.lastScene : doc.scenes[0].id
  const editing = exists(state.editing) ? state.editing : { kind: 'scene' as const, id: lastScene }
  const ids = new Set(targetEntities(doc, editing).map((e) => e.id))
  return { editing, lastScene, selection: state.selection.filter((id) => ids.has(id)) }
}

export function openScene(id: string): void {
  if (editorStore.get().mode === 'play') return
  editorStore.set({ editing: { kind: 'scene', id }, lastScene: id, selection: [] })
}

/** Opens a prefab for editing with its root selected. */
export function openPrefab(id: string): void {
  const { mode, doc } = editorStore.get()
  const prefab = doc.prefabs.find((p) => p.id === id)
  if (mode === 'play' || !prefab) return
  const root = prefab.entities.find((e) => e.parent === null)
  editorStore.set({ editing: { kind: 'prefab', id }, selection: root ? [root.id] : [] })
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
  /** Allowed while playing (script source edits); everything else is blocked. */
  allowInPlay?: boolean
}

/** Applies a new document and records the previous one for undo. */
export function commit(next: ProjectDoc, { merge, allowInPlay = false }: CommitOptions = {}): void {
  const state = editorStore.get()
  if ((state.mode === 'play' && !allowInPlay) || next === state.doc) return
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
  editorStore.set({ doc: prev, canUndo: past.length > 0, canRedo: true, ...reconcile(prev) })
}

export function redo(): void {
  const state = editorStore.get()
  const next = future.pop()
  if (!next || state.mode === 'play') return
  past.push(state.doc)
  mergeKey = null
  editorStore.set({ doc: next, canUndo: true, canRedo: future.length > 0, ...reconcile(next) })
}

function replaceDoc(doc: ProjectDoc): void {
  stop()
  past.length = 0
  future.length = 0
  mergeKey = null
  const first = doc.scenes[0].id
  editorStore.set({
    doc,
    editing: { kind: 'scene', id: first },
    lastScene: first,
    selection: [],
    canUndo: false,
    canRedo: false,
    openScript: null,
  })
}

// ---------------------------------------------------------------------------
// Entity actions (always on the current edit target)

const state = () => editorStore.get()
const entities = () => targetEntities(state().doc, state().editing)
const setEntities = (next: EntityDoc[], options?: CommitOptions) =>
  commit(withEntities(state().doc, state().editing, next), options)

export function primarySelection(s: EditorState = state()): string | null {
  return s.selection.at(-1) ?? null
}

/** Selects one entity, or toggles it into the selection when `additive`. */
export function select(id: string | null, additive = false): void {
  if (id === null) return editorStore.set({ selection: [] })
  const current = state().selection
  if (!additive) return editorStore.set({ selection: [id] })
  editorStore.set({ selection: current.includes(id) ? current.filter((x) => x !== id) : [...current, id] })
}

export function updateEntity(
  id: string,
  update: Partial<EntityDoc> | ((entity: EntityDoc) => Partial<EntityDoc>),
  options?: CommitOptions,
): void {
  setEntities(
    entities().map((e) => {
      if (e.id !== id) return e
      const patch = typeof update === 'function' ? update(e) : update
      return { ...e, ...patch }
    }),
    options,
  )
}

/** Applies one update to several entities as a single undo step. */
export function updateEntities(
  ids: string[],
  update: (entity: EntityDoc) => Partial<EntityDoc>,
  options?: CommitOptions,
): void {
  const set = new Set(ids)
  setEntities(
    entities().map((e) => (set.has(e.id) ? { ...e, ...update(e) } : e)),
    options,
  )
}

export function addEntities(added: EntityDoc[], selectIds = [added[0]?.id]): void {
  if (!added.length) return
  // In prefab mode everything must hang under the single root.
  const { editing } = state()
  const root = editing.kind === 'prefab' ? entities().find((e) => e.parent === null) : undefined
  const fixed = root ? added.map((e) => (e.parent === null ? { ...e, parent: root.id } : e)) : added
  setEntities([...entities(), ...fixed])
  editorStore.set({ selection: selectIds.filter(Boolean) as string[] })
}

export function addEntity(entity: EntityDoc): void {
  addEntities([entity])
}

/** Deletes the selection (or the given ids) with their children. */
export function deleteEntities(ids = state().selection): void {
  const list = entities()
  const doomed = new Set<string>()
  for (const id of ids) {
    const e = list.find((x) => x.id === id)
    if (!e) continue
    if (state().editing.kind === 'prefab' && e.parent === null) {
      log('warn', 'The prefab root cannot be deleted.')
      continue
    }
    for (const x of subtreeIds(list, id)) doomed.add(x)
  }
  if (!doomed.size) return
  setEntities(list.filter((e) => !doomed.has(e.id)))
  editorStore.set({ selection: state().selection.filter((id) => !doomed.has(id)) })
}

export function duplicateEntities(ids = state().selection): void {
  const list = entities()
  const roots = ids.filter((id) => !ids.some((other) => other !== id && subtreeIds(list, other).has(id)))
  const next = [...list]
  const selected: string[] = []
  for (const id of roots) {
    const copies = cloneSubtree(next, id)
    if (!copies.length || (copies[0].parent === null && state().editing.kind === 'prefab')) continue
    const index = next.findIndex((e) => e.id === id)
    next.splice(index + 1, 0, ...copies)
    selected.push(copies[0].id)
  }
  if (!selected.length) return
  setEntities(next)
  editorStore.set({ selection: selected })
}

/** Moves `id` under `parent` (null = root). Refuses to create cycles. */
export function reparent(id: string, parent: string | null): void {
  if (id === parent) return
  const list = entities()
  if (parent && subtreeIds(list, id).has(parent)) return
  const entity = list.find((e) => e.id === id)
  if (!entity || entity.parent === parent) return
  if (state().editing.kind === 'prefab' && (entity.parent === null || parent === null)) return
  setEntities([...list.filter((e) => e.id !== id), { ...entity, parent }])
}

export function updateProject(patch: Partial<ProjectDoc>, options?: CommitOptions): void {
  commit({ ...state().doc, ...patch }, options)
}

// ---------------------------------------------------------------------------
// Scenes

export function updateScene(id: string, patch: Partial<SceneDoc>, options?: CommitOptions): void {
  const d = state().doc
  commit({ ...d, scenes: d.scenes.map((s) => (s.id === id ? { ...s, ...patch } : s)) }, options)
}

export function createSceneAction(): void {
  const d = state().doc
  const names = new Set(d.scenes.map((s) => s.name))
  let name = 'Scene'
  for (let i = 2; names.has(name); i++) name = `Scene ${i}`
  const scene = createScene(name)
  commit({ ...d, scenes: [...d.scenes, scene] })
  openScene(scene.id)
}

export function deleteScene(id: string): void {
  const d = state().doc
  if (d.scenes.length <= 1) return log('warn', 'A project needs at least one scene.')
  const scenes = d.scenes.filter((s) => s.id !== id)
  commit({ ...d, scenes })
  const s = state()
  if (s.lastScene === id || (s.editing.kind === 'scene' && s.editing.id === id)) openScene(scenes[0].id)
}

/** Makes a scene the first one (where exported games start). */
export function setStartScene(id: string): void {
  const d = state().doc
  const scene = d.scenes.find((s) => s.id === id)
  if (!scene) return
  commit({ ...d, scenes: [scene, ...d.scenes.filter((s) => s.id !== id)] })
}

// ---------------------------------------------------------------------------
// Prefabs

/** Turns an entity subtree into a prefab and replaces it with an instance. */
export function createPrefab(id: string): void {
  const s = state()
  if (s.editing.kind !== 'scene') return log('warn', 'Open a scene to create prefabs from it.')
  const list = entities()
  const entity = list.find((e) => e.id === id)
  if (!entity) return
  const ids = subtreeIds(list, id)
  const prefab: PrefabDoc = {
    id: newId(),
    name: entity.name,
    entities: list.filter((e) => ids.has(e.id)).map((e) => (e.id === id ? { ...e, parent: null } : e)),
  }
  const instance: EntityDoc = {
    id: entity.id,
    name: entity.name,
    parent: entity.parent,
    active: entity.active,
    transform: entity.transform,
    scripts: [],
    prefab: prefab.id,
  }
  const scenes = s.doc.scenes.map((scene) =>
    scene.id === s.editing.id
      ? { ...scene, entities: list.filter((e) => !ids.has(e.id) || e.id === id).map((e) => (e.id === id ? instance : e)) }
      : scene,
  )
  commit({ ...s.doc, scenes, prefabs: [...s.doc.prefabs, prefab] })
  log('log', `Created prefab "${prefab.name}"`)
}

export function addPrefabInstance(prefabId: string, position?: [number, number, number]): void {
  const s = state()
  const prefab = s.doc.prefabs.find((p) => p.id === prefabId)
  if (!prefab) return
  if (s.editing.kind === 'prefab' && (s.editing.id === prefabId || nestsPrefab(s.doc, prefabId, s.editing.id))) {
    return log('warn', 'A prefab cannot contain itself.')
  }
  const instance = instantiatePrefab(prefab)
  if (position) instance.transform.position = position
  addEntity(instance)
}

function nestsPrefab(doc: ProjectDoc, outer: string, inner: string, depth = 0): boolean {
  if (depth > 8) return true
  const prefab = doc.prefabs.find((p) => p.id === outer)
  return !!prefab?.entities.some((e) => e.prefab && (e.prefab === inner || nestsPrefab(doc, e.prefab, inner, depth + 1)))
}

/** Replaces an instance with plain entities (fresh ids) copied from its prefab. */
export function unpackPrefab(id: string): void {
  const list = entities()
  const instance = list.find((e) => e.id === id)
  if (!instance?.prefab) return
  const expanded = expandEntities([instance], state().doc.prefabs)
  const remap = new Map(expanded.map((e) => [e.id, e.id === id ? id : newId()]))
  const plain = expanded.map((e) => ({ ...structuredClone(e), id: remap.get(e.id)!, parent: e.id === id ? e.parent : remap.get(e.parent!)! }))
  const index = list.findIndex((e) => e.id === id)
  const next = [...list]
  next.splice(index, 1, ...plain)
  setEntities(next)
}

export function renamePrefab(id: string, name: string): void {
  const d = state().doc
  commit({ ...d, prefabs: d.prefabs.map((p) => (p.id === id ? { ...p, name } : p)) })
}

/** Deletes a prefab and every instance of it. */
export function deletePrefab(id: string): void {
  const d = state().doc
  const strip = (list: EntityDoc[]) => {
    const doomed = new Set<string>()
    for (const e of list) if (e.prefab === id) for (const x of subtreeIds(list, e.id)) doomed.add(x)
    return doomed.size ? list.filter((e) => !doomed.has(e.id)) : list
  }
  commit({
    ...d,
    scenes: d.scenes.map((s) => ({ ...s, entities: strip(s.entities) })),
    prefabs: d.prefabs.filter((p) => p.id !== id).map((p) => ({ ...p, entities: strip(p.entities) })),
  })
  const s = state()
  if (s.editing.kind === 'prefab' && s.editing.id === id) openScene(s.lastScene)
  else editorStore.set(reconcile(state().doc))
}

// ---------------------------------------------------------------------------
// Scripts

export function createScript(): ScriptDoc {
  const existing = new Set(state().doc.scripts.map((s) => s.name))
  let name = 'NewScript'
  for (let i = 1; existing.has(name); i++) name = `NewScript${i}`
  const script: ScriptDoc = { id: newId(), name, source: SCRIPT_TEMPLATE }
  updateProject({ scripts: [...state().doc.scripts, script] })
  editorStore.set({ openScript: script.id })
  return script
}

/** Script edits are allowed while playing (they hot-reload). */
export function updateScript(id: string, patch: Partial<ScriptDoc>): void {
  const scripts = state().doc.scripts.map((s) => (s.id === id ? { ...s, ...patch } : s))
  commit({ ...state().doc, scripts }, { allowInPlay: true })
}

export function deleteScript(id: string): void {
  const d = state().doc
  const strip = (list: EntityDoc[]) =>
    list.map((e) => (e.scripts.some((s) => s.script === id) ? { ...e, scripts: e.scripts.filter((s) => s.script !== id) } : e))
  commit({
    ...d,
    scripts: d.scripts.filter((s) => s.id !== id),
    scenes: d.scenes.map((s) => ({ ...s, entities: strip(s.entities) })),
    prefabs: d.prefabs.map((p) => ({ ...p, entities: strip(p.entities) })),
  })
  if (state().openScript === id) editorStore.set({ openScript: null })
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
  const s = state()
  if (s.mode === 'play') return
  engineRef?.resume()
  editorStore.set({
    mode: 'play',
    view: 'game',
    paused: false,
    playDoc: structuredClone(s.doc),
    playScene: currentScene(s).id,
  })
}

export function stop(): void {
  if (state().mode !== 'play') return
  engineRef?.resume()
  editorStore.set({ mode: 'edit', view: 'scene', paused: false, playDoc: null, playScene: null })
}

/** Called by scripts (`ctx.loadScene`) while playing. */
export function switchPlayScene(sceneId: string): void {
  if (state().mode === 'play') editorStore.set((s) => ({ playScene: sceneId, playRun: s.playRun + 1 }))
}

export function togglePause(): void {
  const engine = engineRef
  if (!engine || state().mode !== 'play') return
  if (engine.paused) engine.resume()
  else engine.pause()
  editorStore.set({ paused: engine.paused })
}

export function stepFrame(): void {
  const engine = engineRef
  if (!engine || state().mode !== 'play') return
  if (!engine.paused) engine.pause()
  engine.step()
  editorStore.set({ paused: true })
}

// ---------------------------------------------------------------------------
// Project files

export function newProject(blank: boolean): void {
  replaceDoc(blank ? emptyProject() : sampleProject())
}

export function exportProject(): void {
  const d = state().doc
  download(`${slug(d.name)}.json`, new Blob([JSON.stringify(d, null, 2)], { type: 'application/json' }))
}

export async function importProject(file: File): Promise<void> {
  try {
    replaceDoc(parseProject(JSON.parse(await file.text())))
    log('log', `Opened ${file.name}`)
  } catch (error) {
    log('error', `Could not open ${file.name}:`, error)
  }
}

export function slug(name: string): string {
  return name.replace(/[^\w-]+/g, '_') || 'project'
}

export function download(filename: string, blob: Blob): void {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}

// Autosave (debounced). Play-mode changes never touch the doc (except script edits).
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

// ---------------------------------------------------------------------------
// Clipboard (copies entity subtrees between scenes and prefabs)

let clipboard: EntityDoc[] = []

export function copySelection(): void {
  const list = entities()
  const ids = state().selection
  const roots = ids.filter((id) => !ids.some((other) => other !== id && subtreeIds(list, other).has(id)))
  clipboard = roots.flatMap((id) => {
    const tree = subtreeIds(list, id)
    return list.filter((e) => tree.has(e.id)).map((e) => (e.id === id ? { ...e, parent: null } : e))
  })
  if (clipboard.length) {
    const text = JSON.stringify({ type: 'engine-entities', entities: clipboard })
    void navigator.clipboard?.writeText(text).catch(() => {})
  }
}

export function pasteClipboard(): void {
  if (!clipboard.length || state().mode === 'play') return
  const remap = new Map(clipboard.map((e) => [e.id, newId()]))
  const pasted = clipboard.map((e) => ({
    ...structuredClone(e),
    id: remap.get(e.id)!,
    parent: e.parent ? (remap.get(e.parent) ?? null) : null,
  }))
  addEntities(pasted, pasted.filter((e) => e.parent === null).map((e) => e.id))
}
