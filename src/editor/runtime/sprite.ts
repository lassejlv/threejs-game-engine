import { Color, DoubleSide, Mesh, MeshBasicMaterial, NearestFilter, PlaneGeometry, SRGBColorSpace, type Texture } from 'three'
import type { SpriteDoc } from '../document'

/** Script-facing control of an entity's Sprite (`ctx.sprite`). */
export interface SpriteApi {
  /** Mirror horizontally (face left). */
  flipX: boolean
  /** Current sprite-sheet frame. */
  frame: number
  /** Frames per second to loop through the sheet; 0 stops on the current frame. */
  fps: number
  /** Tint as '#rrggbb'. */
  color: string
}

const quad = new PlaneGeometry(1, 1)

/** Draws one Sprite: an unlit quad facing +Z, with sprite-sheet animation. */
export class SpriteRenderer implements SpriteApi {
  readonly mesh: Mesh<PlaneGeometry, MeshBasicMaterial>
  disposed = false
  private texture: Texture | null = null
  private time = 0
  private _frame: number
  private _flipX: boolean
  fps: number

  constructor(private config: SpriteDoc) {
    const material = new MeshBasicMaterial({ color: config.color, side: DoubleSide, transparent: true, alphaTest: config.pixelArt ? 0.5 : 0.01 })
    this.mesh = new Mesh(quad, material)
    this.mesh.name = 'Sprite'
    this.mesh.renderOrder = config.order
    this._frame = config.frame
    this._flipX = config.flipX
    this.fps = config.fps
    this.applyScale()
  }

  get flipX(): boolean {
    return this._flipX
  }

  set flipX(value: boolean) {
    this._flipX = value
    this.applyScale()
  }

  get frame(): number {
    return this._frame
  }

  set frame(value: number) {
    this._frame = Math.max(0, Math.floor(value)) % this.frames
    this.applyFrame()
  }

  get color(): string {
    return `#${this.mesh.material.color.getHexString()}`
  }

  set color(value: string) {
    this.mesh.material.color = new Color(value)
  }

  private get frames(): number {
    return Math.max(1, Math.round(this.config.sheetColumns) * Math.round(this.config.sheetRows))
  }

  /** Uses a (cached) texture: copied so this sprite's sheet frame and filtering are its own. */
  setTexture(source: Texture | null): void {
    this.texture?.dispose()
    this.texture = source ? source.clone() : null
    const material = this.mesh.material
    if (this.texture) {
      this.texture.colorSpace = SRGBColorSpace
      if (this.config.pixelArt) {
        this.texture.magFilter = NearestFilter
        this.texture.minFilter = NearestFilter
        this.texture.generateMipmaps = false
      }
      this.texture.needsUpdate = true
    }
    material.map = this.texture
    material.needsUpdate = true
    this.applyFrame()
  }

  /** Advances sheet animation. */
  update(dt: number): void {
    if (this.fps <= 0 || this.frames <= 1) return
    this.time += dt
    const step = 1 / this.fps
    while (this.time >= step) {
      this.time -= step
      this.frame = this._frame + 1
    }
  }

  dispose(): void {
    this.disposed = true
    this.texture?.dispose()
  }

  private applyScale(): void {
    this.mesh.scale.set(this.config.size[0] * (this._flipX ? -1 : 1), this.config.size[1], 1)
  }

  private applyFrame(): void {
    if (!this.texture) return
    const cols = Math.max(1, Math.round(this.config.sheetColumns))
    const rows = Math.max(1, Math.round(this.config.sheetRows))
    const col = this._frame % cols
    const row = Math.floor(this._frame / cols)
    this.texture.repeat.set(1 / cols, 1 / rows)
    this.texture.offset.set(col / cols, 1 - (row + 1) / rows) // rows run top to bottom
  }
}
