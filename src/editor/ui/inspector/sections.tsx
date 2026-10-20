import { useMemo } from 'react'
import { useStore } from '../../../react'
import { COMPONENT_LABELS, type EntityDoc, decodeHeights, encodeHeights, generateHills, type JointDoc, type TerrainDoc } from '../../document'
import { editorStore, targetEntities } from '../../editor'
import { CheckField, ColorField, NumberField, Row, Section, SelectField, Vec3Field } from '../fields'
import { sampleHeight } from '../../runtime/terrain'
import { Icon } from '../icons'
import { AssetSelect } from './assetFields'

export function JointSection({
  entity,
  set,
  onRemove,
}: {
  entity: EntityDoc
  set: (patch: Partial<JointDoc>, field: string) => void
  onRemove?: () => void
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

export function TerrainSection({ terrain: t, set, onRemove }: { terrain: TerrainDoc; set: (patch: Partial<TerrainDoc>, field: string) => void; onRemove?: () => void }) {
  const tool = useStore(editorStore, (s) => s.terrainTool)
  const radius = useStore(editorStore, (s) => s.brushRadius)
  const strength = useStore(editorStore, (s) => s.brushStrength)
  const tools = [
    ['raise', 'Raise'],
    ['lower', 'Lower'],
    ['smooth', 'Smooth'],
    ['flatten', 'Flatten'],
  ] as const
  const resample = (resolution: number) => {
    const n = Math.max(9, Math.min(257, Math.round(resolution)))
    if (n === t.resolution) return
    const old = decodeHeights(t.heights, t.resolution)
    const next = new Float32Array(n * n)
    for (let z = 0; z < n; z++) {
      for (let x = 0; x < n; x++) {
        next[z * n + x] = sampleHeight(t, old, (x / (n - 1) - 0.5) * t.size[0], (z / (n - 1) - 0.5) * t.size[1])
      }
    }
    set({ resolution: n, heights: encodeHeights(next) }, 'res')
  }
  return (
    <Section title={COMPONENT_LABELS.terrain} icon={<Icon name="terrain" />} onRemove={onRemove}>
      <Row label="Sculpt">
        <div className="button-row">
          {tools.map(([id, label]) => (
            <button key={id} type="button" className={tool === id ? 'active' : ''} aria-pressed={tool === id} onClick={() => editorStore.set({ terrainTool: tool === id ? null : id })}>
              {label}
            </button>
          ))}
        </div>
      </Row>
      {tool && (
        <>
          <NumberField label="Brush radius" value={radius} step={0.25} min={0.25} onChange={(brushRadius) => editorStore.set({ brushRadius })} />
          <NumberField label="Brush strength" value={strength} step={0.05} min={0.01} max={2} onChange={(brushStrength) => editorStore.set({ brushStrength })} />
          <p className="hint">Drag on the terrain in the Scene view. Each stroke is one undo step. Click the tool again to stop sculpting.</p>
        </>
      )}
      <NumberField label="Width" value={t.size[0]} step={1} min={1} onChange={(w) => set({ size: [w, t.size[1]] }, 'w')} />
      <NumberField label="Depth" value={t.size[1]} step={1} min={1} onChange={(d) => set({ size: [t.size[0], d] }, 'd')} />
      <NumberField label="Resolution" value={t.resolution} step={8} min={9} max={257} onChange={resample} />
      <ColorField label="Ground color" value={t.color} onChange={(color) => set({ color }, 'color')} />
      <ColorField label="Slope color" value={t.slopeColor} onChange={(slopeColor) => set({ slopeColor }, 'slope')} />
      <NumberField label="Slope angle (°)" value={t.slopeAngle} step={1} min={1} max={89} onChange={(slopeAngle) => set({ slopeAngle }, 'angle')} />
      <AssetSelect kind="texture" label="Texture" value={t.texture} onChange={(texture) => set({ texture }, 'tex')} />
      {t.texture && <NumberField label="Tiling" value={t.tiling} step={1} min={1} onChange={(tiling) => set({ tiling }, 'tiling')} />}
      <Row label="">
        <div className="button-row">
          <button type="button" onClick={() => set({ heights: encodeHeights(generateHills(t.resolution, t.size, 4, Math.floor(Math.random() * 1e9))) }, 'hills')}>
            New hills
          </button>
          <button type="button" onClick={() => set({ heights: encodeHeights(new Float32Array(t.resolution * t.resolution)) }, 'flat')}>
            Flatten all
          </button>
        </div>
      </Row>
      <p className="hint">Collides as a static heightfield in play (unless the entity has its own Collider); pathfinding walks on it.</p>
    </Section>
  )
}

export function ColliderHandlesToggle() {
  const on = useStore(editorStore, (s) => s.colliderHandles)
  return <CheckField label="Edit in Scene view" value={on} onChange={(colliderHandles) => editorStore.set({ colliderHandles })} />
}

/** States and transitions of a model's animation state machine. */
