import { describe, expect, it } from 'vitest'
import { deflateRawSync } from 'node:zlib'
import { crc32, unzip, zip } from './zip'

describe('zip', () => {
  it('computes CRC-32', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926)
  })

  it('writes a well-formed archive', async () => {
    const blob = zip([
      { name: 'index.html', data: '<p>hi</p>' },
      { name: 'icon.png', data: new Uint8Array([1, 2, 3]) },
    ])
    const bytes = new Uint8Array(await blob.arrayBuffer())
    const view = new DataView(bytes.buffer)
    expect(view.getUint32(0, true)).toBe(0x04034b50)
    const end = bytes.length - 22
    expect(view.getUint32(end, true)).toBe(0x06054b50)
    expect(view.getUint16(end + 10, true)).toBe(2)
    // The central directory points back at the second file's local header.
    const centralStart = view.getUint32(end + 16, true)
    const secondRecord = centralStart + 46 + 'index.html'.length
    const secondOffset = view.getUint32(secondRecord + 42, true)
    expect(view.getUint32(secondOffset, true)).toBe(0x04034b50)
    expect(new TextDecoder().decode(bytes.slice(secondOffset + 30, secondOffset + 38))).toBe('icon.png')
  })
})

describe('unzip', () => {
  it('reads back what zip writes', async () => {
    const png = new Uint8Array([137, 80, 78, 71, 0, 255])
    const blob = zip([
      { name: 'project.json', data: '{"name":"ü"}' },
      { name: 'assets/a.png', data: png },
    ])
    const files = await unzip(new Uint8Array(await new Response(blob).arrayBuffer()))
    expect([...files.keys()]).toEqual(['project.json', 'assets/a.png'])
    expect(new TextDecoder().decode(files.get('project.json'))).toBe('{"name":"ü"}')
    expect(files.get('assets/a.png')).toEqual(png)
  })

  it('reads deflated entries, as OS zip tools write them', async () => {
    const text = new TextEncoder().encode('hello '.repeat(200))
    const deflated = deflateRawSync(text)
    const name = new TextEncoder().encode('big.txt')
    const local = new Uint8Array(30 + name.length)
    const l = new DataView(local.buffer)
    l.setUint32(0, 0x04034b50, true)
    l.setUint16(8, 8, true)
    l.setUint32(14, crc32(text), true)
    l.setUint32(18, deflated.length, true)
    l.setUint32(22, text.length, true)
    l.setUint16(26, name.length, true)
    local.set(name, 30)
    const central = new Uint8Array(46 + name.length)
    const c = new DataView(central.buffer)
    c.setUint32(0, 0x02014b50, true)
    c.setUint16(10, 8, true)
    c.setUint32(20, deflated.length, true)
    c.setUint32(24, text.length, true)
    c.setUint16(28, name.length, true)
    central.set(name, 46)
    const end = new Uint8Array(22)
    const e = new DataView(end.buffer)
    e.setUint32(0, 0x06054b50, true)
    e.setUint16(8, 1, true)
    e.setUint16(10, 1, true)
    e.setUint32(12, central.length, true)
    e.setUint32(16, local.length + deflated.length, true)
    const archive = new Uint8Array([...local, ...deflated, ...central, ...end])
    expect((await unzip(archive)).get('big.txt')).toEqual(text)
  })

  it('rejects files that are not zips', async () => {
    await expect(unzip(new TextEncoder().encode('{"version":2}'))).rejects.toThrow('Not a zip file')
  })
})
