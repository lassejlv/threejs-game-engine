import {
  Box3,
  Box3Helper,
  DirectionalLight,
  Euler,
  GridHelper,
  Group,
  HemisphereLight,
  type Material,
  MathUtils,
  type Object3D,
  PerspectiveCamera,
  Raycaster,
  Vector2,
  Vector3,
} from 'three'
import { TransformControls } from 'three/addons/controls/TransformControls.js'
import { defineScene, type Engine, type GameScene } from '../../engine'
import { defaultSettings, type EntityDoc, ownerId, type Vec3 } from '../document'
import {
  assetLibrary,
  beginTransaction,
  currentScene,
  editorStore,
  endTransaction,
  expandedTarget,
  primarySelection,
  select,
  updateEntities,
} from '../editor'
import { ColliderOutlines } from './colliderOutlines'
import { editorCamera, getOrbit } from './editorCamera'
import { disposeVisual, NodeFactory } from './nodes'
import { applySettings } from './settings'

/** Hooks the UI calls into the live scene view (set while edit mode is active). */
export const sceneView = {
  focusSelection: () => {},
  /** Where new objects should appear: the point the camera orbits. */
  spawnPoint: (): Vec3 => [0, 0, 0],
}

const PREFAB_SETTINGS = { ...defaultSettings(), background: '#3a4250', ambientIntensity: 0.6 }
const round = (v: number) => Math.round(v * 1000) / 1000
const toDegrees = (e: Euler) => [e.x, e.y, e.z].map((r) => round(MathUtils.radToDeg(r))) as Vec3

/** Keeps three.js nodes in sync with the document, diffing by entity identity. */
class DocSync {
  readonly nodes = new Map<string, Group>()
  private readonly seen = new Map<string, EntityDoc>()

  constructor(
    private readonly factory: NodeFactory,
    private readonly root: Group,
  ) {}

  sync(entities: EntityDoc[]): void {
    const alive = new Set<string>()
    for (const entity of entities) {
      alive.add(entity.id)
      const previous = this.seen.get(entity.id)
      if (previous === entity) continue // untouched since last sync
      let node = this.nodes.get(entity.id)
      if (!node) {
        node = this.factory.createNode(entity)
        this.nodes.set(entity.id, node)
      } else {
        this.factory.applyTransform(node, entity)
        if (
          previous &&
          (previous.mesh !== entity.mesh ||
            previous.model !== entity.model ||
            previous.light !== entity.light ||
            previous.camera !== entity.camera)
        ) {
          this.factory.buildVisual(node, entity)
        }
      }
      this.seen.set(entity.id, entity)
    }
    for (const [id, node] of this.nodes) {
      if (alive.has(id)) continue
      if (node.userData.visual) disposeVisual(node.userData.visual)
      node.removeFromParent()
      this.nodes.delete(id)
      this.seen.delete(id)
    }
    for (const entity of entities) {
      const node = this.nodes.get(entity.id)!
      const parent = (entity.parent && this.nodes.get(entity.parent)) || this.root
      if (node.parent !== parent) parent.add(node)
    }
  }
}

