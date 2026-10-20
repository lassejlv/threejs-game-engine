import { componentDefaults, defaultCollider } from './defaults'
import { type ComponentKey, type EntityDoc, type EntityOverride } from './types'

export const OVERRIDABLE: ComponentKey[] = ['mesh', 'model', 'sprite', 'light', 'camera', 'audio', 'particles', 'rigidBody', 'collider', 'joint', 'terrain']

/** A fresh component for `key` on `entity` (colliders fit the entity's mesh or model). */
export function defaultComponent(key: ComponentKey, entity: EntityDoc): unknown {
  return key === 'collider' ? defaultCollider(entity) : componentDefaults[key]()
}

/**
 * An entity with an instance's overrides applied: patched, removed (`null`) and
 * added (`added`) components. A patch for a component the part doesn't have and
 * didn't add is ignored, so a prefab that drops a component drops it everywhere.
 */
export function applyOverride(e: EntityDoc, override: EntityOverride | undefined, isRoot: boolean): EntityDoc {
  if (!override) return e
  const out: EntityDoc = { ...e }
  const components = out as unknown as Record<string, unknown>
  for (const key of OVERRIDABLE) {
    const patch = override[key]
    if (patch === null) delete components[key]
    else if (patch && (components[key] || override.added?.includes(key))) {
      components[key] = { ...((components[key] ?? defaultComponent(key, e)) as object), ...patch }
    }
  }
  // The root's name/active/transform come from the instance itself.
  if (!isRoot) {
    if (override.name !== undefined) out.name = override.name
    if (override.active !== undefined) out.active = override.active
    if (override.transform) out.transform = override.transform
  }
  return out
}
