import { type CSSProperties, type ReactNode, useEffect, useLayoutEffect, useRef, useState } from 'react'

export interface MenuItem {
  label: string
  onSelect: () => void
  group?: string
  disabled?: boolean
}

const MARGIN = 8

/**
 * Button + dropdown. Closes on selection, outside click, Escape, scrolling or
 * resizing. The list is positioned against the window (fixed), so panels that
 * clip their content can't cut it off, and it flips to stay on screen.
 */
export function Menu({ label, items, className, align = 'left' }: { label: ReactNode; items: MenuItem[]; className?: string; align?: 'left' | 'right' }) {
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState<CSSProperties>({ visibility: 'hidden' })
  const ref = useRef<HTMLDivElement>(null)
  const button = useRef<HTMLButtonElement>(null)
  const list = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    if (!open || !button.current || !list.current) return
    const anchor = button.current.getBoundingClientRect()
    const { width, height } = list.current.getBoundingClientRect()
    const fitsRight = anchor.left + width <= window.innerWidth - MARGIN
    const fitsLeft = anchor.right - width >= MARGIN
    let left = align === 'right' || !fitsRight ? anchor.right - width : anchor.left
    if (align === 'right' && !fitsLeft) left = anchor.left
    left = Math.max(MARGIN, Math.min(left, window.innerWidth - MARGIN - width))
    const below = anchor.bottom + 4
    const top = below + height <= window.innerHeight - MARGIN ? below : Math.max(MARGIN, anchor.top - 4 - height)
    setPosition({ left, top, maxHeight: window.innerHeight - 2 * MARGIN })
  }, [open, align, items.length])

  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    // A fixed list would drift away from its button: close instead.
    const close = (e: Event) => {
      if (!list.current?.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('pointerdown', onDown)
    window.addEventListener('keydown', onKey)
    window.addEventListener('scroll', close, true)
    window.addEventListener('resize', close)
    return () => {
      window.removeEventListener('pointerdown', onDown)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('resize', close)
    }
  }, [open])

  let lastGroup: string | undefined
  return (
    <div className={`menu ${className ?? ''}`} ref={ref}>
      <button
        ref={button}
        type="button"
        className="tool-button"
        onClick={() => {
          setPosition({ visibility: 'hidden' })
          setOpen(!open)
        }}
        aria-expanded={open}
        aria-haspopup="menu"
      >
        {label}
      </button>
      {open && (
        <div ref={list} className="menu-list" role="menu" style={position}>
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
