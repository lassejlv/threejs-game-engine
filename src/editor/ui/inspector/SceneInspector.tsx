import { useStore } from '../../../react'
import { type SceneSettings } from '../../document'
import { editorStore, updateScene } from '../../editor'
import { CheckField, ColorField, NumberField, Section, SelectField } from '../fields'
import { Icon } from '../icons'
import { TextureField } from './assetFields'

export function SceneMusic({ settings, set }: { settings: SceneSettings; set: (patch: Partial<SceneSettings>, key: string) => void }) {
  const assets = useStore(editorStore, (s) => s.assets)
  const audio = assets.filter((a) => a.kind === 'audio')
  return (
    <Section title="Music" icon={<Icon name="audio" className="icon-audio" />}>
      <SelectField
        label="When the scene starts"
        value={settings.music}
        options={[
          ['', 'Keep current music'],
          ['stop', 'Stop music'],
          ...audio.map((a) => [a.id, `Play ${a.name}`] as const),
          ...(settings.music && settings.music !== 'stop' && !audio.some((a) => a.id === settings.music) ? [[settings.music, 'Missing asset'] as const] : []),
        ]}
        onChange={(music) => set({ music }, 'music')}
      />
      {settings.music !== '' && settings.music !== 'stop' && (
        <NumberField label="Music volume" value={settings.musicVolume} step={0.05} min={0} max={1} onChange={(musicVolume) => set({ musicVolume }, 'mv')} />
      )}
      <p className="hint">Music cross-fades between scenes and keeps playing when the next scene uses the same track. Scripts: ctx.music, ctx.volume.</p>
    </Section>
  )
}

export function SceneInspector({ sceneId, settings }: { sceneId: string; settings: SceneSettings }) {
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
      <SceneMusic settings={settings} set={set} />
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

/**
 * A prefab instance: its own transform, name and active flag, script parameter
 * overrides, and field overrides for any part of the prefab (marked with •).
 */
