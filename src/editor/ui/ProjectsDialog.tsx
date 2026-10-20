import { useEffect, useState } from 'react'
import { useStore } from '../../react'
import { log } from '../console'
import { editorStore } from '../editor'
import { deleteProject, duplicateProject, openProject, refreshProjects } from '../projects'

/** Every project in the active store: open, duplicate or delete. */
export function ProjectsDialog({ onClose, onNew }: { onClose: () => void; onNew: () => void }) {
  const projects = useStore(editorStore, (s) => s.projects)
  const storage = useStore(editorStore, (s) => s.storage)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void refreshProjects()
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const run = async (fn: () => Promise<unknown>, close = false) => {
    setBusy(true)
    try {
      await fn()
      if (close) onClose()
    } catch (error) {
      log('error', error)
      window.alert(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog projects-dialog" role="dialog" aria-modal="true" aria-label="Projects">
        <header className="dialog-header">
          <span>Projects</span>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close">
            ×
          </button>
        </header>
        <div className="dialog-body">
          <p className="hint">
            Saved in {storage.label || 'browser storage'}.
            {storage.kind === 'browser' && ' Run the editor with Bun installed (npm run dev) to keep projects as folders on disk instead.'}
          </p>
          <ul className="project-list">
            {projects.map((p) => (
              <li key={p.id} className={p.id === storage.projectId ? 'current' : ''}>
                <button type="button" className="project-open" disabled={busy || p.id === storage.projectId} onClick={() => void run(() => openProject(p.id), true)}>
                  <span className="project-title">{p.name}</span>
                  <span className="project-meta">
                    {storage.kind === 'disk' ? `projects/${p.id}` : p.id} · {p.modified ? new Date(p.modified).toLocaleString() : 'never saved'}
                    {p.id === storage.projectId && ' · open'}
                  </span>
                </button>
                <button type="button" disabled={busy} onClick={() => void run(() => duplicateProject(p.id))}>
                  Duplicate
                </button>
                <button
                  type="button"
                  className="danger"
                  disabled={busy}
                  onClick={() => {
                    const where = storage.kind === 'disk' ? ' It moves to projects/.trash, so you can still recover it.' : ''
                    if (window.confirm(`Delete "${p.name}"?${where}`)) void run(() => deleteProject(p.id))
                  }}
                >
                  Delete
                </button>
              </li>
            ))}
          </ul>
          <button type="button" className="primary" onClick={onNew}>
            New project…
          </button>
        </div>
      </div>
    </div>
  )
}
