// Export test: every template is exported through Build → Download game, served
// like a static host, started and played. Each game must render, react to input
// (its player moves), stay error-free and start within the load budgets.
// Chromium also exports one WebGPU game and checks the error screen with a
// deliberately broken script.
//
// Run with `npm run test:exports` (E2E_BROWSER=firefox|webkit for other browsers).

import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { assert, BROWSER, budgets, collectErrors, countColors, describeGpu, failureShot, launch, logger, serveDir, startDevServer } from './harness.mjs'

const log = logger('exports')
const PORT = Number(process.env.E2E_EXPORT_PORT ?? 5209)

/** Templates, the key that moves their player, and which object should move. */
const ALL_GAMES = [
  { card: 'Coin Rush', file: 'coin-rush', key: 'KeyD', mover: 'Player' },
  { card: 'Sky Hopper', file: 'sky-hopper', key: 'KeyD', mover: 'Player' },
  { card: 'Arena', file: 'arena', key: 'KeyW', mover: 'Player' },
  { card: 'Kart Loop', file: 'kart-loop', key: 'KeyW', mover: 'Kart' },
  { card: 'Empty', file: 'empty' },
]

// E2E_GAMES=coin-rush,arena runs a subset (Coin Rush is always kept: the error-screen check uses it).
const only = process.env.E2E_GAMES?.split(',')
const GAMES = only ? ALL_GAMES.filter((g) => g.file === 'coin-rush' || only.includes(g.file)) : ALL_GAMES

async function newProject(editor, card) {
  await editor.getByRole('button', { name: 'File' }).click()
  await editor.getByText('New project…').click()
  await editor.locator('.template-card', { hasText: card }).click()
  await editor.locator('.save-status', { hasText: /Saved/ }).waitFor({ timeout: 30_000 })
}

async function exportGame(editor, dir, file) {
  await editor.getByRole('button', { name: /Build/ }).click()
  const [download] = await Promise.all([editor.waitForEvent('download', { timeout: 120_000 }), editor.getByText('Download game (.html)').click()])
  const path = join(dir, `${file}.html`)
  await download.saveAs(path)
  return path
}

async function setRenderer(editor, renderer) {
  await editor.getByRole('button', { name: 'File' }).click()
  await editor.getByText('Project settings…').click()
  await editor.locator('.dialog .field', { has: editor.locator('.field-label', { hasText: 'Renderer' }) }).locator('select').selectOption(renderer)
  await editor.keyboard.press('Escape')
  await editor.waitForTimeout(800)
}

/** Opens an exported game, starts it and returns timings. */
async function start(page, url) {
  const t0 = Date.now()
  await page.goto(`${url}?e2e`)
  await page.locator('button.start').waitFor({ timeout: budgets.exportStartScreenMs })
  const startScreenMs = Date.now() - t0
  const t1 = Date.now()
  await page.locator('button.start').click()
  await page.waitForFunction(() => window.__game?.engine.activeScene && window.__game.engine.time.frame > 3, null, {
    timeout: budgets.exportFirstFrameMs,
  })
  return { startScreenMs, firstFrameMs: Date.now() - t1 }
}

/** Holds `key` until the named object has moved, or the time runs out. */
async function moveWith(page, key, mover) {
  const where = () => page.evaluate((name) => window.__game.engine.scene.getObjectByName(name)?.position.toArray(), mover)
  const from = await where()
  assert(from, `the game has an object named ${mover}`)
  await page.keyboard.down(key)
  let moved = 0
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline && moved < 0.5) {
    await page.waitForTimeout(200)
    const now = await where()
    moved = Math.hypot(now[0] - from[0], now[1] - from[1], now[2] - from[2])
  }
  await page.keyboard.up(key)
  return moved
}

/** Adds a script that throws every frame to an exported game's data. */
function breakGame(html) {
  const start = html.indexOf('window.__GAME__=') + 'window.__GAME__='.length
  const end = html.indexOf('</script>', start)
  const game = JSON.parse(html.slice(start, end))
  game.project.scripts.push({ id: 'boom', name: 'Boom', source: "export default { update() { throw new Error('boom') } }" })
  // A plain entity: on a prefab instance, scripts only override the prefab's parameters.
  game.project.scenes[0].entities.find((e) => !e.prefab).scripts.push({ script: 'boom', params: {} })
  return html.slice(0, start) + JSON.stringify(game).replace(/</g, '\\u003c') + html.slice(end)
}

