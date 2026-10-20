import { useStore } from '../../react'
import { editorStore } from '../editor'
import { hudStore } from '../runtime/playSession'

/** Values written by scripts through `ctx.hud`. Only shown in play mode. */
export function PlayHud() {
  const playing = useStore(editorStore, (s) => s.mode === 'play')
  const values = useStore(hudStore, (s) => s.values)
  const message = useStore(hudStore, (s) => s.message)
  if (!playing) return null
  const entries = Object.entries(values)
  return (
    <div className="play-hud">
      {entries.length > 0 && (
        <div className="play-hud-values">
          {entries.map(([key, value]) => (
            <div key={key} className="hud-card">
              <span className="hud-label">{key}</span>
              <span className="hud-value">{value}</span>
            </div>
          ))}
        </div>
      )}
      {message && <div className="hud-banner">{message}</div>}
    </div>
  )
}
