import { PerspectiveCamera } from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import type { Engine } from '../../engine'

/** The scene-view camera. Survives edit/play switches so the view never jumps. */
export const editorCamera = new PerspectiveCamera(50, 1, 0.1, 2000)
editorCamera.position.set(22, 16, 26)

const orbits = new WeakMap<Engine, OrbitControls>()

export function getOrbit(engine: Engine): OrbitControls {
  let orbit = orbits.get(engine)
  if (!orbit) {
    orbit = new OrbitControls(editorCamera, engine.canvas)
    orbit.enableDamping = true
    orbit.dampingFactor = 0.15
    orbit.screenSpacePanning = true
    orbit.target.set(0, 1, 0)
    orbit.update()
    const created = orbit
    orbits.set(engine, created)
    engine.events.on('dispose', () => created.dispose())
  }
  return orbit
}
