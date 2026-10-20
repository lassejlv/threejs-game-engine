import { type Camera, Vector3 } from 'three'
import type { Handle } from '../scripting'

export type Anchor =
  | 'top-left'
  | 'top'
  | 'top-right'
  | 'left'
  | 'center'
  | 'right'
  | 'bottom-left'
  | 'bottom'
  | 'bottom-right'

export interface UiStyle {
  anchor?: Anchor
  /** Pixel offset from the anchor (positive = right/down). */
  x?: number
  y?: number
  /** Font size in px. */
  size?: number
  color?: string
  /** Card background; `'none'` for plain text. */
  background?: string
  width?: number
}

export interface BarStyle extends UiStyle {
  label?: string
  fill?: string
}

export interface LabelStyle {
  /** World units above the target's origin. */
  offsetY?: number
  size?: number
  color?: string
}

/** Screen-space UI for scripts (`ctx.ui`). Calls are idempotent: call every frame or once. */
export interface UiApi {
  text(id: string, text: string | number, style?: UiStyle): void
  button(id: string, label: string, onClick: () => void, style?: UiStyle): void
  /** Progress/health bar; `value` is 0..1. */
  bar(id: string, value: number, style?: BarStyle): void
  /** Text that follows an entity in the world (name tags, damage numbers). */
  label(id: string, text: string | number, target: Handle, style?: LabelStyle): void
  remove(id: string): void
  clear(): void
}

const CSS = `
.gu-root { position: absolute; inset: 0; pointer-events: none; overflow: hidden; font: 600 14px/1.3 ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif; color: #fff; z-index: 2; }
.gu-el { position: absolute; white-space: nowrap; }
.gu-card { padding: 6px 12px; background: rgba(12, 15, 22, 0.72); border: 1px solid rgba(255,255,255,0.1); border-radius: 8px; backdrop-filter: blur(6px); }
.gu-button { pointer-events: auto; cursor: pointer; font: inherit; color: inherit; padding: 8px 18px; background: rgba(76,141,255,0.9); border: 0; border-radius: 8px; box-shadow: 0 4px 14px rgba(0,0,0,0.3); }
.gu-button:hover { background: #6aa1ff; }
.gu-button:active { transform: translateY(1px); }
.gu-bar { width: 200px; }
.gu-bar-label { font-size: 11px; letter-spacing: 0.06em; text-transform: uppercase; opacity: 0.75; margin-bottom: 4px; }
.gu-bar-track { height: 10px; border-radius: 5px; background: rgba(255,255,255,0.15); overflow: hidden; }
.gu-bar-fill { height: 100%; border-radius: 5px; background: #4cd97b; transition: width 0.15s ease-out; }
.gu-label { transform: translate(-50%, -100%); text-shadow: 0 1px 3px rgba(0,0,0,0.8); }
.gu-hud { position: absolute; top: 10px; left: 10px; display: flex; gap: 6px; }
.gu-stat { display: flex; flex-direction: column; min-width: 88px; }
.gu-stat-key { font-size: 10px; letter-spacing: 0.08em; text-transform: uppercase; opacity: 0.65; }
.gu-stat-value { font-size: 20px; font-variant-numeric: tabular-nums; }
.gu-message { left: 50%; top: 50%; transform: translate(-50%, -50%); padding: 18px 30px; font-size: 24px; font-weight: 700; color: #ffd25a; }
`

let styleInjected = false
function injectStyle(): void {
  if (styleInjected || typeof document === 'undefined') return
  styleInjected = true
  const style = document.createElement('style')
  style.textContent = CSS
  document.head.appendChild(style)
}

const ANCHORS: Record<Anchor, { h: 'left' | 'center' | 'right'; v: 'top' | 'middle' | 'bottom' }> = {
  'top-left': { h: 'left', v: 'top' },
  top: { h: 'center', v: 'top' },
  'top-right': { h: 'right', v: 'top' },
  left: { h: 'left', v: 'middle' },
  center: { h: 'center', v: 'middle' },
  right: { h: 'right', v: 'middle' },
  'bottom-left': { h: 'left', v: 'bottom' },
  bottom: { h: 'center', v: 'bottom' },
  'bottom-right': { h: 'right', v: 'bottom' },
}

function place(el: HTMLElement, style: UiStyle, defaultAnchor: Anchor): void {
  const { h, v } = ANCHORS[style.anchor ?? defaultAnchor]
  const x = style.x ?? 0
  const y = style.y ?? 0
  const margin = 12
  el.style.left = h === 'left' ? `${margin + x}px` : h === 'center' ? `calc(50% + ${x}px)` : ''
  el.style.right = h === 'right' ? `${margin - x}px` : ''
  el.style.top = v === 'top' ? `${margin + y}px` : v === 'middle' ? `calc(50% + ${y}px)` : ''
  el.style.bottom = v === 'bottom' ? `${margin - y}px` : ''
  el.style.transform = `translate(${h === 'center' ? '-50%' : '0'}, ${v === 'middle' ? '-50%' : '0'})`
  if (style.size) el.style.fontSize = `${style.size}px`
  if (style.color) el.style.color = style.color
  if (style.width) el.style.width = `${style.width}px`
  if (style.background === 'none') el.classList.remove('gu-card')
  else if (style.background) el.style.background = style.background
}

