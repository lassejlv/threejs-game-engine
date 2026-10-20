import type { Engine } from '../../engine'

const STYLE = `position:absolute;left:50%;top:16px;transform:translateX(-50%);z-index:30;padding:8px 14px;border-radius:8px;
font:600 13px/1.4 ui-sans-serif,system-ui,sans-serif;color:#fff;background:rgba(20,24,32,.88);box-shadow:0 6px 20px rgba(0,0,0,.4);pointer-events:auto`

/**
 * Tells the player when the GPU context is lost (the browser or driver reset
 * the graphics) and when it is back. Returns a function that stops watching.
 */
export function watchGraphics(engine: Engine): () => void {
  let note: HTMLDivElement | null = null
  const show = (html: string) => {
    note ??= Object.assign(document.createElement('div'), { className: 'graphics-notice' })
    note.style.cssText = STYLE
    note.innerHTML = html
    note.setAttribute('role', 'status')
    if (!note.isConnected) engine.container.appendChild(note)
  }
  const offLost = engine.events.on('contextLost', ({ recoverable }) => {
    if (recoverable) show('Graphics were reset by the browser. Restoring…')
    else {
      show('The graphics device was lost. <button type="button">Reload</button>')
      note?.querySelector('button')?.addEventListener('click', () => location.reload())
    }
  })
  const offRestored = engine.events.on('contextRestored', () => {
    note?.remove()
  })
  return () => {
    offLost()
    offRestored()
    note?.remove()
  }
}
