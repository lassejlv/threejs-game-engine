import {
  AdditiveBlending,
  Box3,
  type BufferAttribute,
  Color,
  DynamicDrawUsage,
  Float32BufferAttribute,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Matrix4,
  Mesh,
  NormalBlending,
  type Material,
  type Object3D,
  ShaderMaterial,
  Sphere,
  type Texture,
  UniformsLib,
  UniformsUtils,
  Vector2,
  Vector3,
} from 'three'
import type { LifeCurve, ParticlesDoc } from '../document'

/** Script-facing control of an entity's Particle Emitter (`ctx.particles`). */
export interface ParticlesApi {
  /** Restarts the emitter: fires its burst and emits for its duration. */
  play(): void
  /** Stops emitting; live particles finish their lifetime. */
  stop(): void
  /** Emits `count` particles at once (default: the emitter's burst count). */
  burst(count?: number): void
  /** Removes every live particle. */
  clear(): void
  readonly emitting: boolean
  /** Live particles. */
  readonly count: number
}

const vertexShader = /* glsl */ `
attribute vec3 offset;
attribute vec4 color;
attribute float size;
attribute float angle;
attribute float frame;
uniform vec2 sheet;
varying vec2 vUv;
varying vec4 vColor;
#include <common>
#include <fog_pars_vertex>
void main() {
  // Sprite-sheet frame: rows run top to bottom.
  float column = mod(frame, sheet.x);
  float row = floor(frame / sheet.x);
  vUv = (position.xy + 0.5 + vec2(column, sheet.y - 1.0 - row)) / sheet;
  vColor = color;
  float c = cos(angle);
  float s = sin(angle);
  vec2 corner = mat2(c, s, -s, c) * position.xy;
  vec4 mvPosition = modelViewMatrix * vec4(offset, 1.0);
  mvPosition.xy += corner * size; // camera-facing quad
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`

const fragmentShader = /* glsl */ `
uniform sampler2D map;
uniform bool useMap;
varying vec2 vUv;
varying vec4 vColor;
#include <common>
#include <fog_pars_fragment>
void main() {
  // Without a texture each particle is a soft round dot.
  vec4 tex = useMap ? texture2D(map, vUv) : vec4(1.0, 1.0, 1.0, smoothstep(0.5, 0.15, length(fract(vUv) - 0.5)));
  gl_FragColor = vColor * tex;
  if (gl_FragColor.a < 0.004) discard;
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`

/**
 * How particles are shaded. The default is GLSL (WebGL); WebGPU engines use a
 * TSL node material with the same inputs (see particleNodeMaterial.ts).
 * Per-instance attributes: offset (vec3), color (vec4), size, angle and frame.
 */
export interface ParticleMaterial {
  readonly material: Material
  setSheet(columns: number, rows: number): void
  setMap(texture: Texture | null): void
}

export type ParticleMaterialFactory = () => ParticleMaterial

export function glslParticleMaterial(): ParticleMaterial {
  const material = new ShaderMaterial({
    uniforms: UniformsUtils.merge([UniformsLib.fog, { map: { value: null }, useMap: { value: false }, sheet: { value: new Vector2(1, 1) } }]),
    vertexShader,
    fragmentShader,
    transparent: true,
    depthWrite: false,
    fog: true,
  })
  return {
    material,
    setSheet: (columns, rows) => material.uniforms.sheet.value.set(columns, rows),
    setMap: (texture) => {
      material.uniforms.map.value = texture
      material.uniforms.useMap.value = texture !== null
    },
  }
}

/** Seconds an editor preview waits before replaying a finished effect. */
const PREVIEW_PAUSE = 0.6

const m4 = new Matrix4()
const v3 = new Vector3()
const gravity = new Vector3()
const here = new Vector3()
const camera = new Vector3()

/** Eases t (0..1) along a life curve; `bump` returns 0 at both ends and 1 in the middle. */
export function lifeCurve(curve: LifeCurve, t: number): number {
  switch (curve) {
    case 'easeIn':
      return t * t
    case 'easeOut':
      return 1 - (1 - t) * (1 - t)
    case 'smooth':
      return t * t * (3 - 2 * t)
    case 'bump':
      return Math.sin(Math.PI * t)
    default:
      return t
  }
}

