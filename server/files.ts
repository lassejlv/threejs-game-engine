// Local project storage for the editor: a small API on Bun.serve that keeps
// every project as a plain folder on disk.
//
//   projects/<id>/project.json   the document (formatted, so git diffs stay readable)
//   projects/<id>/meta.json      { name, modified } for fast listing
//   projects/<id>/assets.json    [{ id, name, kind, size, file }]
//   projects/<id>/assets/<file>  models, textures, audio
//   projects/.trash/             deleted projects, kept so nothing is lost by accident
//
//   bun server/files.ts            API on http://127.0.0.1:5174 (npm run dev starts it)
//   bun server/files.ts --static   also serves the built editor from dist/ (npm start)
//
// Environment: PORT, GE_PROJECTS_DIR, GE_ALLOWED_ORIGINS (comma separated).
//
// It only listens on 127.0.0.1, and rejects requests whose Host isn't local
// (DNS rebinding) or whose Origin isn't the editor's (other websites), keeps
// every path inside the projects folder, and caps request sizes.

import { mkdir, readdir, rename, rm, stat } from 'node:fs/promises'
import { extname, join, resolve, sep } from 'node:path'

export const API_VERSION = 1
const MAX_DOCUMENT = 64 * 1024 * 1024
const MAX_ASSET = 256 * 1024 * 1024
const PROJECT_ID = /^[a-z0-9][a-z0-9-]{0,63}$/
const ASSET_ID = /^[A-Za-z0-9_-]{1,64}$/
const ASSET_TYPES: Record<string, { kind: 'model' | 'texture' | 'audio'; mime: string }> = {
  '.glb': { kind: 'model', mime: 'model/gltf-binary' },
  '.gltf': { kind: 'model', mime: 'model/gltf+json' },
  '.png': { kind: 'texture', mime: 'image/png' },
  '.jpg': { kind: 'texture', mime: 'image/jpeg' },
  '.jpeg': { kind: 'texture', mime: 'image/jpeg' },
  '.webp': { kind: 'texture', mime: 'image/webp' },
  '.mp3': { kind: 'audio', mime: 'audio/mpeg' },
  '.ogg': { kind: 'audio', mime: 'audio/ogg' },
  '.wav': { kind: 'audio', mime: 'audio/wav' },
  '.m4a': { kind: 'audio', mime: 'audio/mp4' },
}

export interface ProjectSummary {
  id: string
  name: string
  modified: number
}

export interface StoredAsset {
  id: string
  name: string
  kind: 'model' | 'texture' | 'audio'
  size: number
  /** File name inside assets/. */
  file: string
}

export interface FileServerOptions {
  root: string
  port?: number
  /** Extra origins allowed to call the API (the editor's dev server is allowed by default). */
  allowedOrigins?: string[]
  /** Serve this folder (the built editor) for non-API paths. */
  staticDir?: string
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'cache-control': 'no-store' } })

