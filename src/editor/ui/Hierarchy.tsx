import { type DragEvent, type ReactNode, useMemo, useState } from 'react'
import { useStore } from '../../react'
import type { EntityDoc, UiElementDoc } from '../document'
import {
  addPrefabInstance,
  addUiElement,
  currentScene,
  selectUi,
  createPrefab,
  deleteEntities,
  duplicateEntities,
  editorStore,
  openScene,
  primarySelection,
  reparent,
  select,
  targetEntities,
  updateEntity,
} from '../editor'
import { entityIcon, Icon } from './icons'
import { Menu } from './Menu'
import { createMenuItems } from './Toolbar'

const DRAG_TYPE = 'application/x-entity'
export const PREFAB_DRAG_TYPE = 'application/x-prefab'

export function Hierarchy() {
  const entities = useStore(editorStore, (s) => targetEntities(s.doc, s.editing))
  const editing = useStore(editorStore, (s) => s.editing)
  const title = useStore(editorStore, (s) =>
    s.editing.kind === 'prefab'
      ? (s.doc.prefabs.find((p) => p.id === s.editing.id)?.name ?? 'Prefab')
      : (s.doc.scenes.find((x) => x.id === s.editing.id)?.name ?? 'Scene'),
  )
  const prefabNames = useStore(editorStore, (s) => s.doc.prefabs)
  const selection = useStore(editorStore, (s) => s.selection)
  const primary = useStore(editorStore, (s) => primarySelection(s))
  const playing = useStore(editorStore, (s) => s.mode === 'play')
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set())
  const [renaming, setRenaming] = useState<string | null>(null)
  const [dropTarget, setDropTarget] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const prefabMode = editing.kind === 'prefab'

  // Search: matches plus their ancestors, so results keep their place in the tree.
  const filter = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return null
    const byId = new Map(entities.map((e) => [e.id, e]))
    const matches = new Set(entities.filter((e) => matchesQuery(e, q)).map((e) => e.id))
    const visible = new Set<string>()
    for (const id of matches) {
      for (let e = byId.get(id); e && !visible.has(e.id); e = e.parent ? byId.get(e.parent) : undefined) visible.add(e.id)
    }
    return { matches, visible }
  }, [entities, query])

  const children = useMemo(() => {
    const map = new Map<string | null, EntityDoc[]>()
    for (const e of entities) {
      const list = map.get(e.parent) ?? []
      list.push(e)
      map.set(e.parent, list)
    }
    return map
  }, [entities])

  const toggle = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const onDrop = (e: DragEvent, parent: string | null) => {
    e.preventDefault()
    e.stopPropagation()
    setDropTarget(null)
    const prefab = e.dataTransfer.getData(PREFAB_DRAG_TYPE)
    if (prefab) {
      addPrefabInstance(prefab)
      const added = editorStore.get().selection.at(-1)
      if (added && parent) reparent(added, parent)
      return
    }
    const id = e.dataTransfer.getData(DRAG_TYPE)
    if (id) reparent(id, parent)
  }
  const accepts = (e: DragEvent) =>
    e.dataTransfer.types.includes(DRAG_TYPE) || e.dataTransfer.types.includes(PREFAB_DRAG_TYPE)

  const renderRows = (parent: string | null, depth: number): ReactNode =>
    (children.get(parent) ?? []).filter((entity) => !filter || filter.visible.has(entity.id)).map((entity) => {
      const kids = children.get(entity.id)
      const open = filter ? true : !collapsed.has(entity.id)
      const isSelected = selection.includes(entity.id)
      const prefabName = entity.prefab ? prefabNames.find((p) => p.id === entity.prefab)?.name : undefined
      return (
        <div key={entity.id} role="treeitem" aria-expanded={kids ? open : undefined} aria-selected={isSelected}>
          <div
            className={[
              'tree-row',
              isSelected && 'selected',
              primary === entity.id && 'primary',
              !entity.active && 'inactive',
              entity.prefab && 'is-prefab',
              dropTarget === entity.id && 'drop',
              filter && !filter.matches.has(entity.id) && 'context',
            ]
              .filter(Boolean)
              .join(' ')}
            style={{ paddingLeft: 8 + depth * 14 }}
            draggable={!playing && renaming !== entity.id}
            title={prefabName ? `Instance of prefab "${prefabName}"` : undefined}
            onDragStart={(e) => {
              e.dataTransfer.setData(DRAG_TYPE, entity.id)
              e.dataTransfer.effectAllowed = 'move'
            }}
            onDragOver={(e) => {
              if (!accepts(e)) return
              e.preventDefault()
              e.stopPropagation()
              setDropTarget(entity.id)
            }}
            onDragLeave={() => setDropTarget((t) => (t === entity.id ? null : t))}
            onDrop={(e) => onDrop(e, entity.id)}
            onClick={(e) => select(entity.id, e.shiftKey || e.metaKey || e.ctrlKey)}
            onDoubleClick={() => !playing && setRenaming(entity.id)}
          >
            <button
              type="button"
              className={`caret-button ${kids ? '' : 'hidden'}`}
              onClick={(e) => {
                e.stopPropagation()
                toggle(entity.id)
              }}
              tabIndex={-1}
              aria-label={open ? 'Collapse' : 'Expand'}
            >
              <span className={`caret ${open ? 'open' : ''}`}>▸</span>
            </button>
            <Icon name={entity.prefab ? 'prefab' : entityIcon(entity)} className={`icon-${entity.prefab ? 'prefab' : entityIcon(entity)}`} />
            {renaming === entity.id ? (
              <input
                className="rename"
                defaultValue={entity.name}
                autoFocus
                onFocus={(e) => e.currentTarget.select()}
                onBlur={(e) => {
                  const name = e.currentTarget.value.trim()
                  if (name && name !== entity.name) updateEntity(entity.id, { name })
                  setRenaming(null)
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') e.currentTarget.blur()
                  if (e.key === 'Escape') setRenaming(null)
                }}
                onClick={(e) => e.stopPropagation()}
              />
            ) : (
              <span className="tree-name">{entity.name}</span>
            )}
          </div>
          {kids && open && renderRows(entity.id, depth + 1)}
        </div>
      )
    })

  const canPrefab = !playing && !prefabMode && primary !== null && !entities.find((e) => e.id === primary)?.prefab

  return (
    <aside className="panel hierarchy">
      <header className="panel-header">
        {prefabMode ? (
          <span className="prefab-title">
            <button type="button" className="tool-button" onClick={() => openScene(editorStore.get().lastScene)} title="Back to scene">
              ‹
            </button>
            <Icon name="prefab" className="icon-prefab" />
            {title}
          </span>
        ) : (
          <span title="Scene">{title}</span>
        )}
        <div className="panel-actions">
          <Menu label={<Icon name="plus" />} items={createMenuItems(null)} />
          <button
            type="button"
            className="tool-button"
            disabled={!canPrefab}
            onClick={() => primary && createPrefab(primary)}
            title="Make prefab from selection"
          >
            <Icon name="prefab" />
          </button>
          <button
            type="button"
            className="tool-button"
            disabled={!selection.length || playing}
            onClick={() => duplicateEntities()}
            title="Duplicate (Ctrl+D)"
          >
            <Icon name="copy" />
          </button>
          <button
            type="button"
            className="tool-button"
            disabled={!selection.length || playing}
            onClick={() => deleteEntities()}
            title="Delete (Del)"
          >
            <Icon name="trash" />
          </button>
        </div>
      </header>
      <div className="tree-search">
        <input
          type="search"
          placeholder="Search (t:light, t:script…)"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Escape' && setQuery('')}
          aria-label="Search hierarchy"
        />
      </div>
      <div
        className={`panel-body tree ${dropTarget === 'root' ? 'drop-root' : ''} ${prefabMode ? 'prefab-mode' : ''}`}
        role="tree"
        aria-multiselectable="true"
        onDragOver={(e) => {
          if (!accepts(e)) return
          e.preventDefault()
          setDropTarget('root')
        }}
        onDragLeave={() => setDropTarget((t) => (t === 'root' ? null : t))}
        onDrop={(e) => onDrop(e, null)}
        onClick={(e) => e.target === e.currentTarget && select(null)}
      >
        {!prefabMode && <ScreenUiList />}
        {entities.length === 0 ? (
          <p className="empty">Empty scene. Use + to add objects.</p>
        ) : filter && filter.matches.size === 0 ? (
          <p className="empty">Nothing matches "{query}".</p>
        ) : (
          renderRows(null, 0)
        )}
      </div>
    </aside>
  )
}

