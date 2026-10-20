import { useEffect, useMemo, useState } from 'react'
import type { Engine } from '../../engine'
import { DebugOverlay, GameCanvas, useStore } from '../../react'
import {
  attachEngine,
  deleteEntity,
  duplicateEntity,
  editorStore,
  play,
  redo,
  select,
  stop,
  undo,
} from '../editor'
import { createEditScene, sceneView } from '../runtime/editScene'
import { createPlayScene } from '../runtime/playScene'
import { BottomPanel } from './ProjectPanel'
import { Hierarchy } from './Hierarchy'
import { Inspector } from './Inspector'
import { PlayHud } from './PlayHud'
import { ScriptEditor } from './ScriptEditor'
import { Toolbar } from './Toolbar'
import '../editor.css'

const editScene = createEditScene()

export function Editor() {
  const [engine, setEngine] = useState<Engine | null>(null)
  const mode = useStore(editorStore, (s) => s.mode)
  const playDoc = useStore(editorStore, (s) => s.playDoc)
  const scene = useMemo(() => (mode === 'play' && playDoc ? createPlayScene(playDoc) : editScene), [mode, playDoc])

  useShortcuts()

  return (
    <div className={`editor ${mode === 'play' ? 'is-playing' : ''}`}>
      <Toolbar engine={engine} />
      <Hierarchy />
      <main className="viewport">
        <GameCanvas
          style={{ position: 'absolute', inset: 0 }}
          scene={scene}
          onReady={(e) => {
            attachEngine(e)
            setEngine(e)
            if (import.meta.env.DEV) Object.assign(window, { __engine: e })
          }}
        >
          <PlayHud />
          <DebugOverlay />
        </GameCanvas>
        <ScriptEditor />
      </main>
      <Inspector />
      <BottomPanel />
    </div>
  )
}

function isTyping(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))
  )
}

function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target)) return
      const mod = e.metaKey || e.ctrlKey
      const state = editorStore.get()
      const key = e.key.toLowerCase()

      if (mod && key === 'p') {
        e.preventDefault()
        if (state.mode === 'play') stop()
        else play()
        return
      }
      if (state.mode === 'play') return

      if (mod && key === 'z') {
        e.preventDefault()
        if (e.shiftKey) redo()
        else undo()
      } else if (mod && key === 'y') {
        e.preventDefault()
        redo()
      } else if (mod && key === 'd') {
        e.preventDefault()
        if (state.selection) duplicateEntity(state.selection)
      } else if (mod) {
        return
      } else if (key === 'w') editorStore.set({ tool: 'translate' })
      else if (key === 'e') editorStore.set({ tool: 'rotate' })
      else if (key === 'r') editorStore.set({ tool: 'scale' })
      else if (key === 'f') sceneView.focusSelection()
      else if (key === 'escape') select(null)
      else if ((key === 'delete' || key === 'backspace') && state.selection) {
        e.preventDefault()
        deleteEntity(state.selection)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}
