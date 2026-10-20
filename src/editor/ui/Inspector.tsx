import { useEffect, useMemo, useState } from 'react'
import { useStore } from '../../react'
import type { AssetKind } from '../assetLibrary'
import {
  COMPONENT_LABELS,
  type ComponentKey,
  componentDefaults,
  defaultCollider,
  type EntityDoc,
  type ParamValue,
  type JointDoc,
  type ParticlesDoc,
  prefabRoot,
  type ProjectDoc,
  type ScriptRefDoc,
  type SceneSettings,
  type Vec3,
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
  updateEntities,
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
import type { AnimStateDef, AnimTransitionDef } from '../runtime/animator'
import { modelClips } from '../runtime/nodes'
import { Icon } from './icons'
import { LiveInspector } from './LiveInspector'

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
      {playing && primary && (
        <div className="panel-body live-panel">
          <LiveInspector key={primary} docId={primary} />
        </div>
      )}
      <fieldset className="panel-body" disabled={playing}>
        {selection.length > 1 && (
          <p className="hint multi">
            {selection.length} objects selected. Edits apply to every selected object that has the field; the values shown are the last
            one's.
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
  const setNav = (patch: Partial<SceneSettings['navigation']>, key: string) => set({ navigation: { ...settings.navigation, ...patch } }, `nav.${key}`)
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
      <Section title="Sky & Lighting" icon={<Icon name="light" />}>
        <SelectField
          label="Sky"
          value={settings.sky}
          options={[['color', 'Background color'], ['gradient', 'Gradient'], ['texture', '360° image']]}
          onChange={(sky) => set({ sky }, 'sky')}
        />
        {settings.sky === 'gradient' && (
          <>
            <ColorField label="Top" value={settings.skyTop} onChange={(v) => set({ skyTop: v }, 'st')} />
            <ColorField label="Horizon" value={settings.skyHorizon} onChange={(v) => set({ skyHorizon: v }, 'sh')} />
            <ColorField label="Bottom" value={settings.skyBottom} onChange={(v) => set({ skyBottom: v }, 'sb')} />
          </>
        )}
        {settings.sky === 'texture' && <TextureField value={settings.skyTexture} onChange={(v) => set({ skyTexture: v }, 'stex')} />}
        <CheckField label="Sky lighting" value={settings.environment} onChange={(v) => set({ environment: v }, 'env')} />
        {settings.environment && (
          <NumberField label="Sky light intensity" value={settings.environmentIntensity} step={0.05} min={0} onChange={(v) => set({ environmentIntensity: v }, 'envi')} />
        )}
        <SelectField
          label="Shadows"
          value={settings.shadows}
          options={[['off', 'Off'], ['low', 'Low (hard)'], ['medium', 'Medium'], ['high', 'High']]}
          onChange={(shadows) => set({ shadows }, 'shadows')}
        />
        <p className="hint">Sky lighting reflects the sky on metallic and smooth surfaces. 360° images should be 2:1 panoramas.</p>
      </Section>
      <Section title="Post-processing" icon={<Icon name="eye" />}>
        <NumberField label="Exposure" value={settings.exposure} step={0.05} min={0} onChange={(v) => set({ exposure: v }, 'exp')} />
        <CheckField label="Bloom" value={settings.bloom} onChange={(v) => set({ bloom: v }, 'bloom')} />
        {settings.bloom && (
          <>
            <NumberField label="Bloom strength" value={settings.bloomStrength} step={0.05} min={0} onChange={(v) => set({ bloomStrength: v }, 'bs')} />
            <NumberField label="Bloom radius" value={settings.bloomRadius} step={0.05} min={0} max={1} onChange={(v) => set({ bloomRadius: v }, 'br')} />
            <NumberField label="Bloom threshold" value={settings.bloomThreshold} step={0.05} min={0} onChange={(v) => set({ bloomThreshold: v }, 'bt')} />
          </>
        )}
        <NumberField label="Vignette" value={settings.vignette} step={0.05} min={0} max={1} onChange={(v) => set({ vignette: v }, 'vig')} />
        <NumberField label="Saturation" value={settings.saturation} step={0.05} min={0} onChange={(v) => set({ saturation: v }, 'sat')} />
        <NumberField label="Contrast" value={settings.contrast} step={0.05} min={0} onChange={(v) => set({ contrast: v }, 'con')} />
        <p className="hint">Bloom makes bright and emissive surfaces glow. Lower the threshold for more glow.</p>
      </Section>
      <Section title="Physics" icon={<Icon name="body" />}>
        <NumberField label="Gravity" value={settings.gravity} step={0.5} onChange={(v) => set({ gravity: v }, 'g')} />
      </Section>
      <Section title="Navigation" icon={<Icon name="move" />} defaultOpen={false}>
        <NumberField label="Cell size" value={settings.navigation.cellSize} step={0.05} min={0.1} onChange={(v) => setNav({ cellSize: v }, 'cell')} />
        <NumberField label="Agent radius" value={settings.navigation.agentRadius} step={0.05} min={0} onChange={(v) => setNav({ agentRadius: v }, 'radius')} />
        <NumberField label="Agent height" value={settings.navigation.agentHeight} step={0.05} min={0.1} onChange={(v) => setNav({ agentHeight: v }, 'height')} />
        <NumberField label="Max step" value={settings.navigation.maxStep} step={0.05} min={0} onChange={(v) => setNav({ maxStep: v }, 'step')} />
        <NumberField label="Max slope (°)" value={settings.navigation.maxSlope} step={1} min={0} max={89} onChange={(v) => setNav({ maxSlope: v }, 'slope')} />
        <p className="hint">
          Pathfinding (ctx.nav, Chase, Wander) uses a grid baked from static colliders when a script first asks for a path. Turn on
          Colliders while playing to see the walkable cells.
        </p>
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
          <AssetSelect kind="texture" label="Normal map" value={entity.mesh.normalMap} onChange={(normalMap) => setComponent('mesh', { normalMap }, 'nmap')} />
          {entity.mesh.normalMap && (
            <NumberField label="Normal strength" value={entity.mesh.normalScale} step={0.05} onChange={(normalScale) => setComponent('mesh', { normalScale }, 'ns')} />
          )}
          <AssetSelect kind="texture" label="Roughness map" value={entity.mesh.roughnessMap} onChange={(roughnessMap) => setComponent('mesh', { roughnessMap }, 'rmap')} />
          <AssetSelect kind="texture" label="Metalness map" value={entity.mesh.metalnessMap} onChange={(metalnessMap) => setComponent('mesh', { metalnessMap }, 'mmap')} />
          <AssetSelect kind="texture" label="Emissive map" value={entity.mesh.emissiveMap} onChange={(emissiveMap) => setComponent('mesh', { emissiveMap }, 'emap')} />
          {(entity.mesh.map || entity.mesh.normalMap || entity.mesh.roughnessMap || entity.mesh.metalnessMap || entity.mesh.emissiveMap) && (
            <>
              <NumberField label="Tiling U" value={entity.mesh.tiling[0]} step={0.1} min={0.01} onChange={(u) => setComponent('mesh', { tiling: [u, entity.mesh!.tiling[1]] }, 'tu')} />
              <NumberField label="Tiling V" value={entity.mesh.tiling[1]} step={0.1} min={0.01} onChange={(v) => setComponent('mesh', { tiling: [entity.mesh!.tiling[0], v] }, 'tv')} />
            </>
          )}
          <NumberField label="Opacity" value={entity.mesh.opacity} step={0.05} min={0} max={1} onChange={(opacity) => setComponent('mesh', { opacity }, 'op')} />
          <CheckField label="Double sided" value={entity.mesh.doubleSided} onChange={(doubleSided) => setComponent('mesh', { doubleSided }, 'ds')} />
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
          {entity.model.animStates.length === 0 && (
            <ClipSelect asset={entity.model.asset} value={entity.model.animation} onChange={(animation) => setComponent('model', { animation }, 'anim')} />
          )}
          {entity.model.animStates.length === 0 && entity.model.animation && (
            <>
              <NumberField label="Speed" value={entity.model.animationSpeed} step={0.05} min={0} onChange={(animationSpeed) => setComponent('model', { animationSpeed }, 'aspeed')} />
              <CheckField label="Loop" value={entity.model.animationLoop} onChange={(animationLoop) => setComponent('model', { animationLoop }, 'aloop')} />
            </>
          )}
          <CheckField label="Cast shadow" value={entity.model.castShadow} onChange={(castShadow) => setComponent('model', { castShadow }, 'cs')} />
          <CheckField label="Receive shadow" value={entity.model.receiveShadow} onChange={(receiveShadow) => setComponent('model', { receiveShadow }, 'rs')} />
          {entity.model.lods.map((level, index) => {
            const setLevel = (patch: Partial<typeof level>, field: string) =>
              setComponent('model', { lods: entity.model!.lods.map((l, i) => (i === index ? { ...l, ...patch } : l)) }, `lod${index}.${field}`)
            return (
              <div key={index} className="lod-level">
                <AssetSelect kind="model" label={`LOD ${index + 1}`} value={level.asset} onChange={(asset) => setLevel({ asset }, 'asset')} />
                <NumberField label="Beyond (m)" value={level.distance} step={1} min={0} onChange={(distance) => setLevel({ distance }, 'dist')} />
                <Row label="">
                  <button type="button" onClick={() => setComponent('model', { lods: entity.model!.lods.filter((_, i) => i !== index) }, 'lodrm')}>
                    Remove LOD {index + 1}
                  </button>
                </Row>
              </div>
            )
          })}
          {entity.model.lods.length < 4 && (
            <Row label="">
              <button
                type="button"
                onClick={() => {
                  const last = entity.model!.lods.at(-1)?.distance ?? 0
                  setComponent('model', { lods: [...entity.model!.lods, { asset: null, distance: last + 25 }] }, 'lodadd')
                }}
              >
                Add LOD level
              </button>
            </Row>
          )}
          <AnimStatesEditor
            asset={entity.model.asset}
            states={entity.model.animStates}
            transitions={entity.model.animTransitions}
            onChange={(patch, field) => setComponent('model', patch, field)}
          />
          <NumberField label="Cull distance (0 = off)" value={entity.model.cullDistance} step={5} min={0} onChange={(cullDistance) => setComponent('model', { cullDistance }, 'cull')} />
          {entity.model.lods.length > 0 && <p className="hint">LOD levels swap in simpler models with distance. Animations play on the full model only.</p>}
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

      {entity.particles && (
        <ParticlesSection particles={entity.particles} set={(patch, field) => setComponent('particles', patch, field)} onRemove={() => removeComponent('particles')} />
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
            options={[
              ['box', 'Box'], ['sphere', 'Sphere'], ['capsule', 'Capsule'], ['cylinder', 'Cylinder'],
              ['mesh', 'Mesh (exact)'], ['convex', 'Convex hull'],
            ]}
            onChange={(shape) => setComponent('collider', { shape }, 'shape')}
          />
          {(entity.collider.shape === 'mesh' || entity.collider.shape === 'convex') && (
            <p className="hint">
              Built from this entity's Mesh Renderer or Model.
              {entity.collider.shape === 'mesh' && ' Exact surface for static and kinematic objects; dynamic bodies use the convex hull.'}
            </p>
          )}
          <SelectField
            label="Layer"
            value={String(entity.collider.layer)}
            options={doc.settings.layerNames.map((name, i) => [String(i), name] as const)}
            onChange={(layer) => setComponent('collider', { layer: Number(layer) }, 'layer')}
          />
          {entity.collider.shape === 'box' && (
            <Vec3Field label="Size" value={entity.collider.size} step={0.05} onChange={(size) => setComponent('collider', { size }, 'size')} />
          )}
          {entity.collider.shape !== 'box' && entity.collider.shape !== 'mesh' && entity.collider.shape !== 'convex' && (
            <NumberField label="Radius" value={entity.collider.radius} step={0.05} min={0} onChange={(radius) => setComponent('collider', { radius }, 'radius')} />
          )}
          {(entity.collider.shape === 'capsule' || entity.collider.shape === 'cylinder') && (
            <NumberField label="Height" value={entity.collider.height} step={0.05} min={0} onChange={(height) => setComponent('collider', { height }, 'height')} />
          )}
          <Vec3Field label="Center" value={entity.collider.center} step={0.05} onChange={(center) => setComponent('collider', { center }, 'center')} />
          <NumberField label="Friction" value={entity.collider.friction} step={0.05} min={0} onChange={(friction) => setComponent('collider', { friction }, 'fric')} />
          <CheckField label="Is trigger" value={entity.collider.trigger} onChange={(trigger) => setComponent('collider', { trigger }, 'trig')} />
          {entity.collider.shape !== 'mesh' && entity.collider.shape !== 'convex' && <ColliderHandlesToggle />}
          <p className="hint">Sizes are multiplied by the transform scale.</p>
        </Section>
      )}

      {entity.joint && (
        <JointSection entity={entity} set={(patch, field) => setComponent('joint', patch, field)} onRemove={() => removeComponent('joint')} />
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

function JointSection({
  entity,
  set,
  onRemove,
}: {
  entity: EntityDoc
  set: (patch: Partial<JointDoc>, field: string) => void
  onRemove: () => void
}) {
  const j = entity.joint!
  const doc = useStore(editorStore, (s) => s.doc)
  const editing = useStore(editorStore, (s) => s.editing)
  const bodies = useMemo(
    () => targetEntities(doc, editing).filter((e) => e.rigidBody && e.id !== entity.id),
    [doc, editing, entity.id],
  )
  const unit = j.type === 'hinge' ? '°' : 'm'
  return (
    <Section title={COMPONENT_LABELS.joint} icon={<Icon name="joint" />} onRemove={onRemove}>
      <SelectField
        label="Type"
        value={j.type}
        options={[['hinge', 'Hinge'], ['ball', 'Ball'], ['fixed', 'Fixed'], ['slider', 'Slider'], ['spring', 'Spring']]}
        onChange={(type) => set({ type }, 'type')}
      />
      <SelectField
        label="Connected to"
        value={j.target ?? ''}
        options={[['', 'The world'], ...bodies.map((e) => [e.id, e.name] as const), ...(j.target && !bodies.some((e) => e.id === j.target) ? [[j.target, 'Missing body'] as const] : [])]}
        onChange={(target) => set({ target: target || null }, 'target')}
      />
      <Vec3Field label="Anchor" value={j.anchor} step={0.05} onChange={(anchor) => set({ anchor }, 'anchor')} />
      {(j.type === 'hinge' || j.type === 'slider') && (
        <>
          <Vec3Field label="Axis" value={j.axis} step={0.1} onChange={(axis) => set({ axis }, 'axis')} />
          <CheckField label="Limits" value={j.limits} onChange={(limits) => set({ limits }, 'limits')} />
          {j.limits && (
            <>
              <NumberField label={`Min (${unit})`} value={j.min} step={j.type === 'hinge' ? 5 : 0.1} onChange={(min) => set({ min }, 'min')} />
              <NumberField label={`Max (${unit})`} value={j.max} step={j.type === 'hinge' ? 5 : 0.1} onChange={(max) => set({ max }, 'max')} />
            </>
          )}
          <NumberField label={`Motor speed (${unit}/s)`} value={j.motorSpeed} step={j.type === 'hinge' ? 10 : 0.1} onChange={(motorSpeed) => set({ motorSpeed }, 'ms')} />
          <NumberField label="Motor strength" value={j.motorStrength} step={1} min={0} onChange={(motorStrength) => set({ motorStrength }, 'mf')} />
        </>
      )}
      {j.type === 'spring' && (
        <>
          <NumberField label="Rest length (-1 = start)" value={j.restLength} step={0.1} min={-1} onChange={(restLength) => set({ restLength }, 'rest')} />
          <NumberField label="Stiffness" value={j.stiffness} step={1} min={0} onChange={(stiffness) => set({ stiffness }, 'stiff')} />
          <NumberField label="Damping" value={j.damping} step={0.1} min={0} onChange={(damping) => set({ damping }, 'damp')} />
        </>
      )}
      <p className="hint">
        {!entity.rigidBody
          ? 'Needs a Rigid Body on this entity.'
          : j.type === 'hinge'
            ? 'Rotates around the axis through the anchor (doors, wheels, pendulums).'
            : j.type === 'slider'
              ? 'Moves along the axis only (elevators, pistons).'
              : j.type === 'ball'
                ? 'Swings freely around the anchor (chains, ragdoll joints).'
                : j.type === 'spring'
                  ? 'Pulled toward the connected body, or back to its start when connected to the world.'
                  : 'Holds the two bodies together rigidly.'}{' '}
        The anchor is relative to this entity.
      </p>
    </Section>
  )
}

function ColliderHandlesToggle() {
  const on = useStore(editorStore, (s) => s.colliderHandles)
  return <CheckField label="Edit in Scene view" value={on} onChange={(colliderHandles) => editorStore.set({ colliderHandles })} />
}

/** States and transitions of a model's animation state machine. */
function AnimStatesEditor({
  asset,
  states,
  transitions,
  onChange,
}: {
  asset: string | null
  states: AnimStateDef[]
  transitions: AnimTransitionDef[]
  onChange: (patch: { animStates?: AnimStateDef[]; animTransitions?: AnimTransitionDef[] }, field: string) => void
}) {
  const clips = useStore(modelClips, (s) => (asset ? s[asset] : undefined)) ?? []
  const clipOptions = (value: string) => [['', 'None'] as const, ...clips.map((c) => [c, c] as const), ...(value && !clips.includes(value) ? [[value, value] as const] : [])]
  const setState = (i: number, patch: Partial<AnimStateDef>, key: string) => {
    const old = states[i]
    const next = states.map((st, k) => (k === i ? { ...st, ...patch } : st))
    // Renaming a state keeps its transitions pointing at it.
    const renamed = patch.name !== undefined && patch.name !== old.name
    onChange(
      renamed
        ? {
            animStates: next,
            animTransitions: transitions.map((t) => ({ ...t, from: t.from === old.name ? patch.name! : t.from, to: t.to === old.name ? patch.name! : t.to })),
          }
        : { animStates: next },
      `state${i}.${key}`,
    )
  }
  const setTransition = (i: number, patch: Partial<AnimTransitionDef>, key: string) =>
    onChange({ animTransitions: transitions.map((t, k) => (k === i ? { ...t, ...patch } : t)) }, `transition${i}.${key}`)
  const stateOptions = states.map((st) => [st.name, st.name] as const)

  if (states.length === 0) {
    return (
      <Row label="">
        <button
          type="button"
          onClick={() => onChange({ animStates: [{ name: 'Idle', clip: clips[0] ?? '', blendParam: '', blend: [], speed: 1, loop: true }] }, 'states.add')}
        >
          Use a state machine
        </button>
      </Row>
    )
  }
  return (
    <div className="anim-machine">
      <div className="subhead">Animation states (first one starts)</div>
      {states.map((st, i) => (
        <div key={i} className="anim-state">
          <TextField label="State" value={st.name} onChange={(name) => name && setState(i, { name }, 'name')} />
          <CheckField label="Blend by parameter" value={st.blendParam !== ''} onChange={(on) => setState(i, { blendParam: on ? 'speed' : '', blend: on && !st.blend.length ? [{ clip: st.clip, at: 0 }] : st.blend }, 'blendOn')} />
          {st.blendParam === '' ? (
            <SelectField label="Clip" value={st.clip} options={clipOptions(st.clip)} onChange={(clip) => setState(i, { clip }, 'clip')} />
          ) : (
            <>
              <TextField label="Parameter" value={st.blendParam} onChange={(blendParam) => blendParam && setState(i, { blendParam }, 'param')} />
              {st.blend.map((b, k) => (
                <div key={k} className="blend-point">
                  <SelectField label={`Clip ${k + 1}`} value={b.clip} options={clipOptions(b.clip)} onChange={(clip) => setState(i, { blend: st.blend.map((x, j) => (j === k ? { ...x, clip } : x)) }, `blend${k}.clip`)} />
                  <NumberField label="At value" value={b.at} step={0.1} onChange={(at) => setState(i, { blend: st.blend.map((x, j) => (j === k ? { ...x, at } : x)) }, `blend${k}.at`)} />
                </div>
              ))}
              <Row label="">
                <button type="button" onClick={() => setState(i, { blend: [...st.blend, { clip: '', at: (st.blend.at(-1)?.at ?? 0) + 1 }] }, 'blend.add')}>
                  Add blend clip
                </button>
              </Row>
            </>
          )}
          <NumberField label="Speed" value={st.speed} step={0.05} min={0} onChange={(speed) => setState(i, { speed }, 'speed')} />
          <CheckField label="Loop" value={st.loop} onChange={(loop) => setState(i, { loop }, 'loop')} />
          <Row label="">
            <button
              type="button"
              onClick={() =>
                onChange(
                  { animStates: states.filter((_, k) => k !== i), animTransitions: transitions.filter((t) => t.from !== st.name && t.to !== st.name) },
                  'state.remove',
                )
              }
            >
              Remove state
            </button>
          </Row>
        </div>
      ))}
      <Row label="">
        <button type="button" onClick={() => onChange({ animStates: [...states, { name: `State ${states.length + 1}`, clip: '', blendParam: '', blend: [], speed: 1, loop: true }] }, 'state.add')}>
          Add state
        </button>
      </Row>
      <div className="subhead">Transitions (first match wins)</div>
      {transitions.map((t, i) => (
        <div key={i} className="anim-state">
          <SelectField label="From" value={t.from} options={[['*', 'Any state'], ...stateOptions]} onChange={(from) => setTransition(i, { from }, 'from')} />
          <SelectField label="To" value={t.to} options={stateOptions} onChange={(to) => setTransition(i, { to }, 'to')} />
          <TextField label="When" value={t.when} onChange={(when) => setTransition(i, { when }, 'when')} />
          <CheckField label="After clip ends" value={t.afterEnd} onChange={(afterEnd) => setTransition(i, { afterEnd }, 'end')} />
          <NumberField label="Fade (s)" value={t.fade} step={0.05} min={0} onChange={(fade) => setTransition(i, { fade }, 'fade')} />
          <Row label="">
            <button type="button" onClick={() => onChange({ animTransitions: transitions.filter((_, k) => k !== i) }, 'transition.remove')}>
              Remove transition
            </button>
          </Row>
        </div>
      ))}
      <Row label="">
        <button
          type="button"
          onClick={() => onChange({ animTransitions: [...transitions, { from: states[0].name, to: states[states.length - 1].name, when: '', fade: 0.2, afterEnd: false }] }, 'transition.add')}
        >
          Add transition
        </button>
      </Row>
      <p className="hint">
        Conditions read parameters set by scripts: <code>speed &gt; 0.1 &amp;&amp; grounded</code>, <code>!grounded</code>, or a trigger name
        like <code>jump</code> (ctx.animation.trigger). PlayerController sets speed, verticalSpeed and grounded.
      </p>
    </div>
  )
}

const CURVES = [
  ['linear', 'Linear'],
  ['easeIn', 'Ease in'],
  ['easeOut', 'Ease out'],
  ['smooth', 'Smooth'],
  ['bump', 'Up and back'],
] as const

function ParticlesSection({
  particles: p,
  set,
  onRemove,
}: {
  particles: ParticlesDoc
  set: (patch: Partial<ParticlesDoc>, field: string) => void
  onRemove: () => void
}) {
  return (
    <Section title={COMPONENT_LABELS.particles} icon={<Icon name="particles" />} onRemove={onRemove}>
      <SelectField
        label="Emit"
        value={p.trigger}
        options={[['none', 'On its own'], ['parentBirth', 'When parent particles spawn'], ['parentDeath', 'When parent particles die']]}
        onChange={(trigger) => set({ trigger }, 'trigger')}
      />
      {p.trigger === 'none' ? (
        <>
          <CheckField label="Play on start" value={p.playOnStart} onChange={(playOnStart) => set({ playOnStart }, 'pos')} />
          <NumberField label="Rate (/s)" value={p.rate} step={1} min={0} onChange={(rate) => set({ rate }, 'rate')} />
          <NumberField label="Rate (/meter)" value={p.rateOverDistance} step={1} min={0} onChange={(rateOverDistance) => set({ rateOverDistance }, 'rod')} />
        </>
      ) : (
        <p className="hint">Sub-emitter: emits its Burst count wherever a particle of the nearest parent entity's emitter spawns or dies. Keep World space on.</p>
      )}
      <NumberField label="Burst" value={p.burst} step={1} min={0} onChange={(burst) => set({ burst: Math.round(burst) }, 'burst')} />
      {p.trigger === 'none' && (
        <NumberField label="Duration (0 = ∞)" value={p.duration} step={0.1} min={0} onChange={(duration) => set({ duration }, 'dur')} />
      )}
      <NumberField label="Max particles" value={p.maxParticles} step={10} min={1} max={20000} onChange={(maxParticles) => set({ maxParticles: Math.round(maxParticles) }, 'max')} />
      <SelectField
        label="Shape"
        value={p.shape}
        options={[['point', 'Point'], ['sphere', 'Sphere'], ['box', 'Box']]}
        onChange={(shape) => set({ shape }, 'shape')}
      />
      {p.shape === 'sphere' && <NumberField label="Radius" value={p.radius} step={0.05} min={0} onChange={(radius) => set({ radius }, 'radius')} />}
      {p.shape === 'box' && <Vec3Field label="Box size" value={p.boxSize} step={0.05} onChange={(boxSize) => set({ boxSize }, 'box')} />}
      <NumberField label="Speed" value={p.speed} step={0.1} onChange={(speed) => set({ speed }, 'speed')} />
      <NumberField label="Spread (°)" value={p.spread} step={1} min={0} max={180} onChange={(spread) => set({ spread }, 'spread')} />
      <NumberField label="Lifetime" value={p.lifetime} step={0.05} min={0.01} onChange={(lifetime) => set({ lifetime }, 'life')} />
      <NumberField label="Randomness" value={p.randomness} step={0.05} min={0} max={1} onChange={(randomness) => set({ randomness }, 'rand')} />
      <NumberField label="Gravity" value={p.gravity} step={0.1} onChange={(gravity) => set({ gravity }, 'grav')} />
      <NumberField label="Drag" value={p.drag} step={0.05} min={0} onChange={(drag) => set({ drag }, 'drag')} />
      <NumberField label="Start size" value={p.startSize} step={0.01} min={0} onChange={(startSize) => set({ startSize }, 'ss')} />
      <NumberField label="End size" value={p.endSize} step={0.01} min={0} onChange={(endSize) => set({ endSize }, 'es')} />
      <SelectField label="Size curve" value={p.sizeCurve} options={CURVES} onChange={(sizeCurve) => set({ sizeCurve }, 'scurve')} />
      <ColorField label="Start color" value={p.startColor} onChange={(startColor) => set({ startColor }, 'sc')} />
      <ColorField label="End color" value={p.endColor} onChange={(endColor) => set({ endColor }, 'ec')} />
      <NumberField label="Start opacity" value={p.startOpacity} step={0.05} min={0} max={1} onChange={(startOpacity) => set({ startOpacity }, 'so')} />
      <NumberField label="End opacity" value={p.endOpacity} step={0.05} min={0} max={1} onChange={(endOpacity) => set({ endOpacity }, 'eo')} />
      <SelectField label="Opacity curve" value={p.opacityCurve} options={CURVES} onChange={(opacityCurve) => set({ opacityCurve }, 'ocurve')} />
      <NumberField label="Spin (°/s)" value={p.spin} step={5} onChange={(spin) => set({ spin }, 'spin')} />
      <SelectField
        label="Blending"
        value={p.blending}
        options={[['additive', 'Additive (glow)'], ['normal', 'Normal']]}
        onChange={(blending) => set({ blending }, 'blend')}
      />
      <TextureField value={p.texture} onChange={(texture) => set({ texture }, 'tex')} />
      {p.texture && (
        <>
          <NumberField label="Sheet columns" value={p.sheetColumns} step={1} min={1} onChange={(v) => set({ sheetColumns: Math.max(1, Math.round(v)) }, 'scol')} />
          <NumberField label="Sheet rows" value={p.sheetRows} step={1} min={1} onChange={(v) => set({ sheetRows: Math.max(1, Math.round(v)) }, 'srow')} />
          {p.sheetColumns * p.sheetRows > 1 && (
            <SelectField label="Sheet frames" value={p.sheetMode} options={[['life', 'Play over life'], ['random', 'Random frame']]} onChange={(sheetMode) => set({ sheetMode }, 'smode')} />
          )}
        </>
      )}
      <CheckField label="World space" value={p.worldSpace} onChange={(worldSpace) => set({ worldSpace }, 'ws')} />
      <CheckField label="Auto destroy" value={p.destroyWhenDone} onChange={(destroyWhenDone) => set({ destroyWhenDone }, 'dwd')} />
      <p className="hint">
        Emits along the entity's up axis. The Scene view previews the effect on a loop.
        {p.destroyWhenDone && ' In play mode the entity is destroyed once the effect ends: good for spawned one-shot effects.'}
      </p>
    </Section>
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

function ClipSelect({ asset, value, onChange }: { asset: string | null; value: string; onChange: (clip: string) => void }) {
  const clips = useStore(modelClips, (s) => (asset ? s[asset] : undefined))
  if (!clips?.length && !value) return null
  return (
    <SelectField
      label="Animation"
      value={value}
      options={[['', 'None'], ...(clips ?? []).map((c) => [c, c] as const), ...(value && !clips?.includes(value) ? [[value, value] as const] : [])]}
      onChange={onChange}
    />
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
