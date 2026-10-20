import { type DragEvent, type ReactNode, useMemo, useState } from 'react'
import { useStore } from '../../react'
import type { EntityDoc } from '../document'
import {
  addPrefabInstance,
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
  const prefabMode = editing.kind === 'prefab'

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
    (children.get(parent) ?? []).map((entity) => {
      const kids = children.get(entity.id)
      const open = !collapsed.has(entity.id)
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
        {entities.length === 0 ? <p className="empty">Empty scene. Use + to add objects.</p> : renderRows(null, 0)}
      </div>
    </aside>
  )
}