export function createEditScene(): GameScene {
  return defineScene({
    name: 'Editor',
    physics: false,
    setup({ engine }) {
      const { scene } = engine
      const cleanups: (() => void)[] = []
      const orbit = getOrbit(engine)
      orbit.enabled = true

      const grid = new GridHelper(120, 120, 0x5b6472, 0x3a414c)
      grid.position.y = 0.01
      const gridMaterial = grid.material as Material
      gridMaterial.transparent = true
      gridMaterial.opacity = 0.35
      gridMaterial.depthWrite = false
      scene.add(grid)

      const root = new Group()
      scene.add(root)
      const sync = new DocSync(new NodeFactory(engine, assetLibrary, true), root)
      const outlines = new ColliderOutlines()
      scene.add(outlines.group)

      // Lighting for prefab mode when the prefab has no lights of its own.
      const studio = new Group()
      const key = new DirectionalLight(0xffffff, 2)
      key.position.set(4, 8, 6)
      studio.add(key, new HemisphereLight(0xdfe8ff, 0x404650, 1))
      scene.add(studio)

      // Game-view preview camera (follows the scene's main camera entity).
      const gameCamera = new PerspectiveCamera(60, 1, 0.1, 1000)

      const gizmo = new TransformControls(editorCamera, engine.canvas)
      gizmo.setSize(0.9)
      scene.add(gizmo.getHelper())
      const selectionBoxes: { box: Box3; helper: Box3Helper }[] = []

      // Multi-object editing: the gizmo drives the primary node; others get the same delta.
      let gizmoPressed = false
      let dragStart: { id: string; node: Object3D; position: Vector3; rotation: Euler; scale: Vector3 }[] = []
      gizmo.addEventListener('dragging-changed', (e) => {
        orbit.enabled = !e.value
      })
      gizmo.addEventListener('mouseDown', () => {
        gizmoPressed = true
        beginTransaction()
        dragStart = editorStore.get().selection.flatMap((id) => {
          const node = sync.nodes.get(id)
          return node ? [{ id, node, position: node.position.clone(), rotation: node.rotation.clone(), scale: node.scale.clone() }] : []
        })
      })
      gizmo.addEventListener('mouseUp', () => {
        endTransaction()
        dragStart = []
      })
      gizmo.addEventListener('objectChange', () => {
        const primary = gizmo.object
        const start = dragStart.find((d) => d.node === primary)
        if (!primary || !start) return
        const dp = primary.position.clone().sub(start.position)
        const dr = new Vector3(
          primary.rotation.x - start.rotation.x,
          primary.rotation.y - start.rotation.y,
          primary.rotation.z - start.rotation.z,
        )
        const ds = primary.scale.clone().divide(start.scale)
        const byId = new Map(dragStart.map((d) => [d.id, d]))
        updateEntities([...byId.keys()], (entity) => {
          const d = byId.get(entity.id)!
          const position = d.position.clone().add(dp)
          const rotation = new Euler(d.rotation.x + dr.x, d.rotation.y + dr.y, d.rotation.z + dr.z)
          const scale = d.scale.clone().multiply(ds)
          return {
            transform: {
              position: position.toArray().map(round) as Vec3,
              rotation: toDegrees(rotation),
              scale: scale.toArray().map(round) as Vec3,
            },
          }
        })
      })
      cleanups.push(() => {
        endTransaction()
        gizmo.detach()
        gizmo.dispose()
      })

      let entities: EntityDoc[] = []
      const applyState = () => {
        const state = editorStore.get()
        entities = expandedTarget(state.doc, state.editing)
        sync.sync(entities)
        const prefabMode = state.editing.kind === 'prefab'
        applySettings(scene, prefabMode ? PREFAB_SETTINGS : currentScene(state).settings)
        studio.visible = prefabMode && !entities.some((e) => e.light)
        grid.visible = state.view === 'scene'

        const primary = primarySelection(state)
        const node = primary ? sync.nodes.get(primary) : undefined
        if (node !== gizmo.object) {
          if (node) gizmo.attach(node)
          else gizmo.detach()
        }
        gizmo.getHelper().visible = state.view === 'scene' && gizmo.object !== undefined
        gizmo.enabled = state.view === 'scene'
        gizmo.setMode(state.tool)
        gizmo.setTranslationSnap(state.snap ? 0.5 : null)
        gizmo.setRotationSnap(state.snap ? MathUtils.degToRad(15) : null)
        gizmo.setScaleSnap(state.snap ? 0.1 : null)
        orbit.enabled = state.view === 'scene'
        engine.camera = state.view === 'game' ? gameCamera : editorCamera

        while (selectionBoxes.length < state.selection.length) {
          const box = new Box3()
          const helper = new Box3Helper(box, 0xffa53a)
          scene.add(helper)
          selectionBoxes.push({ box, helper })
        }
      }
      applyState()
      cleanups.push(editorStore.subscribe(applyState))

      cleanups.push(
        installPicking(engine, root, () => {
          const pressed = gizmoPressed
          gizmoPressed = false
          return pressed
        }),
      )

      sceneView.focusSelection = () => {
        const id = primarySelection()
        const node = id ? sync.nodes.get(id) : undefined
        if (!node) return
        const box = new Box3().setFromObject(node)
        const center = box.isEmpty() ? node.getWorldPosition(new Vector3()) : box.getCenter(new Vector3())
        const radius = box.isEmpty() ? 1 : box.getSize(new Vector3()).length() / 2
        const direction = editorCamera.position.clone().sub(orbit.target).normalize()
        orbit.target.copy(center)
        editorCamera.position.copy(center).addScaledVector(direction, Math.max(3, radius * 2.5))
      }
      sceneView.spawnPoint = () => orbit.target.toArray().map((v) => Math.round(v * 2) / 2) as Vec3
      cleanups.push(() => {
        sceneView.focusSelection = () => {}
      })

      engine.addSystem({
        name: 'editor.view',
        phase: 'late',
        run() {
          const state = editorStore.get()
          if (state.view === 'scene') orbit.update()
          else {
            // Mirror the main camera entity (or keep the last pose if there is none).
            const main = entities.find((e) => e.camera?.main && e.active)
            const node = main && sync.nodes.get(main.id)
            if (main?.camera && node) {
              node.getWorldPosition(gameCamera.position)
              node.getWorldQuaternion(gameCamera.quaternion)
              if (gameCamera.fov !== main.camera.fov) {
                gameCamera.fov = main.camera.fov
                gameCamera.updateProjectionMatrix()
              }
            }
          }
          const visible = state.view === 'scene'
          state.selection.forEach((id, i) => {
            const node = sync.nodes.get(id)
            const entry = selectionBoxes[i]
            if (!node || !entry) return
            entry.box.setFromObject(node)
            entry.helper.visible = visible && !entry.box.isEmpty()
          })
          for (let i = state.selection.length; i < selectionBoxes.length; i++) selectionBoxes[i].helper.visible = false
          const selected = new Set(state.selection)
          outlines.update(
            visible ? entities.filter((e) => e.collider && (state.showColliders || selected.has(ownerId(e.id)))) : [],
            sync.nodes,
          )
        },
        init: () => () => {
          for (const cleanup of cleanups) cleanup()
          outlines.dispose()
        },
      })
    },
  })
}

