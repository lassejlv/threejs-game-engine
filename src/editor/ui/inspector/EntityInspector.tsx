import { useMemo, useState } from 'react'
import { useStore } from '../../../react'
import {
  COMPONENT_LABELS,
  type ComponentKey,
  componentDefaults,
  defaultCollider,
  defaultComponent,
  type EntityDoc,
  type ParamValue,
  applyOverride,
  type EntityOverride,
  prefabParts,
  prefabRoot,
  type ProjectDoc,
  type Vec3,
} from '../../document'
import { type CommitOptions, editorStore, openPrefab, unpackPrefab, updateEntities, updateEntity } from '../../editor'
import { BUILTINS, resolveBehavior, scriptLabel } from '../../scripting'
import { CheckField, ColorField, NumberField, Row, Section, SelectField, TextField, TextInput, Vec3Field } from '../fields'
import { sceneView } from '../../runtime/editScene'
import { Icon } from '../icons'
import { ComponentSections } from './ComponentSections'
import { ScriptSection } from './ScriptSection'
import type { Patch } from './ComponentSections'

export function InstanceInspector({ entity, doc }: { entity: EntityDoc; doc: ProjectDoc }) {
  const id = entity.id
  const prefab = doc.prefabs.find((p) => p.id === entity.prefab)
  const root = prefab && prefabRoot(prefab)
  const parts = useMemo(() => (prefab ? prefabParts(prefab, doc.prefabs) : []), [prefab, doc.prefabs])
  const [partId, setPartId] = useState<string>(() => root?.id ?? '')
  const part = parts.find((p) => p.id === partId) ?? parts[0]
  const isRoot = !!root && part?.id === root.id
  const partOverride = part ? entity.overrides?.[part.id] : undefined
  const t = entity.transform
  const merge = (key: string): CommitOptions => ({ merge: `${id}.${key}` })
  const setOverride = (script: string, key: string, value: ParamValue) =>
    updateEntity(
      id,
      (e) => {
        const existing = e.scripts.find((s) => s.script === script)
        const params = { ...existing?.params, [key]: value }
        return {
          scripts: existing
            ? e.scripts.map((s) => (s.script === script ? { ...s, params } : s))
            : [...e.scripts, { script, params }],
        }
      },
      merge(`override.${script}.${key}`),
    )
  const setPart = (patch: EntityOverride, key: string) =>
    updateEntity(
      id,
      (e) => {
        const current = e.overrides?.[part!.id] ?? {}
        const next: EntityOverride = { ...current }
        for (const [k, v] of Object.entries(patch)) {
          const old = (current as Record<string, unknown>)[k]
          ;(next as Record<string, unknown>)[k] = v && typeof v === 'object' && !Array.isArray(v) && old && typeof old === 'object' ? { ...old, ...v } : v
        }
        return { overrides: { ...e.overrides, [part!.id]: next } }
      },
      merge(`part.${part!.id}.${key}`),
    )
  const setComponent = <K extends ComponentKey>(key: K, patch: Patch<K>, field: string) => setPart({ [key]: patch } as EntityOverride, `${key}.${field}`)
  /** Removes a component on this instance only: drops an added one, or hides the prefab's (null). */
  const removePartComponent = (key: ComponentKey) => {
    const added = partOverride?.added ?? []
    if (added.includes(key)) setPart({ [key]: undefined, added: added.filter((k) => k !== key) } as EntityOverride, `remove.${key}`)
    else setPart({ [key]: null } as EntityOverride, `remove.${key}`)
  }
  /** Adds a component on this instance only (or brings back one of the prefab's that was removed here). */
  const addPartComponent = (key: ComponentKey) => {
    if (part?.[key] && partOverride?.[key] === null) setPart({ [key]: undefined } as EntityOverride, `add.${key}`)
    else setPart({ [key]: defaultComponent(key, merged ?? part!), added: [...(partOverride?.added ?? []), key] } as EntityOverride, `add.${key}`)
  }
  const revertPart = () =>
    updateEntity(id, (e) => {
      const rest = { ...e.overrides }
      delete rest[part!.id]
      return { overrides: Object.keys(rest).length ? rest : undefined }
    })
  const revertAll = () => updateEntity(id, { scripts: [], overrides: undefined })
  const overriddenParts = Object.keys(entity.overrides ?? {}).length
  // What this part looks like with the overrides applied; the root shows the instance's own transform.
  const merged = part ? applyOverride(part, partOverride, isRoot) : undefined
  const rootPart = parts.find((p) => p.id === root?.id)

  return (
    <>
      <div className="entity-header">
        <input type="checkbox" checked={entity.active} onChange={(e) => updateEntity(id, { active: e.target.checked })} title="Active" aria-label="Active" />
        <TextInput className="entity-name" value={entity.name} onChange={(name) => name && updateEntity(id, { name })} />
      </div>
      <Section title={`Prefab: ${prefab?.name ?? 'missing'}`} icon={<Icon name="prefab" className="icon-prefab" />}>
        {prefab ? (
          <div className="button-row">
            <button
              type="button"
              onClick={() => {
                openPrefab(prefab.id)
                requestAnimationFrame(() => sceneView.focusSelection())
              }}
            >
              Open prefab
            </button>
            <button type="button" onClick={() => unpackPrefab(id)} title="Replace with plain, editable copies">
              Unpack
            </button>
            {(entity.scripts.length > 0 || overriddenParts > 0) && (
              <button type="button" onClick={revertAll} title="Go back to exactly what the prefab says">
                Revert all
              </button>
            )}
          </div>
        ) : (
          <p className="error-text">This prefab was deleted.</p>
        )}
      </Section>
      <Section title="Transform" icon={<Icon name="move" />}>
        <Vec3Field label="Position" value={t.position} onChange={(position) => updateEntity(id, { transform: { ...t, position } }, merge('pos'))} />
        <Vec3Field label="Rotation" value={t.rotation} step={1} onChange={(rotation) => updateEntity(id, { transform: { ...t, rotation } }, merge('rot'))} />
        <Vec3Field label="Scale" value={t.scale} step={0.05} onChange={(scale) => updateEntity(id, { transform: { ...t, scale } }, merge('scale'))} />
      </Section>
      {rootPart?.scripts.map((ref) => {
        const behavior = resolveBehavior(ref.script, doc)
        if (behavior instanceof Error) return null
        const override = entity.scripts.find((s) => s.script === ref.script)?.params ?? {}
        return (
          <Section key={ref.script} title={`${scriptLabel(ref.script, doc)} (overrides)`} icon={<Icon name="script" />}>
            <ParamFields
              params={behavior.params}
              values={{ ...ref.params, ...override }}
              overridden={override}
              onChange={(key, value) => setOverride(ref.script, key, value)}
            />
          </Section>
        )
      })}
      {merged && part && (
        <>
          <div className="override-bar">
            <SelectField
              label="Override part"
              value={part.id}
              options={parts.map((p) => [p.id, `${p.id === root?.id ? 'Root' : p.name}${entity.overrides?.[p.id] ? ' •' : ''}`] as const)}
              onChange={setPartId}
            />
            {partOverride && (
              <Row label="">
                <button type="button" onClick={revertPart}>
                  Revert this part
                </button>
              </Row>
            )}
          </div>
          {!isRoot && (
            <Section title={`${merged.name}${partOverride?.transform || partOverride?.active !== undefined ? ' •' : ''}`} icon={<Icon name="move" />}>
              <CheckField label="Active" value={merged.active} onChange={(active) => setPart({ active }, 'active')} />
              <Vec3Field label="Position" value={merged.transform.position} onChange={(position) => setPart({ transform: { ...merged.transform, position } }, 'pos')} />
              <Vec3Field label="Rotation" value={merged.transform.rotation} step={1} onChange={(rotation) => setPart({ transform: { ...merged.transform, rotation } }, 'rot')} />
              <Vec3Field label="Scale" value={merged.transform.scale} step={0.05} onChange={(scale) => setPart({ transform: { ...merged.transform, scale } }, 'scale')} />
            </Section>
          )}
          <div className="override-sections">
            <ComponentSections entity={merged} doc={doc} setComponent={setComponent} removeComponent={removePartComponent} />
          </div>
          <div className="add-component">
            <select
              value=""
              onChange={(e) => {
                if (e.target.value) addPartComponent(e.target.value as ComponentKey)
              }}
              aria-label="Add component to this part"
            >
              <option value="">Add Component to this instance…</option>
              {(Object.keys(COMPONENT_LABELS) as ComponentKey[])
                .filter((k) => !merged[k])
                .map((k) => (
                  <option key={k} value={k}>
                    {COMPONENT_LABELS[k]}
                  </option>
                ))}
            </select>
          </div>
          {partOverride && (
            <p className="hint">
              Overridden here:{' '}
              {Object.entries(partOverride)
                .filter(([key, value]) => key !== 'added' && value !== undefined)
                .map(([key, value]) => (value === null ? `${key} (removed)` : partOverride.added?.includes(key as ComponentKey) ? `${key} (added)` : key))
                .join(', ')}
              . Everything else follows the prefab.
            </p>
          )}
        </>
      )}
    </>
  )
}