/**
 * A particle emitter simulated on the CPU and drawn as camera-facing quads in
 * one instanced draw call. `object` goes in the entity's visual group; call
 * `update` once per frame.
 */
export class ParticleEmitter implements ParticlesApi {
  readonly object: Mesh<InstancedBufferGeometry, Material>
  private readonly shading: ParticleMaterial
  config: ParticlesDoc
  /** Editor preview: always plays, and replays once a finite effect ends. */
  readonly preview: boolean
  disposed = false
  /** Called once, the first time the emitter finishes after emitting something (not in preview). */
  onFinished: (() => void) | null = null
  /** Sub-emitters on child entities, linked each frame by the node factory. */
  readonly subEmitters: ParticleEmitter[] = []

  private _emitting = false
  private _count = 0
  private elapsed = 0
  private idle = 0
  /** Has emitted at least one particle. */
  private started = false
  /** Particles owed: fractional rate emission plus queued bursts. */
  private pending = 0
  private capacity = 0
  private position = new Float32Array(0)
  private velocity = new Float32Array(0)
  private age = new Float32Array(0)
  private life = new Float32Array(0)
  private scale = new Float32Array(0)
  private angle = new Float32Array(0)
  /** Spin in radians per second (signed). */
  private turn = new Float32Array(0)
  /** Fixed sprite-sheet frame (random mode), or -1 to animate over life. */
  private sprite = new Float32Array(0)
  /** World positions (x, y, z, count) queued by a parent emitter. */
  private readonly queued: number[] = []
  /** Emitter world position last frame, for distance emission and path interpolation. */
  private readonly lastOrigin = new Vector3()
  private hasOrigin = false
  /** Back-to-front draw order (normal blending). */
  private order = new Uint32Array(0)
  private depth = new Float32Array(0)
  private readonly startColor = new Color()
  private readonly endColor = new Color()
  private readonly random: () => number

  constructor(
    config: ParticlesDoc,
    options: { preview?: boolean; random?: () => number; material?: ParticleMaterialFactory } = {},
  ) {
    this.config = config
    this.preview = options.preview ?? false
    this.random = options.random ?? Math.random
    this.shading = (options.material ?? glslParticleMaterial)()
    this.object = new Mesh(new InstancedBufferGeometry(), this.shading.material)
    this.object.name = 'Particles'
    this.object.frustumCulled = false
    this.object.castShadow = false
    // The quad at the origin is not what is drawn, so keep it out of picking and bounds.
    this.object.raycast = () => {}
    this.configure(config)

  }

  get emitting(): boolean {
    return this._emitting
  }

  get count(): number {
    return this._count
  }

  /** Not emitting, nothing queued and no particles left. */
  get finished(): boolean {
    return !this._emitting && this.pending < 1 && this._count === 0
  }

  /** Applies new settings, keeping live particles where possible. */
  configure(config: ParticlesDoc): void {
    this.config = config
    this.startColor.set(config.startColor)
    this.endColor.set(config.endColor)
    const capacity = Math.max(1, Math.floor(config.maxParticles))
    if (capacity !== this.capacity) this.allocate(capacity)
    const material = this.object.material
    const blending = config.blending === 'additive' ? AdditiveBlending : NormalBlending
    if (material.blending !== blending) {
      material.blending = blending
      material.needsUpdate = true
    }
    this.setWorldSpace(config.worldSpace)
    this.shading.setSheet(Math.max(1, Math.round(config.sheetColumns)), Math.max(1, Math.round(config.sheetRows)))
  }

  /** True for a sub-emitter, which only emits when its parent's particles are born or die. */
  get isSubEmitter(): boolean {
    return this.config.trigger !== 'none'
  }

  /** Queues `count` particles at a world position (used by a parent emitter). */
  emitAt(x: number, y: number, z: number, count: number): void {
    if (this.queued.length < 4 * 512) this.queued.push(x, y, z, count)
  }

  setTexture(texture: Texture | null): void {
    this.shading.setMap(texture)
  }

  play(): void {
    if (this.isSubEmitter) return
    this._emitting = true
    this.elapsed = 0
    this.idle = 0
    this.pending += Math.max(0, this.config.burst)
  }

  stop(): void {
    this._emitting = false
    this.pending = 0
  }

  burst(count = this.config.burst): void {
    this.pending += Math.max(0, count)
  }

  clear(): void {
    this._count = 0
    this.pending = 0
    this.queued.length = 0
    this.writeAttributes()
  }