/** Starts the server. `port: 0` picks a free port (tests). */
export function startFileServer(options: FileServerOptions) {
  const root = resolve(options.root)
  const trash = join(root, '.trash')

  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: options.port ?? 5174,
    maxRequestBodySize: MAX_ASSET,
    fetch: async (request) => {
      try {
        const url = new URL(request.url)
        checkLocal(request, server.port!, options.allowedOrigins ?? [])
        if (url.pathname.startsWith('/api/')) return await api(request, url)
        if (options.staticDir) return await serveStatic(options.staticDir, url.pathname)
        throw new HttpError(404, 'Not found')
      } catch (error) {
        if (error instanceof HttpError) return json({ error: error.message }, error.status)
        console.error('[files]', error)
        return json({ error: 'Internal error' }, 500)
      }
    },
  })

  /** Keeps a path inside `base`, whatever the request contained. */
  function inside(base: string, ...parts: string[]): string {
    const path = resolve(base, ...parts)
    if (path !== base && !path.startsWith(base + sep)) throw new HttpError(400, 'Bad path')
    return path
  }

  function projectDir(id: string): string {
    if (!PROJECT_ID.test(id)) throw new HttpError(400, 'Bad project id')
    return inside(root, id)
  }

  async function exists(path: string): Promise<boolean> {
    return stat(path).then(
      () => true,
      () => false,
    )
  }

  async function requireProject(id: string): Promise<string> {
    const dir = projectDir(id)
    if (!(await exists(join(dir, 'project.json')))) throw new HttpError(404, `No project "${id}"`)
    return dir
  }

  /** Writes to a temporary file first, so a crash never leaves a half-written file. */
  async function writeAtomic(path: string, data: string | Blob | ArrayBuffer): Promise<void> {
    const tmp = `${path}.tmp-${process.pid}-${Date.now()}`
    await Bun.write(tmp, data)
    await rename(tmp, path)
  }

  async function readJson<T>(path: string, fallback: T): Promise<T> {
    const file = Bun.file(path)
    return (await file.exists()) ? ((await file.json()) as T) : fallback
  }

  async function readBody(request: Request, limit: number): Promise<ArrayBuffer> {
    const length = Number(request.headers.get('content-length') ?? 0)
    if (length > limit) throw new HttpError(413, 'Too large')
    const body = await request.arrayBuffer()
    if (body.byteLength > limit) throw new HttpError(413, 'Too large')
    return body
  }

  async function uniqueId(name: string): Promise<string> {
    const base =
      name
        .toLowerCase()
        .normalize('NFKD')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 48) || 'project'
    let id = base
    for (let n = 2; await exists(join(root, id)); n++) id = `${base}-${n}`
    return id
  }

  async function saveDocument(dir: string, text: string): Promise<ProjectSummary> {
    let doc: { name?: unknown; version?: unknown }
    try {
      doc = JSON.parse(text)
    } catch {
      throw new HttpError(400, 'The document is not valid JSON')
    }
    if (!doc || typeof doc !== 'object' || typeof doc.version !== 'number') throw new HttpError(400, 'Not a project document')
    const meta = { name: typeof doc.name === 'string' ? doc.name : 'Untitled', modified: Date.now() }
    await mkdir(join(dir, 'assets'), { recursive: true })
    await writeAtomic(join(dir, 'project.json'), JSON.stringify(doc, null, 2))
    await writeAtomic(join(dir, 'meta.json'), JSON.stringify(meta))
    return { id: dir.slice(root.length + 1), ...meta }
  }

  async function api(request: Request, url: URL): Promise<Response> {
    const parts = url.pathname.split('/').filter(Boolean).slice(1).map(decodeURIComponent) // drop "api"
    const method = request.method

    if (parts[0] === 'health' && parts.length === 1) return json({ ok: true, version: API_VERSION, root })

    if (parts[0] !== 'projects') throw new HttpError(404, 'Not found')
    await mkdir(root, { recursive: true })

    // /api/projects
    if (parts.length === 1) {
      if (method === 'GET') {
        const list: ProjectSummary[] = []
        for (const entry of await readdir(root, { withFileTypes: true })) {
          if (!entry.isDirectory() || !PROJECT_ID.test(entry.name)) continue
          const dir = join(root, entry.name)
          if (!(await exists(join(dir, 'project.json')))) continue
          const meta = await readJson<{ name?: string; modified?: number }>(join(dir, 'meta.json'), {})
          list.push({ id: entry.name, name: meta.name ?? entry.name, modified: meta.modified ?? 0 })
        }
        return json(list.sort((a, b) => b.modified - a.modified))
      }
      if (method === 'POST') {
        const text = new TextDecoder().decode(await readBody(request, MAX_DOCUMENT))
        const name = (() => {
          try {
            return String(JSON.parse(text).name ?? 'project')
          } catch {
            return 'project'
          }
        })()
        const id = await uniqueId(name)
        return json(await saveDocument(join(root, id), text), 201)
      }
      throw new HttpError(405, 'Method not allowed')
    }

    const id = parts[1]
    const dir = projectDir(id)

    // /api/projects/:id
    if (parts.length === 2) {
      if (method === 'GET') {
        const file = Bun.file(join(await requireProject(id), 'project.json'))
        return new Response(file, { headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } })
      }
      if (method === 'PUT') {
        const text = new TextDecoder().decode(await readBody(request, MAX_DOCUMENT))
        return json(await saveDocument(dir, text))
      }
      if (method === 'DELETE') {
        await requireProject(id)
        await mkdir(trash, { recursive: true })
        await rename(dir, join(trash, `${id}-${Date.now()}`))
        return json({ ok: true })
      }
      throw new HttpError(405, 'Method not allowed')
    }

    // /api/projects/:id/duplicate
    if (parts.length === 3 && parts[2] === 'duplicate' && method === 'POST') {
      const source = await requireProject(id)
      const meta = await readJson<{ name?: string }>(join(source, 'meta.json'), {})
      const name = `${meta.name ?? id} copy`
      const copyId = await uniqueId(name)
      const target = join(root, copyId)
      await mkdir(join(target, 'assets'), { recursive: true })
      for (const asset of await readJson<StoredAsset[]>(join(source, 'assets.json'), [])) {
        await Bun.write(join(target, 'assets', asset.file), Bun.file(join(source, 'assets', asset.file)))
      }
      if (await exists(join(source, 'assets.json'))) await Bun.write(join(target, 'assets.json'), Bun.file(join(source, 'assets.json')))
      const doc = (await Bun.file(join(source, 'project.json')).json()) as Record<string, unknown>
      return json(await saveDocument(target, JSON.stringify({ ...doc, name })), 201)
    }

    // /api/projects/:id/assets[/:assetId]
    if (parts[2] === 'assets' && parts.length <= 4) {
      const projectRoot = await requireProject(id)
      const indexPath = join(projectRoot, 'assets.json')
      const index = await readJson<StoredAsset[]>(indexPath, [])
      if (parts.length === 3) {
        if (method !== 'GET') throw new HttpError(405, 'Method not allowed')
        return json(index.map(({ file: _file, ...meta }) => meta))
      }
      const assetId = parts[3]
      if (!ASSET_ID.test(assetId)) throw new HttpError(400, 'Bad asset id')
      const existing = index.find((a) => a.id === assetId)
      if (method === 'GET') {
        if (!existing) throw new HttpError(404, 'No such asset')
        const ext = extname(existing.file).toLowerCase()
        return new Response(Bun.file(inside(projectRoot, 'assets', existing.file)), {
          headers: { 'content-type': ASSET_TYPES[ext]?.mime ?? 'application/octet-stream', 'cache-control': 'no-store' },
        })
      }
      if (method === 'PUT') {
        const name = (url.searchParams.get('name') ?? '').slice(0, 200)
        const ext = extname(name).toLowerCase()
        const type = ASSET_TYPES[ext]
        if (!name || !type) throw new HttpError(400, `Unsupported asset type: ${name || '(no name)'}`)
        const body = await readBody(request, MAX_ASSET)
        const file = `${assetId}${ext}`
        await writeAtomic(inside(projectRoot, 'assets', file), body)
        if (existing && existing.file !== file) await rm(inside(projectRoot, 'assets', existing.file), { force: true })
        const meta: StoredAsset = { id: assetId, name, kind: type.kind, size: body.byteLength, file }
        await writeAtomic(indexPath, JSON.stringify([...index.filter((a) => a.id !== assetId), meta], null, 2))
        return json({ id: meta.id, name: meta.name, kind: meta.kind, size: meta.size })
      }
      if (method === 'DELETE') {
        if (existing) await rm(inside(projectRoot, 'assets', existing.file), { force: true })
        await writeAtomic(indexPath, JSON.stringify(index.filter((a) => a.id !== assetId), null, 2))
        return json({ ok: true })
      }
      throw new HttpError(405, 'Method not allowed')
    }

    throw new HttpError(404, 'Not found')
  }

  return server
}

