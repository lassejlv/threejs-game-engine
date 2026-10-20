import type { AssetKind, AssetMeta } from './assetLibrary'
import { readBytes } from './storage/browserStore'
import { unzip, zip, type ZipEntry } from './zip'

/**
 * Project bundles: one .zip with the document and every asset, laid out like a
 * project folder on disk (projects/<id>/), so a bundle can be unzipped straight
 * into projects/ and a folder zipped up is a bundle.
 *
 *   project.json
 *   assets.json        [{ id, name, kind, size, file }]
 *   assets/<id><ext>
 */

interface BundleAsset extends AssetMeta {
  file: string
}

const KINDS: AssetKind[] = ['model', 'texture', 'audio']

export async function buildBundle(doc: unknown, assets: { meta: AssetMeta; blob: Blob }[]): Promise<Blob> {
  const index: BundleAsset[] = []
  const entries: ZipEntry[] = [{ name: 'project.json', data: JSON.stringify(doc, null, 2) }]
  for (const { meta, blob } of assets) {
    const ext = /\.[A-Za-z0-9]+$/.exec(meta.name)?.[0].toLowerCase() ?? ''
    const file = `${meta.id}${ext}`
    index.push({ id: meta.id, name: meta.name, kind: meta.kind, size: meta.size, file })
    entries.push({ name: `assets/${file}`, data: new Uint8Array(await readBytes(blob)) })
  }
  entries.splice(1, 0, { name: 'assets.json', data: JSON.stringify(index, null, 2) })
  return zip(entries)
}

/** Reads a bundle (also one zipped up with its folder, e.g. coin-rush/project.json). Errors say what is wrong. */
export async function readBundle(bytes: Uint8Array): Promise<{ doc: unknown; assets: { meta: AssetMeta; blob: Blob }[] }> {
  const files = await unzip(bytes)
  const projectPath = [...files.keys()].filter((p) => p === 'project.json' || p.endsWith('/project.json')).sort((a, b) => a.length - b.length)[0]
  if (!projectPath) throw new Error('This zip has no project.json, so it is not a project bundle.')
  const root = projectPath.slice(0, -'project.json'.length)
  const decoder = new TextDecoder()
  let doc: unknown
  try {
    doc = JSON.parse(decoder.decode(files.get(projectPath)))
  } catch {
    throw new Error('project.json in this zip is not valid JSON.')
  }
  const indexBytes = files.get(`${root}assets.json`)
  let index: BundleAsset[] = []
  if (indexBytes) {
    try {
      index = JSON.parse(decoder.decode(indexBytes)) as BundleAsset[]
    } catch {
      throw new Error('assets.json in this zip is not valid JSON.')
    }
  }
  const assets: { meta: AssetMeta; blob: Blob }[] = []
  for (const entry of index) {
    if (!entry || typeof entry.id !== 'string' || typeof entry.file !== 'string' || !KINDS.includes(entry.kind)) {
      throw new Error('assets.json lists an asset without an id, file or valid kind.')
    }
    const data = files.get(`${root}assets/${entry.file}`)
    if (!data) throw new Error(`The zip is missing assets/${entry.file} (${entry.name}).`)
    assets.push({ meta: { id: entry.id, name: entry.name, kind: entry.kind, size: data.length }, blob: new Blob([data as BlobPart]) })
  }
  return { doc, assets }
}
