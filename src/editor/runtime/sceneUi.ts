import type { UiElementDoc } from '../document'
import type { GameUi } from './gameUi'
import type { AssetResolver } from './nodes'

const PLACEHOLDER = /\{([^{}]+)\}/g

/** `{key}` placeholders filled from `values` (numbers get at most one decimal). */
export function fillText(text: string, values: Record<string, unknown>): string {
  return text.replace(PLACEHOLDER, (_, key: string) => {
    const v = values[key.trim()]
    if (v === undefined || v === null) return ''
    return typeof v === 'number' && !Number.isInteger(v) ? v.toFixed(1) : String(v)
  })
}

/** A bar's fill (0..1) from a number, a values key, or `a/b` (two keys or numbers). */
export function barValue(expression: string, values: Record<string, unknown>): number {
  const read = (part: string) => {
    const n = Number(part.trim())
    return Number.isFinite(n) && part.trim() !== '' ? n : Number(values[part.trim()] ?? 0)
  }
  const slash = expression.lastIndexOf('/')
  if (slash > 0) {
    const b = read(expression.slice(slash + 1))
    return b === 0 ? 0 : read(expression.slice(0, slash)) / b
  }
  return read(expression)
}

/** Whether an element changes with the values (so play mode refreshes it every frame). */
export function isLive(el: UiElementDoc): boolean {
  return el.text.includes('{') || (el.type === 'bar' && !Number.isFinite(Number(el.value)))
}

/** Draws one scene UI element (by its name) into a GameUi. */
export function drawUiElement(
  ui: GameUi,
  el: UiElementDoc,
  values: Record<string, unknown>,
  assets: AssetResolver,
  onClick: () => void = () => {},
): void {
  if (!el.visible) {
    ui.api.remove(el.name)
    return
  }
  const style = {
    anchor: el.anchor,
    x: el.x,
    y: el.y,
    size: el.size,
    color: el.color,
    background: el.background || undefined,
    width: el.width || undefined,
  }
  switch (el.type) {
    case 'text':
      ui.api.text(el.name, fillText(el.text, values), style)
      break
    case 'button':
      ui.api.button(el.name, fillText(el.text, values), onClick, style)
      break
    case 'bar':
      ui.api.bar(el.name, barValue(el.value, values), { ...style, label: fillText(el.text, values) || undefined, fill: el.fill })
      break
    case 'image': {
      const url = el.image ? assets.url(el.image) : null
      if (url) ui.api.image(el.name, url, style)
      else ui.api.remove(el.name)
      break
    }
  }
}