/** Inspector fields for script params; types are inferred from the defaults. */
export function ParamFields({
  params,
  values,
  overridden,
  onChange,
}: {
  params: Record<string, ParamValue>
  values: Record<string, ParamValue>
  overridden?: Record<string, ParamValue>
  onChange: (key: string, value: ParamValue) => void
}) {
  return (
    <>
      {Object.entries(params).map(([key, fallback]) => {
        const value = key in values ? values[key] : fallback
        const label = `${key.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase())}${overridden && key in overridden ? ' •' : ''}`
        if (typeof fallback === 'number')
          return <NumberField key={key} label={label} value={Number(value)} step={Math.abs(fallback) >= 10 ? 1 : 0.05} onChange={(v) => onChange(key, v)} />
        if (typeof fallback === 'boolean') return <CheckField key={key} label={label} value={Boolean(value)} onChange={(v) => onChange(key, v)} />
        if (/^#[0-9a-f]{6}$/i.test(fallback)) return <ColorField key={key} label={label} value={String(value)} onChange={(v) => onChange(key, v)} />
        return <TextField key={key} label={label} value={String(value)} onChange={(v) => onChange(key, v)} />
      })}
    </>
  )
}

export function EntityInspector({ entity, doc }: { entity: EntityDoc; doc: ProjectDoc }) {
  const id = entity.id
  // Multi-edit: every selected plain entity (prefab instances have their own inspector).
  const selection = useStore(editorStore, (s) => s.selection)
  const ids = selection.includes(id) ? selection : [id]
  const merge = (key: string): CommitOptions => ({ merge: `${id}.${key}` })
  const setComponent = <K extends ComponentKey>(key: K, patch: Patch<K>, field: string) =>
    updateEntities(ids, (e) => (e[key] && !e.prefab ? ({ [key]: { ...e[key], ...patch } } as Partial<EntityDoc>) : {}), merge(`${key}.${field}`))
  const removeComponent = (key: ComponentKey) => updateEntities(ids, (e) => (e.prefab ? {} : { [key]: undefined }))
  /** Sets only the axes that changed, so editing X on several objects keeps each one's Y and Z. */
  const setVec = (field: 'position' | 'rotation' | 'scale', next: Vec3, key: string) => {
    const changed = [0, 1, 2].filter((i) => next[i] !== entity.transform[field][i])
    updateEntities(
      ids,
      (e) => ({ transform: { ...e.transform, [field]: e.transform[field].map((v, i) => (changed.includes(i) ? next[i] : v)) as Vec3 } }),
      merge(key),
    )
  }
  const t = entity.transform

  const addable = (Object.keys(COMPONENT_LABELS) as ComponentKey[]).filter((k) => !entity[k])
  const scripts: [string, string][] = [
    ...Object.keys(BUILTINS).map((key) => [key, scriptLabel(key, doc)] as [string, string]),
    ...doc.scripts.map((s) => [s.id, s.name] as [string, string]),
  ]

  return (
    <>
      <div className="entity-header">
        <input
          type="checkbox"
          checked={entity.active}
          onChange={(e) => {
            const active = e.target.checked
            updateEntities(ids, () => ({ active }))
          }}
          title="Active"
          aria-label="Active"
        />
        <TextInput className="entity-name" value={entity.name} onChange={(name) => name && updateEntity(id, { name })} />
      </div>

      <Section title="Transform" icon={<Icon name="move" />}>
        <Vec3Field label="Position" value={t.position} onChange={(position) => setVec('position', position, 'pos')} />
        <Vec3Field label="Rotation" value={t.rotation} step={1} onChange={(rotation) => setVec('rotation', rotation, 'rot')} />
        <Vec3Field label="Scale" value={t.scale} step={0.05} onChange={(scale) => setVec('scale', scale, 'scale')} />
      </Section>

      <ComponentSections entity={entity} doc={doc} setComponent={setComponent} removeComponent={removeComponent} />
      {entity.scripts.map((ref, index) => (
        <ScriptSection key={`${index}:${ref.script}`} entity={entity} index={index} scriptRef={ref} doc={doc} options={scripts} />
      ))}

      <div className="add-component">
        <select
          value=""
          onChange={(e) => {
            const value = e.target.value
            if (!value) return
            if (value.startsWith('script:')) {
              updateEntities(ids, (en) => (en.prefab ? {} : { scripts: [...en.scripts, { script: value.slice(7), params: {} }] }))
            } else {
              const key = value as ComponentKey
              updateEntities(ids, (en) => (en[key] || en.prefab ? {} : { [key]: key === 'collider' ? defaultCollider(en) : componentDefaults[key]() }))
            }
          }}
          aria-label="Add component"
        >
          <option value="">Add Component…</option>
          <optgroup label="Components">
            {addable.map((k) => (
              <option key={k} value={k}>
                {COMPONENT_LABELS[k]}
              </option>
            ))}
          </optgroup>
          <optgroup label="Scripts">
            {scripts.map(([value, label]) => (
              <option key={value} value={`script:${value}`}>
                {label}
              </option>
            ))}
          </optgroup>
        </select>
      </div>
    </>
  )
}
