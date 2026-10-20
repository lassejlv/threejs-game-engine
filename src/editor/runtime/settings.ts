import { AmbientLight, Color, Fog, type Scene } from 'three'
import type { SceneSettings } from '../document'

/** Applies background, fog and ambient light. Safe to call repeatedly. */
export function applySettings(scene: Scene, settings: SceneSettings): void {
  scene.background = new Color(settings.background)
  scene.fog = settings.fog ? new Fog(settings.fogColor, settings.fogNear, settings.fogFar) : null
  let ambient = scene.userData.ambient as AmbientLight | undefined
  if (!ambient || ambient.parent !== scene) {
    ambient = new AmbientLight()
    scene.userData.ambient = ambient
    scene.add(ambient)
  }
  ambient.color.set(settings.ambientColor)
  ambient.intensity = settings.ambientIntensity
}
