import 'fake-indexeddb/auto'
import { type ChildProcess, spawn, spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildBundle, readBundle } from '../bundle'
import { emptyProject } from '../document'
import { BrowserStore } from './browserStore'
import { DiskStore } from './diskStore'
import type { ProjectStore } from './types'

const hasBun = spawnSync('bun', ['--version']).status === 0
const PORT = 5290 + Math.floor(Math.random() * 100)
let server: ChildProcess | null = null
let root = ''

beforeAll(async () => {
  if (!hasBun) return
  root = mkdtempSync(join(tmpdir(), 'ge-cross-'))
  server = spawn('bun', ['server/files.ts'], { env: { ...process.env, PORT: String(PORT), GE_PROJECTS_DIR: root }, stdio: 'ignore' })
  for (let i = 0; i < 100 && !(await DiskStore.available(`http://127.0.0.1:${PORT}/api`, 200)); i++) await new Promise((r) => setTimeout(r, 50))
})

afterAll(() => {
  server?.kill()
  if (root) rmSync(root, { recursive: true, force: true })
})

/** Exports a project from one store as a bundle and imports it into another. */
async function move(from: ProjectStore, id: string, to: ProjectStore) {
  const doc = await from.load(id)
  const assets = await Promise.all((await from.listAssets(id)).map(async (meta) => ({ meta, blob: await from.readAsset(id, meta.id) })))
  const bundle = await buildBundle(doc, assets)
  const read = await readBundle(new Uint8Array(await bundle.arrayBuffer()))
  const created = await to.create(read.doc)
  for (const a of read.assets) await to.writeAsset(created.id, a.meta, a.blob)
  return created.id
}

async function snapshot(store: ProjectStore, id: string) {
  const assets = await store.listAssets(id)
  const bytes = await Promise.all(assets.map(async (a) => [...new Uint8Array(await (await store.readAsset(id, a.id)).arrayBuffer())]))
  return { doc: await store.load(id), assets: assets.sort((a, b) => a.id.localeCompare(b.id)), bytes: bytes.sort() }
}

describe.skipIf(!hasBun)('bundles between the disk and browser stores', () => {
  it('a project moves from the browser to disk and back unchanged', async () => {
    const browser = new BrowserStore('ge-cross-test')
    const disk = new DiskStore(`http://127.0.0.1:${PORT}/api`)
    const { id } = await browser.create({ ...emptyProject(), name: 'Traveller' })
    await browser.writeAsset(id, { id: 'tex1', name: 'grass.png', kind: 'texture', size: 4 }, new Blob([new Uint8Array([1, 2, 3, 4])]))
    await browser.writeAsset(id, { id: 'snd1', name: 'jump.ogg', kind: 'audio', size: 2 }, new Blob([new Uint8Array([5, 6])]))

    const onDisk = await move(browser, id, disk)
    expect(await snapshot(disk, onDisk)).toEqual(await snapshot(browser, id))

    const back = await move(disk, onDisk, browser)
    expect(await snapshot(browser, back)).toEqual(await snapshot(browser, id))
  })
})
