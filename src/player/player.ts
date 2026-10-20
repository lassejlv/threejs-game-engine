import { AudioContext as ThreeAudioContext, PerspectiveCamera } from 'three'
import { logListeners } from '../editor/console'
import { parseProject } from '../editor/projectFormat'
import type { AssetResolver } from '../editor/runtime/nodes'
import { watchGraphics } from '../editor/runtime/graphicsNotice'
import { createPlayScene } from '../editor/runtime/playScene'
import { installWebGPUKit, type WebGPUKit } from '../editor/runtime/rendererKit'
import { Engine } from '../engine'
import { showErrors } from './errorScreen'

/**
 * Standalone game player. An exported game is one HTML file that sets
 * `window.__GAME__` (project + base64 assets) and inlines this bundle.
 * There are two builds: main.ts (WebGL) and main-webgpu.ts, which adds the
 * WebGPU kit for projects set to the WebGPU renderer.
 */
interface GameBundle {
  project: unknown
  assets: Record<string, { name: string; data: string }>
}

export async function startPlayer(gpu?: WebGPUKit): Promise<void> {
  const bundle = (window as unknown as { __GAME__?: GameBundle }).__GAME__
  const container = document.getElementById('game')
  if (!bundle || !container) {
    document.body.textContent = 'No game data found.'
    return
  }
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
  if (gpu) installWebGPUKit(gpu)
  const webgpu = !!gpu && project.settings.renderer === 'webgpu'
  let engine = new Engine({ container, renderer: webgpu ? 'webgpu' : 'webgl', webgpuRenderer: gpu?.Renderer })
  try {
    await engine.ready
  } catch (error) {
    console.error('[game] WebGPU renderer failed, using WebGL', error)
    engine.dispose()
    engine = new Engine({ container })
  }
  // Which renderer runs, for anyone inspecting the page (and the export tests).
  container.dataset.renderer = engine.backendName
  showErrors(engine)
  watchGraphics(engine)
  // ?e2e exposes the engine to automated tests; nothing in a game depends on it.
  if (new URLSearchParams(location.search).has('e2e')) Object.assign(window, { __game: { engine } })
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
