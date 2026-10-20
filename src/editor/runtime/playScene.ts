import {
  AudioListener,
  BufferAttribute,
  BufferGeometry,
  type Group,
  LineBasicMaterial,
  LineSegments,
  type PerspectiveCamera,
  Points,
  PointsMaterial,
  Vector3,
} from 'three'
import {
  boxCollider,
  capsuleCollider,
  Collider,
  type ColliderData,
  convexCollider,
  cylinderCollider,
  Joint,
  joint,
  meshCollider,
  defineScene,
  type Engine,
  type Entity,
  type GameScene,
  loadRapier,
  RapierPhysics,
  RigidBody,
  rigidBody,
  sphereCollider,
  Transform,
} from '../../engine'
import { log } from '../console'
import {
  type ColliderDoc,
  defaultInputActions,
  defaultInputAxes,
  defaultProjectSettings,
  depthFirst,
  type EntityDoc,
  expandEntities,
  instantiatePrefab,
  type JointDoc,
  type ProjectDoc,
  type ProjectSettings,
} from '../document'
import { AudioMixer } from './audioMixer'
import { assetsIdle, Fader } from './fader'
import { MeshBatcher } from './batcher'
import { type AssetResolver, NodeFactory } from './nodes'
import type { ParticleEmitter } from './particles'
import { PlaySession } from './playSession'
import { TouchControls, wantsTouchControls } from './touchControls'
import { visualGeometry } from './visualGeometry'
import { SceneEnvironment } from './environment'

const scale = new Vector3()

/** Collision groups for a layer index: its own bit, and the layers it collides with. */
export function layerGroups(layer: number, settings: ProjectSettings = defaultProjectSettings()): { layer: number; mask: number } {
  const index = Math.max(0, Math.min(15, Math.floor(layer)))
  return { layer: 1 << index, mask: settings.layerCollisions[index] ?? 0xffff }
}

/** Converts a primitive-shape collider doc to engine collider data, baking in the entity's world scale. */
export function colliderData(c: ColliderDoc, worldScale: Vector3, groups = layerGroups(c.layer)): ColliderData {
  const { x: sx, y: sy, z: sz } = worldScale
  const options = { offset: new Vector3(...c.center).multiply(worldScale), trigger: c.trigger, friction: c.friction, ...groups }
  switch (c.shape) {
    case 'sphere':
      return sphereCollider(c.radius * Math.max(sx, sy, sz), options)
    case 'capsule': {
      const radius = c.radius * Math.max(sx, sz)
      return capsuleCollider(radius, Math.max(0, (c.height * sy) / 2 - radius), options)
    }
    case 'cylinder':
      return cylinderCollider(c.radius * Math.max(sx, sz), (c.height * sy) / 2, options)
    default:
      return boxCollider((c.size[0] * sx) / 2, (c.size[1] * sy) / 2, (c.size[2] * sz) / 2, options)
  }
}

/** Engine joint data from a joint doc: degrees become radians, local units get the entity's scale. */
export function jointData(j: JointDoc, target: Entity | null, worldScale: Vector3) {
  const angular = j.type === 'hinge'
  const unit = (v: number) => (angular ? (v * Math.PI) / 180 : v)
  return joint(j.type, target, {
    anchor: new Vector3(...j.anchor).multiply(worldScale),
    axis: new Vector3(...j.axis),
    limits: j.limits ? [unit(j.min), unit(j.max)] : null,
    restLength: j.restLength,
    stiffness: j.stiffness,
    damping: j.damping,
    motorSpeed: unit(j.motorSpeed),
    motorStrength: j.motorStrength,
  })
}

/** Builds ECS entities from entity docs. Used for the initial scene and for runtime spawning. */
export class PlayBuilder {
  constructor(
    private readonly engine: Engine,
    private readonly factory: NodeFactory,
    private readonly session: PlaySession,
    private readonly batcher?: MeshBatcher,
    private readonly settings: ProjectSettings = defaultProjectSettings(),
  ) {}