  dispose(): void {
    this.disposed = true
  }

  /**
   * Steps the simulation. `frame` is the emitter's world matrix (its parent's,
   * since `object` sits at the origin); `cameraPosition` (world) orders particles for normal blending.
   */
  update(dt: number, frame: Matrix4, cameraPosition?: Vector3): void {
    const c = this.config
    here.setFromMatrixPosition(frame)
    if (!this.hasOrigin) this.lastOrigin.copy(here)
    if (this._emitting) {
      this.elapsed += dt
      this.pending += Math.max(0, c.rate) * dt + Math.max(0, c.rateOverDistance) * here.distanceTo(this.lastOrigin)
      // A burst-only emitter (no rate, no duration) is done once its burst is out.
      const burstOnly = c.rate <= 0 && c.rateOverDistance <= 0 && c.duration <= 0
      if ((c.duration > 0 && this.elapsed >= c.duration) || burstOnly) this._emitting = false
    }
    this.simulate(dt, frame)
    this.emit(frame)
    this.emitQueued(frame)
    this.writeAttributes(frame, c.blending === 'normal' ? cameraPosition : undefined)
    this.lastOrigin.copy(here)
    this.hasOrigin = true

    if (!this.finished || this.isSubEmitter) return
    if (this.preview) {
      this.idle += dt
      if (this.idle >= PREVIEW_PAUSE) this.play()
    } else if (this.started && this.onFinished) {
      const done = this.onFinished
      this.onFinished = null
      done()
    }
  }

  private allocate(capacity: number): void {
    const keep = Math.min(this._count, capacity)
    const grow = (old: Float32Array, stride: number) => {
      const next = new Float32Array(capacity * stride)
      next.set(old.subarray(0, keep * stride))
      return next
    }
    this.position = grow(this.position, 3)
    this.velocity = grow(this.velocity, 3)
    this.age = grow(this.age, 1)
    this.life = grow(this.life, 1)
    this.scale = grow(this.scale, 1)
    this.angle = grow(this.angle, 1)
    this.turn = grow(this.turn, 1)
    this.sprite = grow(this.sprite, 1)
    this.order = new Uint32Array(capacity)
    this.depth = new Float32Array(capacity)
    this._count = keep
    this.capacity = capacity

    const old = this.object.geometry
    const geometry = new InstancedBufferGeometry()
    geometry.setIndex([0, 1, 2, 0, 2, 3])
    geometry.setAttribute('position', new Float32BufferAttribute([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0], 3))
    const instanced = (stride: number) => new InstancedBufferAttribute(new Float32Array(capacity * stride), stride).setUsage(DynamicDrawUsage)
    geometry.setAttribute('offset', instanced(3))
    geometry.setAttribute('color', instanced(4))
    geometry.setAttribute('size', instanced(1))
    geometry.setAttribute('angle', instanced(1))
    geometry.setAttribute('frame', instanced(1))
    // Empty bounds: selection boxes and focus ignore particles instead of stretching to the origin.
    geometry.boundingBox = new Box3()
    geometry.boundingSphere = new Sphere()
    geometry.instanceCount = 0
    this.object.geometry = geometry
    old.dispose()
  }

  /** World space: particles are stored in world coordinates, so the mesh ignores its parents' transforms. */
  private setWorldSpace(world: boolean): void {
    const mesh: Object3D = this.object
    if (mesh.matrixWorldAutoUpdate === !world) return
    this.clear()
    mesh.matrixAutoUpdate = !world
    mesh.matrixWorldAutoUpdate = !world
    if (world) mesh.matrixWorld.identity()
  }

  private simulate(dt: number, frame: Matrix4): void {
    const c = this.config
    const { position: p, velocity: v, age, life } = this
    // Gravity always points down in the world, so in local space rotate it into the emitter's frame.
    gravity.set(0, -c.gravity, 0)
    if (!c.worldSpace && c.gravity !== 0) {
      gravity.set(0, -1, 0).transformDirection(m4.copy(frame).invert()).multiplyScalar(c.gravity)
    }
    const drag = c.drag > 0 ? Math.exp(-c.drag * dt) : 1
    const onDeath = this.subEmitters.filter((sub) => sub.config.trigger === 'parentDeath')
    let i = 0
    while (i < this._count) {
      age[i] += dt
      if (age[i] >= life[i]) {
        if (onDeath.length) this.notify(onDeath, i, frame)
        this.swapRemove(i)
        continue
      }
      this.angle[i] += this.turn[i] * dt
      const j = i * 3
      v[j] = (v[j] + gravity.x * dt) * drag
      v[j + 1] = (v[j + 1] + gravity.y * dt) * drag
      v[j + 2] = (v[j + 2] + gravity.z * dt) * drag
      p[j] += v[j] * dt
      p[j + 1] += v[j + 1] * dt
      p[j + 2] += v[j + 2] * dt
      i++
    }
  }

