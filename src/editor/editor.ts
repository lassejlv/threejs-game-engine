import { AudioContext as ThreeAudioContext } from 'three'
import { createStore, type Engine } from '../engine'
import { type AssetMeta, AssetLibrary } from './assetLibrary'
import { parseProject, serializableProject } from './projectFormat'
import type { ProjectSummary } from './storage/types'
import { log } from './console'
import {
  cloneSubtree,
  createScene,
  createUiElement,
  createVariant,
  emptyProject,
  type EntityDoc,
  expandEntities,
  instantiatePrefab,
  newId,
  type PrefabDoc,
  type ProjectDoc,
  type SceneDoc,
  type ScriptDoc,
  subtreeIds,
  type UiElementDoc,
} from './document'
import { activeSessions } from './runtime/playSession'
import { sampleProject } from './sample'
import type { Template } from './templates'
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
  /** Selected screen UI element of the current scene (exclusive with `selection`). */
  uiSelection: string | null
  tool: Tool
  snap: boolean
  /** Draw collider outlines for every entity (the selection's are always drawn). */
  showColliders: boolean
  /** Show drag handles on the selected collider in the Scene view. */
  colliderHandles: boolean
  /** Terrain sculpting tool for the selected Terrain (null = off). */
  terrainTool: 'raise' | 'lower' | 'smooth' | 'flatten' | null
  brushRadius: number
  brushStrength: number
  /** Scene view camera looks straight down -Z without rotating (for 2D scenes). */
  view2D: boolean
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
  bottomTab: 'project' | 'console' | 'history'
  /** Labels of the undoable steps, oldest first. */
  history: string[]
  /** Labels of the redoable steps, next one first. */
  redoHistory: string[]
  /** Where the open project is saved and how the last save went (see projects.ts). */
  storage: StorageStatus
  /** Projects in the active store, most recently saved first. */
  projects: ProjectSummary[]
  /** Asking whether an imported project's scripts may run (answered with answerTrust). */
  trustPrompt: { project: string; scripts: string[] } | null
}

export interface StorageStatus {
  /** null until projects.ts has picked a store (and in tests). */
  kind: 'disk' | 'browser' | null
  /** Human-readable location, e.g. "the projects/ folder". */
  label: string
  projectId: string | null
  state: 'idle' | 'loading' | 'saving' | 'saved' | 'error'
  error: string | null
  /** False for an imported project whose scripts haven't been allowed to run (see trust.ts). */
  trusted: boolean
}

const HISTORY_LIMIT = 200
const MERGE_WINDOW_MS = 600

// The real project is opened by projects.ts once it has found where projects are stored.
const initialDoc = sampleProject()

export const editorStore = createStore<EditorState>({
  doc: initialDoc,
  editing: { kind: 'scene', id: initialDoc.scenes[0].id },
  lastScene: initialDoc.scenes[0].id,
  selection: [],
  uiSelection: null,
  tool: 'translate',
  snap: false,
  showColliders: false,
  colliderHandles: false,
  terrainTool: null,
  view2D: false,
  brushRadius: 4,
  brushStrength: 0.5,
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
  history: [],
  redoHistory: [],
  storage: { kind: null, label: '', projectId: null, state: 'idle', error: null, trusted: true },
  projects: [],
  trustPrompt: null,
})

export const assetLibrary = new AssetLibrary()

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

interface Step {
  doc: ProjectDoc
  label: string
}

const past: Step[] = []
const future: Step[] = []

function historyState(): Pick<EditorState, 'history' | 'redoHistory' | 'canUndo' | 'canRedo'> {
  return {
    history: past.map((s) => s.label),
    redoHistory: [...future].reverse().map((s) => s.label),
    canUndo: past.length > 0,
    canRedo: future.length > 0,
  }
}

/** A readable name for a change, from its merge key (`<entityId>.mesh.color`) when no label was given. */
function describeChange(doc: ProjectDoc, merge: string | undefined): string {
  if (!merge) return 'Edit'
  const [head, ...rest] = merge.split('.')
  const field = rest.join(' › ')
  if (head === 'settings') return 'Scene settings'
  if (head === 'project') return 'Project settings'
  for (const list of [...doc.scenes.map((s) => s.entities), ...doc.prefabs.map((p) => p.entities)]) {
    const entity = list.find((e) => e.id === head)
    if (entity) return `${entity.name}: ${field.replace(/\d+$/, '') || 'edit'}`
  }
  return 'Edit'
}
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
  /** Name of the step in the history panel (derived from `merge` when omitted). */
  label?: string
}

