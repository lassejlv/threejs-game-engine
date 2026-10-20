import { useEffect, useState } from 'react'
import {
  Box3,
  DirectionalLight,
  HemisphereLight,
  type Object3D,
  PerspectiveCamera,
  Scene,
  Vector3,
  WebGLRenderer,
} from 'three'
import { disposeObject } from '../../engine'
import { assetLibrary } from '../editor'

const SIZE = 112
const cache = new Map<string, string>()
const inflight = new Map<string, Promise<string | null>>()
let renderer: WebGLRenderer | null = null
let queue: Promise<unknown> = Promise.resolve()

/** One small offscreen renderer shared by every thumbnail (a second WebGL context, created on first use). */
function getRenderer(): WebGLRenderer {
  if (!renderer) {
    renderer = new WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true })
    renderer.setSize(SIZE, SIZE, false)
    renderer.setPixelRatio(1)
  }
  return renderer
}

function snapshot(object: Object3D): string {
  const scene = new Scene()
  scene.add(new HemisphereLight(0xffffff, 0x445566, 1.6))
  const key = new DirectionalLight(0xffffff, 2)
  key.position.set(3, 5, 4)
  scene.add(key, object)
  const box = new Box3().setFromObject(object)
  const center = box.getCenter(new Vector3())
  const radius = Math.max(box.getSize(new Vector3()).length() / 2, 0.01)
  const camera = new PerspectiveCamera(35, 1, radius / 100, radius * 100)
  camera.position.copy(center).add(new Vector3(1, 0.8, 1.2).normalize().multiplyScalar(radius * 3))
  camera.lookAt(center)
  const r = getRenderer()
  r.render(scene, camera)
  return r.domElement.toDataURL('image/png')
}

async function renderModel(id: string): Promise<string | null> {
  const url = assetLibrary.url(id)
  if (!url) return null
  const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js')
  const gltf = await new GLTFLoader().loadAsync(url)
  const image = snapshot(gltf.scene)
  disposeObject(gltf.scene, { textures: true })
  return image
}

/** A data-URL preview for a model asset, rendered once and cached for the session. */
export function useModelThumbnail(id: string | null): string | null {
  const [image, setImage] = useState(() => (id ? (cache.get(id) ?? null) : null))
  useEffect(() => {
    if (!id || cache.has(id)) {
      setImage(id ? (cache.get(id) ?? null) : null)
      return
    }
    let cancelled = false
    let job = inflight.get(id)
    if (!job) {
      // Render one at a time so a big import doesn't stall the editor.
      job = queue.then(() => renderModel(id)).catch(() => null)
      queue = job
      inflight.set(id, job)
    }
    void job.then((result) => {
      inflight.delete(id)
      if (result) cache.set(id, result)
      if (!cancelled) setImage(result)
    })
    return () => {
      cancelled = true
    }
  }, [id])
  return image
}
