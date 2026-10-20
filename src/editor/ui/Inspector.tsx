import { useEffect, useState } from 'react'
import { useStore } from '../../react'
import type { AssetKind } from '../assetLibrary'
import {
  COMPONENT_LABELS,
  type ComponentKey,
  componentDefaults,
  defaultCollider,
  type EntityDoc,
  type ParamValue,
  prefabRoot,
  type ProjectDoc,
  type ScriptRefDoc,
  type SceneSettings,
} from '../document'
import {
  assetLibrary,
  type CommitOptions,
  currentScene,
  editorStore,
  openPrefab,
  primarySelection,
  targetEntities,
  unpackPrefab,
  updateEntity,
  updateScene,
} from '../editor'
import { BUILTINS, resolveBehavior, scriptLabel } from '../scripting'
import {
  CheckField,
  ColorField,
  NumberField,
  Row,
  Section,
  SelectField,
  TextField,
  TextInput,
  Vec3Field,
} from './fields'
import { sceneView } from '../runtime/editScene'
import { Icon } from './icons'

type Patch<K extends keyof EntityDoc> = Partial<NonNullable<EntityDoc[K]>>

export function Inspector() {
  const selection = useStore(editorStore, (s) => s.selection)
  const primary = useStore(editorStore, (s) => primarySelection(s))
  const entity = useStore(editorStore, (s) => targetEntities(s.doc, s.editing).find((e) => e.id === primarySelection(s)))
  const doc = useStore(editorStore, (s) => s.doc)
  const editing = useStore(editorStore, (s) => s.editing)
  const scene = useStore(editorStore, (s) => currentScene(s))
  const playing = useStore(editorStore, (s) => s.mode === 'play')

  return (
    <aside className="panel inspector">
      <header className="panel-header">
        <span>Inspector</span>
        {playing && <span className="badge">Read-only while playing</span>}
      </header>
      <fieldset className="panel-body" disabled={playing}>
        {selection.length > 1 && (
          <p className="hint multi">
            {selection.length} objects selected. Gizmo edits apply to all; the fields below edit the last one.
          </p>
        )}
        {entity?.prefab ? (
          <InstanceInspector key={primary} entity={entity} doc={doc} />
        ) : entity ? (
          <EntityInspector key={primary} entity={entity} doc={doc} />
        ) : editing.kind === 'prefab' ? (
          <p className="hint">Editing a prefab. Changes apply to every instance. Select an object to edit it.</p>
        ) : (
          <SceneInspector key={scene.id} sceneId={scene.id} settings={scene.settings} />
        )}
      </fieldset>
    </aside>
  )
}

function SceneInspector({ sceneId, settings }: { sceneId: string; settings: SceneSettings }) {
  const set = (patch: Partial<SceneSettings>, key: string) =>
    updateScene(sceneId, { settings: { ...settings, ...patch } }, { merge: `settings.${sceneId}.${key}` })
  return (
    <>
      <p className="hint">Nothing selected. These settings apply to the whole scene.</p>
      <Section title="Environment" icon={<Icon name="settings" />}>
        <ColorField label="Background" value={settings.background} onChange={(v) => set({ background: v }, 'bg')} />
        <ColorField label="Ambient" value={settings.ambientColor} onChange={(v) => set({ ambientColor: v }, 'ac')} />
        <NumberField label="Ambient intensity" value={settings.ambientIntensity} step={0.05} min={0} onChange={(v) => set({ ambientIntensity: v }, 'ai')} />
        <CheckField label="Fog" value={settings.fog} onChange={(v) => set({ fog: v }, 'fog')} />
        {settings.fog && (
          <>
            <ColorField label="Fog color" value={settings.fogColor} onChange={(v) => set({ fogColor: v }, 'fc')} />
            <NumberField label="Fog near" value={settings.fogNear} step={1} min={0} onChange={(v) => set({ fogNear: v }, 'fn')} />
            <NumberField label="Fog far" value={settings.fogFar} step={1} min={0} onChange={(v) => set({ fogFar: v }, 'ff')} />
          </>
        )}
      </Section>
      <Section title="Physics" icon={<Icon name="body" />}>
        <NumberField label="Gravity" value={settings.gravity} step={0.5} onChange={(v) => set({ gravity: v }, 'g')} />
      </Section>
    </>
  )
}

