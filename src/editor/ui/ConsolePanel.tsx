import { useEffect, useRef } from 'react'
import { useStore } from '../../react'
import { clearConsole, consoleStore } from '../console'

export function ConsolePanel() {
  const entries = useStore(consoleStore, (s) => s.entries)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = listRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [entries])

  return (
    <div className="panel-body console">
      <div className="console-toolbar">
        <button type="button" onClick={clearConsole}>
          Clear
        </button>
        <span className="dim">Script output and errors appear here.</span>
      </div>
      <div className="console-list" ref={listRef} role="log">
        {entries.map((entry) => (
          <div key={entry.id} className={`log log-${entry.level}`}>
            <time>{new Date(entry.time).toLocaleTimeString()}</time>
            <pre>{entry.message}</pre>
            {entry.count > 1 && <span className="badge">{entry.count}</span>}
          </div>
        ))}
      </div>
    </div>
  )
}
