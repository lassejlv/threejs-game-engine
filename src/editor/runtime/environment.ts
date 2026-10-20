import {
  BasicShadowMap,
  type Camera,
  CanvasTexture,
  EquirectangularReflectionMapping,
  type Light,
  type LightShadow,
  type Material,
  type Mesh,
  type OrthographicCamera,
  PCFShadowMap,
  PMREMGenerator,
  type Scene,
  SRGBColorSpace,
  type Texture,
  UVMapping,
  WebGLRenderer,
} from 'three'
import { type Engine, postEnabled } from '../../engine'
import type { PostProcessing } from '../../engine/render/PostProcessing'
import type { PostProcessingGPU } from '../../engine/render/PostProcessingGPU'
import { log } from '../console'
import type { SceneSettings, ShadowQuality } from '../document'
import type { AssetResolver } from './nodes'
import { webgpuKit } from './rendererKit'
import { applySettings } from './settings'

const SHADOW_MAP_SIZE: Record<ShadowQuality, number> = { off: 1024, low: 1024, medium: 2048, high: 4096 }
let shadowQuality: ShadowQuality = 'medium'

/** Shadow map size for newly built lights, following the current scene's quality setting. */
export function shadowMapSize(): number {
  return SHADOW_MAP_SIZE[shadowQuality]
}

/**
 * Applies a scene's look: background/fog/ambient, sky, image-based lighting,
 * shadow quality, exposure and post-processing. Calling `apply` with unchanged
 * settings is cheap, so it can run on every editor state change.
 */
export class SceneEnvironment {
  private skyKey = ''
  private shadowKey = ''
  private sky: Texture | null = null
  /** The sky drawn flat across the screen, for orthographic cameras (an equirect sky needs perspective). */
  private flatSky: Texture | null = null
  /** Image-based lighting: a PMREM render target (WebGL), or the equirect sky itself (WebGPU prefilters it). */
  private envTexture: Texture | null = null
  private envResource: { dispose(): void } | null = null
  private post: PostProcessing | PostProcessingGPU | null = null
  private postLoading = false
  private settings: SceneSettings | null = null
  private disposed = false

  constructor(
    private readonly engine: Engine,
    private readonly assets: AssetResolver,
  ) {
    engine.scene.onBeforeRender = this.swapSky
    // A restored GPU context comes back without the prefiltered environment map: build it again.
    this.offRestore = engine.events.on('contextRestored', () => {
      this.skyKey = ''
      if (this.settings) this.applySky(this.settings)
    })
  }

  private readonly offRestore: () => void

  private readonly swapSky = (_renderer: unknown, scene: Scene, camera: Camera): void => {
    if (this.sky && scene.background === this.sky && (camera as OrthographicCamera).isOrthographicCamera) scene.background = this.flatSky
    else if (this.flatSky && scene.background === this.flatSky && !(camera as OrthographicCamera).isOrthographicCamera) scene.background = this.sky
  }

  apply(settings: SceneSettings): void {
    this.settings = settings
    const { engine } = this
    applySettings(engine.scene, settings)
    engine.renderer.toneMappingExposure = settings.exposure
    this.applySky(settings)
    this.applyShadows(settings.shadows)
    this.applyPost(settings)
  }

  dispose(): void {
    this.disposed = true
    this.offRestore()
    this.sky?.dispose()
    this.flatSky?.dispose()
    this.envResource?.dispose()
    if (this.engine.scene.onBeforeRender === this.swapSky) this.engine.scene.onBeforeRender = () => {}
    if (this.post && this.engine.pipeline === this.post) this.engine.pipeline = null
  }

  private applySky(s: SceneSettings): void {
    const { scene } = this.engine
    const key = JSON.stringify([s.sky, s.skyTop, s.skyHorizon, s.skyBottom, s.skyTexture, s.environment, s.background])
    if (key !== this.skyKey) {
      this.skyKey = key
      this.sky?.dispose()
      this.flatSky?.dispose()
      this.envResource?.dispose()
      this.sky = null
      this.flatSky = null
      this.envTexture = null
      this.envResource = null
      if (s.sky === 'gradient') this.setSky(gradientTexture(s.skyTop, s.skyHorizon, s.skyBottom), s)
      else if (s.sky === 'texture' && s.skyTexture) this.loadSkyTexture(s.skyTexture, key)
      else if (s.environment) this.setSky(gradientTexture(s.background, s.background, s.background), s, false)
    }
    // applySettings resets the background to the flat color; put the sky back.
    if (this.sky && s.sky !== 'color') scene.background = this.sky
    scene.environment = s.environment ? this.envTexture : null
    scene.environmentIntensity = s.environmentIntensity
  }

