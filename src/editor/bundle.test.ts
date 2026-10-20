// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { buildBundle, readBundle } from './bundle'
import { emptyProject } from './document'
import { readBytes } from './storage/browserStore'
import { unzip, zip } from './zip'

const bytesOf = async (blob: Blob) => new Uint8Array(await readBytes(blob))
const asset = (id: string, name: string, data: number[]) => ({
  meta: { id, name, kind: 'texture' as const, size: data.length },
  blob: new Blob([new Uint8Array(data)]),
})

describe('project bundles', () => {
  it('round-trips the document and every asset byte for byte', async () => {
    const doc = { ...emptyProject(), name: 'Bundled' }
    const bundle = await buildBundle(doc, [asset('a1', 'grass.png', [1, 2, 3]), asset('b2', 'Stone.JPG', [9, 8])])
    const files = await unzip(await bytesOf(bundle))
    // Same layout as a project folder on disk.
    expect([...files.keys()]).toEqual(['project.json', 'assets.json', 'assets/a1.png', 'assets/b2.jpg'])
    const read = await readBundle(await bytesOf(bundle))
    expect(read.doc).toEqual(JSON.parse(JSON.stringify(doc)))
    expect(read.assets.map((a) => a.meta)).toEqual([
      { id: 'a1', name: 'grass.png', kind: 'texture', size: 3 },
      { id: 'b2', name: 'Stone.JPG', kind: 'texture', size: 2 },
    ])
    expect(await bytesOf(read.assets[0].blob)).toEqual(new Uint8Array([1, 2, 3]))
  })

  it('reads a project folder that was zipped up with its folder name', async () => {
    const blob = zip([
      { name: 'coin-rush/project.json', data: JSON.stringify({ ...emptyProject(), name: 'Folder' }) },
      { name: 'coin-rush/assets.json', data: JSON.stringify([{ id: 'x', name: 'x.png', kind: 'texture', size: 1, file: 'x.png' }]) },
      { name: 'coin-rush/assets/x.png', data: new Uint8Array([7]) },
    ])
    const read = await readBundle(await bytesOf(blob))
    expect((read.doc as { name: string }).name).toBe('Folder')
    expect(await bytesOf(read.assets[0].blob)).toEqual(new Uint8Array([7]))
  })

  it('says what is wrong with a bad bundle', async () => {
    await expect(readBundle(await bytesOf(zip([{ name: 'readme.txt', data: 'hi' }])))).rejects.toThrow('no project.json')
    await expect(readBundle(await bytesOf(zip([{ name: 'project.json', data: '{oops' }])))).rejects.toThrow('not valid JSON')
    const missing = zip([
      { name: 'project.json', data: '{}' },
      { name: 'assets.json', data: JSON.stringify([{ id: 'x', name: 'tree.glb', kind: 'model', size: 1, file: 'x.glb' }]) },
    ])
    await expect(readBundle(await bytesOf(missing))).rejects.toThrow('missing assets/x.glb (tree.glb)')
  })
})
