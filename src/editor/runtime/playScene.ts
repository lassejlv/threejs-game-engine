import { type Group, type PerspectiveCamera, Vector3 } from 'three'
import {
  boxCollider,
  Collider,
  defineScene,
  type Entity,
  type GameScene,
  RigidBody,
  rigidBody,
  sphereCollider,
  Transform,
} from '../../engine'
import { log } from '../console'
import { depthFirst, type ProjectDoc } from '../document'
import { assetLibrary } from '../editor'
import { editorCamera, getOrbit } from './editorCamera'
import { NodeFactory } from './nodes'
import { PlaySession } from './playSession'
import { applySettings } from './settings'

const scale = new Vector3()

/** Builds a running game from a frozen copy of the project. */
export function createPlayScene(doc: ProjectDoc): GameScene {
  return defineScene({
    name: `${doc.name} (play)`,
    setup({ engine }) {
      const { world, scene } = engine
      engine.physics.gravity.set(0, -doc.settings.gravity, 0)
      applySettings(scene, doc.settings)
      getOrbit(engine).enabled = false

      const factory = new NodeFactory(engine, assetLibrary, false)
      const session = new PlaySession(engine, doc)
      const nodes = new Map<string, Group>()
      const entities = new Map<string, Entity>()
      const inactive = new Set<string>()
      let mainCamera: PerspectiveCamera | null = null

      const ordered = depthFirst(doc)
      for (const e of ordered) {
        if (!e.active || (e.parent && inactive.has(e.parent))) {
          inactive.add(e.id)
          continue
        }
        const node = factory.createNode(e)
        const camera = node.userData.camera as PerspectiveCamera | undefined
        if (e.camera?.main && camera && !mainCamera) mainCamera = camera
        const parent = e.parent ? nodes.get(e.parent) : undefined
        parent?.add(node)
        nodes.set(e.id, node)
        const entity = world.create()
        entities.set(e.id, entity)
        world.add(entity, Transform, node) // root nodes join the scene here
      }
      scene.updateMatrixWorld(true)

      for (const e of ordered) {
        const node = nodes.get(e.id)
        const entity = entities.get(e.id)
        if (!node || entity === undefined) continue

        if (e.rigidBody) {
          // Bodies simulate in world space, so lift them out of any hierarchy.
          if (node.parent !== scene) scene.attach(node)
          const { kinematic, gravityScale, damping, restitution } = e.rigidBody
          world.add(entity, RigidBody, rigidBody(node, { kinematic, gravityScale, damping, restitution }))
        }
        if (e.collider) {
          const c = e.collider
          node.getWorldScale(scale)
          const offset = new Vector3(...c.center).multiply(scale)
          world.add(
            entity,
            Collider,
            c.shape === 'sphere'
              ? sphereCollider(c.radius * Math.max(scale.x, scale.y, scale.z), { offset, trigger: c.trigger })
              : boxCollider((c.size[0] * scale.x) / 2, (c.size[1] * scale.y) / 2, (c.size[2] * scale.z) / 2, {
                  offset,
                  trigger: c.trigger,
                }),
          )
        }
        const handle = { entity, name: e.name, object: node, body: world.tryGet(entity, RigidBody) }
        session.register(handle, e.parent ? (entities.get(e.parent) ?? null) : null)
        session.attachScripts(handle, e)
      }

      if (mainCamera) engine.camera = mainCamera
      else {
        log('warn', 'No main camera in the scene; using the editor camera.')
        engine.camera = editorCamera
      }
      for (const system of session.systems()) engine.addSystem(system)
    },
  })
}
