/** A minimal ZIP writer (files stored uncompressed) and reader (stored or deflated): enough for web-app exports and project bundles. */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

export function crc32(data: Uint8Array): number {
  let crc = 0xffffffff
  for (let i = 0; i < data.length; i++) crc = CRC_TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

export interface ZipEntry {
  name: string
  data: Uint8Array | string
}

export function zip(entries: ZipEntry[]): Blob {
  const encoder = new TextEncoder()
  const parts: Uint8Array[] = []
  const central: Uint8Array[] = []
  let offset = 0
  for (const entry of entries) {
    const name = encoder.encode(entry.name)
    const data = typeof entry.data === 'string' ? encoder.encode(entry.data) : entry.data
    const crc = crc32(data)
    const local = new Uint8Array(30 + name.length)
    const l = new DataView(local.buffer)
    l.setUint32(0, 0x04034b50, true) // local file header
    l.setUint16(4, 20, true) // version needed
    l.setUint16(6, 0x0800, true) // UTF-8 names
    l.setUint16(8, 0, true) // stored
    l.setUint32(14, crc, true)
    l.setUint32(18, data.length, true)
    l.setUint32(22, data.length, true)
    l.setUint16(26, name.length, true)
    local.set(name, 30)
    parts.push(local, data)

    const record = new Uint8Array(46 + name.length)
    const c = new DataView(record.buffer)
    c.setUint32(0, 0x02014b50, true) // central directory header
    c.setUint16(4, 20, true)
    c.setUint16(6, 20, true)
    c.setUint16(8, 0x0800, true)
    c.setUint16(10, 0, true)
    c.setUint32(16, crc, true)
    c.setUint32(20, data.length, true)
    c.setUint32(24, data.length, true)
    c.setUint16(28, name.length, true)
    c.setUint32(42, offset, true)
    record.set(name, 46)
    central.push(record)
    offset += local.length + data.length
  }
  const size = central.reduce((n, r) => n + r.length, 0)
  const end = new Uint8Array(22)
  const e = new DataView(end.buffer)
  e.setUint32(0, 0x06054b50, true) // end of central directory
  e.setUint16(8, entries.length, true)
  e.setUint16(10, entries.length, true)
  e.setUint32(12, size, true)
  e.setUint32(16, offset, true)
  return new Blob([...parts, ...central, end] as BlobPart[], { type: 'application/zip' })
}

/**
 * Reads a ZIP archive into name → bytes. Handles stored and deflated entries
 * (what OS zip tools write); folders are skipped.
 */
export async function unzip(input: Uint8Array): Promise<Map<string, Uint8Array>> {
  const view = new DataView(input.buffer, input.byteOffset, input.byteLength)
  // The end-of-central-directory record sits in the last 22 bytes plus an optional comment.
  let end = -1
  for (let i = input.length - 22; i >= Math.max(0, input.length - 22 - 0xffff); i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      end = i
      break
    }
  }
  if (end < 0) throw new Error('Not a zip file')
  const count = view.getUint16(end + 10, true)
  let pos = view.getUint32(end + 16, true)
  const decoder = new TextDecoder()
  const files = new Map<string, Uint8Array>()
  for (let n = 0; n < count; n++) {
    if (view.getUint32(pos, true) !== 0x02014b50) throw new Error('Damaged zip file (central directory)')
    const method = view.getUint16(pos + 10, true)
    const compressedSize = view.getUint32(pos + 20, true)
    const nameLength = view.getUint16(pos + 28, true)
    const extraLength = view.getUint16(pos + 30, true)
    const commentLength = view.getUint16(pos + 32, true)
    const localOffset = view.getUint32(pos + 42, true)
    const name = decoder.decode(input.subarray(pos + 46, pos + 46 + nameLength))
    pos += 46 + nameLength + extraLength + commentLength
    if (name.endsWith('/')) continue
    if (view.getUint32(localOffset, true) !== 0x04034b50) throw new Error(`Damaged zip file (${name})`)
    const dataStart = localOffset + 30 + view.getUint16(localOffset + 26, true) + view.getUint16(localOffset + 28, true)
    const data = input.subarray(dataStart, dataStart + compressedSize)
    if (method === 0) files.set(name, data.slice())
    else if (method === 8) files.set(name, await inflate(data))
    else throw new Error(`Unsupported zip compression in ${name}`)
  }
  return files
}

async function inflate(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}
