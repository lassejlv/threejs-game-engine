import { useEffect } from 'react'
import { type Template, TEMPLATES } from '../templates'

/** Picks a starter project. */
export function TemplateDialog({ onClose, onPick }: { onClose: () => void; onPick: (template: Template) => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog template-dialog" role="dialog" aria-modal="true" aria-label="New from template">
        <header className="dialog-header">
          <span>New from template</span>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close">
            ×
          </button>
        </header>
        <div className="dialog-body template-grid">
          {TEMPLATES.map((template) => (
            <button key={template.id} type="button" className="template-card" onClick={() => onPick(template)}>
              <span className="template-name">
                {template.name}
                <span className="template-tag">{template.view2D ? '2D' : '3D'}</span>
              </span>
              <span className="template-description">{template.description}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
