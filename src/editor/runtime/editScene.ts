import { Box3, Box3Helper, GridHelper, Group, type Material, MathUtils, type Object3D, Raycaster, Vector2, Vector3 } from 'three'
import { TransformControls } from 'three/addons/controls/TransformControls.js'
import { defineScene, type Engine, type GameScene } from '../../engine'
import type { EntityDoc, ProjectDoc, Vec3 } from '../document'
import { assetLibrary, beginTransaction, editorStore, endTransaction, select, updateEntity } from '../editor'
import { editorCamera, getOrbit } from './editorCamera'
import { disposeVisual, NodeFactory } from './nodes'
import { applySettings } from './settings'

/** Hooks the UI calls into the live scene view (set while edit mode is active). */
export const sceneView = {
  focusSelection: () => {},
  /** Where new objects should appear: the point the camera orbits. */
  spawnPoint: (): Vec3 => [0, 0, 0],
}

const round = (v: number) => Math.round(v * 1000) / 1000

/** Keeps three.js nodes in sync with the document, diffing by entity identity. */
class DocSync {
  readonly nodes = new Map<string, Group>()
  private readonly seen = new Map<string, EntityDoc>()

  constructor(
    private readonly factory: NodeFactory,
    private readonly root: Group,
  ) {}

  sync(doc: ProjectDoc): void {
    const alive = new Set<string>()
    for (const entity of doc.entities) {
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
    // Parenting and sibling order.
    for (const entity of doc.entities) {
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
      engine.camera = editorCamera

      const grid = new GridHelper(200, 200, 0x5b6472, 0x3a414c)
      grid.position.y = 0.01
      const gridMaterial = grid.material as Material
      gridMaterial.transparent = true
      gridMaterial.opacity = 0.35
      gridMaterial.depthWrite = false
      scene.add(grid)

      const root = new Group()
      scene.add(root)
      const sync = new DocSync(new NodeFactory(engine, assetLibrary, true), root)

      const gizmo = new TransformControls(editorCamera, engine.canvas)
      gizmo.setSize(0.9)
      scene.add(gizmo.getHelper())
      const selectionBox = new Box3()
      const selectionHelper = new Box3Helper(selectionBox, 0xffa53a)
      selectionHelper.visible = false
      scene.add(selectionHelper)

      let gizmoPressed = false
      gizmo.addEventListener('dragging-changed', (e) => {
        orbit.enabled = !e.value
      })
      gizmo.addEventListener('mouseDown', () => {
        gizmoPressed = true
        beginTransaction()
      })
      gizmo.addEventListener('mouseUp', endTransaction)
      gizmo.addEventListener('objectChange', () => {
        const node = gizmo.object
        const id = node?.userData.docId as string | undefined
        if (!node || !id) return
        updateEntity(
          id,
          {
            transform: {
              position: node.position.toArray().map(round) as Vec3,
              rotation: [node.rotation.x, node.rotation.y, node.rotation.z].map((r) => round(MathUtils.radToDeg(r))) as Vec3,
              scale: node.scale.toArray().map(round) as Vec3,
            },
          },
          { merge: `gizmo:${id}` },
        )
      })
      cleanups.push(() => {
        endTransaction()
        gizmo.detach()
        gizmo.dispose()
      })

      const applyState = () => {
        const state = editorStore.get()
        sync.sync(state.doc)
        applySettings(scene, state.doc.settings)
        const node = state.selection ? sync.nodes.get(state.selection) : undefined
        if (node !== gizmo.object) {
          if (node) gizmo.attach(node)
          else gizmo.detach()
        }
        gizmo.setMode(state.tool)
        gizmo.setTranslationSnap(state.snap ? 0.5 : null)
        gizmo.setRotationSnap(state.snap ? MathUtils.degToRad(15) : null)
        gizmo.setScaleSnap(state.snap ? 0.1 : null)
      }
      applyState()
      cleanups.push(editorStore.subscribe(applyState))

      cleanups.push(installPicking(engine, root, () => {
        const pressed = gizmoPressed
        gizmoPressed = false
        return pressed
      }))

      sceneView.focusSelection = () => {
        const id = editorStore.get().selection
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
          orbit.update()
          const node = gizmo.object
          if (node) {
            selectionBox.setFromObject(node)
            selectionHelper.visible = !selectionBox.isEmpty()
          } else {
            selectionHelper.visible = false
          }
        },
        init: () => () => {
          for (const cleanup of cleanups) cleanup()
        },
      })
    },
  })
}

/** Click (not drag) in the viewport selects the entity under the cursor. */
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
    if (e.button !== 0) return
    const gizmoUsed = consumeGizmoPress()
    if (gizmoUsed || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4) return
    const rect = canvas.getBoundingClientRect()
    pointer.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1)
    raycaster.setFromCamera(pointer, editorCamera)
    for (const hit of raycaster.intersectObject(root, true)) {
      const id = owningEntity(hit.object)
      if (id) {
        select(id)
        return
      }
    }
    select(null)
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
