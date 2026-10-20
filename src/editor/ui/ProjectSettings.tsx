import { useEffect, useState } from 'react'
import { useStore } from '../../react'
import { defaultInputActions, defaultInputAxes, type InputActionDoc, type InputAxisDoc, LAYER_COUNT, type ProjectSettings } from '../document'
import { editorStore, updateProject } from '../editor'
import { TextInput } from './fields'

type Tab = 'input' | 'layers'

/** Project-wide settings (everything that isn't per scene or per entity). */
export function ProjectSettingsDialog({ onClose }: { onClose: () => void }) {
  const settings = useStore(editorStore, (s) => s.doc.settings)
  const [tab, setTab] = useState<Tab>('input')

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const set = (patch: Partial<ProjectSettings>, key: string) =>
    updateProject({ settings: { ...editorStore.get().doc.settings, ...patch } }, { merge: `project.settings.${key}` })

  return (
    <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog" role="dialog" aria-modal="true" aria-label="Project settings">
        <header className="dialog-header">
          <span>Project Settings</span>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close">
            ×
          </button>
        </header>
        <nav className="dialog-tabs">
          <button type="button" className={tab === 'input' ? 'active' : ''} onClick={() => setTab('input')}>
            Input
          </button>
          <button type="button" className={tab === 'layers' ? 'active' : ''} onClick={() => setTab('layers')}>
            Physics Layers
          </button>
        </nav>
        <div className="dialog-body">
          {tab === 'input' && <InputSettings settings={settings} set={set} />}
          {tab === 'layers' && <LayerSettings settings={settings} set={set} />}
        </div>
      </div>
    </div>
  )
}

