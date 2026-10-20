import { useEffect, useMemo, useState } from 'react'
import type { PerspectiveCamera } from 'three'
import type { Engine } from '../../engine'
import { DebugOverlay, GameCanvas, useStore } from '../../react'
import {
  assetLibrary,
  attachEngine,
  copySelection,
  deleteEntities,
  duplicateEntities,
  editorStore,
  pasteClipboard,
  play,
  redo,
  select,
  stop,
  switchPlayScene,
  undo,
} from '../editor'
import { editorCamera, getOrbit } from '../runtime/editorCamera'
import { createEditScene, sceneView } from '../runtime/editScene'
import { createPlayScene } from '../runtime/playScene'
import { BottomPanel } from './ProjectPanel'
import { Hierarchy } from './Hierarchy'
import { Icon } from './icons'
import { Inspector } from './Inspector'
import { Splitter, usePanelSizes } from './layout'
import { ScriptEditor } from './ScriptEditor'
import { Toolbar } from './Toolbar'
import '../editor.css'

const editScene = createEditScene()

/** The camera the running game chose, so the Scene/Game tabs can switch back and forth while playing. */
let gameCamera: PerspectiveCamera | null = null

function applyPlayView(engine: Engine): void {
  const { mode, view } = editorStore.get()
  if (mode !== 'play') return
  const orbit = getOrbit(engine)
  orbit.enabled = view === 'scene'
  engine.camera = view === 'scene' || !gameCamera ? editorCamera : gameCamera
}

export function Editor() {
  const [engine, setEngine] = useState<Engine | null>(null)
  const mode = useStore(editorStore, (s) => s.mode)
  const playDoc = useStore(editorStore, (s) => s.playDoc)
  const playSceneId = useStore(editorStore, (s) => s.playScene)
  const playRun = useStore(editorStore, (s) => s.playRun)
  const view = useStore(editorStore, (s) => s.view)
  const showColliders = useStore(editorStore, (s) => s.showColliders)

  const scene = useMemo(
    () =>
      mode === 'play' && playDoc && playSceneId
        ? createPlayScene(playDoc, playSceneId, {
            assets: assetLibrary,
            loadScene: switchPlayScene,
            fallbackCamera: editorCamera,
            onStart: (e) => {
              gameCamera = e.camera
              applyPlayView(e)
            },
          })
        : editScene,
    // playRun restarts the scene even when the id is unchanged.
    [mode, playDoc, playSceneId, playRun],
  )

  useEffect(() => {
    if (engine) applyPlayView(engine)
  }, [engine, view])

  useShortcuts()
  const { sizes, update, style } = usePanelSizes()

  return (
    <div className={`editor ${mode === 'play' ? 'is-playing' : ''}`} style={style}>
      <Toolbar engine={engine} />
      <Hierarchy />
      <main className="viewport">
        <div className="viewport-bar">
          <div className="tabs" role="tablist">
            {(['scene', 'game'] as const).map((v) => (
              <button
                key={v}
                type="button"
                role="tab"
                aria-selected={view === v}
                className={view === v ? 'active' : ''}
                onClick={() => editorStore.set({ view: v })}
              >
                {v === 'scene' ? 'Scene' : 'Game'}
              </button>
            ))}
          </div>
          <button
            type="button"
            className={`tool-button ${showColliders ? 'active' : ''}`}
            onClick={() => editorStore.set({ showColliders: !showColliders })}
            title="Show all colliders"
            aria-pressed={showColliders}
          >
            <Icon name="collider" /> Colliders
          </button>
        </div>
        <div className="viewport-stage">
          <GameCanvas
            style={{ position: 'absolute', inset: 0 }}
            scene={scene}
            onReady={(e) => {
              attachEngine(e)
              setEngine(e)
              if (import.meta.env.DEV) Object.assign(window, { __engine: e })
            }}
          >
            <DebugOverlay />
          </GameCanvas>
          <ScriptEditor />
        </div>
      </main>
      <Inspector />
      <BottomPanel />
      <Splitter edge="right" size={sizes.left} onResize={(left) => update({ left })} label="Resize hierarchy" />
      <Splitter edge="left" size={sizes.right} onResize={(right) => update({ right })} label="Resize inspector" />
      <Splitter edge="top" size={sizes.bottom} onResize={(bottom) => update({ bottom })} label="Resize project panel" />
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
        duplicateEntities()
      } else if (mod && key === 'c') {
        copySelection()
      } else if (mod && key === 'v') {
        e.preventDefault()
        pasteClipboard()
      } else if (mod) {
        return
      } else if (key === 'w') editorStore.set({ tool: 'translate' })
      else if (key === 'e') editorStore.set({ tool: 'rotate' })
      else if (key === 'r') editorStore.set({ tool: 'scale' })
      else if (key === 'f') sceneView.focusSelection()
      else if (key === 'escape') select(null)
      else if ((key === 'delete' || key === 'backspace') && state.selection.length) {
        e.preventDefault()
        deleteEntities()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}
