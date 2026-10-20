import { type ComponentKey, type EntityDoc, type EntityOverride } from './types'

const OVERRIDABLE: ComponentKey[] = ['mesh', 'model', 'sprite', 'light', 'camera', 'audio', 'particles', 'rigidBody', 'collider', 'joint', 'terrain']

/** An entity with an instance's overrides applied (only components it already has are changed). */
export function applyOverride(e: EntityDoc, override: EntityOverride | undefined, isRoot: boolean): EntityDoc {
  if (!override) return e
  const out: EntityDoc = { ...e }
  for (const key of OVERRIDABLE) {
    const patch = override[key]
    if (patch && out[key]) (out as unknown as Record<string, unknown>)[key] = { ...out[key], ...patch }
  }
  // The root's name/active/transform come from the instance itself.
  if (!isRoot) {
    if (override.name !== undefined) out.name = override.name
    if (override.active !== undefined) out.active = override.active
    if (override.transform) out.transform = override.transform
  }
  return out
}
