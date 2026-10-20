import { newId } from './document'
import type { ProjectStore } from './storage/types'

export type AssetKind = 'model' | 'texture' | 'audio'

export interface AssetMeta {
  id: string
  name: string
  kind: AssetKind
  size: number
}

export const ACCEPTED_ASSETS = '.glb,.gltf,.png,.jpg,.jpeg,.webp,.mp3,.ogg,.wav,.m4a'

function kindOf(name: string): AssetKind | null {
  const ext = name.split('.').pop()?.toLowerCase()
  if (ext === 'glb' || ext === 'gltf') return 'model'
  if (ext === 'png' || ext === 'jpg' || ext === 'jpeg' || ext === 'webp') return 'texture'
  if (ext === 'mp3' || ext === 'ogg' || ext === 'wav' || ext === 'm4a') return 'audio'
  return null
}

/**
 * The open project's binary assets (models, textures, audio), held in memory
 * and written through to the project's store (folder on disk or IndexedDB).
 * Each asset gets one object URL per session, so engine-side caches hit.
 */
export class AssetLibrary {
  private target: { store: ProjectStore; project: string } | null = null
  private readonly blobs = new Map<string, Blob>()
  private readonly metas = new Map<string, AssetMeta>()
  private readonly names = new Map<string, string>()
  private readonly urls = new Map<string, string>()

  /** Loads a project's assets (replacing the previous project's) and writes new ones there. */
  async open(store: ProjectStore, project: string): Promise<AssetMeta[]> {
    const list = await store.listAssets(project)
    const blobs = await Promise.all(list.map((meta) => store.readAsset(project, meta.id)))
    this.clear()
    this.target = { store, project }
    list.forEach((meta, i) => this.add(meta, blobs[i]))
    return list
  }

  /** Forgets every asset (memory only; the store keeps them). */
  clear(): void {
    for (const url of this.urls.values()) URL.revokeObjectURL(url)
    this.urls.clear()
    this.blobs.clear()
    this.metas.clear()
    this.names.clear()
  }

  /** Every asset with its bytes, for exports and bundles. */
  entries(): { meta: AssetMeta; blob: Blob }[] {
    return [...this.metas.values()].map((meta) => ({ meta, blob: this.blobs.get(meta.id)! }))
  }

  async import(file: File): Promise<AssetMeta> {
    const kind = kindOf(file.name)
    if (!kind) throw new Error(`Unsupported file type: ${file.name}`)
    const meta: AssetMeta = { id: newId(), name: file.name, kind, size: file.size }
    await this.put(meta, file)
    return meta
  }

  /** Stores an asset with a known id (bundle import). */
  async put(meta: AssetMeta, blob: Blob): Promise<void> {
    if (this.target) await this.target.store.writeAsset(this.target.project, meta, blob)
    this.add(meta, blob)
  }

  async remove(id: string): Promise<void> {
    if (this.target) await this.target.store.deleteAsset(this.target.project, id)
    this.blobs.delete(id)
    this.metas.delete(id)
    for (const [name, existing] of this.names) if (existing === id) this.names.delete(name)
    const url = this.urls.get(id)
    if (url) URL.revokeObjectURL(url)
    this.urls.delete(id)
  }

  private add(meta: AssetMeta, blob: Blob): void {
    this.blobs.set(meta.id, blob)
    this.metas.set(meta.id, meta)
    this.names.set(meta.name, meta.id)
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
}
