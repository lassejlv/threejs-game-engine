import { AudioContext as ThreeAudioContext, PerspectiveCamera } from 'three'
import { logListeners } from '../editor/console'
import { parseProject } from '../editor/document'
import type { AssetResolver } from '../editor/runtime/nodes'
import { createPlayScene } from '../editor/runtime/playScene'
import { Engine } from '../engine'

/**
 * Standalone game player. An exported game is one HTML file that sets
 * `window.__GAME__` (project + base64 assets) and inlines this bundle.
 */
interface GameBundle {
  project: unknown
  assets: Record<string, { name: string; data: string }>
}

const bundle = (window as unknown as { __GAME__?: GameBundle }).__GAME__
const container = document.getElementById('game')

if (!bundle || !container) {
  document.body.textContent = 'No game data found.'
} else {
  const project = parseProject(bundle.project)
  for (const level of ['log', 'warn', 'error'] as const) {
    logListeners.add((l, message) => l === level && console[level](message))
  }

  const urls = new Map<string, string>()
  const names = new Map<string, string>()
  for (const [id, asset] of Object.entries(bundle.assets)) {
    urls.set(id, dataUrlToObjectUrl(asset.data))
    names.set(asset.name, id)
  }
  const assets: AssetResolver = {
    url: (id) => urls.get(id) ?? null,
    byName: (name) =>
      names.get(name) ?? [...names].find(([file]) => file.replace(/\.\w+$/, '') === name)?.[1] ?? null,
  }

  document.title = project.name
  const engine = new Engine({ container })
  const fallbackCamera = new PerspectiveCamera(60, 1, 0.1, 1000)
  fallbackCamera.position.set(0, 5, 10)
  fallbackCamera.lookAt(0, 0, 0)

  const load = (sceneId: string) => {
    engine
      .loadScene(createPlayScene(project, sceneId, { assets, loadScene: load, fallbackCamera }))
      .catch((error: unknown) => console.error('[game] failed to load scene', error))
  }

  // Browsers need a user gesture before audio (and pointer lock) can start.
  const overlay = document.createElement('button')
  overlay.className = 'start'
  overlay.innerHTML = `<strong></strong><span>Click to play</span>`
  overlay.querySelector('strong')!.textContent = project.name
  overlay.addEventListener(
    'click',
    () => {
      void (ThreeAudioContext.getContext() as unknown as AudioContext).resume()
      overlay.remove()
      engine.canvas.focus()
      engine.start()
      load(project.scenes[0].id)
    },
    { once: true },
  )
  document.body.appendChild(overlay)
}

function dataUrlToObjectUrl(dataUrl: string): string {
  const [header, base64] = dataUrl.split(',', 2)
  const type = /data:([^;]+)/.exec(header)?.[1] ?? 'application/octet-stream'
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))
  return URL.createObjectURL(new Blob([bytes], { type }))
}
