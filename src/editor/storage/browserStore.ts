import type { AssetMeta } from '../assetLibrary'
import { type ProjectStore, type ProjectSummary, projectSlug } from './types'

const DB_NAME = 'ge-projects'
const PROJECTS = 'projects'
const ASSETS = 'assets'

interface ProjectRecord extends ProjectSummary {
  doc: unknown
}

interface AssetRecord extends AssetMeta {
  project: string
  /** Raw bytes rather than a Blob: plain data clones and stores reliably everywhere. */
  bytes: ArrayBuffer
  type: string
}

/** A Blob's bytes (FileReader works in every browser and in jsdom). */
export function readBytes(blob: Blob): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as ArrayBuffer)
    reader.onerror = () => reject(reader.error)
    reader.readAsArrayBuffer(blob)
  })
}

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error ?? new Error('Transaction aborted'))
  })
}

/**
 * Projects kept in this browser (IndexedDB), for when the local file server
 * isn't running. No size cap beyond the browser's own quota, which is far
 * above the ~5 MB localStorage limit the editor used before.
 */
export class BrowserStore implements ProjectStore {
  readonly kind = 'browser'
  readonly label = 'this browser'
  private db: Promise<IDBDatabase> | null = null

  constructor(private readonly dbName = DB_NAME) {}

  async list(): Promise<ProjectSummary[]> {
    const db = await this.open()
    const all = await request<ProjectRecord[]>(db.transaction(PROJECTS).objectStore(PROJECTS).getAll())
    return all.map(({ id, name, modified }) => ({ id, name, modified })).sort((a, b) => b.modified - a.modified)
  }

  async create(doc: unknown): Promise<ProjectSummary> {
    const db = await this.open()
    const base = projectSlug(nameOf(doc))
    const existing = new Set((await this.list()).map((p) => p.id))
    let id = base
    for (let n = 2; existing.has(id); n++) id = `${base}-${n}`
    const record: ProjectRecord = { id, name: nameOf(doc), modified: Date.now(), doc }
    const tx = db.transaction(PROJECTS, 'readwrite')
    tx.objectStore(PROJECTS).add(record)
    await done(tx)
    return { id, name: record.name, modified: record.modified }
  }

  async load(id: string): Promise<unknown> {
    const db = await this.open()
    const record = await request<ProjectRecord | undefined>(db.transaction(PROJECTS).objectStore(PROJECTS).get(id))
    if (!record) throw new Error(`No project "${id}"`)
    return record.doc
  }

  async save(id: string, doc: unknown): Promise<void> {
    const db = await this.open()
    const tx = db.transaction(PROJECTS, 'readwrite')
    tx.objectStore(PROJECTS).put({ id, name: nameOf(doc), modified: Date.now(), doc } satisfies ProjectRecord)
    await done(tx)
  }

  async remove(id: string): Promise<void> {
    const db = await this.open()
    const tx = db.transaction([PROJECTS, ASSETS], 'readwrite')
    tx.objectStore(PROJECTS).delete(id)
    const assets = tx.objectStore(ASSETS)
    const keys = await request(assets.index('project').getAllKeys(id))
    for (const key of keys) assets.delete(key)
    await done(tx)
  }

  async duplicate(id: string): Promise<ProjectSummary> {
    const doc = (await this.load(id)) as Record<string, unknown>
    const copy = await this.create({ ...doc, name: `${nameOf(doc)} copy` })
    for (const meta of await this.listAssets(id)) await this.writeAsset(copy.id, meta, await this.readAsset(id, meta.id))
    return copy
  }

  async listAssets(id: string): Promise<AssetMeta[]> {
    const db = await this.open()
    const all = await request<AssetRecord[]>(db.transaction(ASSETS).objectStore(ASSETS).index('project').getAll(id))
    return all.map(({ id: assetId, name, kind, size }) => ({ id: assetId, name, kind, size }))
  }

  async readAsset(id: string, assetId: string): Promise<Blob> {
    const db = await this.open()
    const record = await request<AssetRecord | undefined>(db.transaction(ASSETS).objectStore(ASSETS).get([id, assetId]))
    if (!record) throw new Error(`No asset "${assetId}"`)
    return new Blob([record.bytes], { type: record.type })
  }

  async writeAsset(id: string, meta: AssetMeta, blob: Blob): Promise<void> {
    const bytes = await readBytes(blob)
    const db = await this.open()
    const tx = db.transaction(ASSETS, 'readwrite')
    tx.objectStore(ASSETS).put({ id: meta.id, name: meta.name, kind: meta.kind, size: meta.size, project: id, bytes, type: blob.type } satisfies AssetRecord)
    await done(tx)
  }

  async deleteAsset(id: string, assetId: string): Promise<void> {
    const db = await this.open()
    const tx = db.transaction(ASSETS, 'readwrite')
    tx.objectStore(ASSETS).delete([id, assetId])
    await done(tx)
  }

  private open(): Promise<IDBDatabase> {
    this.db ??= new Promise((resolve, reject) => {
      const req = indexedDB.open(this.dbName, 1)
      req.onupgradeneeded = () => {
        const db = req.result
        db.createObjectStore(PROJECTS, { keyPath: 'id' })
        db.createObjectStore(ASSETS, { keyPath: ['project', 'id'] }).createIndex('project', 'project')
      }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
    return this.db
  }
}

function nameOf(doc: unknown): string {
  const name = (doc as { name?: unknown } | null)?.name
  return typeof name === 'string' && name ? name : 'Untitled'
}

// ---------------------------------------------------------------------------
// The editor before multi-project storage

const LEGACY_DOC = 'ge-project-v1'
const LEGACY_ASSETS_DB = 'ge-assets'

/**
 * The single project (localStorage) and shared asset store (IndexedDB) older
 * versions of the editor used, or null when there is none. Read-only: the old
 * data is left in place.
 */
export async function readLegacyProject(): Promise<{ doc: unknown; assets: { meta: AssetMeta; blob: Blob }[] } | null> {
  let raw: string | null = null
  try {
    raw = localStorage.getItem(LEGACY_DOC)
  } catch {
    return null
  }
  if (!raw) return null
  let doc: unknown
  try {
    doc = JSON.parse(raw)
  } catch {
    return null
  }
  const assets: { meta: AssetMeta; blob: Blob }[] = []
  try {
    const db = await new Promise<IDBDatabase | null>((resolve) => {
      const req = indexedDB.open(LEGACY_ASSETS_DB)
      // Opening a database that doesn't exist creates it empty; nothing to read then.
      req.onupgradeneeded = () => {
        req.transaction?.abort()
        resolve(null)
      }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => resolve(null)
    })
    if (db && db.objectStoreNames.contains('assets')) {
      const all = await request<(AssetMeta & { blob: unknown })[]>(db.transaction('assets').objectStore('assets').getAll())
      for (const { blob, ...meta } of all) {
        const data = blob instanceof Blob ? blob : new Blob([blob as BlobPart])
        assets.push({ meta: { id: meta.id, name: meta.name, kind: meta.kind, size: meta.size }, blob: data })
      }
    }
    db?.close()
  } catch {
    // Assets unavailable: still migrate the document.
  }
  return { doc, assets }
}
