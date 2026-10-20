// Shared pieces of the browser tests: a dev server with a throwaway projects
// folder, the browser to test with (E2E_BROWSER=chromium|firefox|webkit), a
// static server for exported games, and a check that a canvas drew something.

import { spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, extname, join, normalize } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { chromium, firefox, webkit } from 'playwright'

export const BROWSER = process.env.E2E_BROWSER ?? 'chromium'
export const budgets = JSON.parse(readFileSync(new URL('../budgets.json', import.meta.url), 'utf8'))

export function logger(name) {
  return (...args) => console.log(`[${name}:${BROWSER}]`, ...args)
}

export function assert(condition, message) {
  if (!condition) throw new Error(`Assertion failed: ${message}`)
}

/** `npm run dev` on `port`, with its own projects folder and file-server port. */
export function startDevServer(port) {
  const projects = mkdtempSync(join(tmpdir(), 'ge-e2e-projects-'))
  const server = spawn('npm', ['run', 'dev', '--', '--port', String(port), '--strictPort'], {
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: process.platform !== 'win32', // own process group, so vite and its children can be killed together
    env: { ...process.env, BROWSER: 'none', FORCE_COLOR: '0', GE_PROJECTS_DIR: projects, GE_FILES_PORT: String(port + 1) },
  })
  let output = ''
  server.stdout.on('data', (chunk) => (output += chunk))
  server.stderr.on('data', (chunk) => (output += chunk))
  const stop = () => {
    if (server.exitCode !== null) return
    try {
      if (process.platform === 'win32') server.kill()
      else process.kill(-server.pid, 'SIGTERM')
    } catch {
      // already gone
    }
  }
  process.on('exit', stop)
  const url = `http://localhost:${port}/`
  const ready = async (timeout = 120_000) => {
    const deadline = Date.now() + timeout
    while (Date.now() < deadline) {
      if (server.exitCode !== null) throw new Error(`dev server exited early (${server.exitCode}):\n${output}`)
      try {
        if ((await fetch(url)).ok) return
      } catch {
        // not up yet
      }
      await sleep(250)
    }
    throw new Error(`dev server did not start within ${timeout / 1000}s:\n${output}`)
  }
  return { url, ready, stop, projects }
}

/** Launches the browser under test. `webgpu` adds the flags headless Chromium needs for a real WebGPU adapter. */
export function launch({ webgpu = false } = {}) {
  const headless = !process.env.E2E_HEADED
  if (BROWSER === 'firefox') return firefox.launch({ headless, firefoxUserPrefs: { 'webgl.force-enabled': true } })
  if (BROWSER === 'webkit') return webkit.launch({ headless })
  const args = ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']
  if (webgpu) args.push('--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-vulkan=swiftshader', '--use-webgpu-adapter=swiftshader')
  return chromium.launch({ headless, args })
}

/** Collects console errors and page errors, for an "nothing went wrong" assertion. */
export function collectErrors(page, ignore = []) {
  const errors = []
  page.on('console', (msg) => {
    if (msg.type() === 'error' && !ignore.some((re) => re.test(msg.text()))) errors.push(`console.error: ${msg.text()}`)
  })
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.stack ?? error.message}`))
  return errors
}

/**
 * Distinct colors in a screenshot of `locator`, sampled at 64×64. WebGL canvases
 * can't be read back without preserveDrawingBuffer, so this inspects a screenshot.
 */
export async function countColors(page, locator) {
  const shot = await locator.screenshot()
  return page.evaluate(async (base64) => {
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))
    const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }))
    const probe = document.createElement('canvas')
    probe.width = 64
    probe.height = 64
    const ctx = probe.getContext('2d')
    ctx.drawImage(bitmap, 0, 0, 64, 64)
    const data = ctx.getImageData(0, 0, 64, 64).data
    const seen = new Set()
    for (let i = 0; i < data.length; i += 4) seen.add(`${data[i] >> 4},${data[i + 1] >> 4},${data[i + 2] >> 4}`)
    return seen.size
  }, shot.toString('base64'))
}

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png' }

/** Serves a folder over http (exported games behave as on a static host). */
export async function serveDir(dir) {
  const server = createServer((req, res) => {
    const path = normalize(join(dir, decodeURIComponent(new URL(req.url, 'http://x').pathname)))
    if (!path.startsWith(dir)) return res.writeHead(403).end()
    try {
      const body = readFileSync(path)
      res.writeHead(200, { 'content-type': TYPES[extname(path)] ?? 'application/octet-stream' }).end(body)
    } catch {
      res.writeHead(404).end()
    }
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  return { url: `http://127.0.0.1:${server.address().port}/`, close: () => server.close() }
}

/** Saves a screenshot for debugging a failure. */
export async function failureShot(page, name) {
  const shot = process.env.E2E_SCREENSHOT_DIR ? join(process.env.E2E_SCREENSHOT_DIR, `${name}-${BROWSER}.png`) : `test-results/${name}-${BROWSER}.png`
  mkdirSync(dirname(shot), { recursive: true })
  await page?.screenshot({ path: shot }).catch(() => {})
  return shot
}
