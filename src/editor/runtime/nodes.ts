import {
  Audio,
  type AudioListener,
  BoxGeometry,
  BufferGeometry,
  CapsuleGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DirectionalLight,
  EdgesGeometry,
  Group,
  HemisphereLight,
  Line,
  LineBasicMaterial,
  LineSegments,
  type Material,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  type Object3D,
  OctahedronGeometry,
  PerspectiveCamera,
  PlaneGeometry,
  PointLight,
  PositionalAudio,
  SphereGeometry,
  SpotLight,
  TorusGeometry,
  Float32BufferAttribute,
  MathUtils,
} from 'three'
import { createStore, type Engine } from '../../engine'
import { log } from '../console'
import type { EntityDoc, Primitive } from '../document'
import { Animator } from './animator'
import { ParticleEmitter } from './particles'

/** Animation clip names per model asset, filled as models load (for the inspector's clip picker). */
export const modelClips = createStore<Record<string, string[]>>({})

/** Anything that can turn an asset id into a loadable URL (the editor's IndexedDB library, or an exported game's bundle). */
export interface AssetResolver {
  url(id: string): string | null
  /** Asset id for a file name, with or without extension. */
  byName(name: string): string | null
}

/** Shared unit-sized geometries (never disposed per entity). */
const primitives = new Map<Primitive, BufferGeometry>()
function primitive(shape: Primitive): BufferGeometry {
  let g = primitives.get(shape)
  if (!g) {
    g = {
      box: () => new BoxGeometry(1, 1, 1),
      sphere: () => new SphereGeometry(0.5, 32, 16),
      cylinder: () => new CylinderGeometry(0.5, 0.5, 1, 32),
      capsule: () => new CapsuleGeometry(0.5, 1, 8, 16),
      plane: () => new PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
      cone: () => new ConeGeometry(0.5, 1, 32),
      torus: () => new TorusGeometry(0.4, 0.15, 16, 48),
    }[shape]()
    primitives.set(shape, g)
  }
  return g
}

const proxyGeometry = new OctahedronGeometry(0.25)
const arrowGeometry = new BufferGeometry().setAttribute('position', new Float32BufferAttribute([0, 0, 0, 0, 0, -1.5], 3))
const proxyColors = { light: 0xffd25a, camera: 0x7fd1ff, audio: 0xff8fb4, particles: 0xffa53a, empty: 0xb0b8c8 }

export function isShared(geometry: BufferGeometry): boolean {
  return geometry === proxyGeometry || geometry === arrowGeometry || [...primitives.values()].includes(geometry)
}

/**
 * Turns entity docs into three.js objects. Each entity is a `node` Group that
 * carries the transform; its components become a `visual` child group, so
 * rebuilding visuals never disturbs child entities.
 */
export class NodeFactory {
  constructor(
    private readonly engine: Engine,
    private readonly library: AssetResolver,
    private readonly editorMode: boolean,
    /** Play mode only: audio sources are created against this listener. */
    private readonly listener?: AudioListener,
  ) {}

  /** Play mode: every model animator, updated by the play scene each frame. */
  readonly animators = new Set<Animator>()
  /** Every particle emitter; `updateParticles` steps them and drops disposed ones. */
  readonly emitters = new Set<ParticleEmitter>()

  createNode(entity: EntityDoc): Group {
    const node = new Group()
    node.name = entity.name
    node.userData.docId = entity.id
    this.applyTransform(node, entity)
    this.buildVisual(node, entity)
    return node
  }

  applyTransform(node: Object3D, entity: EntityDoc): void {
    const { position, rotation, scale } = entity.transform
    node.position.set(...position)
    node.rotation.set(
      MathUtils.degToRad(rotation[0]),
      MathUtils.degToRad(rotation[1]),
      MathUtils.degToRad(rotation[2]),
    )
    node.scale.set(...scale)
    node.name = entity.name
    node.visible = entity.active
  }