/** Applies a new document and records the previous one for undo. */
export function commit(next: ProjectDoc, { merge, allowInPlay = false, label }: CommitOptions = {}): void {
  const state = editorStore.get()
  if ((state.mode === 'play' && !allowInPlay) || next === state.doc) return
  const now = performance.now()
  const merging = transaction
    ? transaction.recorded
    : merge !== undefined && merge === mergeKey && now - mergeTime < MERGE_WINDOW_MS
  if (transaction) transaction.recorded = true
  if (!merging) {
    past.push({ doc: state.doc, label: label ?? describeChange(next, merge) })
    if (past.length > HISTORY_LIMIT) past.shift()
  }
  mergeKey = merge ?? null
  mergeTime = now
  future.length = 0
  editorStore.set({ doc: next, ...historyState() })
}

export function undo(): void {
  const state = editorStore.get()
  if (!past.length || state.mode === 'play') return
  const step = past.pop()!
  future.push({ doc: state.doc, label: step.label })
  mergeKey = null
  editorStore.set({ doc: step.doc, ...historyState(), ...reconcile(step.doc) })
}

export function redo(): void {
  const state = editorStore.get()
  if (!future.length || state.mode === 'play') return
  const step = future.pop()!
  past.push({ doc: state.doc, label: step.label })
  mergeKey = null
  editorStore.set({ doc: step.doc, ...historyState(), ...reconcile(step.doc) })
}

/** Undoes or redoes until `steps` changes are applied (0 = the oldest state kept). */
export function jumpToHistory(steps: number): void {
  if (editorStore.get().mode === 'play') return
  while (past.length > steps && past.length) undo()
  while (past.length < steps && future.length) redo()
}

/** Shows another document, clearing undo history (opening or creating a project). */
export function replaceDoc(doc: ProjectDoc): void {
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
    openScript: null,
    ...historyState(),
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
  if (id === null) return editorStore.set({ selection: [], uiSelection: null })
  const current = state().selection
  if (!additive) return editorStore.set({ selection: [id], uiSelection: null })
  editorStore.set({ selection: current.includes(id) ? current.filter((x) => x !== id) : [...current, id], uiSelection: null })
}

// ---------------------------------------------------------------------------
// Screen UI (per scene)

export function selectUi(id: string | null): void {
  editorStore.set({ uiSelection: id, selection: [] })
}

function currentSceneId(): string | null {
  const s = state()
  return s.editing.kind === 'scene' ? s.editing.id : null
}

export function addUiElement(type: UiElementDoc['type']): void {
  const sceneId = currentSceneId()
  if (!sceneId) return log('warn', 'Screen UI belongs to scenes: open a scene to add it.')
  const scene = state().doc.scenes.find((s) => s.id === sceneId)!
  const names = new Set(scene.ui.map((u) => u.name))
  const base = type[0].toUpperCase() + type.slice(1)
  let name = base
  for (let i = 2; names.has(name); i++) name = `${base} ${i}`
  const element = createUiElement(type, name)
  updateScene(sceneId, { ui: [...scene.ui, element] }, { label: `Add UI ${name}` })
  // Screen UI is laid out in the Game view.
  editorStore.set({ uiSelection: element.id, selection: [], view: 'game' })
}

export function updateUiElement(id: string, patch: Partial<UiElementDoc>, options?: CommitOptions): void {
  const sceneId = currentSceneId()
  const scene = sceneId && state().doc.scenes.find((s) => s.id === sceneId)
  if (!scene) return
  updateScene(scene.id, { ui: scene.ui.map((u) => (u.id === id ? { ...u, ...patch } : u)) }, options)
}

