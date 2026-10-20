import { useRef, useState } from 'react'
import { useStore } from '../../react'
import { consoleStore } from '../console'
import { createEntity } from '../document'
import {
  addEntity,
  addPrefabInstance,
  createSceneAction,
  createScript,
  deleteAsset,
  deletePrefab,
  deleteScene,
  deleteScript,
  editorStore,
  importAssets,
  openPrefab,
  openScene,
  renamePrefab,
  setStartScene,
  updateScene,
} from '../editor'
import { PREFAB_DRAG_TYPE } from './Hierarchy'
import { ACCEPTED_ASSETS } from '../assetLibrary'
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
      </header>
      {tab === 'project' ? <ProjectPanel /> : <ConsolePanel />}
    </section>
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
          <p className="empty">Drop .glb models or .png/.jpg textures here.</p>
        ) : (
          <ul className="asset-list">
            {assets.map((a) => (
              <li key={a.id}>
                <span className="asset">
                  <Icon name={a.kind === 'model' ? 'model' : 'texture'} className={`icon-${a.kind}`} />
                  {a.name}
                  <span className="dim">{formatSize(a.size)}</span>
                </span>
                {a.kind === 'model' && (
                  <button
                    type="button"
                    disabled={playing}
                    onClick={() =>
                      addEntity(
                        createEntity(a.name.replace(/\.\w+$/, ''), {
                          transform: { position: sceneView.spawnPoint(), rotation: [0, 0, 0], scale: [1, 1, 1] },
                          model: { asset: a.id, castShadow: true, receiveShadow: true },
                        }),
                      )
                    }
                  >
                    Add to scene
                  </button>
                )}
                <button
                  type="button"
                  className="icon-button"
                  onClick={() => window.confirm(`Delete ${a.name}?`) && void deleteAsset(a.id)}
                  aria-label={`Delete ${a.name}`}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}