  /** Replaces the node's visual group. In play mode a Camera component is stored on `node.userData.camera`. */
  buildVisual(node: Group, entity: EntityDoc): void {
    const old = node.userData.visual as Group | undefined
    if (old) {
      disposeVisual(old)
      old.removeFromParent()
    }
    const visual = new Group()
    visual.userData.visual = true
    node.userData.visual = visual
    node.add(visual)
    node.userData.camera = undefined
    node.userData.animator = undefined
    node.userData.particles = undefined

    if (entity.mesh) {
      const m = entity.mesh
      const material = new MeshStandardMaterial({
        color: m.color,
        metalness: m.metalness,
        roughness: m.roughness,
        emissive: new Color(m.emissive),
        emissiveIntensity: m.emissiveIntensity,
      })
      if (m.map) {
        const url = this.library.url(m.map)
        if (url) {
          void this.engine.assets.texture(url).then((texture) => {
            material.map = texture
            material.needsUpdate = true
          })
        }
      }
      const mesh = new Mesh(primitive(m.shape), material)
      mesh.castShadow = m.castShadow
      mesh.receiveShadow = m.receiveShadow
      visual.add(mesh)
    }

    if (entity.model?.asset) this.loadModel(node, visual, entity)

    if (entity.light) {
      const l = entity.light
      switch (l.type) {
        case 'directional': {
          const light = new DirectionalLight(l.color, l.intensity)
          light.target.position.set(0, 0, -1)
          light.add(light.target)
          configureShadow(light, l.castShadow)
          const half = l.shadowArea / 2
          Object.assign(light.shadow.camera, { left: -half, right: half, top: half, bottom: -half, near: 0.5, far: 300 })
          visual.add(light)
          break
        }
        case 'point': {
          const light = new PointLight(l.color, l.intensity, l.distance)
          configureShadow(light, l.castShadow)
          visual.add(light)
          break
        }
        case 'spot': {
          const light = new SpotLight(l.color, l.intensity, l.distance, MathUtils.degToRad(l.angle), 0.3)
          light.target.position.set(0, 0, -1)
          light.add(light.target)
          configureShadow(light, l.castShadow)
          visual.add(light)
          break
        }
        case 'hemisphere':
          visual.add(new HemisphereLight(l.color, l.groundColor, l.intensity))
          break
      }
    }

    if (entity.audio?.asset && this.listener) this.createAudio(node, visual, entity)

    if (entity.particles) {
      const emitter = new ParticleEmitter(entity.particles, { preview: this.editorMode })
      visual.add(emitter.object)
      visual.userData.particles = emitter
      node.userData.particles = emitter
      this.emitters.add(emitter)
      this.loadParticleTexture(emitter, entity.particles.texture)
      if (this.editorMode || entity.particles.playOnStart) emitter.play()
    }

    if (entity.camera && !this.editorMode) {
      const camera = new PerspectiveCamera(entity.camera.fov, 1, entity.camera.near, entity.camera.far)
      node.userData.camera = camera
      visual.add(camera)
    }

    if (this.editorMode) this.addProxy(visual, entity)
  }

  /**
   * Edit mode: applies new emitter settings without restarting the effect, so
   * dragging a field doesn't reset the preview. False if there is no emitter to update.
   */
  reconfigureParticles(node: Group, entity: EntityDoc): boolean {
    const emitter = node.userData.particles as ParticleEmitter | undefined
    if (!emitter || !entity.particles) return false
    const textureChanged = emitter.config.texture !== entity.particles.texture
    emitter.configure(entity.particles)
    if (textureChanged) this.loadParticleTexture(emitter, entity.particles.texture)
    return true
  }

  /** Steps every live emitter. Run once per frame. */
  updateParticles(dt: number): void {
    for (const emitter of this.emitters) {
      const parent = emitter.object.parent
      let root: Object3D = emitter.object
      while (root.parent) root = root.parent
      // Disposed, or its entity was destroyed (play mode removes the node from the scene).
      if (emitter.disposed || !parent || root !== this.engine.scene) {
        this.emitters.delete(emitter)
        continue
      }
      parent.updateWorldMatrix(true, false)
      emitter.update(dt, parent.matrixWorld)
    }
  }

  private loadParticleTexture(emitter: ParticleEmitter, id: string | null): void {
    emitter.setTexture(null)
    const url = id && this.library.url(id)
    if (!url) return
    void this.engine.assets.texture(url).then((texture) => {
      if (!emitter.disposed && emitter.config.texture === id) emitter.setTexture(texture)
    })
  }

