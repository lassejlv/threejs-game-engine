import type { AssetMeta } from '../assetLibrary'
import type { ProjectStore, ProjectSummary } from './types'

const OFFLINE = "The file server isn't responding. Is `npm run dev` (or `npm start`) still running?"

/** Projects as folders on disk, through the local Bun file server (server/files.ts). */
export class DiskStore implements ProjectStore {
  readonly kind = 'disk'
  readonly label = 'the projects/ folder'

  constructor(private readonly base = '/api') {}

  /** True when the file server answers (quickly) at `base`. */
  static async available(base = '/api', timeout = 1500): Promise<boolean> {
    try {
      const res = await fetch(`${base}/health`, { signal: AbortSignal.timeout(timeout) })
      if (!res.ok) return false
      const body = (await res.json()) as { ok?: unknown }
      return body.ok === true
    } catch {
      return false
    }
  }

  list(): Promise<ProjectSummary[]> {
    return this.json('/projects')
  }

  create(doc: unknown): Promise<ProjectSummary> {
    return this.json('/projects', { method: 'POST', body: JSON.stringify(doc) })
  }

  load(id: string): Promise<unknown> {
    return this.json(`/projects/${encodeURIComponent(id)}`)
  }

  async save(id: string, doc: unknown): Promise<void> {
    await this.json(`/projects/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(doc) })
  }

  async remove(id: string): Promise<void> {
    await this.json(`/projects/${encodeURIComponent(id)}`, { method: 'DELETE' })
  }

  duplicate(id: string): Promise<ProjectSummary> {
    return this.json(`/projects/${encodeURIComponent(id)}/duplicate`, { method: 'POST' })
  }

  listAssets(id: string): Promise<AssetMeta[]> {
    return this.json(`/projects/${encodeURIComponent(id)}/assets`)
  }

  async readAsset(id: string, assetId: string): Promise<Blob> {
    const res = await this.request(`/projects/${encodeURIComponent(id)}/assets/${encodeURIComponent(assetId)}`)
    return res.blob()
  }

  async writeAsset(id: string, meta: AssetMeta, blob: Blob): Promise<void> {
    const path = `/projects/${encodeURIComponent(id)}/assets/${encodeURIComponent(meta.id)}?name=${encodeURIComponent(meta.name)}`
    await this.request(path, { method: 'PUT', body: blob })
  }

  async deleteAsset(id: string, assetId: string): Promise<void> {
    await this.request(`/projects/${encodeURIComponent(id)}/assets/${encodeURIComponent(assetId)}`, { method: 'DELETE' })
  }

  private async request(path: string, init?: RequestInit): Promise<Response> {
    let res: Response
    try {
      res = await fetch(`${this.base}${path}`, init)
    } catch {
      throw new Error(OFFLINE)
    }
    // The dev server's proxy answers 502/504 when the file server is gone.
    if (res.status === 502 || res.status === 503 || res.status === 504) throw new Error(OFFLINE)
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { error?: string } | null
      throw new Error(body?.error ?? `File server: ${res.status} ${res.statusText}`)
    }
    return res
  }

  private async json<T>(path: string, init?: RequestInit): Promise<T> {
    return (await (await this.request(path, init)).json()) as T
  }
}
