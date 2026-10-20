/**
 * three's WebGPU backend passes `swizzle: 'rgba'` (the final spec's string form)
 * on every texture view. Browsers that shipped an earlier draft reject that
 * with a TypeError on every frame. 'rgba' is the identity swizzle, so where the
 * browser rejects it, drop it. Detected once per device; a no-op elsewhere.
 */
export function patchTextureViewSwizzle(device: GPUDevice): void {
  const proto = GPUTexture.prototype as GPUTexture & { __swizzlePatched?: boolean }
  if (proto.__swizzlePatched) return
  const probe = device.createTexture({ size: [1, 1], format: 'rgba8unorm', usage: 0x04 /* TEXTURE_BINDING */ })
  try {
    probe.createView({ swizzle: 'rgba' } as GPUTextureViewDescriptor)
    return
  } catch {
    const createView = proto.createView
    proto.createView = function (this: GPUTexture, descriptor?: GPUTextureViewDescriptor) {
      if (descriptor && (descriptor as { swizzle?: string }).swizzle === 'rgba') {
        const { swizzle: _identity, ...rest } = descriptor as GPUTextureViewDescriptor & { swizzle?: string }
        return createView.call(this, rest)
      }
      return createView.call(this, descriptor)
    }
    proto.__swizzlePatched = true
  } finally {
    probe.destroy()
  }
}
