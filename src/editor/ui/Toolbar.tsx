import { useRef } from 'react'
import { createStore, type Engine } from '../../engine'
import { useStore } from '../../react'
import { createEntity } from '../document'
import {
  addEntity,
  editorStore,
  exportProject,
  importProject,
  newProject,
  play,
  redo,
  stepFrame,
  stop,
  togglePause,
  type Tool,
  undo,
  updateProject,
} from '../editor'
import { downloadGame, runGameInTab } from '../exportGame'
import { PRESETS } from '../presets'
import { sceneView } from '../runtime/editScene'
import { TextInput } from './fields'
import { Icon, type IconName } from './icons'
import { Menu, type MenuItem } from './Menu'

export function createMenuItems(parent: string | null = null): MenuItem[] {
  return PRESETS.map((preset) => ({
    label: preset.label,
    group: preset.group,
    onSelect: () => {
      const partial = preset.create()
      const at = sceneView.spawnPoint()
      const transform = partial.transform ?? { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] }
      if (!parent) transform.position = [transform.position[0] + at[0], transform.position[1] + at[1], transform.position[2] + at[2]]
      addEntity(createEntity(preset.name, { ...partial, transform, parent }))
    },
  }))
}

const TOOLS: [Tool, IconName, string][] = [
  ['translate', 'move', 'Move (W)'],
  ['rotate', 'rotate', 'Rotate (E)'],
  ['scale', 'scale', 'Scale (R)'],
]

export function Toolbar({ engine }: { engine: Engine | null }) {
  const name = useStore(editorStore, (s) => s.doc.name)
  const mode = useStore(editorStore, (s) => s.mode)
  const paused = useStore(editorStore, (s) => s.paused)
  const tool = useStore(editorStore, (s) => s.tool)
  const snap = useStore(editorStore, (s) => s.snap)
  const canUndo = useStore(editorStore, (s) => s.canUndo)
  const canRedo = useStore(editorStore, (s) => s.canRedo)
  const fps = useStore(engine?.stats ?? fallbackStats, (s) => s.fps)
  const fileInput = useRef<HTMLInputElement>(null)
  const playing = mode === 'play'

  return (
    <header className="toolbar">
      <div className="toolbar-group">
        <span className="brand">◆ Engine</span>
        <TextInput className="project-name" value={name} onChange={(v) => updateProject({ name: v || 'Untitled' })} />
        <Menu
          label="File"
          items={[
            { label: 'New empty scene', onSelect: () => confirmDiscard() && newProject(true) },
            { label: 'New from sample (Coin Rush)', onSelect: () => confirmDiscard() && newProject(false) },
            { label: 'Open project…', onSelect: () => fileInput.current?.click() },
            { label: 'Export project', onSelect: exportProject },
          ]}
        />
        <input
          ref={fileInput}
          type="file"
          accept=".json,application/json"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) void importProject(file)
            e.target.value = ''
          }}
        />
        <button type="button" className="tool-button" onClick={undo} disabled={!canUndo || playing} title="Undo (Ctrl+Z)">
          <Icon name="undo" />
        </button>
        <button type="button" className="tool-button" onClick={redo} disabled={!canRedo || playing} title="Redo (Ctrl+Shift+Z)">
          <Icon name="redo" />
        </button>
      </div>

      <div className="toolbar-group">
        {TOOLS.map(([id, icon, title]) => (
          <button
            key={id}
            type="button"
            className={`tool-button ${tool === id ? 'active' : ''}`}
            onClick={() => editorStore.set({ tool: id })}
            disabled={playing}
            title={title}
            aria-pressed={tool === id}
          >
            <Icon name={icon} />
          </button>
        ))}
        <button
          type="button"
          className={`tool-button ${snap ? 'active' : ''}`}
          onClick={() => editorStore.set({ snap: !snap })}
          disabled={playing}
          title="Snap (0.5 m, 15°, 0.1×)"
          aria-pressed={snap}
        >
          <Icon name="magnet" />
        </button>
        <Menu label={<><Icon name="plus" /> Create</>} items={createMenuItems()} />
      </div>

      <div className="toolbar-group play-controls">
        <button
          type="button"
          className={`tool-button play ${playing ? 'active' : ''}`}
          onClick={playing ? stop : play}
          title={playing ? 'Stop (Ctrl+P)' : 'Play (Ctrl+P)'}
        >
          <Icon name={playing ? 'stop' : 'play'} />
        </button>
        <button type="button" className={`tool-button ${paused ? 'active' : ''}`} onClick={togglePause} disabled={!playing} title="Pause">
          <Icon name="pause" />
        </button>
        <button type="button" className="tool-button" onClick={stepFrame} disabled={!playing} title="Step one frame">
          <Icon name="step" />
        </button>
      </div>

      <div className="toolbar-group toolbar-right">
        <Menu
          align="right"
          label={<><Icon name="build" /> Build</>}
          items={[
            { label: 'Run in new tab', onSelect: () => void runGameInTab() },
            { label: 'Download game (.html)', onSelect: () => void downloadGame() },
          ]}
        />
        <span className="fps">{fps} fps</span>
      </div>
    </header>
  )
}

const fallbackStats = createStore({ fps: 0 })

function confirmDiscard(): boolean {
  return window.confirm('Replace the current project? Export it first if you want to keep it.')
}
