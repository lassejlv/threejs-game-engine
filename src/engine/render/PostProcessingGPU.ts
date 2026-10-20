import type { Camera, Scene } from 'three'
import { bloom } from 'three/addons/tsl/display/BloomNode.js'
import { clamp, distance, float, luminance, mix, pass, renderOutput, smoothstep, uniform, uv, vec2, vec3, vec4 } from 'three/tsl'
import { RenderPipeline, type WebGPURenderer } from 'three/webgpu'
import type { PostSettings } from './postSettings'

/**
 * The WebGPU version of PostProcessing, built from TSL nodes: bloom on the HDR
 * scene, then tone mapping and color space, then saturation, contrast and vignette.
 */
export class PostProcessingGPU {
  private readonly pipeline: RenderPipeline
  private readonly scenePass: ReturnType<typeof pass>
  private readonly bloom: ReturnType<typeof bloom>
  private readonly saturation = uniform(1)
  private readonly contrast = uniform(1)
  private readonly vignette = uniform(0)

  constructor(renderer: WebGPURenderer, scene: Scene, camera: Camera) {
    this.scenePass = pass(scene, camera, { samples: 4 })
    const color = this.scenePass.getTextureNode('output')
    this.bloom = bloom(color, 0.6, 0.4, 0.85)
    const display = renderOutput(color.add(this.bloom))
    const luma = luminance(display.rgb)
    const saturated = mix(vec3(luma), display.rgb, this.saturation)
    const contrasted = saturated.sub(0.5).mul(this.contrast).add(0.5)
    const edge = smoothstep(0.35, 1, distance(uv(), vec2(0.5)).mul(1.4142))
    const graded = contrasted.mul(float(1).sub(this.vignette.mul(edge)))
    this.pipeline = new RenderPipeline(renderer, vec4(clamp(graded, 0, 1), display.a))
    // renderOutput above already tone-maps and converts to the display color space.
    this.pipeline.outputColorTransform = false
  }

  set(s: PostSettings): void {
    this.bloom.strength.value = s.bloom ? s.bloomStrength : 0
    this.bloom.radius.value = s.bloomRadius
    this.bloom.threshold.value = s.bloomThreshold
    this.saturation.value = s.saturation
    this.contrast.value = s.contrast
    this.vignette.value = s.vignette
  }

  render(scene: Scene, camera: Camera): void {
    this.scenePass.scene = scene
    this.scenePass.camera = camera
    this.pipeline.render()
  }

  /** The renderer's size drives the passes. */
  setSize(): void {}

  dispose(): void {
    this.bloom.dispose()
    this.scenePass.dispose()
    this.pipeline.dispose()
  }
}
