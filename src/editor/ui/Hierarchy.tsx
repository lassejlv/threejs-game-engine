import { type ReactNode, useMemo, useState } from 'react'
import { useStore } from '../../react'
import type { EntityDoc } from '../document'
import { deleteEntity, duplicateEntity, editorStore, reparent, select, updateEntity } from '../editor'
import { entityIcon, Icon } from './icons'
import { Menu } from './Menu'
import { createMenuItems } from './Toolbar'

const DRAG_TYPE = 'application/x-entity'

export function Hierarchy() {
  const entities = useStore(editorStore, (s) => s.doc.entities)
  const selection = useStore(editorStore, (s) => s.selection)
  const playing = useStore(editorStore, (s) => s.mode === 'play')
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set())
  const [renaming, setRenaming] = useState<string | null>(null)
  const [dropTarget, setDropTarget] = useState<string | null>(null)

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

  const renderRows = (parent: string | null, depth: number): ReactNode =>
    (children.get(parent) ?? []).map((entity) => {
      const kids = children.get(entity.id)
      const open = !collapsed.has(entity.id)
      return (
        <div key={entity.id} role="treeitem" aria-expanded={kids ? open : undefined} aria-selected={selection === entity.id}>
          <div
            className={`tree-row ${selection === entity.id ? 'selected' : ''} ${entity.active ? '' : 'inactive'} ${dropTarget === entity.id ? 'drop' : ''}`}
            style={{ paddingLeft: 8 + depth * 14 }}
            draggable={!playing && renaming !== entity.id}
            onDragStart={(e) => {
              e.dataTransfer.setData(DRAG_TYPE, entity.id)
              e.dataTransfer.effectAllowed = 'move'
            }}
            onDragOver={(e) => {
              if (!e.dataTransfer.types.includes(DRAG_TYPE)) return
              e.preventDefault()
              e.stopPropagation()
              setDropTarget(entity.id)
            }}
            onDragLeave={() => setDropTarget((t) => (t === entity.id ? null : t))}
            onDrop={(e) => {
              e.preventDefault()
              e.stopPropagation()
              setDropTarget(null)
              const id = e.dataTransfer.getData(DRAG_TYPE)
              if (id) reparent(id, entity.id)
            }}
            onClick={() => select(entity.id)}
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
            <Icon name={entityIcon(entity)} className={`icon-${entityIcon(entity)}`} />
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

  return (
    <aside className="panel hierarchy">
      <header className="panel-header">
        <span>Hierarchy</span>
        <div className="panel-actions">
          <Menu label={<Icon name="plus" />} items={createMenuItems(null)} />
          <button
            type="button"
            className="tool-button"
            disabled={!selection || playing}
            onClick={() => selection && duplicateEntity(selection)}
            title="Duplicate (Ctrl+D)"
          >
            <Icon name="copy" />
          </button>
          <button
            type="button"
            className="tool-button"
            disabled={!selection || playing}
            onClick={() => selection && deleteEntity(selection)}
            title="Delete (Del)"
          >
            <Icon name="trash" />
          </button>
        </div>
      </header>
      <div
        className={`panel-body tree ${dropTarget === 'root' ? 'drop-root' : ''}`}
        role="tree"
        onDragOver={(e) => {
          if (!e.dataTransfer.types.includes(DRAG_TYPE)) return
          e.preventDefault()
          setDropTarget('root')
        }}
        onDragLeave={() => setDropTarget((t) => (t === 'root' ? null : t))}
        onDrop={(e) => {
          e.preventDefault()
          setDropTarget(null)
          const id = e.dataTransfer.getData(DRAG_TYPE)
          if (id) reparent(id, null)
        }}
        onClick={(e) => e.target === e.currentTarget && select(null)}
      >
        {entities.length === 0 ? <p className="empty">Empty scene. Use + to add objects.</p> : renderRows(null, 0)}
      </div>
    </aside>
  )
}
