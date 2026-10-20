import { COMPONENT_LABELS, type ComponentKey, type EntityDoc, type ProjectDoc } from '../../document'
import { CheckField, ColorField, NumberField, Row, Section, SelectField, Vec3Field } from '../fields'
import { Icon } from '../icons'
import { AnimStatesEditor } from './AnimStatesEditor'
import { ParticlesSection } from './ParticlesSection'
import { AssetSelect, ClipSelect, PreviewButton, TextureField } from './assetFields'
import { ColliderHandlesToggle, JointSection, TerrainSection } from './sections'

export type Patch<K extends keyof EntityDoc> = Partial<NonNullable<EntityDoc[K]>>

export function ComponentSections({
  entity,
  doc,
  setComponent,
  removeComponent,
}: {
  entity: EntityDoc
  doc: ProjectDoc
  setComponent: <K extends ComponentKey>(key: K, patch: Patch<K>, field: string) => void
  removeComponent?: (key: ComponentKey) => void
}) {
  return (
    <>
      {entity.mesh && (
        <Section title={COMPONENT_LABELS.mesh} icon={<Icon name="cube" />} onRemove={removeComponent && (() => removeComponent('mesh'))}>
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
        <Section title={COMPONENT_LABELS.model} icon={<Icon name="model" />} onRemove={removeComponent && (() => removeComponent('model'))}>
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

      {entity.sprite && (
        <Section title={COMPONENT_LABELS.sprite} icon={<Icon name="sprite" />} onRemove={removeComponent && (() => removeComponent('sprite'))}>
          <AssetSelect kind="texture" label="Texture" value={entity.sprite.texture} onChange={(texture) => setComponent('sprite', { texture }, 'tex')} />
          <ColorField label="Color" value={entity.sprite.color} onChange={(color) => setComponent('sprite', { color }, 'color')} />
          <NumberField label="Width" value={entity.sprite.size[0]} step={0.05} min={0.01} onChange={(w) => setComponent('sprite', { size: [w, entity.sprite!.size[1]] }, 'w')} />
          <NumberField label="Height" value={entity.sprite.size[1]} step={0.05} min={0.01} onChange={(h) => setComponent('sprite', { size: [entity.sprite!.size[0], h] }, 'h')} />
          <CheckField label="Flip X" value={entity.sprite.flipX} onChange={(flipX) => setComponent('sprite', { flipX }, 'flip')} />
          <CheckField label="Pixel art" value={entity.sprite.pixelArt} onChange={(pixelArt) => setComponent('sprite', { pixelArt }, 'pixel')} />
          {entity.sprite.texture && (
            <>
              <NumberField label="Sheet columns" value={entity.sprite.sheetColumns} step={1} min={1} onChange={(v) => setComponent('sprite', { sheetColumns: Math.max(1, Math.round(v)) }, 'cols')} />
              <NumberField label="Sheet rows" value={entity.sprite.sheetRows} step={1} min={1} onChange={(v) => setComponent('sprite', { sheetRows: Math.max(1, Math.round(v)) }, 'rows')} />
              <NumberField label="Frame" value={entity.sprite.frame} step={1} min={0} onChange={(v) => setComponent('sprite', { frame: Math.max(0, Math.round(v)) }, 'frame')} />
              <NumberField label="FPS (0 = still)" value={entity.sprite.fps} step={1} min={0} onChange={(fps) => setComponent('sprite', { fps }, 'fps')} />
            </>
          )}
          <NumberField label="Order" value={entity.sprite.order} step={1} onChange={(order) => setComponent('sprite', { order: Math.round(order) }, 'order')} />
          <p className="hint">Faces +Z (the 2D view looks at it head on). Higher order draws in front. Scripts: ctx.sprite.</p>
        </Section>
      )}

      {entity.light && (
        <Section title={COMPONENT_LABELS.light} icon={<Icon name="light" />} onRemove={removeComponent && (() => removeComponent('light'))}>
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
        <Section title={COMPONENT_LABELS.camera} icon={<Icon name="camera" />} onRemove={removeComponent && (() => removeComponent('camera'))}>
          <SelectField
            label="Projection"
            value={entity.camera.projection}
            options={[['perspective', 'Perspective'], ['orthographic', 'Orthographic (2D)']]}
            onChange={(projection) => setComponent('camera', { projection }, 'proj')}
          />
          {entity.camera.projection === 'orthographic' ? (
            <NumberField label="Size (half height)" value={entity.camera.orthoSize} step={0.5} min={0.1} onChange={(orthoSize) => setComponent('camera', { orthoSize }, 'osize')} />
          ) : (
            <NumberField label="Field of view" value={entity.camera.fov} step={1} min={1} max={170} onChange={(fov) => setComponent('camera', { fov }, 'fov')} />
          )}
          <NumberField label="Near" value={entity.camera.near} step={0.01} min={0.001} onChange={(near) => setComponent('camera', { near }, 'near')} />
          <NumberField label="Far" value={entity.camera.far} step={10} min={1} onChange={(far) => setComponent('camera', { far }, 'far')} />
          <CheckField label="Main camera" value={entity.camera.main} onChange={(main) => setComponent('camera', { main }, 'main')} />
        </Section>
      )}

      {entity.audio && (
        <Section title={COMPONENT_LABELS.audio} icon={<Icon name="audio" className="icon-audio" />} onRemove={removeComponent && (() => removeComponent('audio'))}>
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
        <ParticlesSection particles={entity.particles} set={(patch, field) => setComponent('particles', patch, field)} onRemove={removeComponent && (() => removeComponent('particles'))} />
      )}

      {entity.rigidBody && (
        <Section title={COMPONENT_LABELS.rigidBody} icon={<Icon name="body" />} onRemove={removeComponent && (() => removeComponent('rigidBody'))}>
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
          <CheckField label="2D (XY plane)" value={entity.rigidBody.planar} onChange={(planar) => setComponent('rigidBody', { planar }, 'planar')} />
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
        <Section title={COMPONENT_LABELS.collider} icon={<Icon name="collider" />} onRemove={removeComponent && (() => removeComponent('collider'))}>
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

      {entity.terrain && (
        <TerrainSection terrain={entity.terrain} set={(patch, field) => setComponent('terrain', patch, field)} onRemove={removeComponent && (() => removeComponent('terrain'))} />
      )}

      {entity.joint && (
        <JointSection entity={entity} set={(patch, field) => setComponent('joint', patch, field)} onRemove={removeComponent && (() => removeComponent('joint'))} />
      )}

    </>
  )
}
