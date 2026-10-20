import type { Engine } from '../engine'
import { logListeners } from '../editor/console'

const CSS = `
.ge-errors { position: fixed; left: 12px; bottom: 12px; z-index: 40; max-width: min(560px, calc(100vw - 24px)); font: 13px/1.4 ui-sans-serif, system-ui, sans-serif; color: #fff; }
.ge-errors > button { font: inherit; font-weight: 600; color: #fff; background: #a3323a; border: 0; border-radius: 6px; padding: 6px 10px; cursor: pointer; box-shadow: 0 4px 14px rgba(0,0,0,.35); }
.ge-errors ol { margin: 8px 0 0; padding: 10px 12px 10px 28px; max-height: 40vh; overflow: auto; background: rgba(16,18,24,.94); border-radius: 6px; font: 12px/1.45 ui-monospace, monospace; white-space: pre-wrap; }
.ge-fatal { position: fixed; inset: 0; z-index: 50; display: grid; place-items: center; background: rgba(8,10,14,.86); color: #fff; font: 15px/1.5 ui-sans-serif, system-ui, sans-serif; text-align: center; padding: 24px; }
.ge-fatal pre { max-width: min(720px, 90vw); white-space: pre-wrap; text-align: left; font: 12px/1.45 ui-monospace, monospace; background: rgba(255,255,255,.06); padding: 10px 12px; border-radius: 6px; }
.ge-fatal button { font: inherit; font-weight: 600; color: #fff; background: #4c8dff; border: 0; border-radius: 8px; padding: 8px 18px; cursor: pointer; }
`

/**
 * Shows problems in an exported game instead of only in the browser console:
 * script errors, failed asset loads and uncaught exceptions collect in a small
 * "errors" button the player can open; an error that stops the game loop gets
 * a full-screen message with a Reload button.
 */
export function showErrors(engine: Engine): () => void {
  const style = Object.assign(document.createElement('style'), { textContent: CSS })
  document.head.appendChild(style)
  const box = Object.assign(document.createElement('div'), { className: 'ge-errors' })
  const toggle = Object.assign(document.createElement('button'), { type: 'button' })
  const list = document.createElement('ol')
  list.hidden = true
  box.append(toggle, list)
  let count = 0

  const add = (message: string) => {
    count++
    const item = document.createElement('li')
    item.textContent = message
    list.appendChild(item)
    // Keep the newest 50.
    while (list.children.length > 50) list.firstElementChild?.remove()
    toggle.textContent = `⚠ ${count} error${count === 1 ? '' : 's'}`
    if (!box.isConnected) document.body.appendChild(box)
  }
  toggle.addEventListener('click', () => (list.hidden = !list.hidden))

  const onLog = (level: string, message: string) => {
    if (level === 'error') add(message)
  }
  const onError = (event: ErrorEvent) => add(event.message || String(event.error))
  const onRejection = (event: PromiseRejectionEvent) => add(`Unhandled: ${event.reason instanceof Error ? event.reason.message : String(event.reason)}`)
  logListeners.add(onLog)
  window.addEventListener('error', onError)
  window.addEventListener('unhandledrejection', onRejection)
  const offFatal = engine.events.on('error', ({ error }) => {
    const fatal = Object.assign(document.createElement('div'), { className: 'ge-fatal' })
    fatal.setAttribute('role', 'alert')
    const text = error instanceof Error ? `${error.message}\n${error.stack ?? ''}` : String(error)
    fatal.innerHTML = '<div><p><strong>The game stopped because of an error.</strong></p><pre></pre><button type="button">Reload</button></div>'
    fatal.querySelector('pre')!.textContent = text
    fatal.querySelector('button')!.addEventListener('click', () => location.reload())
    document.body.appendChild(fatal)
  })

  return () => {
    logListeners.delete(onLog)
    window.removeEventListener('error', onError)
    window.removeEventListener('unhandledrejection', onRejection)
    offFatal()
    box.remove()
    style.remove()
  }
}