interface LabelEntry {
  el: HTMLElement
  target: Handle
  offsetY: number
}

const world = new Vector3()

/** DOM overlay for in-game UI and the HUD. One per play session. */
export class GameUi {
  readonly root: HTMLDivElement
  private readonly elements = new Map<string, HTMLElement>()
  private readonly labels = new Map<string, LabelEntry>()
  private readonly hudRoot: HTMLDivElement
  private readonly hudValues = new Map<string, HTMLElement>()
  private messageEl: HTMLElement | null = null

  constructor(container: HTMLElement, private readonly guard: (fn: () => void) => void = (fn) => fn()) {
    injectStyle()
    this.root = document.createElement('div')
    this.root.className = 'gu-root'
    this.hudRoot = document.createElement('div')
    this.hudRoot.className = 'gu-hud'
    this.root.appendChild(this.hudRoot)
    container.appendChild(this.root)
  }

  readonly api: UiApi = {
    text: (id, text, style = {}) => {
      const el = this.element(id, 'div', 'gu-el gu-card')
      el.textContent = String(text)
      place(el, style, 'top')
    },
    button: (id, label, onClick, style = {}) => {
      const el = this.element(id, 'button', 'gu-el gu-button') as HTMLButtonElement
      el.type = 'button'
      el.textContent = label
      el.onclick = () => this.guard(onClick)
      place(el, style, 'center')
    },
    bar: (id, value, style = {}) => {
      let el = this.elements.get(id)
      if (!el) {
        el = this.element(id, 'div', 'gu-el gu-card gu-bar')
        el.innerHTML = '<div class="gu-bar-label"></div><div class="gu-bar-track"><div class="gu-bar-fill"></div></div>'
      }
      const label = el.querySelector<HTMLElement>('.gu-bar-label')!
      label.textContent = style.label ?? ''
      label.style.display = style.label ? '' : 'none'
      const fill = el.querySelector<HTMLElement>('.gu-bar-fill')!
      fill.style.width = `${Math.max(0, Math.min(1, value)) * 100}%`
      if (style.fill) fill.style.background = style.fill
      place(el, style, 'top-left')
    },
    label: (id, text, target, style = {}) => {
      let entry = this.labels.get(id)
      if (!entry) {
        const el = document.createElement('div')
        el.className = 'gu-el gu-label'
        this.root.appendChild(el)
        entry = { el, target, offsetY: 0 }
        this.labels.set(id, entry)
      }
      entry.target = target
      entry.offsetY = style.offsetY ?? 1.2
      entry.el.textContent = String(text)
      if (style.size) entry.el.style.fontSize = `${style.size}px`
      if (style.color) entry.el.style.color = style.color
    },
    remove: (id) => {
      this.elements.get(id)?.remove()
      this.elements.delete(id)
      this.labels.get(id)?.el.remove()
      this.labels.delete(id)
    },
    clear: () => {
      for (const id of [...this.elements.keys(), ...this.labels.keys()]) this.api.remove(id)
    },
  }

  /** HUD stat card (used by `ctx.hud.set`). */
  setStat(key: string, value: string | number): void {
    let el = this.hudValues.get(key)
    if (!el) {
      el = document.createElement('div')
      el.className = 'gu-card gu-stat'
      el.innerHTML = '<span class="gu-stat-key"></span><span class="gu-stat-value"></span>'
      el.querySelector('.gu-stat-key')!.textContent = key
      this.hudRoot.appendChild(el)
      this.hudValues.set(key, el)
    }
    el.querySelector('.gu-stat-value')!.textContent = String(value)
  }

  removeStat(key: string): void {
    this.hudValues.get(key)?.remove()
    this.hudValues.delete(key)
  }

  message(text: string | null): void {
    if (text === null) {
      this.messageEl?.remove()
      this.messageEl = null
      return
    }
    if (!this.messageEl) {
      this.messageEl = document.createElement('div')
      this.messageEl.className = 'gu-el gu-card gu-message'
      this.root.appendChild(this.messageEl)
    }
    this.messageEl.textContent = text
  }

  /** Positions world-space labels. Call once per frame after cameras move. */
  update(camera: Camera, isAlive: (handle: Handle) => boolean): void {
    if (!this.labels.size) return
    const width = this.root.clientWidth
    const height = this.root.clientHeight
    for (const [id, entry] of this.labels) {
      if (!isAlive(entry.target)) {
        this.api.remove(id)
        continue
      }
      entry.target.object.getWorldPosition(world)
      world.y += entry.offsetY
      world.project(camera)
      const visible = world.z < 1 && Math.abs(world.x) <= 1.1 && Math.abs(world.y) <= 1.1
      entry.el.style.display = visible ? '' : 'none'
      if (visible) {
        entry.el.style.left = `${((world.x + 1) / 2) * width}px`
        entry.el.style.top = `${((1 - world.y) / 2) * height}px`
      }
    }
  }

  dispose(): void {
    this.root.remove()
    this.elements.clear()
    this.labels.clear()
  }

  private element(id: string, tag: string, className: string): HTMLElement {
    let el = this.elements.get(id)
    if (!el || el.tagName.toLowerCase() !== tag) {
      el?.remove()
      el = document.createElement(tag)
      el.className = className
      this.root.appendChild(el)
      this.elements.set(id, el)
    }
    return el
  }
}
