// Browser smoke test: the editor loads, renders Coin Rush, plays it, a coin
// can be collected, the scene stays within its draw-call budget, and the game
// survives the browser resetting the graphics context.
//
// Run with `npm run test:e2e` (E2E_BROWSER=firefox|webkit for other browsers).
// Not part of `npm test` (vitest only includes src/**/*.test.ts).

import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { assert, budgets, collectErrors, countColors, describeGpu, failureShot, launch, logger, startDevServer } from './harness.mjs'

const log = logger('smoke')
const PORT = Number(process.env.E2E_PORT ?? 5199)

async function main() {
  const dev = startDevServer(PORT)
  process.on('SIGINT', () => process.exit(130))
  process.on('SIGTERM', () => process.exit(143))
  let browser
  let page
  try {
    log(`starting dev server on ${dev.url}`)
    await dev.ready()
    log('dev server ready')

    browser = await launch()
    page = await (await browser.newContext({ viewport: { width: 1400, height: 900 } })).newPage()
    // The test loses the context on purpose: three may log that, and WebKit complains when objects made
    // before the loss are disposed afterwards (their GL handles belong to the old context). Both are harmless.
    const errors = collectErrors(page, [/Context Lost/i, /does not belong to this context/])
    await page.goto(dev.url, { waitUntil: 'load' })
    log(await describeGpu(page))

    // The editor renders into a canvas with a real size.
    const canvas = page.locator('canvas').first()
    await canvas.waitFor({ state: 'visible', timeout: 30_000 })
    const box = await canvas.boundingBox()
    assert(box && box.width > 100 && box.height > 100, `canvas has a usable size (got ${JSON.stringify(box)})`)
    log(`canvas ${Math.round(box.width)}x${Math.round(box.height)}`)

    // The sample project is open: it is saved in the throwaway projects folder, and its entities are in the hierarchy.
    await page.locator('.save-status', { hasText: /Saved/ }).waitFor({ timeout: 30_000 })
    const hierarchy = page.locator('.hierarchy')
    await hierarchy.getByText('Coin Rush', { exact: true }).first().waitFor({ timeout: 15_000 })
    for (const name of ['Player', 'Coins', 'Game Manager']) {
      await hierarchy.locator('.tree-name', { hasText: name }).first().waitFor({ timeout: 5_000 })
    }
    log(`hierarchy shows Coin Rush (${await page.locator('.save-status').innerText()})`)

    await page.waitForTimeout(1000)
    const colors = await countColors(page, canvas)
    log(`canvas shows ${colors} distinct colors`)
    if (colors <= 8) log(`errors so far:\n  ${errors.join('\n  ') || '(none)'}`)
    assert(colors > 8, `canvas renders a scene, not a flat color (${colors} colors)`)

    // Play (the keyboard goes to the focused element, which is the page body here).
    await page.keyboard.press('Control+KeyP')
    log('pressed Ctrl+P, waiting for play mode')
    const hud = page.locator('.gu-hud')
    await hud.locator('.gu-stat-value').first().waitFor({ timeout: 15_000 })
    await page.waitForTimeout(5000)

    // Performance budget: instancing keeps Coin Rush's draw calls low (budgets.json).
    const stats = await page.evaluate(() => window.__engine.stats.get())
    log(`play stats: ${stats.drawCalls} draw calls, ${stats.triangles} triangles, ${stats.frameMs.toFixed(1)} ms CPU`)
    assert(stats.drawCalls > 0 && stats.drawCalls <= budgets.coinRushDrawCalls, `draw calls within budget (${stats.drawCalls} > ${budgets.coinRushDrawCalls})`)
    assert(stats.triangles <= budgets.coinRushTriangles, `triangles within budget (${stats.triangles} > ${budgets.coinRushTriangles})`)

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

    // The browser resets the graphics context: the game must come back without a reload.
    const lost = await page.evaluate(() => {
      const gl = document.querySelector('canvas').getContext('webgl2')
      const ext = gl?.getExtension('WEBGL_lose_context')
      if (!ext) return false
      ext.loseContext()
      window.__restoreGl = () => ext.restoreContext()
      return true
    })
    if (lost) {
      await page.locator('.graphics-notice', { hasText: 'Restoring' }).waitFor({ timeout: 5_000 })
      await page.waitForTimeout(500)
      await page.evaluate(() => window.__restoreGl())
      await page.locator('.graphics-notice').waitFor({ state: 'detached', timeout: 10_000 })
      const frame = await page.evaluate(() => window.__engine.time.frame)
      await page.waitForTimeout(2000)
      const after = await countColors(page, canvas)
      const advanced = (await page.evaluate(() => window.__engine.time.frame)) - frame
      log(`after a context loss and restore: ${after} colors, ${advanced} frames`)
      assert(after > 8 && advanced > 0, 'the game renders and runs again after the context is restored')
    } else log('WEBGL_lose_context unavailable: skipped the context-loss check')

    // Trust: an imported project's script must not run until the user allows it.
    await page.keyboard.press('Control+KeyP') // back to edit mode
    const playButton = page.locator('button[title="Play (Ctrl+P)"]')
    await playButton.waitFor({ timeout: 15_000 })
    const shared = join(mkdtempSync(join(tmpdir(), 'ge-trust-')), 'shared.json')
    const doc = JSON.parse(readFileSync(new URL('../src/editor/fixtures/v3.json', import.meta.url), 'utf8'))
    doc.name = 'Shared Game'
    doc.scripts = [{ id: 'mark', name: 'Mark', source: "document.title = 'script ran'\nexport default {}" }]
    doc.scenes[0].entities[0].scripts.push({ script: 'mark', params: {} })
    writeFileSync(shared, JSON.stringify(doc))
    await page.locator('input[type=file][accept*=".zip"]').setInputFiles(shared)
    await page.locator('.trust-banner').waitFor({ timeout: 15_000 })
    const titleBefore = await page.title()
    await page.keyboard.press('Control+KeyP')
    await page.locator('.trust-dialog').waitFor({ timeout: 5_000 })
    assert((await page.title()) === titleBefore, 'the imported script has not run while the trust dialog is open')
    await page.locator('.trust-dialog').getByRole('button', { name: 'Cancel' }).click()
    await page.waitForTimeout(1000)
    assert((await page.title()) === titleBefore && (await playButton.count()) === 1, 'Cancel neither plays nor runs the script')
    await page.keyboard.press('Control+KeyP')
    await page.locator('.trust-dialog').getByRole('button', { name: 'Run scripts' }).click()
    await page.waitForFunction(() => document.title === 'script ran', null, { timeout: 30_000 })
    assert((await page.locator('.trust-banner').count()) === 0, 'the paused-scripts banner is gone once trusted')
    log('imported scripts waited for trust, then ran')

    assert(errors.length === 0, `no console errors or page errors, got:\n  ${errors.join('\n  ')}`)
    log('PASS')
  } catch (error) {
    const shot = await failureShot(page, 'smoke-failure')
    console.error('[smoke] FAIL:', error instanceof Error ? error.message : error)
    console.error(`[smoke] screenshot saved to ${shot}`)
    process.exitCode = 1
  } finally {
    await browser?.close().catch(() => {})
    dev.stop()
  }
}

await main()
