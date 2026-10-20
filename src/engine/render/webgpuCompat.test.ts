import { afterEach, describe, expect, it } from 'vitest'
import { patchTextureViewSwizzle } from './webgpuCompat'

/** A GPUTexture whose createView rejects the string swizzle, like browsers on the older draft. */
function installFakeGPU(rejectsString: boolean) {
  const seen: unknown[] = []
  class FakeTexture {
    createView(descriptor?: { swizzle?: unknown }) {
      if (rejectsString && typeof descriptor?.swizzle === 'string') throw new TypeError('not a GPUTextureComponentSwizzle')
      seen.push(descriptor)
      return {}
    }
    destroy() {}
  }
  Object.assign(globalThis, { GPUTexture: FakeTexture })
  const device = { createTexture: () => new FakeTexture() } as unknown as GPUDevice
  return { device, seen, texture: new FakeTexture() as unknown as GPUTexture }
}

afterEach(() => {
  delete (globalThis as { GPUTexture?: unknown }).GPUTexture
})

describe('patchTextureViewSwizzle', () => {
  it('drops the identity swizzle where the browser rejects it', () => {
    const { device, seen, texture } = installFakeGPU(true)
    patchTextureViewSwizzle(device)
    texture.createView({ swizzle: 'rgba', format: 'rgba8unorm' } as GPUTextureViewDescriptor)
    expect(seen.at(-1)).toEqual({ format: 'rgba8unorm' })
    texture.createView()
    expect(seen.at(-1)).toBeUndefined()
  })

  it('leaves browsers that accept it alone', () => {
    const { device, seen, texture } = installFakeGPU(false)
    patchTextureViewSwizzle(device)
    texture.createView({ swizzle: 'rgba' } as GPUTextureViewDescriptor)
    expect(seen.at(-1)).toEqual({ swizzle: 'rgba' })
  })
})
