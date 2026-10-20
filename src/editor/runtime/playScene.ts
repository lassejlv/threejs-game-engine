import { type Group, type PerspectiveCamera, Vector3 } from 'three'
import {
  boxCollider,
  capsuleCollider,
  Collider,
  type ColliderData,
  cylinderCollider,
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
import { type ColliderDoc, depthFirst, type EntityDoc, expandEntities, instantiatePrefab, type ProjectDoc } from '../document'
import { type AssetResolver, NodeFactory } from './nodes'
import { PlaySession } from './playSession'
import { applySettings } from './settings'

const scale = new Vector3()

/** Converts a collider doc to engine collider data, baking in the entity's world scale. */
export function colliderData(c: ColliderDoc, worldScale: Vector3): ColliderData {
  const { x: sx, y: sy, z: sz } = worldScale
  const options = { offset: new Vector3(...c.center).multiply(worldScale), trigger: c.trigger, friction: c.friction }
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

/** Builds ECS entities from entity docs. Used for the initial scene and for runtime spawning. */
export class PlayBuilder {
  constructor(
    private readonly engine: Engine,
    private readonly factory: NodeFactory,
    private readonly session: PlaySession,
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
        world.add(entity, Collider, colliderData(e.collider, scale))
      }
      const handle = { entity, name: e.name, object: node, body: world.tryGet(entity, RigidBody) }
      const parentEntity = e.parent ? (ids.get(e.parent) ?? null) : (parent?.entity ?? null)
      this.session.register(handle, parentEntity)
      this.session.attachScripts(handle, e)
    }
    return { ids, mainCamera }
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
}

/** Builds a running game for one scene of a frozen copy of the project. */
export function createPlayScene(doc: ProjectDoc, sceneId: string, options: PlayOptions): GameScene {
  const scene = doc.scenes.find((s) => s.id === sceneId) ?? doc.scenes[0]
  return defineScene({
    name: scene.name,
    physics: false, // Rapier replaces the built-in physics
    async setup({ engine, signal }) {
      const R = await loadRapier()
      if (signal.aborted) return
      engine.physics.gravity.set(0, -scene.settings.gravity, 0)
      applySettings(engine.scene, scene.settings)

      const physics = new RapierPhysics(engine, R)
      const session = new PlaySession(engine, doc, physics)
      const builder = new PlayBuilder(engine, new NodeFactory(engine, options.assets, false), session)
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
          else log('warn', `loadScene: no scene named "${name}"`)
        },
      })
      const { mainCamera } = builder.instantiate(depthFirst(expandEntities(scene.entities, doc.prefabs)))

      if (mainCamera) engine.camera = mainCamera
      else {
        log('warn', `"${scene.name}" has no main camera; using a default view.`)
        engine.camera = options.fallbackCamera
      }
      for (const system of physics.systems()) engine.addSystem(system)
      for (const system of session.systems()) engine.addSystem(system)
      options.onStart?.(engine)
    },
  })
}
