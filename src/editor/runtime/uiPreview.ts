import type { UiElementDoc } from '../document'
import { beginTransaction, currentScene, editorStore, endTransaction, selectUi, updateUiElement } from '../editor'
import { GameUi } from './gameUi'
import type { AssetResolver } from './nodes'
import { drawUiElement } from './sceneUi'

const CSS = `
.gu-root.gu-editing .gu-el { pointer-events: auto; cursor: move; user-select: none; }
.gu-root.gu-editing .gu-el.gu-selected { outline: 2px dashed #4c8dff; outline-offset: 3px; }
.gu-root.gu-editing .gu-el.gu-hidden { opacity: 0.35; }
`

/** Placeholder values for the editor: `{Coins:got}` previews as ‹Coins:got›. */
const previewValues = new Proxy({} as Record<string, unknown>, { get: (_, key) => `‹${String(key)}›` })

/**
 * The current scene's screen UI over the Game view in edit mode, drawn by the
 * same code as play mode. Click an element to select it; drag to move it.
 */
export class UiPreview {
  private readonly ui: GameUi
  private readonly drawn = new Map<string, UiElementDoc>()
  private drag: { id: string; x: number; y: number; startX: number; startY: number } | null = null
  private readonly unsubscribe: () => void

  constructor(
    container: HTMLElement,
    private readonly assets: AssetResolver,
  ) {
    this.ui = new GameUi(container)
    this.ui.root.classList.add('gu-editing')
    if (!document.getElementById('gu-editing-style')) {
      const style = document.createElement('style')
      style.id = 'gu-editing-style'
      style.textContent = CSS
      document.head.appendChild(style)
    }
    this.ui.root.addEventListener('pointerdown', this.onDown)
    this.unsubscribe = editorStore.subscribe(() => this.sync())
    this.sync()
  }

  dispose(): void {
    this.unsubscribe()
    this.endDrag()
    this.ui.root.removeEventListener('pointerdown', this.onDown)
    this.ui.dispose()
  }

  private sync(): void {
    const state = editorStore.get()
    const show = state.mode === 'edit' && state.view === 'game' && state.editing.kind === 'scene'
    this.ui.root.style.display = show ? '' : 'none'
    if (!show) return
    const elements = currentScene(state).ui
    const names = new Set(elements.map((e) => e.name))
    for (const [name] of this.drawn) {
      if (!names.has(name)) {
        this.ui.api.remove(name)
        this.drawn.delete(name)
      }
    }
    for (const el of elements) {
      if (this.drawn.get(el.name) !== el) {
        // Hidden elements stay visible (faded) so they can still be picked.
        const preview = { ...el, visible: true, value: el.type === 'bar' && !Number.isFinite(Number(el.value)) ? '0.6' : el.value }
        drawUiElement(this.ui, preview, previewValues, this.assets)
        this.drawn.set(el.name, el)
      }
      const node = this.ui.elementFor(el.name)
      node?.classList.toggle('gu-selected', state.uiSelection === el.id)
      node?.classList.toggle('gu-hidden', !el.visible)
    }
  }

  private readonly onDown = (e: PointerEvent) => {
    if (e.button !== 0) return
    const elements = currentScene(editorStore.get()).ui
    const hit = elements.find((el) => {
      const node = this.ui.elementFor(el.name)
      return node && (node === e.target || node.contains(e.target as Node))
    })
    if (!hit) return
    e.preventDefault()
    e.stopPropagation()
    selectUi(hit.id)
    this.drag = { id: hit.id, x: hit.x, y: hit.y, startX: e.clientX, startY: e.clientY }
    beginTransaction()
    window.addEventListener('pointermove', this.onMove)
    window.addEventListener('pointerup', this.endDrag)
  }

  private readonly onMove = (e: PointerEvent) => {
    if (!this.drag) return
    const step = e.shiftKey ? 10 : 1 // Shift snaps to 10 px
    const snap = (v: number) => Math.round(v / step) * step
    updateUiElement(this.drag.id, { x: snap(this.drag.x + e.clientX - this.drag.startX), y: snap(this.drag.y + e.clientY - this.drag.startY) })
  }

  private readonly endDrag = () => {
    if (this.drag) endTransaction()
    this.drag = null
    window.removeEventListener('pointermove', this.onMove)
    window.removeEventListener('pointerup', this.endDrag)
  }
}