  /** `entities` must be parent-first. Returns doc id → entity, plus the main camera if one was built. */
  instantiate(entities: EntityDoc[], parent: { entity: Entity; node: Group } | null = null) {
    const { world, scene } = this.engine
    const nodes = new Map<string, Group>()
    const ids = new Map<string, Entity>()
    const inactive = new Set<string>()
    let mainCamera: PerspectiveCamera | null = null

    for (const e of entities) {
      if (!e.active || (e.parent && inactive.has(e.parent))) {
        inactive.add(e.id)
        continue
      }
      const node = this.factory.createNode(e)
      const camera = node.userData.camera as PerspectiveCamera | undefined
      if (e.camera?.main && camera && !mainCamera) mainCamera = camera
      const parentNode = e.parent ? nodes.get(e.parent) : parent?.node
      parentNode?.add(node)
      nodes.set(e.id, node)
      if (this.batcher) this.batcher.add(node.userData.visual as Group)
      const entity = world.create()
      ids.set(e.id, entity)
      world.add(entity, Transform, node) // root nodes join the scene here
    }
    scene.updateMatrixWorld(true)

    for (const e of entities) {
      const node = nodes.get(e.id)
      const entity = ids.get(e.id)
      if (!node || entity === undefined) continue
      if (e.rigidBody) {
        // Bodies simulate in world space, so lift them out of any hierarchy.
        if (node.parent !== scene) scene.attach(node)
        const { type, gravityScale, damping, restitution, mass, lockRotation } = e.rigidBody
        world.add(
          entity,
          RigidBody,
          rigidBody(node, {
            kinematic: type === 'kinematic',
            character: type === 'character',
            gravityScale,
            damping,
            restitution,
            mass,
            lockRotation,
          }),
        )
      }
      if (e.collider) {
        node.getWorldScale(scale)
        const groups = layerGroups(e.collider.layer, this.settings)
        if (e.collider.shape === 'mesh' || e.collider.shape === 'convex') this.addMeshCollider(entity, node, e, groups)
        else world.add(entity, Collider, colliderData(e.collider, scale, groups))
      }
      const handle = { entity, name: e.name, object: node, body: world.tryGet(entity, RigidBody) }
      const parentEntity = e.parent ? (ids.get(e.parent) ?? null) : (parent?.entity ?? null)
      this.session.register(handle, parentEntity)
      this.session.mapDoc(e.id, entity)
      this.session.attachScripts(handle, e)
      const emitter = node.userData.particles as ParticleEmitter | undefined
      if (emitter && e.particles?.destroyWhenDone) emitter.onFinished = () => this.session.destroy(entity)
    }
    // Joints last: their targets may be built later in the list.
    for (const e of entities) {
      const entity = ids.get(e.id)
      const node = nodes.get(e.id)
      if (!e.joint || entity === undefined || !node) continue
      if (!e.rigidBody) {
        log('warn', `"${e.name}": a Joint needs a Rigid Body`)
        continue
      }
      node.getWorldScale(scale)
      const target = e.joint.target ? (ids.get(e.joint.target) ?? null) : null
      world.add(entity, Joint, jointData(e.joint, target, scale))
    }
    return { ids, mainCamera }
  }

  /** Mesh and convex colliders are built from the visual, once a model has loaded. */
  private addMeshCollider(entity: Entity, node: Group, e: EntityDoc, groups: { layer: number; mask: number }): void {
    const c = e.collider!
    const build = () => {
      const { world } = this.engine
      if (!world.isAlive(entity)) return
      node.getWorldScale(scale)
      const { vertices, indices } = visualGeometry(node, scale)
      if (vertices.length === 0) {
        log('warn', `"${e.name}": a ${c.shape} collider needs a Mesh Renderer or Model`)
        return
      }
      // Triangle meshes have no inside, so moving bodies use the convex hull instead.
      const dynamic = e.rigidBody && e.rigidBody.type === 'dynamic'
      const options = { offset: new Vector3(...c.center).multiply(scale), trigger: c.trigger, friction: c.friction, ...groups }
      world.add(entity, Collider, c.shape === 'mesh' && !dynamic ? meshCollider(vertices, indices, options) : convexCollider(vertices, options))
    }
    const ready = node.userData.modelReady as Promise<unknown> | undefined
    if (ready) void ready.then(build)
    else build()
  }
}

export interface PlayOptions {
  assets: AssetResolver
  /** Called when a script asks for another scene. */
  loadScene(sceneId: string): void
  /** Used when the scene has no main camera. */
  fallbackCamera: PerspectiveCamera
  /** Extra setup once the scene is built (e.g. disabling editor controls). */
  onStart?(engine: Engine): void
  /** When this returns true, every collider and joint is drawn as lines (the editor's Colliders toggle). */
  showColliders?(): boolean
}

