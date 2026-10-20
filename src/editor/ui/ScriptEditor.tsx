import { useEffect, useRef, useState } from 'react'
import { useStore } from '../../react'
import { editorStore, updateScript } from '../editor'
import { compileScript } from '../scripting'

/** Minimal code editor for project scripts. Ctrl/Cmd+S saves, Tab indents. */
export function ScriptEditor() {
  const id = useStore(editorStore, (s) => s.openScript)
  const script = useStore(editorStore, (s) => s.doc.scripts.find((x) => x.id === s.openScript))
  const playing = useStore(editorStore, (s) => s.mode === 'play')
  const [draft, setDraft] = useState('')
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const textarea = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (!script) return
    setDraft(script.source)
    setName(script.name)
    const result = compileScript(script.name, script.source)
    setError(result instanceof Error ? result.message : null)
    textarea.current?.focus()
    // Reset the draft only when a different script is opened, not on every save.
  }, [id])

  if (!id || !script) return null
  const dirty = draft !== script.source || name !== script.name

  const save = () => {
    const cleanName = name.trim().replace(/[^\w]/g, '') || script.name
    const result = compileScript(cleanName, draft)
    setError(result instanceof Error ? result.message : null)
    setName(cleanName)
    updateScript(script.id, { source: draft, name: cleanName })
  }
  const close = () => {
    if (dirty && !window.confirm('Discard unsaved changes?')) return
    editorStore.set({ openScript: null })
  }

  return (
    <div className="script-editor" role="dialog" aria-label={`Editing ${script.name}`}>
      <header>
        <input className="script-name" value={name} onChange={(e) => setName(e.target.value)} aria-label="Script name" />
        <span className="dim">.js {dirty && '• unsaved'}</span>
        <div className="spacer" />
        <button type="button" onClick={save} disabled={!dirty || playing}>
          Save
        </button>
        <button type="button" onClick={close}>
          Close
        </button>
      </header>
      <textarea
        ref={textarea}
        spellCheck={false}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === 's') {
            e.preventDefault()
            if (!playing) save()
          } else if (e.key === 'Tab') {
            e.preventDefault()
            const el = e.currentTarget
            const { selectionStart: start, selectionEnd: end } = el
            const next = `${draft.slice(0, start)}  ${draft.slice(end)}`
            setDraft(next)
            requestAnimationFrame(() => el.setSelectionRange(start + 2, start + 2))
          } else if (e.key === 'Escape') {
            close()
          }
          e.stopPropagation()
        }}
      />
      <footer className={error ? 'error-text' : 'dim'}>
        {error ? `Compile error: ${error}` : playing ? 'Stop play mode to save changes.' : 'Compiled OK. Ctrl/Cmd+S to save.'}
      </footer>
    </div>
  )
}
