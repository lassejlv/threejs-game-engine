import { useEffect, useState } from 'react'
import { useStore } from '../../react'
import { LAYER_COUNT, type ProjectSettings } from '../document'
import { editorStore, updateProject } from '../editor'
import { TextInput } from './fields'

type Tab = 'layers'

/** Project-wide settings (everything that isn't per scene or per entity). */
export function ProjectSettingsDialog({ onClose }: { onClose: () => void }) {
  const settings = useStore(editorStore, (s) => s.doc.settings)
  const [tab, setTab] = useState<Tab>('layers')

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
          <button type="button" className={tab === 'layers' ? 'active' : ''} onClick={() => setTab('layers')}>
            Physics Layers
          </button>
        </nav>
        <div className="dialog-body">{tab === 'layers' && <LayerSettings settings={settings} set={set} />}</div>
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