  /** Small pickable gizmos for things that are otherwise invisible. */
  private addProxy(visual: Group, entity: EntityDoc): void {
    if (entity.mesh || entity.model) return
    const kind = entity.light ? 'light' : entity.camera ? 'camera' : entity.audio ? 'audio' : entity.particles ? 'particles' : 'empty'
    const material = new MeshBasicMaterial({ color: proxyColors[kind], wireframe: true, fog: false })
    const proxy = new Mesh(proxyGeometry, material)
    proxy.userData.editorOnly = true
    visual.add(proxy)
    const directional = entity.camera || (entity.light && entity.light.type !== 'point' && entity.light.type !== 'hemisphere')
    if (directional) {
      const arrow = new Line(arrowGeometry, new LineBasicMaterial({ color: proxyColors[kind], fog: false }))
      arrow.userData.editorOnly = true
      visual.add(arrow)
    }
    if (entity.camera) {
      const frustum = new LineSegments(
        new EdgesGeometry(new ConeGeometry(0.45, 0.7, 4, 1, true).rotateX(Math.PI / 2).rotateZ(Math.PI / 4).translate(0, 0, -0.35)),
        new LineBasicMaterial({ color: proxyColors.camera, fog: false }),
      )
      frustum.userData.editorOnly = true
      visual.add(frustum)
    }
  }

  /** Audio source on `node.userData.audio`; starts once its buffer has loaded if `playOnStart`. */
  private createAudio(node: Group, visual: Group, entity: EntityDoc): void {
    const a = entity.audio!
    const url = this.library.url(a.asset!)
    if (!url) {
      log('warn', `${entity.name}: audio asset is missing`)
      return
    }
    const listener = this.listener!
    const sound = a.spatial ? new PositionalAudio(listener) : new Audio(listener)
    if (sound instanceof PositionalAudio) sound.setRefDistance(a.refDistance)
    sound.setVolume(a.volume)
    sound.setLoop(a.loop)
    visual.add(sound)
    node.userData.audio = sound
    void this.engine.assets
      .audio(url)
      .then((buffer) => {
        if (!visual.parent) return
        sound.setBuffer(buffer)
        if (a.playOnStart) sound.play()
      })
      .catch((error: unknown) => log('error', `${entity.name}: failed to load audio`, error))
  }

  private loadModel(node: Group, visual: Group, entity: EntityDoc): void {
    const model = entity.model!
    const animator = this.editorMode ? null : new Animator()
    if (animator) {
      node.userData.animator = animator
      visual.userData.animator = animator
      this.animators.add(animator)
      if (model.animation) animator.play(model.animation, { speed: model.animationSpeed, loop: model.animationLoop, fade: 0 })
    }
    const url = this.library.url(model.asset!)
    if (!url) {
      log('warn', `${entity.name}: model asset is missing`)
      return
    }
    void Promise.all([this.engine.assets.gltf(url), import('three/addons/utils/SkeletonUtils.js')])
      .then(([gltf, { clone }]) => {
        if (!visual.parent) return // rebuilt or removed while loading
        const instance = clone(gltf.scene)
        instance.traverse((o) => {
          o.userData.fromAsset = true // geometry/materials belong to the cached glTF
          o.castShadow = model.castShadow
          o.receiveShadow = model.receiveShadow
        })
        visual.add(instance)
        if (gltf.animations.length) {
          modelClips.set({ [model.asset!]: gltf.animations.map((c) => c.name) })
          animator?.attach(instance, gltf.animations)
        }
      })
      .catch((error: unknown) => log('error', `${entity.name}: failed to load model`, error))
  }
}

function configureShadow(light: DirectionalLight | PointLight | SpotLight, enabled: boolean): void {
  light.castShadow = enabled
  light.shadow.mapSize.set(2048, 2048)
  light.shadow.bias = -0.0005
  light.shadow.normalBias = 0.02
}

/** Disposes per-entity GPU resources (materials, light shadows), keeping shared geometry. */
export function disposeVisual(visual: Object3D): void {
  ;(visual.userData.animator as Animator | undefined)?.dispose()
  ;(visual.userData.particles as ParticleEmitter | undefined)?.dispose()
  visual.traverse((o) => {
    if (o.userData.fromAsset) return
    const mesh = o as Mesh
    if (mesh.geometry && !isShared(mesh.geometry)) mesh.geometry.dispose()
    const material = mesh.material as Material | Material[] | undefined
    if (Array.isArray(material)) for (const m of material) m.dispose()
    else material?.dispose()
    if ('isLight' in o && 'dispose' in o) (o as unknown as { dispose(): void }).dispose()
    if (o instanceof Audio && o.isPlaying) o.stop()
  })
}
