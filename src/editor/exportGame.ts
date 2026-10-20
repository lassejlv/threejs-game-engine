import { log } from './console'
import { assetLibrary, editorStore, slug } from './editor'

const PAGE_STYLE = `html,body{margin:0;height:100%;background:#0b0f17;overflow:hidden;font-family:system-ui,-apple-system,'Segoe UI',sans-serif}
#game{position:fixed;inset:0}
.start{position:fixed;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;border:0;margin:0;background:radial-gradient(circle at 50% 40%,#1f2738,#0b0f17);color:#fff;cursor:pointer;font:inherit;z-index:10}
.start strong{font-size:clamp(24px,5vw,40px);letter-spacing:.01em}
.start span{opacity:.8;font-size:14px;padding:8px 18px;border:1px solid rgba(255,255,255,.3);border-radius:999px}
.start:hover span{background:rgba(255,255,255,.08)}`

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)
}

/**
 * Builds a self-contained HTML file: the player bundle, the project and
 * every imported asset (base64). Runs from disk or any static host.
 */
export async function buildGameHtml(): Promise<string> {
  const { doc, assets: metas } = editorStore.get()
  const response = await fetch(`${import.meta.env.BASE_URL}player/player.js`)
  if (!response.ok) throw new Error('Player bundle not found. Run `npm run build:player`.')
  const player = await response.text()

  const assets: Record<string, { name: string; data: string }> = {}
  for (const meta of metas) {
    const blob = assetLibrary.blob(meta.id)
    if (blob) assets[meta.id] = { name: meta.name, data: await blobToDataUrl(blob) }
  }
  // `<` escaped so nothing in the data can close the script tag.
  const data = JSON.stringify({ project: doc, assets }).replace(/</g, '\\u003c')
  const code = player.replace(/<\/script/gi, '<\\/script')
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(doc.name)}</title>
<style>${PAGE_STYLE}</style>
</head>
<body>
<div id="game"></div>
<script>window.__GAME__=${data}</script>
<script type="module">${code}</script>
</body>
</html>
`
}

/** Downloads the game as `<name>.html`. */
export async function downloadGame(): Promise<void> {
  try {
    log('log', 'Building game…')
    const html = await buildGameHtml()
    const name = `${slug(editorStore.get().doc.name)}.html`
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([html], { type: 'text/html' }))
    a.download = name
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 5000)
    log('log', `Exported ${name} (${(html.length / 1024 / 1024).toFixed(1)} MB)`)
  } catch (error) {
    log('error', 'Export failed:', error)
  }
}

/** Opens the built game in a new tab. The tab is opened first so popup blockers allow it. */
export async function runGameInTab(): Promise<void> {
  const tab = window.open('', '_blank')
  if (!tab) {
    log('warn', 'The browser blocked the new tab.')
    return
  }
  tab.document.write('<p style="font:14px system-ui;color:#888;padding:20px">Building game…</p>')
  try {
    const html = await buildGameHtml()
    tab.location.href = URL.createObjectURL(new Blob([html], { type: 'text/html' }))
  } catch (error) {
    tab.close()
    log('error', 'Build failed:', error)
  }
}
