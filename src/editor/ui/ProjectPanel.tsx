import { useRef, useState } from 'react'
import { useStore } from '../../react'
import { consoleStore } from '../console'
import { assetReferences, componentDefaults, createEntity } from '../document'
import {
  addEntity,
  addPrefabInstance,
  assetLibrary,
  createSceneAction,
  createScript,
  deleteAsset,
  deletePrefab,
  deleteScene,
  deleteScript,
  editorStore,
  jumpToHistory,
  importAssets,
  openPrefab,
  openScene,
  renamePrefab,
  setStartScene,
  updateScene,
} from '../editor'
import { PREFAB_DRAG_TYPE } from './Hierarchy'
import { useModelThumbnail } from './thumbnails'
import { ACCEPTED_ASSETS, type AssetMeta } from '../assetLibrary'
import { sceneView } from '../runtime/editScene'
import { BUILTINS } from '../scripting'
import { ConsolePanel } from './ConsolePanel'
import { Icon } from './icons'

export function BottomPanel() {
  const tab = useStore(editorStore, (s) => s.bottomTab)
  const errors = useStore(consoleStore, (s) => s.entries.filter((e) => e.level === 'error').length)
  return (
    <section className="panel bottom">
      <header className="panel-header tabs" role="tablist">
        <button type="button" role="tab" aria-selected={tab === 'project'} className={tab === 'project' ? 'active' : ''} onClick={() => editorStore.set({ bottomTab: 'project' })}>
          Project
        </button>
        <button type="button" role="tab" aria-selected={tab === 'console'} className={tab === 'console' ? 'active' : ''} onClick={() => editorStore.set({ bottomTab: 'console' })}>
          Console {errors > 0 && <span className="badge error">{errors}</span>}
        </button>
        <button type="button" role="tab" aria-selected={tab === 'history'} className={tab === 'history' ? 'active' : ''} onClick={() => editorStore.set({ bottomTab: 'history' })}>
          History
        </button>
      </header>
      {tab === 'project' ? <ProjectPanel /> : tab === 'console' ? <ConsolePanel /> : <HistoryPanel />}
    </section>
  )
}

/** Every undoable and redoable step; clicking one jumps there. */
function HistoryPanel() {
  const history = useStore(editorStore, (s) => s.history)
  const redo = useStore(editorStore, (s) => s.redoHistory)
  const playing = useStore(editorStore, (s) => s.mode === 'play')
  const rows = [
    { label: 'Start', steps: 0, done: true },
    ...history.map((label, i) => ({ label, steps: i + 1, done: true })),
    ...redo.map((label, i) => ({ label, steps: history.length + i + 1, done: false })),
  ]
  return (
    <div className="panel-body history-list" role="list">
      {rows.map((row) => (
        <button
          key={row.steps}
          type="button"
          role="listitem"
          className={`history-row ${row.done ? '' : 'undone'} ${row.steps === history.length ? 'current' : ''}`}
          disabled={playing}
          onClick={() => jumpToHistory(row.steps)}
          title={row.done ? 'Undo back to this step' : 'Redo up to this step'}
        >
          {row.label}
        </button>
      ))}
      <p className="hint">Edits since the editor opened (up to 200). Click a step to undo or redo to it.</p>
    </div>
  )
}

