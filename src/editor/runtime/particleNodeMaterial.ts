import { DataTexture, type Texture, Vector2 } from 'three'
import { attribute, floor, fract, length, mod, modelScale, positionGeometry, smoothstep, texture, uniform, vec2, vec4 } from 'three/tsl'
import { SpriteNodeMaterial } from 'three/webgpu'
import type { ParticleMaterial } from './particles'

const white = new DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1)
white.needsUpdate = true

/**
 * The TSL twin of the GLSL particle shader, for WebGPU engines: camera-facing
 * quads sized in world units (ignoring the emitter's scale), spun by `angle`,
 * tinted by `color`, with a sprite-sheet frame or a soft round dot.
 */
export function nodeParticleMaterial(): ParticleMaterial {
  const sheet = uniform(new Vector2(1, 1))
  const useMap = uniform(0)
  const map = texture(white)

  const material = new SpriteNodeMaterial({ transparent: true, depthWrite: false })
  material.alphaTest = 0.004
  material.positionNode = attribute('offset', 'vec3')
  material.rotationNode = attribute('angle', 'float')
  // SpriteNodeMaterial multiplies by the object's scale; the GLSL shader doesn't.
  material.scaleNode = vec2(attribute('size', 'float')).div(modelScale.xy)

  // Sprite-sheet frame: rows run top to bottom.
  const frame = attribute('frame', 'float')
  const column = mod(frame, sheet.x)
  const row = floor(frame.div(sheet.x))
  const uv = positionGeometry.xy.add(0.5).add(vec2(column, sheet.y.sub(1).sub(row))).div(sheet)
  const dot = vec4(1, 1, 1, smoothstep(0.5, 0.15, length(fract(uv).sub(0.5))))
  const sample = map.sample(uv)
  const tex = useMap.greaterThan(0.5).select(sample, dot)
  material.colorNode = attribute('color', 'vec4').mul(tex)

  return {
    material,
    setSheet: (columns, rows) => sheet.value.set(columns, rows),
    setMap: (value: Texture | null) => {
      map.value = value ?? white
      useMap.value = value ? 1 : 0
    },
  }
}
