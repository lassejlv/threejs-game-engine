import type { AssetMeta } from '../assetLibrary'

export interface ProjectSummary {
  id: string
  name: string
  /** Last save, ms since the epoch. */
  modified: number
}

/**
 * Where projects live. 'disk' is the local Bun file server (projects/ folders);
 * 'browser' is IndexedDB, used when that server isn't running.
 */
export interface ProjectStore {
  readonly kind: 'disk' | 'browser'
  /** Where projects are kept, for the UI ("projects/ folder", "this browser"). */
  readonly label: string
  list(): Promise<ProjectSummary[]>
  /** Stores a new project and returns its id (derived from the name, made unique). */
  create(doc: unknown): Promise<ProjectSummary>
  /** The raw saved document; pass it through parseProject. */
  load(id: string): Promise<unknown>
  save(id: string, doc: unknown): Promise<void>
  remove(id: string): Promise<void>
  duplicate(id: string): Promise<ProjectSummary>
  listAssets(id: string): Promise<AssetMeta[]>
  readAsset(id: string, assetId: string): Promise<Blob>
  writeAsset(id: string, meta: AssetMeta, blob: Blob): Promise<void>
  deleteAsset(id: string, assetId: string): Promise<void>
}

/** A file-system-friendly id from a project name. */
export function projectSlug(name: string): string {
  return (
    name
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'project'
  )
}
