import { useEffect, useMemo, useState } from 'react'
import type { Engine, GameCamera } from '../../engine'
import { DebugOverlay, GameCanvas, useStore } from '../../react'
import {
  assetLibrary,
  attachEngine,
  copySelection,
  deleteEntities,
  deleteUiElement,
  duplicateEntities,
  editorStore,
  exportProject,
  pasteClipboard,
  play,
  redo,
  select,
  stop,
  switchPlayScene,
  undo,
} from '../editor'
import { answerTrust, requestRun, saveNow } from '../projects'
import { editorCamera, getOrbit } from '../runtime/editorCamera'
import { createEditScene, sceneView } from '../runtime/editScene'
import { watchGraphics } from '../runtime/graphicsNotice'
import { createPlayScene } from '../runtime/playScene'
import { installWebGPUKit, type WebGPUKit } from '../runtime/rendererKit'
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
let gameCamera: GameCamera | null = null

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
  const view2D = useStore(editorStore, (s) => s.view2D)
  const renderer = useStore(editorStore, (s) => s.doc.settings.renderer)
  const gpuKit = useWebGPUKit(renderer === 'webgpu')

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
            showColliders: () => editorStore.get().showColliders,
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
            className={`tool-button ${view2D ? 'active' : ''}`}
            onClick={() => editorStore.set({ view2D: !view2D, view: 'scene' })}
            title="2D view: look straight at the XY plane (pan and zoom only)"
            aria-pressed={view2D}
          >
            2D
          </button>
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
          {(renderer === 'webgl' || gpuKit) && (
            <GameCanvas
              // A different renderer needs a new engine.
              key={renderer}
              options={{ renderer, webgpuRenderer: gpuKit?.Renderer }}
              style={{ position: 'absolute', inset: 0 }}
              scene={scene}
              onReady={(e) => {
                attachEngine(e)
                watchGraphics(e)
                setEngine(e)
                if (import.meta.env.DEV) Object.assign(window, { __engine: e })
              }}
            >
              <DebugOverlay />
            </GameCanvas>
          )}
          <ScriptEditor />
          <StorageNotice />
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
        else void requestRun().then((ok) => ok && play())
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
      else if ((key === 'delete' || key === 'backspace') && state.uiSelection) {
        e.preventDefault()
        deleteUiElement(state.uiSelection)
      } else if ((key === 'delete' || key === 'backspace') && state.selection.length) {
        e.preventDefault()
        deleteEntities()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}

let loadedKit: WebGPUKit | null = null

/** Loads the WebGPU renderer pieces the first time a project asks for them. */
function useWebGPUKit(wanted: boolean): WebGPUKit | null {
  const [kit, setKit] = useState(loadedKit)
  useEffect(() => {
    if (!wanted || kit) return
    let cancelled = false
    void import('../runtime/webgpuKit').then(({ webgpuKit }) => {
      installWebGPUKit(webgpuKit)
      loadedKit = webgpuKit
      if (!cancelled) setKit(webgpuKit)
    })
    return () => {
      cancelled = true
    }
  }, [wanted, kit])
  return kit
}

/** A failed save, projects still opening, or paused scripts: never let any go unnoticed. */
function StorageNotice() {
  const storage = useStore(editorStore, (s) => s.storage)
  const scripts = useStore(editorStore, (s) => s.doc.scripts.length)
  const prompt = useStore(editorStore, (s) => s.trustPrompt)
  if (prompt) return <TrustDialog project={prompt.project} scripts={prompt.scripts} />
  if (storage.state === 'loading' && !storage.projectId) return <div className="boot-overlay">Opening project…</div>
  if (!storage.trusted && scripts > 0 && storage.state !== 'error') {
    return (
      <div className="save-banner trust-banner" role="status">
        <strong>Scripts are paused.</strong> This project was imported; its {scripts} script{scripts === 1 ? '' : 's'} won't run until you trust it.
        <button type="button" onClick={() => void requestRun()}>
          Review…
        </button>
      </div>
    )
  }
  if (storage.state !== 'error') return null
  return (
    <div className="save-banner" role="alert">
      <strong>Your changes aren't being saved.</strong> {storage.error}
      <button type="button" onClick={() => void saveNow()}>
        Try again
      </button>
      <button type="button" onClick={exportProject}>
        Export a copy
      </button>
    </div>
  )
}

/** Asks before an imported project's scripts run for the first time. */
function TrustDialog({ project, scripts }: { project: string; scripts: string[] }) {
  return (
    <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && answerTrust(false)}>
      <div className="dialog trust-dialog" role="alertdialog" aria-modal="true" aria-label="Run this project's scripts?">
        <header className="dialog-header">
          <span>Run this project's scripts?</span>
        </header>
        <div className="dialog-body">
          <p>
            <strong>{project}</strong> was imported and has {scripts.length} script{scripts.length === 1 ? '' : 's'}: {scripts.join(', ')}.
          </p>
          <p className="hint">
            Scripts run inside the editor with the same access as you: they could read or change your other projects. Only run scripts from people
            you trust. Your answer is remembered for this project.
          </p>
          <div className="dialog-actions">
            <button type="button" onClick={() => answerTrust(false)}>
              Cancel
            </button>
            <button type="button" className="primary" onClick={() => answerTrust(true)} autoFocus>
              Run scripts
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