  private loadSkyTexture(id: string, key: string): void {
    const url = this.assets.url(id)
    if (!url) {
      log('warn', 'Sky texture asset is missing')
      return
    }
    void this.engine.assets
      .texture(url)
      .then((texture) => {
        if (this.disposed || this.skyKey !== key || !this.settings) return
        // Clone: the cached texture may also be used as a material map with different settings.
        this.setSky(texture.clone(), this.settings)
        this.applySky(this.settings)
      })
      .catch((error: unknown) => log('error', 'Failed to load the sky texture', error))
  }

  private setSky(texture: Texture, s: SceneSettings, background = true): void {
    texture.mapping = EquirectangularReflectionMapping
    texture.colorSpace = SRGBColorSpace
    texture.needsUpdate = true
    if (background) {
      this.sky = texture
      this.flatSky = texture.clone()
      this.flatSky.mapping = UVMapping
      this.flatSky.needsUpdate = true
    }
    const { renderer } = this.engine
    if (s.environment && renderer instanceof WebGLRenderer) {
      const pmrem = new PMREMGenerator(renderer)
      const target = pmrem.fromEquirectangular(texture)
      pmrem.dispose()
      this.envTexture = target.texture
      this.envResource = target
    } else if (s.environment) {
      this.envTexture = texture
      if (!background) this.envResource = texture
      return
    }
    if (!background) texture.dispose()
  }

  private applyShadows(quality: ShadowQuality): void {
    if (quality === this.shadowKey) return
    const first = this.shadowKey === ''
    this.shadowKey = quality
    shadowQuality = quality
    const { renderer, scene } = this.engine
    renderer.shadowMap.enabled = quality !== 'off'
    renderer.shadowMap.type = quality === 'low' ? BasicShadowMap : PCFShadowMap
    if (first && quality === 'medium') return // matches what lights and materials were built with
    const size = shadowMapSize()
    scene.traverse((object) => {
      const light = object as Light & { shadow?: LightShadow }
      if (light.isLight && light.shadow) {
        if (light.shadow.mapSize.x !== size) {
          light.shadow.mapSize.set(size, size)
          light.shadow.map?.dispose()
          light.shadow.map = null
        }
      }
      // Shadow settings are compiled into shaders.
      const material = (object as Mesh).material as Material | Material[] | undefined
      if (Array.isArray(material)) for (const m of material) m.needsUpdate = true
      else if (material) material.needsUpdate = true
    })
  }

  private applyPost(s: SceneSettings): void {
    const { engine } = this
    if (!postEnabled(s)) {
      // Only one scene environment is active at a time, so any pipeline left over is stale.
      engine.pipeline = null
      this.post = null
      return
    }
    if (this.post) {
      this.post.set(s)
      return
    }
    if (this.postLoading) return
    // Loaded on demand so scenes without effects don't pay for the passes.
    this.postLoading = true
    const { renderer } = engine
    const create =
      renderer instanceof WebGLRenderer
        ? import('../../engine/render/PostProcessing').then(({ PostProcessing }) => () => new PostProcessing(renderer, engine.scene, engine.camera))
        : Promise.resolve(() => new (webgpuKit().PostProcessing)(renderer, engine.scene, engine.camera))
    void create.then((make) => {
      this.postLoading = false
      const latest = this.settings
      if (this.disposed || !latest || !postEnabled(latest)) return
      this.post = make()
      this.post.set(latest)
      engine.pipeline = this.post
    })
  }
}

/** A 2:1 equirectangular gradient: top at the zenith, horizon in the middle, bottom at the nadir. */
function gradientTexture(top: string, horizon: string, bottom: string): Texture {
  const canvas = document.createElement('canvas')
  canvas.width = 16
  canvas.height = 256
  const ctx = canvas.getContext('2d')!
  const g = ctx.createLinearGradient(0, 0, 0, 256)
  g.addColorStop(0, top)
  g.addColorStop(0.42, horizon)
  g.addColorStop(0.5, horizon)
  g.addColorStop(0.58, bottom)
  g.addColorStop(1, bottom)
  ctx.fillStyle = g
  ctx.fillRect(0, 0, 16, 256)
  return new CanvasTexture(canvas)
}
