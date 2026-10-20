import { type Camera, HalfFloatType, type Scene, Vector2, type WebGLRenderer, WebGLRenderTarget } from 'three'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'
import type { PostSettings } from './postSettings'

/** Saturation, contrast and vignette, applied to the final display-space image. */
const GradeShader = {
  name: 'GradeShader',
  uniforms: {
    tDiffuse: { value: null },
    saturation: { value: 1 },
    contrast: { value: 1 },
    vignette: { value: 0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float saturation;
    uniform float contrast;
    uniform float vignette;
    varying vec2 vUv;
    void main() {
      vec4 color = texture2D(tDiffuse, vUv);
      float luma = dot(color.rgb, vec3(0.2126, 0.7152, 0.0722));
      color.rgb = mix(vec3(luma), color.rgb, saturation);
      color.rgb = (color.rgb - 0.5) * contrast + 0.5;
      float d = distance(vUv, vec2(0.5)) * 1.4142;
      color.rgb *= 1.0 - vignette * smoothstep(0.35, 1.0, d);
      gl_FragColor = vec4(clamp(color.rgb, 0.0, 1.0), color.a);
    }`,
}

/**
 * Bloom, tone mapping and color grading on top of the scene render. Rendering
 * goes through multisampled half-float targets, so bloom thresholds work on HDR values.
 */
export class PostProcessing {
  private readonly composer: EffectComposer
  private readonly renderPass: RenderPass
  private readonly bloom: UnrealBloomPass
  private readonly grade: ShaderPass

  constructor(renderer: WebGLRenderer, scene: Scene, camera: Camera) {
    const size = renderer.getDrawingBufferSize(new Vector2())
    const target = new WebGLRenderTarget(size.x, size.y, { type: HalfFloatType, samples: 4 })
    this.composer = new EffectComposer(renderer, target)
    this.renderPass = new RenderPass(scene, camera)
    this.bloom = new UnrealBloomPass(new Vector2(size.x, size.y), 0.6, 0.4, 0.85)
    this.grade = new ShaderPass(GradeShader)
    this.composer.addPass(this.renderPass)
    this.composer.addPass(this.bloom)
    this.composer.addPass(new OutputPass())
    this.composer.addPass(this.grade)
  }

  set(s: PostSettings): void {
    this.bloom.enabled = s.bloom
    this.bloom.strength = s.bloomStrength
    this.bloom.radius = s.bloomRadius
    this.bloom.threshold = s.bloomThreshold
    const u = this.grade.uniforms
    u.saturation.value = s.saturation
    u.contrast.value = s.contrast
    u.vignette.value = s.vignette
    this.grade.enabled = s.vignette > 0 || s.saturation !== 1 || s.contrast !== 1
  }

  render(scene: Scene, camera: Camera, dt: number): void {
    this.renderPass.scene = scene
    this.renderPass.camera = camera
    this.composer.render(dt)
  }

  /** Drawing-buffer size in pixels (CSS size × pixel ratio). */
  setSize(width: number, height: number, pixelRatio: number): void {
    this.composer.setPixelRatio(pixelRatio)
    this.composer.setSize(width, height)
  }

  dispose(): void {
    this.bloom.dispose()
    this.grade.dispose()
    this.composer.dispose()
  }
}