/** Rejects anything that isn't the local editor talking to its local server. */
function checkLocal(request: Request, port: number, extraOrigins: string[]): void {
  const host = request.headers.get('host') ?? ''
  const localHosts = [`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`]
  if (!localHosts.includes(host)) throw new HttpError(403, 'Only local requests are allowed')
  const origin = request.headers.get('origin')
  if (origin === null) {
    // Browsers always send Origin on cross-site writes; a write without one comes from a local tool (curl, tests).
    return
  }
  const allowed = new Set([...localHosts.map((h) => `http://${h}`), ...extraOrigins])
  for (const devPort of [5173, 4173]) {
    allowed.add(`http://127.0.0.1:${devPort}`)
    allowed.add(`http://localhost:${devPort}`)
  }
  if (!allowed.has(origin)) throw new HttpError(403, `Origin ${origin} is not allowed`)
}

async function serveStatic(dir: string, pathname: string): Promise<Response> {
  const base = resolve(dir)
  const path = resolve(base, `.${decodeURIComponent(pathname)}`)
  if (path.startsWith(base + sep)) {
    const file = Bun.file(path)
    if ((await file.exists()) && !(await stat(path)).isDirectory()) return new Response(file)
  }
  // Single-page app: unknown paths get the editor.
  return new Response(Bun.file(join(base, 'index.html')), { headers: { 'content-type': 'text/html; charset=utf-8' } })
}

if (import.meta.main) {
  const repo = resolve(import.meta.dir, '..')
  const root = process.env.GE_PROJECTS_DIR ?? join(repo, 'projects')
  const staticDir = process.argv.includes('--static') ? join(repo, 'dist') : undefined
  const server = startFileServer({
    root,
    port: Number(process.env.PORT) || 5174,
    allowedOrigins: (process.env.GE_ALLOWED_ORIGINS ?? '').split(',').filter(Boolean),
    staticDir,
  })
  console.log(`Projects in ${root}`)
  console.log(staticDir ? `Editor at http://127.0.0.1:${server.port}` : `File API at http://127.0.0.1:${server.port}/api`)
}
