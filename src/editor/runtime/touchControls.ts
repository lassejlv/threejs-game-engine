import type { Input } from '../../engine'

const CSS = `
.tc-root { position: absolute; inset: 0; pointer-events: none; z-index: 3; touch-action: none; user-select: none; -webkit-user-select: none; }
.tc-stick { position: absolute; left: 24px; bottom: 24px; width: 132px; height: 132px; border-radius: 50%; background: rgba(255,255,255,0.08); border: 2px solid rgba(255,255,255,0.25); pointer-events: auto; touch-action: none; }
.tc-knob { position: absolute; left: 50%; top: 50%; width: 56px; height: 56px; margin: -28px 0 0 -28px; border-radius: 50%; background: rgba(255,255,255,0.45); }
.tc-buttons { position: absolute; right: 20px; bottom: 24px; display: flex; flex-wrap: wrap-reverse; justify-content: flex-end; gap: 12px; max-width: 220px; pointer-events: none; }
.tc-button { pointer-events: auto; touch-action: none; width: 64px; height: 64px; border-radius: 50%; border: 2px solid rgba(255,255,255,0.3); background: rgba(12,15,22,0.45); color: #fff; font: 600 12px system-ui, sans-serif; }
.tc-button.down { background: rgba(76,141,255,0.8); }
`

/** Whether this device should show touch controls for a project setting. */
export function wantsTouchControls(setting: 'auto' | 'always' | 'off'): boolean {
  if (setting === 'off') return false
  if (setting === 'always') return true
  return typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches
}

/**
 * On-screen joystick (drives the MoveX/MoveY axes) and action buttons (press
 * `Touch:<action>`, which every action is also bound to). Dragging elsewhere on
 * the screen still looks around, since touches on the canvas act as the mouse.
 */
export class TouchControls {
  private readonly root: HTMLDivElement

  constructor(
    container: HTMLElement,
    private readonly input: Input,
    buttons: string[],
  ) {
    if (!document.getElementById('tc-style')) {
      const style = document.createElement('style')
      style.id = 'tc-style'
      style.textContent = CSS
      document.head.appendChild(style)
    }
    this.root = document.createElement('div')
    this.root.className = 'tc-root'
    this.root.appendChild(this.stick())
    const row = document.createElement('div')
    row.className = 'tc-buttons'
    for (const action of buttons) row.appendChild(this.button(action))
    this.root.appendChild(row)
    container.appendChild(this.root)
  }

  dispose(): void {
    this.input.setVirtualAxis('MoveX', 0)
    this.input.setVirtualAxis('MoveY', 0)
    this.root.remove()
  }

  private stick(): HTMLElement {
    const base = document.createElement('div')
    base.className = 'tc-stick'
    const knob = document.createElement('div')
    knob.className = 'tc-knob'
    base.appendChild(knob)
    let pointer: number | null = null
    const move = (e: PointerEvent) => {
      const rect = base.getBoundingClientRect()
      const radius = rect.width / 2
      let dx = (e.clientX - rect.left - radius) / radius
      let dy = (e.clientY - rect.top - radius) / radius
      const length = Math.hypot(dx, dy)
      if (length > 1) {
        dx /= length
        dy /= length
      }
      knob.style.transform = `translate(${dx * radius * 0.6}px, ${dy * radius * 0.6}px)`
      this.input.setVirtualAxis('MoveX', dx)
      this.input.setVirtualAxis('MoveY', -dy) // up on screen = forward
    }
    const end = (e: PointerEvent) => {
      if (e.pointerId !== pointer) return
      pointer = null
      knob.style.transform = ''
      this.input.setVirtualAxis('MoveX', 0)
      this.input.setVirtualAxis('MoveY', 0)
    }
    base.addEventListener('pointerdown', (e) => {
      e.preventDefault()
      e.stopPropagation()
      pointer = e.pointerId
      base.setPointerCapture(e.pointerId)
      move(e)
    })
    base.addEventListener('pointermove', (e) => e.pointerId === pointer && move(e))
    base.addEventListener('pointerup', end)
    base.addEventListener('pointercancel', end)
    return base
  }

  private button(action: string): HTMLElement {
    const el = document.createElement('button')
    el.type = 'button'
    el.className = 'tc-button'
    el.textContent = action
    const code = `Touch:${action}`
    const set = (down: boolean) => {
      el.classList.toggle('down', down)
      this.input.setVirtualButton(code, down)
    }
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault()
      e.stopPropagation()
      el.setPointerCapture(e.pointerId)
      set(true)
    })
    el.addEventListener('pointerup', () => set(false))
    el.addEventListener('pointercancel', () => set(false))
    el.addEventListener('contextmenu', (e) => e.preventDefault())
    return el
  }
}
