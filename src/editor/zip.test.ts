import { describe, expect, it } from 'vitest'
import { crc32, zip } from './zip'

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
