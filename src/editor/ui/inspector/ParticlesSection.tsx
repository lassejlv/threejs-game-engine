import { COMPONENT_LABELS, type ParticlesDoc } from '../../document'
import { CheckField, ColorField, NumberField, Section, SelectField, Vec3Field } from '../fields'
import { Icon } from '../icons'
import { TextureField } from './assetFields'

export const CURVES = [
  ['linear', 'Linear'],
  ['easeIn', 'Ease in'],
  ['easeOut', 'Ease out'],
  ['smooth', 'Smooth'],
  ['bump', 'Up and back'],
] as const

export function ParticlesSection({
  particles: p,
  set,
  onRemove,
}: {
  particles: ParticlesDoc
  set: (patch: Partial<ParticlesDoc>, field: string) => void
  onRemove?: () => void
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

/** The Inspector sections of an entity's components. Without `removeComponent` they can't be removed (prefab overrides). */