  private emit(frame: Matrix4): void {
    const n = Math.floor(this.pending)
    if (n <= 0) return
    this.pending -= n
    const spawn = Math.min(n, this.capacity - this._count)
    // Spread this frame's particles along the path the emitter moved, so fast trails stay continuous.
    const moved = this.config.worldSpace && this.hasOrigin && !here.equals(this.lastOrigin)
    for (let k = 0; k < spawn; k++) this.spawn(frame, moved ? this.random() : 0, null)
  }

  /** Spawns particles a parent emitter asked for, at world positions. */
  private emitQueued(frame: Matrix4): void {
    const q = this.queued
    for (let k = 0; k < q.length; k += 4) {
      v3.set(q[k], q[k + 1], q[k + 2])
      const at = this.config.worldSpace ? v3 : v3.applyMatrix4(m4.copy(frame).invert())
      const origin = at.clone()
      for (let n = 0; n < q[k + 3] && this._count < this.capacity; n++) this.spawn(frame, 0, origin)
    }
    q.length = 0
  }

  /**
   * Adds one particle. `back` (0..1) moves it back along last frame's emitter path;
   * `origin` replaces the emitter position (sub-emitters), in the particles' space.
   */
  private spawn(frame: Matrix4, back: number, origin: Vector3 | null): void {
    if (this._count >= this.capacity) return
    const c = this.config
    const r = this.random
    const jitter = () => 1 - Math.max(0, Math.min(1, c.randomness)) * r()
    const cosSpread = Math.cos((Math.min(180, Math.max(0, c.spread)) * Math.PI) / 180)
    this.started = true
    const i = this._count++
    const j = i * 3
    // Start position: a point of the shape, in the emitter's local space.
    if (c.shape === 'sphere') {
      randomDirection(v3, -1, r).multiplyScalar(c.radius * Math.cbrt(r()))
    } else if (c.shape === 'box') {
      v3.set((r() - 0.5) * c.boxSize[0], (r() - 0.5) * c.boxSize[1], (r() - 0.5) * c.boxSize[2])
    } else {
      v3.set(0, 0, 0)
    }
    if (origin) {
      // Shape offset turned by the emitter's rotation/scale, around the requested point.
      if (c.worldSpace) v3.applyMatrix4(frame).sub(here)
      v3.add(origin)
    } else if (c.worldSpace) {
      v3.applyMatrix4(frame)
      if (back > 0) {
        v3.x += (this.lastOrigin.x - here.x) * back
        v3.y += (this.lastOrigin.y - here.y) * back
        v3.z += (this.lastOrigin.z - here.z) * back
      }
    }
    this.position[j] = v3.x
    this.position[j + 1] = v3.y
    this.position[j + 2] = v3.z
    // Direction inside a cone around local +Y.
    randomDirection(v3, cosSpread, r)
    if (c.worldSpace) v3.transformDirection(frame)
    v3.multiplyScalar(c.speed * jitter())
    this.velocity[j] = v3.x
    this.velocity[j + 1] = v3.y
    this.velocity[j + 2] = v3.z
    this.age[i] = 0
    this.life[i] = Math.max(0.01, c.lifetime * jitter())
    this.scale[i] = jitter()
    this.angle[i] = c.spin !== 0 ? r() * Math.PI * 2 : 0
    this.turn[i] = ((c.spin * Math.PI) / 180) * (r() < 0.5 ? -1 : 1) * jitter()
    const frames = Math.max(1, Math.round(c.sheetColumns) * Math.round(c.sheetRows))
    this.sprite[i] = c.sheetMode === 'random' ? Math.floor(r() * frames) : -1
    for (const sub of this.subEmitters) if (sub.config.trigger === 'parentBirth') this.notify([sub], i, frame)
  }