async function main() {
  const dev = startDevServer(PORT)
  const out = mkdtempSync(join(tmpdir(), 'ge-exports-'))
  let browser
  let page
  try {
    await dev.ready()
    browser = await launch()
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, acceptDownloads: true })
    const editor = await context.newPage()
    const editorErrors = collectErrors(editor)
    await editor.goto(dev.url)
    log(await describeGpu(editor))
    await editor.locator('.save-status', { hasText: /Saved/ }).waitFor({ timeout: 60_000 })

    for (const game of GAMES) {
      await newProject(editor, game.card)
      await exportGame(editor, out, game.file)
      log(`exported ${game.card}`)
    }
    if (BROWSER === 'chromium') {
      await newProject(editor, 'Sky Hopper')
      await setRenderer(editor, 'webgpu')
      await exportGame(editor, out, 'sky-hopper-webgpu')
      log('exported Sky Hopper with the WebGPU renderer')
    }
    assert(editorErrors.length === 0, `no editor errors, got:\n  ${editorErrors.join('\n  ')}`)
    await editor.close()
    writeFileSync(join(out, 'broken.html'), breakGame(readFileSync(join(out, 'coin-rush.html'), 'utf8')))

    const site = await serveDir(out)
    const timings = []
    for (const game of GAMES) {
      page = await context.newPage()
      const errors = collectErrors(page)
      const { startScreenMs, firstFrameMs } = await start(page, `${site.url}${game.file}.html`)
      timings.push({ game: game.card, startScreenMs, firstFrameMs })
      await page.waitForTimeout(1000)
      const colors = await countColors(page, page.locator('#game canvas'))
      assert(colors > 8, `${game.card} renders a scene (${colors} colors)`)
      let detail = `${colors} colors`
      if (game.key) {
        const moved = await moveWith(page, game.key, game.mover)
        assert(moved >= 0.5, `${game.card}: ${game.mover} moves when ${game.key} is held (moved ${moved.toFixed(2)})`)
        detail += `, ${game.mover} moved ${moved.toFixed(1)} m`
      }
      assert((await page.locator('.ge-errors').count()) === 0, `${game.card} shows no errors`)
      assert(errors.length === 0, `${game.card}: no console errors, got:\n  ${errors.join('\n  ')}`)
      log(`${game.card}: start screen ${startScreenMs} ms, first frames ${firstFrameMs} ms, ${detail}`)
      await page.close()
    }

    // A script that throws: the game keeps running and says so on screen.
    page = await context.newPage()
    await start(page, `${site.url}broken.html`)
    const badge = page.locator('.ge-errors > button')
    await badge.waitFor({ timeout: 15_000 })
    await badge.click()
    const shown = await page.locator('.ge-errors ol').innerText()
    assert(/boom/.test(shown), `the error screen names the error (got ${JSON.stringify(shown)})`)
    log(`broken script: "${(await badge.innerText()).trim()}" with "${shown.split('\n')[0].slice(0, 80)}"`)
    await page.close()

    if (BROWSER === 'chromium') {
      // WebGPU: a separate browser with the flags headless Chromium needs for an adapter.
      const gpuBrowser = await launch({ webgpu: true })
      page = await gpuBrowser.newPage()
      const errors = collectErrors(page)
      const { firstFrameMs } = await start(page, `${site.url}sky-hopper-webgpu.html`)
      // Probed on the game's page: navigator.gpu needs a secure context (about:blank isn't one).
      const hasAdapter = await page.evaluate(async () => !!(await navigator.gpu?.requestAdapter()))
      await page.waitForTimeout(1000)
      const renderer = await page.locator('#game').getAttribute('data-renderer')
      const colors = await countColors(page, page.locator('#game canvas'))
      assert(colors > 8, `the WebGPU game renders (${colors} colors)`)
      assert(renderer === (hasAdapter ? 'WebGPU' : 'WebGL 2 (WebGPU fallback)'), `runs on ${hasAdapter ? 'WebGPU' : 'the WebGL fallback'} (got ${renderer})`)
      const moved = await moveWith(page, 'KeyD', 'Player')
      assert(moved >= 0.5, `the WebGPU game reacts to input (moved ${moved.toFixed(2)})`)
      assert(errors.length === 0, `WebGPU game: no console errors, got:\n  ${errors.join('\n  ')}`)
      log(`Sky Hopper on ${renderer}: first frames ${firstFrameMs} ms, ${colors} colors`)
      await gpuBrowser.close()
    }

    site.close()
    const slowest = timings.reduce((a, b) => (b.firstFrameMs > a.firstFrameMs ? b : a))
    log(`slowest start: ${slowest.game} (${slowest.startScreenMs} + ${slowest.firstFrameMs} ms; budgets ${budgets.exportStartScreenMs} + ${budgets.exportFirstFrameMs})`)
    log('PASS')
  } catch (error) {
    const shot = await failureShot(page, 'exports-failure')
    console.error('[exports] FAIL:', error instanceof Error ? error.message : error)
    console.error(`[exports] screenshot saved to ${shot}`)
    process.exitCode = 1
  } finally {
    await browser?.close().catch(() => {})
    dev.stop()
  }
}

await main()
