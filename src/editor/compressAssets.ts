/**
 * Export-time compression. Loaded on demand (the glTF tooling is large), only
 * when a game is exported with compression on. A result is used only if it is
 * smaller than the original.
 */

/** Meshopt-compresses a .glb (geometry and animation), after removing duplicate and unused data. */
export async function compressModel(blob: Blob): Promise<Blob> {
  const [{ WebIO }, { ALL_EXTENSIONS }, { dedup, meshopt, prune, resample }, { MeshoptEncoder }] = await Promise.all([
    import('@gltf-transform/core'),
    import('@gltf-transform/extensions'),
    import('@gltf-transform/functions'),
    import('meshoptimizer'),
  ])
  await MeshoptEncoder.ready
  const io = new WebIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder })
  const document = await io.readBinary(new Uint8Array(await blob.arrayBuffer()))
  await document.transform(dedup(), prune(), resample(), meshopt({ encoder: MeshoptEncoder, level: 'medium' }))
  const out = await io.writeBinary(document)
  return out.byteLength < blob.size ? new Blob([out as BlobPart], { type: 'model/gltf-binary' }) : blob
}

/** Re-encodes an image as WebP, scaled down to fit `maxSize`. */
export async function compressTexture(blob: Blob, maxSize = 2048): Promise<Blob> {
  const bitmap = await createImageBitmap(blob)
  const scale = Math.min(1, maxSize / Math.max(bitmap.width, bitmap.height))
  const width = Math.max(1, Math.round(bitmap.width * scale))
  const height = Math.max(1, Math.round(bitmap.height * scale))
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, width, height)
  bitmap.close()
  const out = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/webp', 0.85))
  return out && out.type === 'image/webp' && out.size < blob.size ? out : blob
}
