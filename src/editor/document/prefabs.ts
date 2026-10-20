import { createEntity, newId } from './defaults'
import { applyOverride } from './overrides'
import { type EntityDoc, type PrefabDoc } from './types'

export function prefabRoot(prefab: PrefabDoc): EntityDoc | undefined {
  return prefab.entities.find((e) => e.parent === null)
}

/** For an id produced by `expandEntities`, the top-level entity it belongs to. */
export function ownerId(id: string): string {
  const slash = id.indexOf('/')
  return slash === -1 ? id : id.slice(0, slash)
}

const MAX_PREFAB_DEPTH = 8

/**
 * Replaces prefab instances with the prefab's entities. The root keeps the
 * instance's id, name, parent, active flag and transform; inner entities get
 * ids of the form `instanceId/prefabEntityId`. Nested prefabs expand recursively.
 */
export function expandEntities(entities: EntityDoc[], prefabs: PrefabDoc[], depth = 0): EntityDoc[] {
  if (!entities.some((e) => e.prefab)) return entities
  const out: EntityDoc[] = []
  for (const e of entities) {
    if (e.prefab) out.push(...expandInstance(e, prefabs, depth))
    else out.push(e)
  }
  return out
}

function expandInstance(instance: EntityDoc, prefabs: PrefabDoc[], depth: number): EntityDoc[] {
  const prefab = prefabs.find((p) => p.id === instance.prefab)
  const root = prefab && prefabRoot(prefab)
  if (!prefab || !root || depth >= MAX_PREFAB_DEPTH) return [{ ...instance, prefab: undefined }]
  const inner = expandEntities(prefab.entities, prefabs, depth + 1)
  const innerIds = new Set(inner.map((e) => e.id))
  const mapId = (id: string) => (id === root.id ? instance.id : `${instance.id}/${id}`)
  // Joints between entities of the same prefab must point at this instance's copies.
  const remapJoint = (e: EntityDoc): EntityDoc =>
    e.joint?.target && innerIds.has(e.joint.target) ? { ...e, joint: { ...e.joint, target: mapId(e.joint.target) } } : e
  const overridden = (e: EntityDoc) => applyOverride(e, instance.overrides?.[e.id], e.id === root.id)
  return inner.map(overridden).map(remapJoint).map((e) =>
    e.id === root.id
      ? {
          ...e,
          id: instance.id,
          name: instance.name,
          parent: instance.parent,
          active: instance.active,
          transform: instance.transform,
          prefab: undefined,
          scripts: e.scripts.map((ref) => {
            const override = instance.scripts.find((o) => o.script === ref.script)
            return override ? { ...ref, params: { ...ref.params, ...override.params } } : ref
          }),
        }
      : { ...e, id: mapId(e.id), parent: e.parent ? mapId(e.parent) : instance.id },
  )
}

/** The entities of a prefab as instances see them (nested prefabs expanded): the keys `overrides` use. */
export function prefabParts(prefab: PrefabDoc, prefabs: PrefabDoc[]): EntityDoc[] {
  return expandEntities(prefab.entities, prefabs)
}

/** A prefab based on another: its root is an instance of `base`, so it inherits everything until overridden. */
export function createVariant(base: PrefabDoc, name = `${base.name} Variant`): PrefabDoc {
  const root = prefabRoot(base)
  return {
    id: newId(),
    name,
    entities: [createEntity(name, { transform: structuredClone(root?.transform ?? { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] }), prefab: base.id })],
  }
}

/** A new, unparented instance of `prefab` using the prefab root's transform. */
export function instantiatePrefab(prefab: PrefabDoc, partial: Partial<EntityDoc> = {}): EntityDoc {
  // `scripts` on an instance holds parameter overrides only (see EntityDoc.scripts).
  const root = prefabRoot(prefab)
  return createEntity(prefab.name, {
    transform: structuredClone(root?.transform ?? { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] }),
    prefab: prefab.id,
    ...partial,
  })
}

export function childrenOf(entities: EntityDoc[], parent: string | null): EntityDoc[] {
  return entities.filter((e) => e.parent === parent)
}

/** The entity and all its descendants. */
export function subtreeIds(entities: EntityDoc[], id: string): Set<string> {
  const ids = new Set([id])
  let grew = true
  while (grew) {
    grew = false
    for (const e of entities) {
      if (e.parent && ids.has(e.parent) && !ids.has(e.id)) {
        ids.add(e.id)
        grew = true
      }
    }
  }
  return ids
}

/** Entities ordered so every parent precedes its children. */
export function depthFirst(entities: EntityDoc[]): EntityDoc[] {
  const byParent = new Map<string | null, EntityDoc[]>()
  for (const e of entities) {
    const list = byParent.get(e.parent) ?? []
    list.push(e)
    byParent.set(e.parent, list)
  }
  const out: EntityDoc[] = []
  const visit = (parent: string | null) => {
    for (const e of byParent.get(parent) ?? []) {
      out.push(e)
      visit(e.id)
    }
  }
  visit(null)
  return out
}

/** Deep-copies an entity subtree with fresh ids. The copy's root keeps the original parent. */
export function cloneSubtree(entities: EntityDoc[], id: string, suffix = ' (copy)'): EntityDoc[] {
  const ids = subtreeIds(entities, id)
  const remap = new Map<string, string>()
  for (const old of ids) remap.set(old, newId())
  return entities
    .filter((e) => ids.has(e.id))
    .map((e) => {
      const copy: EntityDoc = {
        ...structuredClone(e),
        id: remap.get(e.id)!,
        parent: e.id === id ? e.parent : remap.get(e.parent!)!,
        name: e.id === id ? `${e.name}${suffix}` : e.name,
      }
      // A joint to another entity in the copied subtree connects to that entity's copy.
      if (copy.joint?.target && remap.has(copy.joint.target)) copy.joint.target = remap.get(copy.joint.target)!
      return copy
    })
}