function ScenesAndPrefabs() {
  const scenes = useStore(editorStore, (s) => s.doc.scenes)
  const prefabs = useStore(editorStore, (s) => s.doc.prefabs)
  const editing = useStore(editorStore, (s) => s.editing)
  const lastScene = useStore(editorStore, (s) => s.lastScene)
  const playing = useStore(editorStore, (s) => s.mode === 'play')
  const [renaming, setRenaming] = useState<string | null>(null)

  const rename = (id: string, current: string, apply: (name: string) => void) =>
    renaming === id ? (
      <input
        className="rename"
        defaultValue={current}
        autoFocus
        onFocus={(e) => e.currentTarget.select()}
        onBlur={(e) => {
          const name = e.currentTarget.value.trim()
          if (name && name !== current) apply(name)
          setRenaming(null)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur()
          if (e.key === 'Escape') setRenaming(null)
        }}
      />
    ) : (
      current
    )

  return (
    <div className="project-column">
      <div className="project-heading">
        <span>Scenes</span>
        <button type="button" onClick={createSceneAction} disabled={playing}>
          <Icon name="plus" /> New
        </button>
      </div>
      <ul className="asset-list">
        {scenes.map((scene, index) => {
          const open = editing.kind === 'scene' ? editing.id === scene.id : lastScene === scene.id
          return (
            <li key={scene.id} className={open ? 'current' : ''}>
              <button
                type="button"
                className="asset"
                disabled={playing}
                onClick={() => openScene(scene.id)}
                onDoubleClick={() => setRenaming(scene.id)}
                title="Click to open, double-click to rename"
              >
                <Icon name="scene" className="icon-scene" />
                {rename(scene.id, scene.name, (name) => updateScene(scene.id, { name }))}
                {index === 0 && <span className="dim">start</span>}
              </button>
              {index > 0 && (
                <button type="button" className="icon-button" disabled={playing} onClick={() => setStartScene(scene.id)} title="Make start scene">
                  ⇡
                </button>
              )}
              <button
                type="button"
                className="icon-button"
                disabled={playing || scenes.length === 1}
                onClick={() => window.confirm(`Delete scene "${scene.name}"?`) && deleteScene(scene.id)}
                aria-label={`Delete ${scene.name}`}
              >
                ×
              </button>
            </li>
          )
        })}
      </ul>
      <div className="project-heading">
        <span>Prefabs</span>
      </div>
      {prefabs.length === 0 ? (
        <p className="empty">Select an object and use the prefab button in the Hierarchy.</p>
      ) : (
        <ul className="asset-list">
          {prefabs.map((prefab) => (
            <li key={prefab.id} className={editing.kind === 'prefab' && editing.id === prefab.id ? 'current' : ''}>
              <button
                type="button"
                className="asset"
                draggable={!playing}
                onDragStart={(e) => e.dataTransfer.setData(PREFAB_DRAG_TYPE, prefab.id)}
                onClick={() => {
                  openPrefab(prefab.id)
                  requestAnimationFrame(() => sceneView.focusSelection())
                }}
                onDoubleClick={() => setRenaming(prefab.id)}
                disabled={playing}
                title="Click to edit, drag into the Hierarchy to place"
              >
                <Icon name="prefab" className="icon-prefab" />
                {rename(prefab.id, prefab.name, (name) => renamePrefab(prefab.id, name))}
              </button>
              <button type="button" disabled={playing} onClick={() => addPrefabInstance(prefab.id, sceneView.spawnPoint())}>
                Place
              </button>
              <button
                type="button"
                className="icon-button"
                disabled={playing}
                onClick={() => window.confirm(`Delete prefab "${prefab.name}" and all its instances?`) && deletePrefab(prefab.id)}
                aria-label={`Delete ${prefab.name}`}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function ProjectPanel() {
  const scripts = useStore(editorStore, (s) => s.doc.scripts)
  const assets = useStore(editorStore, (s) => s.assets)
  const playing = useStore(editorStore, (s) => s.mode === 'play')
  const fileInput = useRef<HTMLInputElement>(null)

  return (
    <div
      className="panel-body project"
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) e.preventDefault()
      }}
      onDrop={(e) => {
        if (!e.dataTransfer.files.length) return
        e.preventDefault()
        void importAssets(e.dataTransfer.files)
      }}
    >
      <ScenesAndPrefabs />
      <div className="project-column">
        <div className="project-heading">
          <span>Scripts</span>
          <button type="button" onClick={createScript} disabled={playing}>
            <Icon name="plus" /> New script
          </button>
        </div>
        <ul className="asset-list">
          {scripts.map((s) => (
            <li key={s.id}>
              <button type="button" className="asset" onClick={() => editorStore.set({ openScript: s.id })}>
                <Icon name="script" className="icon-script" />
                {s.name}.js
              </button>
              <button
                type="button"
                className="icon-button"
                disabled={playing}
                onClick={() => window.confirm(`Delete ${s.name}? Entities using it lose the script.`) && deleteScript(s.id)}
                aria-label={`Delete ${s.name}`}
              >
                ×
              </button>
            </li>
          ))}
          {Object.values(BUILTINS).map((b) => (
            <li key={b.name} title={b.description}>
              <span className="asset builtin">
                <Icon name="script" className="icon-script" />
                {b.name}
                <span className="dim">built-in</span>
              </span>
            </li>
          ))}
        </ul>
      </div>

      <div className="project-column">
        <div className="project-heading">
          <span>Assets</span>
          <button type="button" onClick={() => fileInput.current?.click()}>
            <Icon name="plus" /> Import
          </button>
          <input
            ref={fileInput}
            type="file"
            accept={ACCEPTED_ASSETS}
            multiple
            hidden
            onChange={(e) => {
              if (e.target.files) void importAssets(e.target.files)
              e.target.value = ''
            }}
          />
        </div>
        {assets.length === 0 ? (
          <p className="empty">Drop .glb models, .png/.jpg textures or .mp3/.ogg/.wav audio here.</p>
        ) : (
          <div className="asset-grid">
            {assets.map((a) => (
              <AssetTile key={a.id} asset={a} playing={playing} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function AssetTile({ asset, playing }: { asset: AssetMeta; playing: boolean }) {
  const modelThumb = useModelThumbnail(asset.kind === 'model' ? asset.id : null)
  const image = asset.kind === 'texture' ? assetLibrary.url(asset.id) : modelThumb
  const addModel = () =>
    addEntity(
      createEntity(asset.name.replace(/\.\w+$/, ''), {
        transform: { position: sceneView.spawnPoint(), rotation: [0, 0, 0], scale: [1, 1, 1] },
        model: { ...componentDefaults.model(), asset: asset.id },
      }),
    )
  return (
    <div
      className="asset-tile"
      title={`${asset.name} · ${formatSize(asset.size)}${asset.kind === 'model' ? ' · double-click to add' : ''}`}
      onDoubleClick={() => asset.kind === 'model' && !playing && addModel()}
    >
      <div className="asset-thumb">
        {image ? <img src={image} alt="" draggable={false} /> : <Icon name={asset.kind} className={`icon-${asset.kind}`} />}
      </div>
      <span className="asset-tile-name">{asset.name}</span>
      <div className="asset-tile-actions">
        {asset.kind === 'model' && (
          <button type="button" disabled={playing} onClick={addModel} aria-label={`Add ${asset.name} to scene`}>
            Add
          </button>
        )}
        <button
          type="button"
          onClick={() => {
            const uses = assetReferences(editorStore.get().doc, asset.id, asset.name)
            const message = uses.length
              ? `${asset.name} is used in ${uses.length} place${uses.length === 1 ? '' : 's'}:\n\n${uses.slice(0, 12).join('\n')}${uses.length > 12 ? `\n…and ${uses.length - 12} more` : ''}\n\nDelete it anyway? Those references will show as missing.`
              : `Delete ${asset.name}? Nothing in the project uses it.`
            if (window.confirm(message)) void deleteAsset(asset.id)
          }}
          aria-label={`Delete ${asset.name}`}
        >
          ×
        </button>
      </div>
    </div>
  )
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}
