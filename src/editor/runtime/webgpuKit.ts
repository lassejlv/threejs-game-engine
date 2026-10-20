import { WebGPURenderer } from 'three/webgpu'
import { PostProcessingGPU } from '../../engine/render/PostProcessingGPU'
import { nodeParticleMaterial } from './particleNodeMaterial'
import type { WebGPUKit } from './rendererKit'

export const webgpuKit: WebGPUKit = { Renderer: WebGPURenderer, particleMaterial: nodeParticleMaterial, PostProcessing: PostProcessingGPU }