export function deleteUiElement(id: string): void {
  const sceneId = currentSceneId()
  const scene = sceneId && state().doc.scenes.find((s) => s.id === sceneId)
  const element = scene && scene.ui.find((u) => u.id === id)
  if (!scene || !element) return
  updateScene(scene.id, { ui: scene.ui.filter((u) => u.id !== id) }, { label: `Delete UI ${element.name}` })
  if (state().uiSelection === id) editorStore.set({ uiSelection: null })
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
  setEntities([...entities(), ...fixed], { label: added.length === 1 ? `Add ${added[0].name}` : `Add ${added.length} objects` })
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
  const names = list.filter((e) => ids.includes(e.id)).map((e) => e.name)
  setEntities(list.filter((e) => !doomed.has(e.id)), { label: names.length === 1 ? `Delete ${names[0]}` : `Delete ${names.length} objects` })
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
  setEntities(next, { label: selected.length === 1 ? `Duplicate ${list.find((e) => e.id === roots[0])?.name}` : `Duplicate ${selected.length} objects` })
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
  setEntities([...list.filter((e) => e.id !== id), { ...entity, parent }], { label: `Move ${entity.name}` })
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
  commit({ ...d, scenes: [...d.scenes, scene] }, { label: `Create scene ${name}` })
  openScene(scene.id)
}

export function deleteScene(id: string): void {
  const d = state().doc
  if (d.scenes.length <= 1) return log('warn', 'A project needs at least one scene.')
  const scenes = d.scenes.filter((s) => s.id !== id)
  commit({ ...d, scenes }, { label: `Delete scene ${d.scenes.find((s) => s.id === id)?.name}` })
  const s = state()
  if (s.lastScene === id || (s.editing.kind === 'scene' && s.editing.id === id)) openScene(scenes[0].id)
}

/** Makes a scene the first one (where exported games start). */
export function setStartScene(id: string): void {
  const d = state().doc
  const scene = d.scenes.find((s) => s.id === id)
  if (!scene) return
  commit({ ...d, scenes: [scene, ...d.scenes.filter((s) => s.id !== id)] }, { label: `Start scene: ${scene.name}` })
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
  commit({ ...s.doc, scenes, prefabs: [...s.doc.prefabs, prefab] }, { label: `Create prefab ${prefab.name}` })
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
  setEntities(next, { label: `Unpack ${instance.name}` })
}

/** Adds a variant of a prefab and opens it, ready for overrides. */
export function createVariantAction(baseId: string): void {
  const d = state().doc
  const base = d.prefabs.find((p) => p.id === baseId)
  if (!base) return
  const names = new Set(d.prefabs.map((p) => p.name))
  let name = `${base.name} Variant`
  for (let i = 2; names.has(name); i++) name = `${base.name} Variant ${i}`
  const variant = createVariant(base, name)
  commit({ ...d, prefabs: [...d.prefabs, variant] }, { label: `Create variant ${name}` })
  openPrefab(variant.id)
}

export function renamePrefab(id: string, name: string): void {
  const d = state().doc
  commit({ ...d, prefabs: d.prefabs.map((p) => (p.id === id ? { ...p, name } : p)) }, { label: `Rename prefab ${name}` })
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
  }, { label: `Delete prefab ${d.prefabs.find((p) => p.id === id)?.name}` })
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
  updateProject({ scripts: [...state().doc.scripts, script] }, { label: `Create script ${name}` })
  editorStore.set({ openScript: script.id })
  return script
}

/** Script edits are allowed while playing (they hot-reload). */
export function updateScript(id: string, patch: Partial<ScriptDoc>): void {
  const scripts = state().doc.scripts.map((s) => (s.id === id ? { ...s, ...patch } : s))
  commit({ ...state().doc, scripts }, { allowInPlay: true, merge: `script.${id}`, label: `Edit script ${scripts.find((s) => s.id === id)?.name}` })
  const script = scripts.find((s) => s.id === id)
  if (script && state().mode === 'play') {
    for (const session of activeSessions) session.reloadScript(id, script.name, script.source)
  }
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
  }, { label: `Delete script ${d.scripts.find((s) => s.id === id)?.name}` })
  if (state().openScript === id) editorStore.set({ openScript: null })
}

// ---------------------------------------------------------------------------
// Assets

export async function importAssets(files: FileList | File[]): Promise<void> {
  // Copy first: input/drop FileLists are emptied as soon as the event handler returns.
  for (const file of Array.from(files)) {
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
  // Browsers only allow audio after a user gesture; Play is one.
  void (ThreeAudioContext.getContext() as unknown as globalThis.AudioContext).resume()
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

/** Starts a new project from a template, switching the Scene view to 2D for 2D ones. */
export function newFromTemplate(template: Template): void {
  replaceDoc(template.create())
  editorStore.set({ view2D: !!template.view2D })
}

export function exportProject(): void {
  const d = state().doc
  download(`${slug(d.name)}.json`, new Blob([JSON.stringify(serializableProject(d), null, 2)], { type: 'application/json' }))
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
