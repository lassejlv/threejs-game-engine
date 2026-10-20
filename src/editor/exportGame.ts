import { log } from './console'
import { assetReferences } from './document'
import { assetLibrary, editorStore, slug } from './editor'
import { zip } from './zip'

export interface BuildOptions {
  /** Include assets nothing in the project references (for scripts that build asset names at runtime). */
  includeUnused?: boolean
  /** Meshopt-compress models and re-encode textures as WebP. */
  compress?: boolean
  /** Extra tags for the <head> (web app manifest, service worker). */
  head?: string
}

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
 * Builds a self-contained HTML file: the player bundle, the project and the
 * assets it uses (base64). Runs from disk or any static host.
 */
export async function buildGameHtml(options: BuildOptions = {}): Promise<string> {
  const { doc, assets: metas } = editorStore.get()
  const { includeUnused = doc.settings.exportIncludeUnused, compress = doc.settings.exportCompress } = options
  const response = await fetch(`${import.meta.env.BASE_URL}player/player.js`)
  if (!response.ok) throw new Error('Player bundle not found. Run `npm run build:player`.')
  const player = await response.text()

  const assets: Record<string, { name: string; data: string }> = {}
  const skipped: string[] = []
  let saved = 0
  const compression = compress ? await import('./compressAssets') : null
  for (const meta of metas) {
    if (!includeUnused && assetReferences(doc, meta.id, meta.name).length === 0) {
      skipped.push(meta.name)
      continue
    }
    let blob = assetLibrary.blob(meta.id)
    if (!blob) continue
    if (compression) {
      const before = blob.size
      try {
        if (meta.kind === 'model' && /\.glb$/i.test(meta.name)) blob = await compression.compressModel(blob)
        else if (meta.kind === 'texture') blob = await compression.compressTexture(blob)
      } catch (error) {
        log('warn', `Couldn't compress ${meta.name}; exporting it as is.`, error)
      }
      saved += before - blob.size
    }
    assets[meta.id] = { name: meta.name, data: await blobToDataUrl(blob) }
  }
  if (skipped.length) log('log', `Left out ${skipped.length} unused asset${skipped.length === 1 ? '' : 's'}: ${skipped.join(', ')}`)
  if (saved > 0) log('log', `Compression saved ${(saved / 1024 / 1024).toFixed(2)} MB`)
  // `<` escaped so nothing in the data can close the script tag.
  const data = JSON.stringify({ project: doc, assets }).replace(/</g, '\\u003c')
  const code = player.replace(/<\/script/gi, '<\\/script')
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(doc.name)}</title>
<style>${PAGE_STYLE}</style>${options.head ?? ''}
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

/**
 * Downloads an installable web app (.zip): the game plus a manifest, icons and
 * a service worker that caches it, so it can be added to a home screen and run offline.
 */
export async function downloadWebApp(): Promise<void> {
  try {
    log('log', 'Building web app…')
    const { doc } = editorStore.get()
    const name = slug(doc.name)
    const head = `
<link rel="manifest" href="manifest.webmanifest">
<meta name="theme-color" content="#0b0f17">
<link rel="icon" href="icon-192.png">
<link rel="apple-touch-icon" href="icon-192.png">
<script>if ('serviceWorker' in navigator) addEventListener('load', () => navigator.serviceWorker.register('sw.js'))</script>`
    const html = await buildGameHtml({ head })
    const manifest = {
      name: doc.name,
      short_name: doc.name.slice(0, 12),
      start_url: '.',
      display: 'fullscreen',
      orientation: 'landscape',
      background_color: '#0b0f17',
      theme_color: '#0b0f17',
      icons: [192, 512].map((size) => ({ src: `icon-${size}.png`, sizes: `${size}x${size}`, type: 'image/png' })),
    }
    const files = ['./', 'index.html', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png']
    const worker = `// Cache-first: the whole game is one file, so after the first visit it runs offline.
const CACHE = ${JSON.stringify(`${name}-${Date.now()}`)}
self.addEventListener('install', (e) => e.waitUntil(caches.open(CACHE).then((c) => c.addAll(${JSON.stringify(files)})).then(() => self.skipWaiting())))
self.addEventListener('activate', (e) => e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())))
self.addEventListener('fetch', (e) => e.respondWith(caches.match(e.request).then((hit) => hit || fetch(e.request))))
`
    const blob = zip([
      { name: 'index.html', data: html },
      { name: 'manifest.webmanifest', data: JSON.stringify(manifest, null, 2) },
      { name: 'sw.js', data: worker },
      { name: 'icon-192.png', data: await appIcon(doc.name, 192) },
      { name: 'icon-512.png', data: await appIcon(doc.name, 512) },
      { name: 'README.txt', data: `${doc.name}\n\nUpload these files to any HTTPS static host (itch.io, GitHub Pages, Netlify).\nVisitors can then install the game from the browser menu and play offline.\n` },
    ])
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `${name}.zip`
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 5000)
    log('log', `Exported ${name}.zip (${(blob.size / 1024 / 1024).toFixed(1)} MB)`)
  } catch (error) {
    log('error', 'Export failed:', error)
  }
}

/** A simple square app icon: the project's initial on a gradient. */
async function appIcon(title: string, size: number): Promise<Uint8Array> {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const ctx = canvas.getContext('2d')!
  const gradient = ctx.createLinearGradient(0, 0, size, size)
  gradient.addColorStop(0, '#4c8dff')
  gradient.addColorStop(1, '#7a5cff')
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, size, size)
  ctx.fillStyle = '#ffffff'
  ctx.font = `700 ${Math.round(size * 0.55)}px system-ui, sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText((title.trim()[0] ?? 'G').toUpperCase(), size / 2, size * 0.54)
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
  return new Uint8Array(await blob!.arrayBuffer())
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
    // A quick test run: skip compression.
    const html = await buildGameHtml({ compress: false })
    tab.location.href = URL.createObjectURL(new Blob([html], { type: 'text/html' }))
  } catch (error) {
    tab.close()
    log('error', 'Build failed:', error)
  }
}