function LayerSettings({ settings, set }: { settings: ProjectSettings; set: (patch: Partial<ProjectSettings>, key: string) => void }) {
  const { layerNames, layerCollisions } = settings
  const collides = (a: number, b: number) => (layerCollisions[a] & (1 << b)) !== 0
  const toggle = (a: number, b: number) => {
    const on = !collides(a, b)
    // Kept symmetric: Rapier only lets two colliders touch when each accepts the other.
    const next = layerCollisions.map((mask, i) => {
      const other = i === a ? b : i === b ? a : -1
      if (other < 0) return mask
      return on ? mask | (1 << other) : mask & ~(1 << other)
    })
    set({ layerCollisions: next }, `collide.${a}.${b}`)
  }
  const rename = (i: number, name: string) => set({ layerNames: layerNames.map((n, k) => (k === i ? name || `Layer ${i}` : n)) }, `name.${i}`)

  return (
    <>
      <p className="hint">
        Give each collider a layer in the Inspector. A checked box means the two layers collide; unchecked layers pass through each other
        and don't trigger each other.
      </p>
      <table className="layer-matrix">
        <thead>
          <tr>
            <th />
            {layerNames.map((name, j) => (
              <th key={j} className="layer-col" title={name}>
                <span>{name}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {layerNames.map((name, i) => (
            <tr key={i}>
              <th className="layer-row">
                <TextInput value={name} onChange={(v) => rename(i, v)} />
              </th>
              {Array.from({ length: LAYER_COUNT }, (_, j) => (
                <td key={j}>
                  {j <= i ? (
                    <input
                      type="checkbox"
                      checked={collides(i, j)}
                      onChange={() => toggle(i, j)}
                      aria-label={`${name} collides with ${layerNames[j]}`}
                      title={`${name} ↔ ${layerNames[j]}`}
                    />
                  ) : null}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </>
  )
}

const GAMEPAD_AXES: [string, string][] = [['-1', 'None'], ['0', 'Left stick X'], ['1', 'Left stick Y'], ['2', 'Right stick X'], ['3', 'Right stick Y']]

function InputSettings({ settings, set }: { settings: ProjectSettings; set: (patch: Partial<ProjectSettings>, key: string) => void }) {
  const { inputActions: actions, inputAxes: axes } = settings
  const setAction = (i: number, patch: Partial<InputActionDoc>) =>
    set({ inputActions: actions.map((a, k) => (k === i ? { ...a, ...patch } : a)) }, `action.${i}.${Object.keys(patch)[0]}`)
  const setAxis = (i: number, patch: Partial<InputAxisDoc>) =>
    set({ inputAxes: axes.map((a, k) => (k === i ? { ...a, ...patch } : a)) }, `axis.${i}.${Object.keys(patch)[0]}`)
  return (
    <>
      <p className="hint">
        Scripts read these by name: <code>ctx.input.action('Jump')</code>, <code>ctx.input.actionPressed('Fire')</code> and{' '}
        <code>ctx.input.getAxis('MoveX')</code>. The built-in scripts use the default names. Keys are{' '}
        <code>KeyboardEvent.code</code> values such as KeyW, Space, ArrowUp, Mouse0 or GamepadA.
      </p>
      <h3 className="dialog-subhead">Actions</h3>
      <table className="binding-table">
        <tbody>
          {actions.map((a, i) => (
            <tr key={i}>
              <td>
                <TextInput value={a.name} onChange={(name) => setAction(i, { name: name || a.name })} />
              </td>
              <td className="wide">
                <KeysField value={a.keys} onChange={(keys) => setAction(i, { keys })} />
              </td>
              <td>
                <button type="button" className="icon-button" onClick={() => set({ inputActions: actions.filter((_, k) => k !== i) }, 'action.remove')} aria-label={`Remove ${a.name}`}>
                  ×
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="button-row">
        <button type="button" onClick={() => set({ inputActions: [...actions, { name: `Action ${actions.length + 1}`, keys: [] }] }, 'action.add')}>
          Add action
        </button>
        <button type="button" onClick={() => set({ inputActions: defaultInputActions(), inputAxes: defaultInputAxes() }, 'input.reset')}>
          Reset to defaults
        </button>
      </div>
      <h3 className="dialog-subhead">Axes</h3>
      <table className="binding-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Negative keys</th>
            <th>Positive keys</th>
            <th>Gamepad</th>
            <th>Invert</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {axes.map((a, i) => (
            <tr key={i}>
              <td>
                <TextInput value={a.name} onChange={(name) => setAxis(i, { name: name || a.name })} />
              </td>
              <td>
                <KeysField value={a.negative} onChange={(negative) => setAxis(i, { negative })} />
              </td>
              <td>
                <KeysField value={a.positive} onChange={(positive) => setAxis(i, { positive })} />
              </td>
              <td>
                <select value={String(a.gamepadAxis)} onChange={(e) => setAxis(i, { gamepadAxis: Number(e.target.value) })}>
                  {GAMEPAD_AXES.map(([v, label]) => (
                    <option key={v} value={v}>
                      {label}
                    </option>
                  ))}
                </select>
              </td>
              <td>
                <input type="checkbox" checked={a.invert} onChange={(e) => setAxis(i, { invert: e.target.checked })} aria-label="Invert gamepad" />
              </td>
              <td>
                <button type="button" className="icon-button" onClick={() => set({ inputAxes: axes.filter((_, k) => k !== i) }, 'axis.remove')} aria-label={`Remove ${a.name}`}>
                  ×
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="button-row">
        <button
          type="button"
          onClick={() => set({ inputAxes: [...axes, { name: `Axis ${axes.length + 1}`, negative: [], positive: [], gamepadAxis: -1, invert: false }] }, 'axis.add')}
        >
          Add axis
        </button>
      </div>
    </>
  )
}

/** Comma-separated key codes, plus a button that records the next key or mouse button pressed. */
function KeysField({ value, onChange }: { value: string[]; onChange: (keys: string[]) => void }) {
  const [listening, setListening] = useState(false)
  useEffect(() => {
    if (!listening) return
    const add = (code: string) => {
      if (!value.includes(code)) onChange([...value, code])
      setListening(false)
    }
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault()
      e.stopPropagation()
      if (e.code !== 'Escape') add(e.code)
      else setListening(false)
    }
    const onMouse = (e: MouseEvent) => {
      if ((e.target as HTMLElement).closest('.record-key')) return
      e.preventDefault()
      add(`Mouse${e.button}`)
    }
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('mousedown', onMouse, true)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('mousedown', onMouse, true)
    }
  }, [listening, value, onChange])
  return (
    <div className="keys-field">
      <TextInput
        value={value.join(', ')}
        onChange={(text) =>
          onChange(
            text
              .split(',')
              .map((k) => k.trim())
              .filter(Boolean),
          )
        }
      />
      <button type="button" className={`record-key ${listening ? 'active' : ''}`} onClick={() => setListening(!listening)} title="Press a key or mouse button to add it">
        {listening ? 'Press…' : '+ Key'}
      </button>
    </div>
  )
}