/** A prefab instance: own transform, name and active flag, plus script parameter overrides. */
function InstanceInspector({ entity, doc }: { entity: EntityDoc; doc: ProjectDoc }) {
  const id = entity.id
  const prefab = doc.prefabs.find((p) => p.id === entity.prefab)
  const root = prefab && prefabRoot(prefab)
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
  const resetOverrides = () => updateEntity(id, { scripts: [] })

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
      {root?.scripts.map((ref) => {
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
      {entity.scripts.length > 0 && (
        <div className="add-component">
          <button type="button" onClick={resetOverrides}>
            Revert overrides
          </button>
        </div>
      )}
    </>
  )
}

/** Inspector fields for script params; types are inferred from the defaults. */
function ParamFields({
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

function EntityInspector({ entity, doc }: { entity: EntityDoc; doc: ProjectDoc }) {
  const id = entity.id
  const merge = (key: string): CommitOptions => ({ merge: `${id}.${key}` })
  const setComponent = <K extends ComponentKey>(key: K, patch: Patch<K>, field: string) =>
    updateEntity(id, (e) => ({ [key]: { ...e[key], ...patch } }) as Partial<EntityDoc>, merge(`${key}.${field}`))
  const removeComponent = (key: ComponentKey) => updateEntity(id, { [key]: undefined })
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
          onChange={(e) => updateEntity(id, { active: e.target.checked })}
          title="Active"
          aria-label="Active"
        />
        <TextInput className="entity-name" value={entity.name} onChange={(name) => name && updateEntity(id, { name })} />
      </div>

      <Section title="Transform" icon={<Icon name="move" />}>
        <Vec3Field label="Position" value={t.position} onChange={(position) => updateEntity(id, { transform: { ...t, position } }, merge('pos'))} />
        <Vec3Field label="Rotation" value={t.rotation} step={1} onChange={(rotation) => updateEntity(id, { transform: { ...t, rotation } }, merge('rot'))} />
        <Vec3Field label="Scale" value={t.scale} step={0.05} onChange={(scale) => updateEntity(id, { transform: { ...t, scale } }, merge('scale'))} />
      </Section>

      {entity.mesh && (
        <Section title={COMPONENT_LABELS.mesh} icon={<Icon name="cube" />} onRemove={() => removeComponent('mesh')}>
          <SelectField
            label="Shape"
            value={entity.mesh.shape}
            options={[
              ['box', 'Cube'], ['sphere', 'Sphere'], ['cylinder', 'Cylinder'], ['capsule', 'Capsule'],
              ['plane', 'Plane'], ['cone', 'Cone'], ['torus', 'Torus'],
            ]}
            onChange={(shape) => setComponent('mesh', { shape }, 'shape')}
          />
          <ColorField label="Color" value={entity.mesh.color} onChange={(color) => setComponent('mesh', { color }, 'color')} />
          <TextureField value={entity.mesh.map} onChange={(map) => setComponent('mesh', { map }, 'map')} />
          <NumberField label="Metalness" value={entity.mesh.metalness} step={0.01} min={0} max={1} onChange={(metalness) => setComponent('mesh', { metalness }, 'metal')} />
          <NumberField label="Roughness" value={entity.mesh.roughness} step={0.01} min={0} max={1} onChange={(roughness) => setComponent('mesh', { roughness }, 'rough')} />
          <ColorField label="Emissive" value={entity.mesh.emissive} onChange={(emissive) => setComponent('mesh', { emissive }, 'em')} />
          <NumberField label="Emissive intensity" value={entity.mesh.emissiveIntensity} step={0.05} min={0} onChange={(emissiveIntensity) => setComponent('mesh', { emissiveIntensity }, 'emi')} />
          <CheckField label="Cast shadow" value={entity.mesh.castShadow} onChange={(castShadow) => setComponent('mesh', { castShadow }, 'cs')} />
          <CheckField label="Receive shadow" value={entity.mesh.receiveShadow} onChange={(receiveShadow) => setComponent('mesh', { receiveShadow }, 'rs')} />
        </Section>
      )}

      {entity.model && (
        <Section title={COMPONENT_LABELS.model} icon={<Icon name="model" />} onRemove={() => removeComponent('model')}>
          <AssetSelect kind="model" label="Asset" value={entity.model.asset} onChange={(asset) => setComponent('model', { asset }, 'asset')} />
          <CheckField label="Cast shadow" value={entity.model.castShadow} onChange={(castShadow) => setComponent('model', { castShadow }, 'cs')} />
          <CheckField label="Receive shadow" value={entity.model.receiveShadow} onChange={(receiveShadow) => setComponent('model', { receiveShadow }, 'rs')} />
        </Section>
      )}

      {entity.light && (
        <Section title={COMPONENT_LABELS.light} icon={<Icon name="light" />} onRemove={() => removeComponent('light')}>
          <SelectField
            label="Type"
            value={entity.light.type}
            options={[['directional', 'Directional'], ['point', 'Point'], ['spot', 'Spot'], ['hemisphere', 'Hemisphere']]}
            onChange={(type) => setComponent('light', { type }, 'type')}
          />
          <ColorField label={entity.light.type === 'hemisphere' ? 'Sky color' : 'Color'} value={entity.light.color} onChange={(color) => setComponent('light', { color }, 'color')} />
          {entity.light.type === 'hemisphere' && (
            <ColorField label="Ground color" value={entity.light.groundColor} onChange={(groundColor) => setComponent('light', { groundColor }, 'gc')} />
          )}
          <NumberField label="Intensity" value={entity.light.intensity} step={0.05} min={0} onChange={(intensity) => setComponent('light', { intensity }, 'int')} />
          {(entity.light.type === 'point' || entity.light.type === 'spot') && (
            <NumberField label="Range (0 = ∞)" value={entity.light.distance} step={0.5} min={0} onChange={(distance) => setComponent('light', { distance }, 'dist')} />
          )}
          {entity.light.type === 'spot' && (
            <NumberField label="Angle" value={entity.light.angle} step={1} min={1} max={89} onChange={(angle) => setComponent('light', { angle }, 'angle')} />
          )}
          {entity.light.type !== 'hemisphere' && (
            <CheckField label="Cast shadow" value={entity.light.castShadow} onChange={(castShadow) => setComponent('light', { castShadow }, 'cs')} />
          )}
          {entity.light.type === 'directional' && entity.light.castShadow && (
            <NumberField label="Shadow area" value={entity.light.shadowArea} step={1} min={1} onChange={(shadowArea) => setComponent('light', { shadowArea }, 'sa')} />
          )}
        </Section>
      )}

      {entity.camera && (
        <Section title={COMPONENT_LABELS.camera} icon={<Icon name="camera" />} onRemove={() => removeComponent('camera')}>
          <NumberField label="Field of view" value={entity.camera.fov} step={1} min={1} max={170} onChange={(fov) => setComponent('camera', { fov }, 'fov')} />
          <NumberField label="Near" value={entity.camera.near} step={0.01} min={0.001} onChange={(near) => setComponent('camera', { near }, 'near')} />
          <NumberField label="Far" value={entity.camera.far} step={10} min={1} onChange={(far) => setComponent('camera', { far }, 'far')} />
          <CheckField label="Main camera" value={entity.camera.main} onChange={(main) => setComponent('camera', { main }, 'main')} />
        </Section>
      )}

      {entity.audio && (
        <Section title={COMPONENT_LABELS.audio} icon={<Icon name="audio" className="icon-audio" />} onRemove={() => removeComponent('audio')}>
          <AssetSelect kind="audio" label="Clip" value={entity.audio.asset} onChange={(asset) => setComponent('audio', { asset }, 'asset')} />
          <NumberField label="Volume" value={entity.audio.volume} step={0.05} min={0} max={4} onChange={(volume) => setComponent('audio', { volume }, 'vol')} />
          <CheckField label="Loop" value={entity.audio.loop} onChange={(loop) => setComponent('audio', { loop }, 'loop')} />
          <CheckField label="Play on start" value={entity.audio.playOnStart} onChange={(playOnStart) => setComponent('audio', { playOnStart }, 'pos')} />
          <CheckField label="3D (spatial)" value={entity.audio.spatial} onChange={(spatial) => setComponent('audio', { spatial }, 'spatial')} />
          {entity.audio.spatial && (
            <NumberField label="Ref distance" value={entity.audio.refDistance} step={0.5} min={0.1} onChange={(refDistance) => setComponent('audio', { refDistance }, 'ref')} />
          )}
          <Row label="">
            <PreviewButton asset={entity.audio.asset} volume={entity.audio.volume} />
          </Row>
        </Section>
      )}

      {entity.rigidBody && (
        <Section title={COMPONENT_LABELS.rigidBody} icon={<Icon name="body" />} onRemove={() => removeComponent('rigidBody')}>
          <SelectField
            label="Type"
            value={entity.rigidBody.type}
            options={[['dynamic', 'Dynamic'], ['kinematic', 'Kinematic'], ['character', 'Character']]}
            onChange={(type) => setComponent('rigidBody', { type }, 'type')}
          />
          {entity.rigidBody.type === 'dynamic' && (
            <>
              <NumberField label="Mass (0 = auto)" value={entity.rigidBody.mass} step={0.1} min={0} onChange={(mass) => setComponent('rigidBody', { mass }, 'mass')} />
              <CheckField label="Lock rotation" value={entity.rigidBody.lockRotation} onChange={(lockRotation) => setComponent('rigidBody', { lockRotation }, 'lock')} />
              <NumberField label="Damping" value={entity.rigidBody.damping} step={0.05} min={0} onChange={(damping) => setComponent('rigidBody', { damping }, 'damp')} />
              <NumberField label="Bounciness" value={entity.rigidBody.restitution} step={0.05} min={0} max={1} onChange={(restitution) => setComponent('rigidBody', { restitution }, 'rest')} />
            </>
          )}
          {entity.rigidBody.type !== 'kinematic' && (
            <NumberField label="Gravity scale" value={entity.rigidBody.gravityScale} step={0.05} onChange={(gravityScale) => setComponent('rigidBody', { gravityScale }, 'gs')} />
          )}
          <p className="hint">
            {entity.rigidBody.type === 'character'
              ? 'Moved by setting velocity; climbs steps and slopes up to 50°. Pair with a capsule collider.'
              : entity.rigidBody.type === 'kinematic'
                ? 'Moved by scripts (position or velocity); pushes dynamic bodies but is never pushed.'
                : 'Simulated by physics. Needs a collider.'}
            {entity.parent && ' Detached from its parent in play mode.'}
          </p>
        </Section>
      )}

      {entity.collider && (
        <Section title={COMPONENT_LABELS.collider} icon={<Icon name="collider" />} onRemove={() => removeComponent('collider')}>
          <SelectField
            label="Shape"
            value={entity.collider.shape}
            options={[['box', 'Box'], ['sphere', 'Sphere'], ['capsule', 'Capsule'], ['cylinder', 'Cylinder']]}
            onChange={(shape) => setComponent('collider', { shape }, 'shape')}
          />
          {entity.collider.shape === 'box' && (
            <Vec3Field label="Size" value={entity.collider.size} step={0.05} onChange={(size) => setComponent('collider', { size }, 'size')} />
          )}
          {entity.collider.shape !== 'box' && (
            <NumberField label="Radius" value={entity.collider.radius} step={0.05} min={0} onChange={(radius) => setComponent('collider', { radius }, 'radius')} />
          )}
          {(entity.collider.shape === 'capsule' || entity.collider.shape === 'cylinder') && (
            <NumberField label="Height" value={entity.collider.height} step={0.05} min={0} onChange={(height) => setComponent('collider', { height }, 'height')} />
          )}
          <Vec3Field label="Center" value={entity.collider.center} step={0.05} onChange={(center) => setComponent('collider', { center }, 'center')} />
          <NumberField label="Friction" value={entity.collider.friction} step={0.05} min={0} onChange={(friction) => setComponent('collider', { friction }, 'fric')} />
          <CheckField label="Is trigger" value={entity.collider.trigger} onChange={(trigger) => setComponent('collider', { trigger }, 'trig')} />
          <p className="hint">Sizes are multiplied by the transform scale.</p>
        </Section>
      )}

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
              updateEntity(id, (en) => ({ scripts: [...en.scripts, { script: value.slice(7), params: {} }] }))
            } else {
              const key = value as ComponentKey
              updateEntity(id, (en) => ({ [key]: key === 'collider' ? defaultCollider(en) : componentDefaults[key]() }))
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

function ScriptSection({
  entity,
  index,
  scriptRef,
  doc,
  options,
}: {
  entity: EntityDoc
  index: number
  scriptRef: ScriptRefDoc
  doc: ProjectDoc
  options: [string, string][]
}) {
  const behavior = resolveBehavior(scriptRef.script, doc)
  const update = (patch: Partial<ScriptRefDoc>, key: string) =>
    updateEntity(
      entity.id,
      (e) => ({ scripts: e.scripts.map((s, i) => (i === index ? { ...s, ...patch } : s)) }),
      { merge: `${entity.id}.script${index}.${key}` },
    )
  const remove = () => updateEntity(entity.id, (e) => ({ scripts: e.scripts.filter((_, i) => i !== index) }))
  const setParam = (key: string, value: ParamValue) => update({ params: { ...scriptRef.params, [key]: value } }, key)
  const isProjectScript = !scriptRef.script.startsWith('builtin:')

  return (
    <Section title={scriptLabel(scriptRef.script, doc)} icon={<Icon name="script" />} onRemove={remove}>
      <SelectField label="Script" value={scriptRef.script} options={options} onChange={(script) => update({ script, params: {} }, 'script')} />
      {behavior instanceof Error ? (
        <p className="error-text">{behavior.message}</p>
      ) : (
        <>
          {behavior.description && <p className="hint">{behavior.description}</p>}
          <ParamFields params={behavior.params} values={scriptRef.params} onChange={setParam} />
        </>
      )}
      {isProjectScript && (
        <Row label="">
          <button type="button" onClick={() => editorStore.set({ openScript: scriptRef.script })}>
            Edit script
          </button>
        </Row>
      )}
    </Section>
  )
}

/** Plays an audio asset in the editor (outside the game's audio graph). */
function PreviewButton({ asset, volume }: { asset: string | null; volume: number }) {
  const [audio, setAudio] = useState<HTMLAudioElement | null>(null)
  useEffect(() => () => audio?.pause(), [audio])
  const url = asset ? assetLibrary.url(asset) : null
  return (
    <button
      type="button"
      disabled={!url}
      onClick={() => {
        if (audio) {
          audio.pause()
          setAudio(null)
          return
        }
        const el = new Audio(url!)
        el.volume = Math.min(1, volume)
        el.onended = () => setAudio(null)
        void el.play()
        setAudio(el)
      }}
    >
      {audio ? 'Stop preview' : 'Preview'}
    </button>
  )
}

function AssetSelect({
  kind,
  label,
  value,
  onChange,
}: {
  kind: AssetKind
  label: string
  value: string | null
  onChange: (value: string | null) => void
}) {
  const assets = useStore(editorStore, (s) => s.assets)
  const options = assets.filter((a) => a.kind === kind)
  return (
    <Row label={label}>
      <select value={value ?? ''} onChange={(e) => onChange(e.target.value || null)}>
        <option value="">None</option>
        {options.map((a) => (
          <option key={a.id} value={a.id}>
            {a.name}
          </option>
        ))}
        {value && !options.some((a) => a.id === value) && <option value={value}>Missing asset</option>}
      </select>
    </Row>
  )
}

function TextureField({ value, onChange }: { value: string | null; onChange: (value: string | null) => void }) {
  return <AssetSelect kind="texture" label="Texture" value={value} onChange={onChange} />
}
