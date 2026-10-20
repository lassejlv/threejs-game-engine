import { version as ENGINE_VERSION } from '../../package.json'
import { defaultNavSettings } from '../engine/navigation/NavGrid'
import {
  componentDefaults,
  createEntity,
  createUiElement,
  defaultProjectSettings,
  defaultSettings,
  type EntityDoc,
  FORMAT_VERSION,
  type ProjectDoc,
  type RigidBodyDoc,
} from './document'

/**
 * The project file format: versions, the migrations between them, and the
 * checks that turn a broken file into a readable error instead of a crash later.
 *
 * Format history
 *   1  one scene: { version, name, settings, entities, scripts }
 *   2  scenes, prefabs, project settings
 *   3  records the engine version that saved it; assets live next to the
 *      document (projects/<id>/assets or the browser store), not in one shared store
 *
 * Every format change adds a migration here and a fixture in fixtures/.
 */

export { ENGINE_VERSION }

type RawDoc = Record<string, unknown>

interface Migration {
  from: number
  name: string
  up(doc: RawDoc): RawDoc
}

/** Applied in order; each takes a document of version `from` to `from + 1`. */
export const MIGRATIONS: Migration[] = [
  {
    from: 1,
    name: 'single scene → scenes and prefabs',
    up: (doc) => ({
      version: 2,
      name: doc.name,
      settings: {},
      scenes: [{ id: 'main', name: 'Main', settings: doc.settings, entities: doc.entities ?? [], ui: [] }],
      prefabs: [],
      scripts: doc.scripts ?? [],
    }),
  },
  {
    from: 2,
    name: 'record the engine version',
    up: (doc) => ({ ...doc, version: 3, engine: typeof doc.engine === 'string' ? doc.engine : 'pre-1.0' }),
  },
]

export class ProjectFormatError extends Error {
  constructor(readonly problems: string[]) {
    const shown = problems.slice(0, 6).map((p) => `• ${p}`)
    if (problems.length > 6) shown.push(`• …and ${problems.length - 6} more`)
    super(`This project file can't be opened:\n${shown.join('\n')}`)
    this.name = 'ProjectFormatError'
  }
}

/** Reads a saved project of any known version: migrates, validates, then fills fields added since it was saved. */
export function parseProject(json: unknown): ProjectDoc {
  if (!json || typeof json !== 'object' || Array.isArray(json)) throw new ProjectFormatError(['It is not a project (expected a JSON object).'])
  let doc = json as RawDoc
  const version = doc.version
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    throw new ProjectFormatError(['It has no format version, so it is not a project file.'])
  }
  if (version > FORMAT_VERSION) {
    throw new ProjectFormatError([`It was saved by a newer editor (format ${version}; this editor reads up to ${FORMAT_VERSION}). Update the editor.`])
  }
  for (const migration of MIGRATIONS) if (doc.version === migration.from) doc = migration.up(doc)
  const problems = validateProject(doc)
  if (problems.length) throw new ProjectFormatError(problems)
  return normalize(doc as unknown as ProjectDoc)
}

/** Structural problems that would break the editor or the game, with where they are. Empty when fine. */
export function validateProject(doc: RawDoc): string[] {
  const problems: string[] = []
  const isObject = (v: unknown): v is RawDoc => !!v && typeof v === 'object' && !Array.isArray(v)
  const isVec3 = (v: unknown) => Array.isArray(v) && v.length === 3 && v.every((n) => typeof n === 'number' && Number.isFinite(n))
  const label = (kind: string, i: number, item: unknown) => {
    const name = isObject(item) && typeof item.name === 'string' ? ` "${item.name}"` : ''
    return `${kind} ${i + 1}${name}`
  }

  const checkEntities = (where: string, list: unknown) => {
    if (list === undefined) return
    if (!Array.isArray(list)) {
      problems.push(`${where}: entities must be a list`)
      return
    }
    const ids = new Set<string>()
    list.forEach((e, i) => {
      const at = `${where} › ${label('entity', i, e)}`
      if (!isObject(e)) return problems.push(`${at}: not an object`)
      if (typeof e.id !== 'string' || !e.id) problems.push(`${at}: missing id`)
      else if (ids.has(e.id)) problems.push(`${at}: id "${e.id}" is used twice`)
      else ids.add(e.id)
      if (e.parent != null && typeof e.parent !== 'string') problems.push(`${at}: parent must be an entity id`)
      if (e.scripts !== undefined && !Array.isArray(e.scripts)) problems.push(`${at}: scripts must be a list`)
      if (e.transform !== undefined) {
        if (!isObject(e.transform)) problems.push(`${at}: transform must be an object`)
        else
          for (const key of ['position', 'rotation', 'scale'] as const) {
            if (e.transform[key] !== undefined && !isVec3(e.transform[key])) problems.push(`${at}: transform.${key} must be 3 numbers`)
          }
      }
      for (const key of ['mesh', 'model', 'sprite', 'light', 'camera', 'audio', 'particles', 'rigidBody', 'collider', 'joint', 'terrain']) {
        if (e[key] !== undefined && e[key] !== null && !isObject(e[key])) problems.push(`${at}: ${key} must be an object`)
      }
    })
  }

  if (typeof doc.name !== 'string') problems.push('The project has no name')
  if (doc.settings !== undefined && !isObject(doc.settings)) problems.push('Project settings must be an object')
  if (!Array.isArray(doc.scenes) || doc.scenes.length === 0) problems.push('The project has no scenes')
  else
    doc.scenes.forEach((scene, i) => {
      const at = label('Scene', i, scene)
      if (!isObject(scene)) return problems.push(`${at}: not an object`)
      if (scene.settings !== undefined && !isObject(scene.settings)) problems.push(`${at}: settings must be an object`)
      if (scene.ui !== undefined && !Array.isArray(scene.ui)) problems.push(`${at}: ui must be a list`)
      checkEntities(at, scene.entities)
    })
  if (doc.prefabs !== undefined) {
    if (!Array.isArray(doc.prefabs)) problems.push('Prefabs must be a list')
    else
      doc.prefabs.forEach((prefab, i) => {
        const at = label('Prefab', i, prefab)
        if (!isObject(prefab)) return problems.push(`${at}: not an object`)
        if (typeof prefab.id !== 'string') problems.push(`${at}: missing id`)
        if (!Array.isArray(prefab.entities) || prefab.entities.length === 0) problems.push(`${at}: has no entities`)
        else checkEntities(at, prefab.entities)
      })
  }
  if (doc.scripts !== undefined) {
    if (!Array.isArray(doc.scripts)) problems.push('Scripts must be a list')
    else
      doc.scripts.forEach((script, i) => {
        const at = label('Script', i, script)
        if (!isObject(script)) return problems.push(`${at}: not an object`)
        if (typeof script.id !== 'string') problems.push(`${at}: missing id`)
        if (typeof script.source !== 'string') problems.push(`${at}: source must be text`)
      })
  }
  return problems
}

