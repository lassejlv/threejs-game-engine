import { useEffect, useState } from 'react'
import { useEngine, useEngineStats } from './hooks'

const TIME_SCALES = [0.25, 0.5, 1, 2]

export interface DebugOverlayProps {
  /** KeyboardEvent.code that toggles the panel. Default Backquote (`). */
  toggleKey?: string
  defaultOpen?: boolean
}

/** Stats, per-system timings and simulation controls. Stats refresh 4x/second, not per frame. */
export function DebugOverlay({ toggleKey = 'Backquote', defaultOpen = false }: DebugOverlayProps) {
  const engine = useEngine()
  const stats = useEngineStats()
  const [open, setOpen] = useState(defaultOpen)
  const [timeScale, setTimeScale] = useState(engine.time.scale)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === toggleKey) setOpen((v) => !v)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [toggleKey])

  useEffect(() => {
    engine.profiling = open
    return () => {
      engine.profiling = false
    }
  }, [engine, open])

  if (!open) {
    return (
      <button type="button" className="ge-debug-chip" onClick={() => setOpen(true)} title="Debug (`)">
        {stats.fps} fps
      </button>
    )
  }

  const systems = [...stats.systems].sort((a, b) => b.ms - a.ms)

  return (
    <div className="ge-debug">
      <header>
        <strong>Engine</strong>
        <button type="button" onClick={() => setOpen(false)} aria-label="Close debug panel">
          ×
        </button>
      </header>
      <dl>
        <dt>Renderer</dt>
        <dd>{engine.backendName}</dd>
        <dt>FPS</dt>
        <dd>{stats.fps}</dd>
        <dt>CPU</dt>
        <dd>{stats.frameMs.toFixed(2)} ms</dd>
        <dt>Draw calls</dt>
        <dd>{stats.drawCalls}</dd>
        <dt>Triangles</dt>
        <dd>{stats.triangles.toLocaleString()}</dd>
        <dt>Geometries</dt>
        <dd>{stats.geometries}</dd>
        <dt>Textures</dt>
        <dd>{stats.textures}</dd>
        <dt>Entities</dt>
        <dd>{stats.entities}</dd>
      </dl>
      <div className="ge-debug-controls">
        <button type="button" onClick={() => (engine.paused ? engine.resume() : engine.pause())}>
          {stats.paused ? 'Resume' : 'Pause'}
        </button>
        <button type="button" onClick={() => engine.step()} disabled={!stats.paused}>
          Step
        </button>
        <select
          value={timeScale}
          onChange={(e) => {
            const value = Number(e.target.value)
            engine.time.scale = value
            setTimeScale(value)
          }}
          aria-label="Time scale"
        >
          {TIME_SCALES.map((s) => (
            <option key={s} value={s}>
              {s}×
            </option>
          ))}
        </select>
      </div>
      {systems.length > 0 && (
        <table>
          <tbody>
            {systems.map((s) => (
              <tr key={`${s.phase}:${s.name}`}>
                <td>{s.name}</td>
                <td className="ge-dim">{s.phase}</td>
                <td>{s.ms.toFixed(3)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
