import type { WebGPURenderer } from 'three/webgpu'
import type { Engine } from '../../engine'
import type { PostProcessingGPU } from '../../engine/render/PostProcessingGPU'
import type { ParticleMaterialFactory } from './particles'

/**
 * The WebGPU-only pieces (renderer, node particle material, TSL post-processing).
 * They live in webgpuKit.ts, which only the editor (lazily) and the WebGPU game
 * player import, so WebGL games never bundle three/webgpu. Install the kit
 * before creating a WebGPU engine.
 */
export interface WebGPUKit {
  Renderer: typeof WebGPURenderer
  particleMaterial: ParticleMaterialFactory
  PostProcessing: typeof PostProcessingGPU
}

let installed: WebGPUKit | null = null

export function installWebGPUKit(kit: WebGPUKit): void {
  installed = kit
}

export function webgpuKit(): WebGPUKit {
  if (!installed) throw new Error('installWebGPUKit() must run before building a WebGPU scene')
  return installed
}

/** The particle material for an engine's renderer (undefined: the GLSL default). */
export function particleMaterialFor(engine: Engine): ParticleMaterialFactory | undefined {
  return engine.isWebGPU ? webgpuKit().particleMaterial : undefined
}
