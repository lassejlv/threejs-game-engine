import { type ProjectDoc, type UiElementDoc } from '../../document'
import { deleteUiElement, updateUiElement } from '../../editor'
import { ColorField, NumberField, Section, SelectField, TextField, TextInput } from '../fields'
import { Icon } from '../icons'
import { AssetSelect } from './assetFields'

export function UiElementInspector({ element: el, doc }: { element: UiElementDoc; doc: ProjectDoc }) {
  const set = (patch: Partial<UiElementDoc>, key: string) => updateUiElement(el.id, patch, { merge: `ui.${el.id}.${key}`, label: `UI ${el.name}: ${key}` })
  const sceneNames = doc.scenes.map((s) => [s.name, s.name] as const)
  return (
    <>
      <div className="entity-header">
        <input type="checkbox" checked={el.visible} onChange={(e) => set({ visible: e.target.checked }, 'visible')} title="Visible" aria-label="Visible" />
        <TextInput className="entity-name" value={el.name} onChange={(name) => name && set({ name }, 'name')} />
      </div>
      <Section title={`Screen UI: ${el.type}`} icon={<Icon name="ui" className="icon-ui" />} onRemove={() => deleteUiElement(el.id)}>
        <SelectField
          label="Anchor"
          value={el.anchor}
          options={[
            ['top-left', 'Top left'], ['top', 'Top'], ['top-right', 'Top right'],
            ['left', 'Left'], ['center', 'Center'], ['right', 'Right'],
            ['bottom-left', 'Bottom left'], ['bottom', 'Bottom'], ['bottom-right', 'Bottom right'],
          ]}
          onChange={(anchor) => set({ anchor }, 'anchor')}
        />
        <NumberField label="X offset (px)" value={el.x} step={1} onChange={(x) => set({ x }, 'x')} />
        <NumberField label="Y offset (px)" value={el.y} step={1} onChange={(y) => set({ y }, 'y')} />
        {el.type !== 'image' && (
          <TextField label={el.type === 'bar' ? 'Label' : el.type === 'button' ? 'Label' : 'Text'} value={el.text} onChange={(text) => set({ text }, 'text')} />
        )}
        {el.type === 'bar' && (
          <>
            <TextField label="Value" value={el.value} onChange={(value) => set({ value }, 'value')} />
            <ColorField label="Fill" value={el.fill} onChange={(fill) => set({ fill }, 'fill')} />
          </>
        )}
        {el.type === 'image' && <AssetSelect kind="texture" label="Image" value={el.image} onChange={(image) => set({ image }, 'image')} />}
        {el.type !== 'image' && (
          <>
            <NumberField label="Font size" value={el.size} step={1} min={6} onChange={(size) => set({ size }, 'size')} />
            <ColorField label="Color" value={el.color} onChange={(color) => set({ color }, 'color')} />
            <SelectField
              label="Background"
              value={el.background === '' ? 'card' : el.background === 'none' ? 'none' : 'custom'}
              options={[['card', 'Card'], ['none', 'None'], ['custom', 'Color']]}
              onChange={(v) => set({ background: v === 'card' ? '' : v === 'none' ? 'none' : '#1c2027' }, 'bg')}
            />
            {el.background !== '' && el.background !== 'none' && <ColorField label="Card color" value={el.background} onChange={(background) => set({ background }, 'bgc')} />}
          </>
        )}
        <NumberField label="Width (0 = auto)" value={el.width} step={4} min={0} onChange={(width) => set({ width }, 'width')} />
        {el.type === 'button' && (
          <>
            <SelectField
              label="On click"
              value={el.action}
              options={[['none', 'Nothing'], ['loadScene', 'Load scene'], ['emit', 'Send event']]}
              onChange={(action) => set({ action }, 'action')}
            />
            {el.action === 'loadScene' && (
              <SelectField label="Scene" value={el.target} options={[['', 'Choose…'], ...sceneNames]} onChange={(target) => set({ target }, 'target')} />
            )}
            {el.action === 'emit' && <TextField label="Event name" value={el.target} onChange={(target) => set({ target }, 'target')} />}
          </>
        )}
        <p className="hint">
          Drag it in the Game view (Shift snaps to 10 px). <code>{'{key}'}</code> in text shows <code>ctx.globals[key]</code> live
          {el.type === 'bar' && '; Value can be a number, a key, or key/key'}. Scripts can change it with <code>ctx.ui.text('{el.name}', …)</code>
          {el.type === 'button' && el.action === 'emit' && ' and hear clicks with ctx.on(event)'}.
        </p>
      </Section>
    </>
  )
}
