import { type CSSProperties, useCallback, useEffect, useState } from 'react'

export interface PanelSizes {
  left: number
  right: number
  bottom: number
}

const KEY = 'ge-layout-v1'
const DEFAULTS: PanelSizes = { left: 240, right: 310, bottom: 210 }
const MIN = { left: 160, right: 240, bottom: 90 }
/** Space always left for the scene view. */
const VIEW_MIN = { width: 280, height: 160 }

function load(): PanelSizes {
  try {
    return { ...DEFAULTS, ...(JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<PanelSizes>) }
  } catch {
    return DEFAULTS
  }
}

function clamp(sizes: PanelSizes): PanelSizes {
  const w = window.innerWidth
  const h = window.innerHeight
  const left = Math.max(MIN.left, Math.min(sizes.left, w - sizes.right - VIEW_MIN.width))
  const right = Math.max(MIN.right, Math.min(sizes.right, w - left - VIEW_MIN.width))
  const bottom = Math.max(MIN.bottom, Math.min(sizes.bottom, h - 40 - 30 - VIEW_MIN.height))
  return { left, right, bottom }
}

/** Panel sizes as CSS variables, persisted per browser and kept valid on window resize. */
export function usePanelSizes() {
  const [sizes, setSizes] = useState(() => clamp(load()))
  useEffect(() => {
    const onResize = () => setSizes((s) => clamp(s))
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  const update = useCallback((patch: Partial<PanelSizes>) => {
    setSizes((s) => {
      const next = clamp({ ...s, ...patch })
      try {
        localStorage.setItem(KEY, JSON.stringify(next))
      } catch {
        // Private mode: sizes just won't persist.
      }
      return next
    })
  }, [])
  const style = {
    '--left': `${sizes.left}px`,
    '--right': `${sizes.right}px`,
    '--bottom': `${sizes.bottom}px`,
  } as CSSProperties
  return { sizes, update, style }
}

/**
 * Drag handle on a panel edge. `edge` is the side of the panel it sits on;
 * dragging reports the new size measured from the panel's fixed side.
 */
export function Splitter({
  edge,
  size,
  onResize,
  label,
}: {
  edge: 'right' | 'left' | 'top'
  size: number
  onResize: (size: number) => void
  label: string
}) {
  return (
    <div
      className={`splitter splitter-${edge}`}
      role="separator"
      aria-orientation={edge === 'top' ? 'horizontal' : 'vertical'}
      aria-label={label}
      aria-valuenow={size}
      tabIndex={0}
      onKeyDown={(e) => {
        const step = e.shiftKey ? 40 : 10
        const grow = edge === 'right' ? 'ArrowRight' : edge === 'left' ? 'ArrowLeft' : 'ArrowUp'
        const shrink = edge === 'right' ? 'ArrowLeft' : edge === 'left' ? 'ArrowRight' : 'ArrowDown'
        if (e.key === grow) onResize(size + step)
        else if (e.key === shrink) onResize(size - step)
      }}
      onPointerDown={(e) => {
        e.preventDefault()
        const el = e.currentTarget
        el.setPointerCapture(e.pointerId)
        const start = edge === 'top' ? e.clientY : e.clientX
        const initial = size
        const move = (ev: PointerEvent) => {
          const pos = edge === 'top' ? ev.clientY : ev.clientX
          const delta = pos - start
          onResize(edge === 'right' ? initial + delta : initial - delta)
        }
        const up = () => {
          el.removeEventListener('pointermove', move)
          el.removeEventListener('pointerup', up)
          document.body.classList.remove('resizing')
        }
        el.addEventListener('pointermove', move)
        el.addEventListener('pointerup', up)
        document.body.classList.add('resizing')
      }}
    />
  )
}
