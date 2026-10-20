import { useEffect, useRef, useState } from 'react'
import type * as Monaco from 'monaco-editor'
import { useStore } from '../../react'
import { editorStore, updateScript } from '../editor'
import { compileScript } from '../scripting'

type MonacoModule = typeof Monaco

let monacoPromise: Promise<MonacoModule> | null = null
function loadMonaco(): Promise<MonacoModule> {
  monacoPromise ??= import('./monaco').then((m) => m.monaco)
  return monacoPromise
}

/**
 * Code editor for project scripts (Monaco, typed against the script API).
 * Ctrl/Cmd+S saves; saving while playing hot-reloads running instances.
 */
export function ScriptEditor() {
  const id = useStore(editorStore, (s) => s.openScript)
  const script = useStore(editorStore, (s) => s.doc.scripts.find((x) => x.id === s.openScript))
  const playing = useStore(editorStore, (s) => s.mode === 'play')
  const [draft, setDraft] = useState('')
  const [name, setName] = useState('')
  const [status, setStatus] = useState<{ error: boolean; text: string }>({ error: false, text: '' })
  const [loading, setLoading] = useState(true)
  const host = useRef<HTMLDivElement>(null)
  const editorRef = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null)
  const saveRef = useRef<() => void>(() => {})

  const save = () => {
    if (!script) return
    const cleanName = name.trim().replace(/[^\w]/g, '') || script.name
    const result = compileScript(cleanName, draft)
    setName(cleanName)
    updateScript(script.id, { source: draft, name: cleanName })
    setStatus(
      result instanceof Error
        ? { error: true, text: `Compile error: ${result.message}` }
        : { error: false, text: playing ? 'Saved and hot-reloaded.' : 'Saved.' },
    )
  }
  saveRef.current = save

  // Create Monaco once per opened script.
  useEffect(() => {
    if (!id || !script) return
    setDraft(script.source)
    setName(script.name)
    const initial = compileScript(script.name, script.source)
    setStatus(initial instanceof Error ? { error: true, text: `Compile error: ${initial.message}` } : { error: false, text: '' })

    let disposed = false
    let editor: Monaco.editor.IStandaloneCodeEditor | null = null
    let model: Monaco.editor.ITextModel | null = null
    setLoading(true)
    void loadMonaco().then((monaco) => {
      if (disposed || !host.current) return
      model = monaco.editor.createModel(script.source, 'javascript', monaco.Uri.parse(`file:///scripts/${script.id}.js`))
      editor = monaco.editor.create(host.current, {
        model,
        theme: 'engine-dark',
        automaticLayout: true,
        fontSize: 13,
        tabSize: 2,
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
        fixedOverflowWidgets: true,
        padding: { top: 10 },
      })
      editor.onDidChangeModelContent(() => setDraft(model!.getValue()))
      editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => saveRef.current())
      editor.focus()
      editorRef.current = editor
      setLoading(false)
    })
    return () => {
      disposed = true
      editor?.dispose()
      model?.dispose()
      editorRef.current = null
    }
    // Recreate only when a different script is opened, not on every save.
  }, [id])

  if (!id || !script) return null
  const dirty = draft !== script.source || name !== script.name

  const close = () => {
    if (dirty && !window.confirm('Discard unsaved changes?')) return
    editorStore.set({ openScript: null })
  }

  return (
    <div
      className="script-editor"
      role="dialog"
      aria-label={`Editing ${script.name}`}
      onKeyDown={(e) => {
        if (e.key === 'Escape') close()
        // Keep editor shortcuts (W/E/R, Delete...) from reaching the scene.
        e.stopPropagation()
      }}
    >
      <header>
        <input className="script-name" value={name} onChange={(e) => setName(e.target.value)} aria-label="Script name" />
        <span className="dim">.js {dirty && '• unsaved'}</span>
        <div className="spacer" />
        <button type="button" onClick={save} disabled={!dirty}>
          {playing ? 'Save & reload' : 'Save'}
        </button>
        <button type="button" onClick={close}>
          Close
        </button>
      </header>
      <div className="script-host" ref={host}>
        {loading && <p className="dim script-loading">Loading editor…</p>}
      </div>
      <footer className={status.error ? 'error-text' : 'dim'}>
        {status.text || 'Ctrl/Cmd+S to save. Hover for docs; Ctrl+Space for suggestions.'}
      </footer>
    </div>
  )
}