/** Builds a running game for one scene of a frozen copy of the project. */
export function createPlayScene(doc: ProjectDoc, sceneId: string, options: PlayOptions): GameScene {
  const scene = doc.scenes.find((s) => s.id === sceneId) ?? doc.scenes[0]
  return defineScene({
    name: scene.name,
    physics: false, // Rapier replaces the built-in physics
    async setup({ engine, signal }) {
      const fader = Fader.for(engine.container)
      fader.showLoading(engine.assets.progress)
      const R = await loadRapier()
      if (signal.aborted) return
      engine.physics.gravity.set(0, -scene.settings.gravity, 0)
      // Built-in names first, so the built-in scripts work even if a project removed them; project bindings win.
      // Every action also answers to its on-screen touch button.
      for (const a of [...defaultInputActions(), ...doc.settings.inputActions]) engine.input.bind(a.name, [...a.keys, `Touch:${a.name}`])
      for (const a of [...defaultInputAxes(), ...doc.settings.inputAxes]) {
        engine.input.bindAxis(a.name, a.negative, a.positive, a.gamepadAxis, a.invert)
      }
      const environment = new SceneEnvironment(engine, options.assets)
      environment.apply(scene.settings)
      engine.addSystem({ name: 'environment', phase: 'render', run: () => {}, init: () => () => environment.dispose() })

      const physics = new RapierPhysics(engine, R)
      const listener = new AudioListener()
      // Music and volume groups outlive the scene, so tracks continue or cross-fade across scene loads.
      const mixer = AudioMixer.for(engine)
      mixer.useProject(doc.name)
      mixer.attachListener(listener)
      if (scene.settings.music === 'stop') mixer.stopMusic(1)
      else if (scene.settings.music) {
        const url = options.assets.url(scene.settings.music)
        if (url) mixer.playMusic(scene.settings.music, scene.settings.music, url, { volume: scene.settings.musicVolume })
        else log('warn', `"${scene.name}": its music asset is missing`)
      }
      const session = new PlaySession(engine, doc, physics, listener, options.assets, scene.settings.navigation)
      const factory = new NodeFactory(engine, options.assets, false, listener)
      const batcher = new MeshBatcher(engine.scene)
      const builder = new PlayBuilder(engine, factory, session, batcher, doc.settings)
      session.connect({
        sceneName: scene.name,
        spawn: (prefabName, spawn) => {
          const prefab = doc.prefabs.find((p) => p.name === prefabName || p.id === prefabName)
          if (!prefab) {
            log('warn', `spawn: no prefab named "${prefabName}"`)
            return undefined
          }
          const instance = instantiatePrefab(prefab)
          if (spawn.position) instance.transform.position = [spawn.position.x, spawn.position.y, spawn.position.z]
          if (spawn.rotation) instance.transform.rotation = [spawn.rotation.x, spawn.rotation.y, spawn.rotation.z]
          const parent = spawn.parent ? { entity: spawn.parent.entity, node: spawn.parent.object as Group } : null
          const { ids } = builder.instantiate(depthFirst(expandEntities([instance], doc.prefabs)), parent)
          const entity = ids.get(instance.id)
          return entity === undefined ? undefined : session.handle(entity)
        },
        loadScene: (name) => {
          const target = doc.scenes.find((s) => s.name === name || s.id === name)
          if (target) options.loadScene(target.id)
          else {
            log('warn', `loadScene: no scene named "${name}"`)
            void fader.fadeTo(0, 0.2)
          }
        },
        beforeSceneSwitch: () => fader.fadeTo(1, 0.3),
      })
      const { mainCamera } = builder.instantiate(depthFirst(expandEntities(scene.entities, doc.prefabs)))
      session.showSceneUi(scene.ui)

      if (mainCamera) engine.camera = mainCamera
      else {
        log('warn', `"${scene.name}" has no main camera; using a default view.`)
        engine.camera = options.fallbackCamera
      }
      for (const system of physics.systems()) engine.addSystem(system)
      for (const system of session.systems()) engine.addSystem(system)
      engine.addSystem({
        name: 'animation',
        phase: 'update',
        order: 10,
        run: (_engine, dt) => {
          for (const animator of factory.animators) {
            if (animator.isIn(engine.scene)) animator.update(dt)
            else {
              animator.dispose()
              factory.animators.delete(animator)
            }
          }
        },
      })
      engine.addSystem({ name: 'particles', phase: 'late', order: 100, run: (_engine, dt) => factory.updateParticles(dt) })
      engine.addSystem({ name: 'batching', phase: 'render', order: -10, run: () => batcher.update() })
      if (options.showColliders) {
        const show = options.showColliders
        const lines = new LineSegments(new BufferGeometry(), new LineBasicMaterial({ vertexColors: true, depthTest: false, transparent: true, fog: false }))
        lines.frustumCulled = false
        lines.renderOrder = 999
        // Walkable navigation cells, once a script has baked the grid.
        const navPoints = new Points(new BufferGeometry(), new PointsMaterial({ color: 0x4fd1ff, size: 4, sizeAttenuation: false, depthTest: false, fog: false }))
        navPoints.frustumCulled = false
        navPoints.renderOrder = 999
        engine.scene.add(lines, navPoints)
        engine.addSystem({
          name: 'physics.debug',
          phase: 'render',
          run: () => {
            lines.visible = navPoints.visible = show()
            if (!lines.visible) return
            const { vertices, colors } = physics.debugLines()
            lines.geometry.setAttribute('position', new BufferAttribute(vertices, 3))
            lines.geometry.setAttribute('color', new BufferAttribute(colors, 4))
            const nav = session.navigation.debugPoints()
            if (nav && navPoints.geometry.getAttribute('position')?.count !== nav.length / 3) {
              navPoints.geometry.setAttribute('position', new BufferAttribute(nav, 3))
            }
          },
        })
      }
      if (wantsTouchControls(doc.settings.touchControls)) {
        const touch = new TouchControls(engine.container, engine.input, doc.settings.touchButtons)
        engine.addSystem({ name: 'touch', phase: 'render', run: () => {}, init: () => () => touch.dispose() })
      }
      options.onStart?.(engine)
      // Fade in once models and textures have loaded (or after a few seconds).
      void assetsIdle(engine.assets.progress).then(() => {
        if (signal.aborted) return
        fader.hideLoading()
        void fader.fadeTo(0, 0.4)
      })
    },
  })
}