/** Click (not drag) in the viewport selects the entity under the cursor. Shift/Ctrl/Cmd adds to the selection. */
function installPicking(engine: Engine, root: Object3D, consumeGizmoPress: () => boolean): () => void {
  const raycaster = new Raycaster()
  raycaster.params.Line.threshold = 0.05
  const pointer = new Vector2()
  const down = new Vector2()
  const canvas = engine.canvas

  const onDown = (e: PointerEvent) => {
    if (e.button === 0) down.set(e.clientX, e.clientY)
  }
  const onUp = (e: PointerEvent) => {
    if (e.button !== 0 || editorStore.get().view !== 'scene') return
    const gizmoUsed = consumeGizmoPress()
    if (gizmoUsed || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4) return
    const additive = e.shiftKey || e.metaKey || e.ctrlKey
    const rect = canvas.getBoundingClientRect()
    pointer.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1)
    raycaster.setFromCamera(pointer, editorCamera)
    for (const hit of raycaster.intersectObject(root, true)) {
      const id = owningEntity(hit.object)
      if (id) {
        select(ownerId(id), additive)
        return
      }
    }
    if (!additive) select(null)
  }
  canvas.addEventListener('pointerdown', onDown)
  canvas.addEventListener('pointerup', onUp)
  return () => {
    canvas.removeEventListener('pointerdown', onDown)
    canvas.removeEventListener('pointerup', onUp)
  }
}

function owningEntity(object: Object3D): string | null {
  let current: Object3D | null = object
  let id: string | null = null
  while (current) {
    if (!current.visible) return null
    if (!id && current.userData.docId) id = current.userData.docId as string
    current = current.parent
  }
  return id
}
