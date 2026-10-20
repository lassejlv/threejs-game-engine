import { type ReactNode, useEffect, useRef, useState } from 'react'

export interface MenuItem {
  label: string
  onSelect: () => void
  group?: string
  disabled?: boolean
}

/** Button + dropdown. Closes on selection, outside click or Escape. */
export function Menu({ label, items, className, align = 'left' }: { label: ReactNode; items: MenuItem[]; className?: string; align?: 'left' | 'right' }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    window.addEventListener('pointerdown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointerdown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  let lastGroup: string | undefined
  return (
    <div className={`menu ${className ?? ''}`} ref={ref}>
      <button type="button" className="tool-button" onClick={() => setOpen(!open)} aria-expanded={open} aria-haspopup="menu">
        {label}
      </button>
      {open && (
        <div className={`menu-list menu-${align}`} role="menu">
          {items.map((item) => {
            const header = item.group && item.group !== lastGroup ? item.group : null
            lastGroup = item.group
            return (
              <div key={`${item.group}:${item.label}`}>
                {header && <div className="menu-group">{header}</div>}
                <button
                  type="button"
                  role="menuitem"
                  disabled={item.disabled}
                  onClick={() => {
                    setOpen(false)
                    item.onSelect()
                  }}
                >
                  {item.label}
                </button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
