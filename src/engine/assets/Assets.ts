import { AudioLoader, LoadingManager, SRGBColorSpace, type Texture, TextureLoader } from 'three'
import type { GLTF, GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { createStore } from '../core/Store'
import { disposeObject } from '../utils/dispose'

export interface LoadProgress {
  loaded: number
  total: number
  active: boolean
}

export interface TextureOptions {
  /** Color textures are sRGB; data textures (normal, roughness) are not. Default true. */
  srgb?: boolean
}

/**
 * Cached, de-duplicated asset loading. Concurrent requests for the same URL
 * share one promise. Loaders for heavier formats are code-split and only
 * downloaded the first time they are used.
 */
export class Assets {
  readonly manager = new LoadingManager()
  readonly progress = createStore<LoadProgress>({ loaded: 0, total: 0, active: false })

  private readonly cache = new Map<string, Promise<unknown>>()
  private readonly textures = new TextureLoader(this.manager)
  private gltfLoader: Promise<GLTFLoader> | null = null

  constructor() {
    this.manager.onStart = (_url, loaded, total) => this.progress.set({ loaded, total, active: true })
    this.manager.onProgress = (_url, loaded, total) => this.progress.set({ loaded, total })
    this.manager.onLoad = () => this.progress.set({ active: false })
    this.manager.onError = (url) => console.error(`[assets] failed to load ${url}`)
  }

  texture(url: string, { srgb = true }: TextureOptions = {}): Promise<Texture> {
    return this.load(`texture:${srgb}:${url}`, async () => {
      const texture = await this.textures.loadAsync(url)
      if (srgb) texture.colorSpace = SRGBColorSpace
      return texture
    })
  }

  /** Loads a glTF/GLB. Clone `gltf.scene` (SkeletonUtils.clone for skinned meshes) to place it more than once. */
  gltf(url: string): Promise<GLTF> {
    return this.load(`gltf:${url}`, async () => {
      this.gltfLoader ??= Promise.all([
        import('three/addons/loaders/GLTFLoader.js'),
        import('three/addons/libs/meshopt_decoder.module.js'),
      ]).then(([{ GLTFLoader }, { MeshoptDecoder }]) => new GLTFLoader(this.manager).setMeshoptDecoder(MeshoptDecoder))
      return (await this.gltfLoader).loadAsync(url)
    })
  }

  /** Decoded audio for three.js `Audio` / `PositionalAudio`. */
  audio(url: string): Promise<AudioBuffer> {
    return this.load(`audio:${url}`, () => new AudioLoader(this.manager).loadAsync(url))
  }

  json<T>(url: string): Promise<T> {
    return this.load(`json:${url}`, async () => {
      const response = await fetch(url)
      if (!response.ok) throw new Error(`[assets] ${response.status} ${url}`)
      return (await response.json()) as T
    })
  }

  /** Disposes every cached GPU resource and forgets all entries. */
  async clear(): Promise<void> {
    const entries = [...this.cache.values()]
    this.cache.clear()
    const results = await Promise.allSettled(entries)
    for (const result of results) {
      if (result.status !== 'fulfilled') continue
      const value = result.value as Partial<Texture & GLTF>
      if (value && 'isTexture' in value) (value as Texture).dispose()
      else if (value && 'scene' in value && value.scene) disposeObject(value.scene, { textures: true })
    }
  }

  private load<T>(key: string, loader: () => Promise<T>): Promise<T> {
    const cached = this.cache.get(key)
    if (cached) return cached as Promise<T>
    const promise = loader().catch((error: unknown) => {
      this.cache.delete(key)
      throw error
    })
    this.cache.set(key, promise)
    return promise
  }
}