  /** Tells sub-emitters about particle `i` (birth or death) at its world position. */
  private notify(subs: ParticleEmitter[], i: number, frame: Matrix4): void {
    const j = i * 3
    v3.set(this.position[j], this.position[j + 1], this.position[j + 2])
    if (!this.config.worldSpace) v3.applyMatrix4(frame)
    for (const sub of subs) sub.emitAt(v3.x, v3.y, v3.z, Math.max(1, sub.config.burst))
  }

  private swapRemove(i: number): void {
    const last = --this._count
    if (i === last) return
    const { position: p, velocity: v } = this
    for (let k = 0; k < 3; k++) {
      p[i * 3 + k] = p[last * 3 + k]
      v[i * 3 + k] = v[last * 3 + k]
    }
    this.age[i] = this.age[last]
    this.life[i] = this.life[last]
    this.scale[i] = this.scale[last]
    this.angle[i] = this.angle[last]
    this.turn[i] = this.turn[last]
    this.sprite[i] = this.sprite[last]
  }

  private writeAttributes(frame?: Matrix4, cameraPosition?: Vector3): void {
    const c = this.config
    const geometry = this.object.geometry
    const offset = geometry.getAttribute('offset') as BufferAttribute | undefined
    if (!offset) return
    const attributes = ['color', 'size', 'angle', 'frame'].map((name) => geometry.getAttribute(name) as BufferAttribute)
    const [color, size, angle, frameAttr] = attributes
    const o = offset.array as Float32Array
    const col = color.array as Float32Array
    const s = size.array as Float32Array
    const a = angle.array as Float32Array
    const f = frameAttr.array as Float32Array
    const { startColor, endColor } = this
    const n = this._count
    const frames = Math.max(1, Math.round(c.sheetColumns) * Math.round(c.sheetRows))

    // Normal blending needs far particles drawn first; additive blending doesn't care.
    const order = this.order
    for (let i = 0; i < n; i++) order[i] = i
    if (cameraPosition && n > 1) {
      camera.copy(cameraPosition)
      if (!c.worldSpace && frame) camera.applyMatrix4(m4.copy(frame).invert())
      const p = this.position
      for (let i = 0; i < n; i++) {
        const dx = p[i * 3] - camera.x
        const dy = p[i * 3 + 1] - camera.y
        const dz = p[i * 3 + 2] - camera.z
        this.depth[i] = dx * dx + dy * dy + dz * dz
      }
      const depth = this.depth
      order.subarray(0, n).sort((x, y) => depth[y] - depth[x])
    }

    for (let k = 0; k < n; k++) {
      const i = order[k]
      const t = this.age[i] / this.life[i]
      const st = lifeCurve(c.sizeCurve, t)
      const ot = lifeCurve(c.opacityCurve, t)
      o[k * 3] = this.position[i * 3]
      o[k * 3 + 1] = this.position[i * 3 + 1]
      o[k * 3 + 2] = this.position[i * 3 + 2]
      s[k] = (c.startSize + (c.endSize - c.startSize) * st) * this.scale[i]
      col[k * 4] = startColor.r + (endColor.r - startColor.r) * t
      col[k * 4 + 1] = startColor.g + (endColor.g - startColor.g) * t
      col[k * 4 + 2] = startColor.b + (endColor.b - startColor.b) * t
      col[k * 4 + 3] = c.startOpacity + (c.endOpacity - c.startOpacity) * ot
      a[k] = this.angle[i]
      f[k] = this.sprite[i] >= 0 ? this.sprite[i] : Math.min(frames - 1, Math.floor(t * frames))
    }
    for (const attribute of [offset, ...attributes]) {
      attribute.clearUpdateRanges()
      attribute.addUpdateRange(0, n * attribute.itemSize)
      attribute.needsUpdate = true
    }
    geometry.instanceCount = n
    this.object.visible = n > 0
  }
}

/** A random unit vector within a cone around +Y whose half-angle has cosine `minCos` (-1 = any direction). */
function randomDirection(target: Vector3, minCos: number, random: () => number): Vector3 {
  const y = 1 - random() * (1 - minCos)
  const r = Math.sqrt(Math.max(0, 1 - y * y))
  const phi = random() * Math.PI * 2
  return target.set(r * Math.cos(phi), y, r * Math.sin(phi))
}
