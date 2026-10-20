import {
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
  SphereGeometry,
  SpotLight,
  TorusGeometry,
  Float32BufferAttribute,
  MathUtils,
} from 'three'
import type { Engine } from '../../engine'
import { log } from '../console'
import type { EntityDoc, Primitive } from '../document'

/** Anything that can turn an asset id into a loadable URL (the editor's IndexedDB library, or an exported game's bundle). */
export interface AssetResolver {
  url(id: string): string | null
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
const proxyColors = { light: 0xffd25a, camera: 0x7fd1ff, empty: 0xb0b8c8 }

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
  ) {}

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

    if (entity.model?.asset) this.loadModel(visual, entity)

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

    if (entity.camera && !this.editorMode) {
      const camera = new PerspectiveCamera(entity.camera.fov, 1, entity.camera.near, entity.camera.far)
      node.userData.camera = camera
      visual.add(camera)
    }

    if (this.editorMode) this.addProxy(visual, entity)
  }

  /** Small pickable gizmos for things that are otherwise invisible. */
  private addProxy(visual: Group, entity: EntityDoc): void {
    if (entity.mesh || entity.model) return
    const kind = entity.light ? 'light' : entity.camera ? 'camera' : 'empty'
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

  private loadModel(visual: Group, entity: EntityDoc): void {
    const model = entity.model!
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
  visual.traverse((o) => {
    if (o.userData.fromAsset) return
    const mesh = o as Mesh
    if (mesh.geometry && !isShared(mesh.geometry)) mesh.geometry.dispose()
    const material = mesh.material as Material | Material[] | undefined
    if (Array.isArray(material)) for (const m of material) m.dispose()
    else material?.dispose()
    if ('isLight' in o && 'dispose' in o) (o as unknown as { dispose(): void }).dispose()
  })
}
