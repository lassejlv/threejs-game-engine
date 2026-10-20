export function encodeHeights(heights: Float32Array): string {
  const bytes = new Uint8Array(heights.buffer, heights.byteOffset, heights.byteLength)
  let text = ''
  for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(text)
}

export function decodeHeights(encoded: string, resolution: number): Float32Array {
  const out = new Float32Array(resolution * resolution)
  if (!encoded) return out
  const text = atob(encoded)
  const bytes = new Uint8Array(text.length)
  for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i)
  out.set(new Float32Array(bytes.buffer, 0, Math.min(out.length, Math.floor(bytes.length / 4))))
  return out
}

/** Smooth rolling hills (deterministic for a seed): a starting point for sculpting. */
export function generateHills(resolution: number, size: [number, number], height: number, seed = 1): Float32Array {
  const out = new Float32Array(resolution * resolution)
  let s = seed >>> 0
  const random = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296)
  const waves = Array.from({ length: 6 }, (_, i) => ({
    kx: ((random() - 0.5) * 2 * Math.PI * (i + 1)) / size[0],
    kz: ((random() - 0.5) * 2 * Math.PI * (i + 1)) / size[1],
    phase: random() * Math.PI * 2,
    amp: height / (i + 1.5),
  }))
  for (let z = 0; z < resolution; z++) {
    for (let x = 0; x < resolution; x++) {
      const px = (x / (resolution - 1) - 0.5) * size[0]
      const pz = (z / (resolution - 1) - 0.5) * size[1]
      let h = 0
      for (const w of waves) h += Math.sin(px * w.kx + pz * w.kz + w.phase) * w.amp
      out[z * resolution + x] = Math.max(0, h * 0.5 + height * 0.25)
    }
  }
  return out
}