const UI_TYPES: [UiElementDoc['type'], string][] = [
  ['text', 'Text'],
  ['button', 'Button'],
  ['bar', 'Bar'],
  ['image', 'Image'],
]

/** The scene's screen UI elements (laid out in the Game view). */
function ScreenUiList() {
  const ui = useStore(editorStore, (s) => currentScene(s).ui)
  const selected = useStore(editorStore, (s) => s.uiSelection)
  const playing = useStore(editorStore, (s) => s.mode === 'play')
  return (
    <div className="screen-ui" role="group" aria-label="Screen UI">
      <div className="screen-ui-header">
        <span>Screen UI</span>
        {!playing && <Menu label={<Icon name="plus" />} items={UI_TYPES.map(([type, label]) => ({ label, onSelect: () => addUiElement(type) }))} />}
      </div>
      {ui.map((el) => (
        <div
          key={el.id}
          className={`tree-row ${selected === el.id ? 'selected primary' : ''} ${el.visible ? '' : 'inactive'}`}
          style={{ paddingLeft: 22 }}
          onClick={() => {
            selectUi(el.id)
            editorStore.set({ view: 'game' })
          }}
        >
          <Icon name="ui" className="icon-ui" />
          <span className="tree-name">{el.name}</span>
          <span className="tree-meta">{el.type}</span>
        </div>
      ))}
    </div>
  )
}

const TYPE_FILTERS: Record<string, (e: EntityDoc) => boolean> = {
  mesh: (e) => !!e.mesh,
  model: (e) => !!e.model,
  light: (e) => !!e.light,
  camera: (e) => !!e.camera,
  audio: (e) => !!e.audio,
  particles: (e) => !!e.particles,
  body: (e) => !!e.rigidBody,
  rigidbody: (e) => !!e.rigidBody,
  collider: (e) => !!e.collider,
  joint: (e) => !!e.joint,
  script: (e) => e.scripts.length > 0,
  prefab: (e) => !!e.prefab,
}

/** Name substring, or `t:<component>` (mesh, light, collider, script, prefab...), or both: `t:light sun`. */
function matchesQuery(e: EntityDoc, query: string): boolean {
  let rest = query
  const type = /(?:^|\s)t:(\w+)/.exec(query)
  if (type) {
    const test = TYPE_FILTERS[type[1]]
    if (!test || !test(e)) return false
    rest = query.replace(type[0], '').trim()
  }
  return !rest || e.name.toLowerCase().includes(rest)
}
