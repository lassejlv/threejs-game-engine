import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { startFileServer } from './files'

let root: string
let server: ReturnType<typeof startFileServer>
let base: string

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'ge-files-'))
  server = startFileServer({ root, port: 0 })
  base = `http://127.0.0.1:${server.port}`
})

afterAll(async () => {
  server.stop(true)
  await rm(root, { recursive: true, force: true })
})

const doc = (name: string, extra: Record<string, unknown> = {}) => JSON.stringify({ version: 2, name, scenes: [], ...extra })
const api = (path: string, init?: RequestInit) => fetch(`${base}/api${path}`, init)

describe('file server', () => {
  it('reports health', async () => {
    const res = await api('/health')
    expect(res.status).toBe(200)
    expect(((await res.json()) as { ok: boolean }).ok).toBe(true)
  })

  it('creates, lists, loads, saves, duplicates and deletes projects', async () => {
    const created = (await (await api('/projects', { method: 'POST', body: doc('Coin Rush!') })).json()) as { id: string }
    expect(created.id).toBe('coin-rush')
    const again = (await (await api('/projects', { method: 'POST', body: doc('Coin Rush!') })).json()) as { id: string }
    expect(again.id).toBe('coin-rush-2')

    const saved = await api('/projects/coin-rush', { method: 'PUT', body: doc('Coin Rush', { scenes: [{ id: 's' }] }) })
    expect(saved.status).toBe(200)
    const loaded: unknown = await (await api('/projects/coin-rush')).json()
    expect(loaded).toEqual({ version: 2, name: 'Coin Rush', scenes: [{ id: 's' }] })
    // Formatted on disk so diffs stay readable.
    expect(await Bun.file(join(root, 'coin-rush', 'project.json')).text()).toContain('\n  "name": "Coin Rush"')

    const list = (await (await api('/projects')).json()) as { id: string; name: string }[]
    expect(list.map((p) => p.id).sort()).toEqual(['coin-rush', 'coin-rush-2'])
    expect(list.find((p) => p.id === 'coin-rush')?.name).toBe('Coin Rush')

    const copy = (await (await api('/projects/coin-rush/duplicate', { method: 'POST' })).json()) as { id: string; name: string }
    expect(copy).toMatchObject({ id: 'coin-rush-copy', name: 'Coin Rush copy' })

    expect((await api('/projects/coin-rush-2', { method: 'DELETE' })).status).toBe(200)
    expect((await api('/projects/coin-rush-2')).status).toBe(404)
    // Deleted projects go to the trash, not away.
    expect((await readdir(join(root, '.trash'))).some((d) => d.startsWith('coin-rush-2-'))).toBe(true)
  })

  it('stores assets per project, byte for byte', async () => {
    await api('/projects', { method: 'POST', body: doc('Assets') })
    const bytes = new Uint8Array([137, 80, 78, 71, 1, 2, 3, 255])
    const put = await api('/projects/assets/assets/abc123?name=grass.png', { method: 'PUT', body: bytes })
    expect(await put.json()).toEqual({ id: 'abc123', name: 'grass.png', kind: 'texture', size: 8 })
    const got = await api('/projects/assets/assets/abc123')
    expect(got.headers.get('content-type')).toBe('image/png')
    expect(new Uint8Array(await got.arrayBuffer())).toEqual(bytes)
    expect(await (await api('/projects/assets/assets')).json()).toEqual([{ id: 'abc123', name: 'grass.png', kind: 'texture', size: 8 }])

    // Duplicates copy assets too.
    const copy = (await (await api('/projects/assets/duplicate', { method: 'POST' })).json()) as { id: string }
    expect(new Uint8Array(await (await api(`/projects/${copy.id}/assets/abc123`)).arrayBuffer())).toEqual(bytes)

    expect((await api('/projects/assets/assets/abc123', { method: 'DELETE' })).status).toBe(200)
    expect((await api('/projects/assets/assets/abc123')).status).toBe(404)
    expect((await api('/projects/assets/assets/x?name=evil.exe', { method: 'PUT', body: bytes })).status).toBe(400)
  })

  it('keeps every path inside the projects folder', async () => {
    for (const path of ['/projects/..%2F..%2Fetc', '/projects/%2E%2E', '/projects/assets/assets/..%2F..%2Fx', '/projects/UPPER']) {
      // 400 from the id checks, or 404 when the URL parser already normalized the dots away: never served.
      expect([400, 404]).toContain((await api(path)).status)
    }
    expect((await api('/projects/assets/assets/a?name=..%2F..%2Fx.png', { method: 'PUT', body: 'x' })).status).toBe(200)
    // The asset name is metadata only; the file on disk is named after the id.
    expect((await readdir(join(root, 'assets', 'assets'))).includes('a.png')).toBe(true)
  })

  it('rejects other websites and non-local hosts', async () => {
    const evil = await api('/projects', { method: 'POST', body: doc('x'), headers: { origin: 'https://evil.example' } })
    expect(evil.status).toBe(403)
    const editor = await api('/projects', { headers: { origin: 'http://127.0.0.1:5173' } })
    expect(editor.status).toBe(200)
    // DNS rebinding: a foreign host name pointing at 127.0.0.1.
    const rebound = await fetch(`${base}/api/projects`, { headers: { host: 'evil.example' } })
    expect(rebound.status).toBe(403)
  })

  it('rejects documents that are not projects', async () => {
    expect((await api('/projects/x', { method: 'PUT', body: 'not json' })).status).toBe(400)
    expect((await api('/projects/x', { method: 'PUT', body: '{"name":"no version"}' })).status).toBe(400)
  })
})
