// Browser smoke test: boots the editor, plays the sample project and collects a coin.
// Run with `npm run test:e2e`. Not part of `npm test` (vitest only includes src/**/*.test.ts).
//
// Env:
//   E2E_PORT       dev server port (default 5199)
//   E2E_HEADED=1   show the browser
//   E2E_SCREENSHOT path to save a screenshot of the final state (also saved on failure)
import { spawn } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { chromium } from 'playwright'

const PORT = Number(process.env.E2E_PORT ?? 5199)
const URL = `http://localhost:${PORT}/`
const SERVER_TIMEOUT_MS = 120_000

function log(...args) {
  console.log('[e2e]', ...args)
}

function startServer() {
  const server = spawn('npm', ['run', 'dev', '--', '--port', String(PORT), '--strictPort'], {
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: process.platform !== 'win32', // own process group, so we can kill vite and its children
    env: { ...process.env, BROWSER: 'none', FORCE_COLOR: '0' },
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
  return { server, stop, output: () => output }
}

async function waitForServer(server, output) {
  const deadline = Date.now() + SERVER_TIMEOUT_MS
  while (Date.now() < deadline) {
    if (server.exitCode !== null) throw new Error(`dev server exited early (${server.exitCode}):\n${output()}`)
    try {
      const res = await fetch(URL)
      if (res.ok) return
    } catch {
      // not up yet
    }
    await sleep(250)
  }
  throw new Error(`dev server did not start within ${SERVER_TIMEOUT_MS / 1000}s:\n${output()}`)
}

function assert(condition, message) {
  if (!condition) throw new Error(`Assertion failed: ${message}`)
}

async function main() {
  const { server, stop, output } = startServer()
  const cleanup = () => stop()
  process.on('exit', cleanup)
  process.on('SIGINT', () => process.exit(130))
  process.on('SIGTERM', () => process.exit(143))

  let browser
  let page
  try {
    log(`starting dev server on ${URL}`)
    await waitForServer(server, output)
    log('dev server ready')

    browser = await chromium.launch({
      headless: !process.env.E2E_HEADED,
      args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
    })
    const context = await browser.newContext({ viewport: { width: 1400, height: 900 } })
    page = await context.newPage()

    const errors = []
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(`console.error: ${msg.text()}`)
    })
    page.on('pageerror', (error) => errors.push(`pageerror: ${error.stack ?? error.message}`))

    await page.goto(URL, { waitUntil: 'load' })

    // The editor renders into a canvas with a real size.
    const canvas = page.locator('canvas').first()
    await canvas.waitFor({ state: 'visible', timeout: 30_000 })
    const box = await canvas.boundingBox()
    assert(box && box.width > 100 && box.height > 100, `canvas has a usable size (got ${JSON.stringify(box)})`)
    log(`canvas ${Math.round(box.width)}x${Math.round(box.height)}`)

    // The sample project is loaded: scene title and entities in the hierarchy.
    const hierarchy = page.locator('.hierarchy')
    await hierarchy.getByText('Coin Rush', { exact: true }).first().waitFor({ timeout: 15_000 })
    for (const name of ['Player', 'Coins', 'Game Manager']) {
      await hierarchy.locator('.tree-name', { hasText: name }).first().waitFor({ timeout: 5_000 })
    }
    log('hierarchy shows Coin Rush')

    // Give WebGL a moment, then check that the canvas actually drew something.
    await page.waitForTimeout(1000)
    // WebGL canvases can't be read back without preserveDrawingBuffer, so inspect a screenshot instead.
    const shot = await canvas.screenshot()
    const colors = await page.evaluate(async (base64) => {
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
    log(`canvas shows ${colors} distinct colors`)
    assert(colors > 8, `canvas renders a scene, not a flat color (${colors} colors)`)

    // Play (the keyboard goes to the focused element, which is the page body here).
    await page.keyboard.press('Control+KeyP')
    log('pressed Ctrl+P, waiting for play mode')
    const hud = page.locator('.gu-hud')
    await hud.locator('.gu-stat-value').first().waitFor({ timeout: 15_000 })
    await page.waitForTimeout(5000)

    const before = (await hud.textContent()) ?? ''
    log(`HUD before moving: ${JSON.stringify(before)}`)
    assert(/\/ 32/.test(before), `HUD shows a coin counter out of 32 (got ${JSON.stringify(before)})`)

    // The player spawns at the origin; a coin sits at (6, 1, 0). Strafe right into it,
    // holding the key until the counter moves: software rendering can run the game far
    // below real time (frame deltas are capped), so a fixed hold time is unreliable.
    const counter = hud.locator('.gu-stat-value', { hasText: '/ 32' }).first()
    let text = ''
    await page.keyboard.down('KeyD')
    const deadline = Date.now() + 45_000
    while (Date.now() < deadline) {
      text = (await counter.textContent()) ?? ''
      if (/^[1-9]\d* \/ 32$/.test(text.trim())) break
      await page.waitForTimeout(100)
    }
    await page.keyboard.up('KeyD')
    log(`HUD after moving: ${JSON.stringify(text)}`)
    assert(/^[1-9]\d* \/ 32$/.test(text.trim()), `collected a coin (HUD says ${JSON.stringify(text)})`)

    assert(errors.length === 0, `no console errors or page errors, got:\n  ${errors.join('\n  ')}`)

    if (process.env.E2E_SCREENSHOT) await page.screenshot({ path: process.env.E2E_SCREENSHOT })
    log('PASS')
  } catch (error) {
    const shot = process.env.E2E_SCREENSHOT ?? 'test-results/e2e-failure.png'
    mkdirSync(dirname(shot), { recursive: true })
    if (page) await page.screenshot({ path: shot }).catch(() => {})
    console.error('[e2e] FAIL:', error instanceof Error ? error.message : error)
    if (page) console.error(`[e2e] screenshot saved to ${shot}`)
    process.exitCode = 1
  } finally {
    await browser?.close().catch(() => {})
    stop()
  }
}

await main()