/**
 * Links that point at nothing (a deleted prefab, script or parent). The project
 * still opens; these are reported so they can be fixed.
 */
export function checkReferences(doc: ProjectDoc): string[] {
  const warnings: string[] = []
  const prefabs = new Set(doc.prefabs.map((p) => p.id))
  const scripts = new Set(doc.scripts.map((s) => s.id))
  const check = (where: string, entities: EntityDoc[]) => {
    const ids = new Set(entities.map((e) => e.id))
    for (const e of entities) {
      if (e.parent && !ids.has(e.parent)) warnings.push(`${where} › "${e.name}": its parent no longer exists`)
      if (e.prefab && !prefabs.has(e.prefab)) warnings.push(`${where} › "${e.name}": its prefab no longer exists`)
      for (const ref of e.scripts) {
        if (!ref.script.startsWith('builtin:') && !scripts.has(ref.script)) warnings.push(`${where} › "${e.name}": uses a script that no longer exists`)
      }
    }
  }
  for (const scene of doc.scenes) check(`Scene "${scene.name}"`, scene.entities)
  for (const prefab of doc.prefabs) check(`Prefab "${prefab.name}"`, prefab.entities)
  return warnings
}

/** Fills settings and component fields added after the file was saved. */
function normalize(doc: ProjectDoc): ProjectDoc {
  return {
    version: FORMAT_VERSION,
    name: doc.name ?? 'Untitled',
    engine: doc.engine,
    settings: { ...defaultProjectSettings(), ...doc.settings },
    scenes: doc.scenes.map((scene, i) => ({
      id: scene.id ?? `scene-${i + 1}`,
      name: scene.name ?? 'Scene',
      settings: { ...defaultSettings(), ...scene.settings, navigation: { ...defaultNavSettings(), ...scene.settings?.navigation } },
      entities: (scene.entities ?? []).map(migrateEntity),
      ui: (scene.ui ?? []).map((el) => ({ ...createUiElement(el.type ?? 'text', el.name ?? 'UI'), ...el })),
    })),
    prefabs: (doc.prefabs ?? []).map((p) => ({ ...p, entities: p.entities.map(migrateEntity) })),
    scripts: doc.scripts ?? [],
  }
}

function migrateEntity(raw: EntityDoc): EntityDoc {
  const e: EntityDoc = { ...createEntity(raw.name ?? 'Entity'), ...raw, scripts: raw.scripts ?? [] }
  if (e.rigidBody) {
    // Format 1–2 files may have the old `kinematic: true` flag instead of a body type.
    const legacy = e.rigidBody as Partial<RigidBodyDoc> & { kinematic?: boolean }
    const { kinematic, ...rest } = legacy
    e.rigidBody = { ...componentDefaults.rigidBody(), type: kinematic ? 'kinematic' : 'dynamic', ...rest }
  }
  if (e.mesh) e.mesh = { ...componentDefaults.mesh(), ...e.mesh }
  if (e.collider) e.collider = { ...componentDefaults.collider(), ...e.collider }
  if (e.joint) e.joint = { ...componentDefaults.joint(), ...e.joint }
  if (e.terrain) e.terrain = { ...componentDefaults.terrain(), ...e.terrain }
  if (e.camera) e.camera = { ...componentDefaults.camera(), ...e.camera }
  if (e.sprite) e.sprite = { ...componentDefaults.sprite(), ...e.sprite }
  if (e.audio) e.audio = { ...componentDefaults.audio(), ...e.audio }
  if (e.model) e.model = { ...componentDefaults.model(), ...e.model }
  if (e.particles) e.particles = { ...componentDefaults.particles(), ...e.particles }
  return e
}

/** What gets written: the document stamped with this engine's version. */
export function serializableProject(doc: ProjectDoc): ProjectDoc {
  return doc.engine === ENGINE_VERSION ? doc : { ...doc, engine: ENGINE_VERSION }
}
