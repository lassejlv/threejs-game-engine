import { useStore } from '../../react'
import { currentScene, editorStore, primarySelection, targetEntities } from '../editor'
import { LiveInspector } from './LiveInspector'
import { EntityInspector, InstanceInspector } from './inspector/EntityInspector'
import { SceneInspector } from './inspector/SceneInspector'
import { UiElementInspector } from './inspector/UiElementInspector'

export function Inspector() {
  const selection = useStore(editorStore, (s) => s.selection)
  const primary = useStore(editorStore, (s) => primarySelection(s))
  const entity = useStore(editorStore, (s) => targetEntities(s.doc, s.editing).find((e) => e.id === primarySelection(s)))
  const doc = useStore(editorStore, (s) => s.doc)
  const editing = useStore(editorStore, (s) => s.editing)
  const scene = useStore(editorStore, (s) => currentScene(s))
  // Script parameters come from compiling the script, which waits for the project to be trusted.
  useStore(editorStore, (s) => s.storage.trusted)
  const playing = useStore(editorStore, (s) => s.mode === 'play')
  const uiElement = useStore(editorStore, (s) => (s.uiSelection && s.editing.kind === 'scene' ? currentScene(s).ui.find((u) => u.id === s.uiSelection) : undefined))

  return (
    <aside className="panel inspector">
      <header className="panel-header">
        <span>Inspector</span>
        {playing && <span className="badge">Read-only while playing</span>}
      </header>
      {playing && primary && (
        <div className="panel-body live-panel">
          <LiveInspector key={primary} docId={primary} />
        </div>
      )}
      <fieldset className="panel-body" disabled={playing}>
        {selection.length > 1 && (
          <p className="hint multi">
            {selection.length} objects selected. Edits apply to every selected object that has the field; the values shown are the last
            one's.
          </p>
        )}
        {entity?.prefab ? (
          <InstanceInspector key={primary} entity={entity} doc={doc} />
        ) : entity ? (
          <EntityInspector key={primary} entity={entity} doc={doc} />
        ) : uiElement ? (
          <UiElementInspector key={uiElement.id} element={uiElement} doc={doc} />
        ) : editing.kind === 'prefab' ? (
          <p className="hint">Editing a prefab. Changes apply to every instance. Select an object to edit it.</p>
        ) : (
          <SceneInspector key={scene.id} sceneId={scene.id} settings={scene.settings} />
        )}
      </fieldset>
    </aside>
  )
}
