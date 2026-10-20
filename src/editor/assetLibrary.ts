import { newId } from './document'

export type AssetKind = 'model' | 'texture' | 'audio'

export interface AssetMeta {
  id: string
  name: string
  kind: AssetKind
  size: number
}

interface StoredAsset extends AssetMeta {
  blob: Blob
}

const DB_NAME = 'ge-assets'
const STORE = 'assets'

export const ACCEPTED_ASSETS = '.glb,.gltf,.png,.jpg,.jpeg,.webp,.mp3,.ogg,.wav,.m4a'

function kindOf(name: string): AssetKind | null {
  const ext = name.split('.').pop()?.toLowerCase()
  if (ext === 'glb' || ext === 'gltf') return 'model'
  if (ext === 'png' || ext === 'jpg' || ext === 'jpeg' || ext === 'webp') return 'texture'
  if (ext === 'mp3' || ext === 'ogg' || ext === 'wav' || ext === 'm4a') return 'audio'
  return null
}

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

/**
 * Binary project assets (models, textures) persisted in IndexedDB.
 * Each asset gets one object URL per session, so engine-side caches hit.
 */
export class AssetLibrary {
  private db: Promise<IDBDatabase> | null = null
  private readonly blobs = new Map<string, Blob>()
  private readonly names = new Map<string, string>()
  private readonly urls = new Map<string, string>()

  async list(): Promise<AssetMeta[]> {
    const db = await this.open()
    const all = await request<StoredAsset[]>(db.transaction(STORE).objectStore(STORE).getAll())
    for (const a of all) {
      this.blobs.set(a.id, a.blob)
      this.names.set(a.name, a.id)
    }
    return all.map(({ blob: _blob, ...meta }) => meta)
  }

  async import(file: File): Promise<AssetMeta> {
    const kind = kindOf(file.name)
    if (!kind) throw new Error(`Unsupported file type: ${file.name}`)
    const meta: AssetMeta = { id: newId(), name: file.name, kind, size: file.size }
    const db = await this.open()
    await request(db.transaction(STORE, 'readwrite').objectStore(STORE).put({ ...meta, blob: file }))
    this.blobs.set(meta.id, file)
    this.names.set(meta.name, meta.id)
    return meta
  }

  async remove(id: string): Promise<void> {
    const db = await this.open()
    await request(db.transaction(STORE, 'readwrite').objectStore(STORE).delete(id))
    this.blobs.delete(id)
    for (const [name, existing] of this.names) if (existing === id) this.names.delete(name)
    const url = this.urls.get(id)
    if (url) URL.revokeObjectURL(url)
    this.urls.delete(id)
  }

  /** Asset id for a file name (with or without extension), for scripts that refer to assets by name. */
  byName(name: string): string | null {
    if (this.names.has(name)) return this.names.get(name)!
    for (const [file, id] of this.names) if (file.replace(/\.\w+$/, '') === name) return id
    return null
  }

  blob(id: string): Blob | null {
    return this.blobs.get(id) ?? null
  }

  /** Object URL for an asset, or null if it no longer exists. */
  url(id: string): string | null {
    let url = this.urls.get(id)
    if (url) return url
    const blob = this.blobs.get(id)
    if (!blob) return null
    url = URL.createObjectURL(blob)
    this.urls.set(id, url)
    return url
  }

  private open(): Promise<IDBDatabase> {
    this.db ??= new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1)
      req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' })
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
    return this.db
  }
}
