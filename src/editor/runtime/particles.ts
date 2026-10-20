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
  type Object3D,
  ShaderMaterial,
  Sphere,
  type Texture,
  UniformsLib,
  UniformsUtils,
  Vector3,
} from 'three'
import type { ParticlesDoc } from '../document'

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
varying vec2 vUv;
varying vec4 vColor;
#include <common>
#include <fog_pars_vertex>
void main() {
  vUv = position.xy + 0.5;
  vColor = color;
  vec4 mvPosition = modelViewMatrix * vec4(offset, 1.0);
  mvPosition.xy += position.xy * size; // camera-facing quad
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
  vec4 tex = useMap ? texture2D(map, vUv) : vec4(1.0, 1.0, 1.0, smoothstep(0.5, 0.15, length(vUv - 0.5)));
  gl_FragColor = vColor * tex;
  if (gl_FragColor.a < 0.004) discard;
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`

/** Seconds an editor preview waits before replaying a finished effect. */
const PREVIEW_PAUSE = 0.6

const m4 = new Matrix4()
const v3 = new Vector3()
const gravity = new Vector3()

/**
 * A particle emitter simulated on the CPU and drawn as camera-facing quads in
 * one instanced draw call. `object` goes in the entity's visual group; call
 * `update` once per frame.
 */
export class ParticleEmitter implements ParticlesApi {
  readonly object: Mesh<InstancedBufferGeometry, ShaderMaterial>
  config: ParticlesDoc
  /** Editor preview: always plays, and replays once a finite effect ends. */
  readonly preview: boolean
  disposed = false
  /** Called once, the first time the emitter finishes after emitting something (not in preview). */
  onFinished: (() => void) | null = null

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
  private readonly startColor = new Color()
  private readonly endColor = new Color()
  private readonly random: () => number

  constructor(
    config: ParticlesDoc,
    options: { preview?: boolean; random?: () => number } = {},
  ) {
    this.config = config
    this.preview = options.preview ?? false
    this.random = options.random ?? Math.random
    const material = new ShaderMaterial({
      uniforms: UniformsUtils.merge([UniformsLib.fog, { map: { value: null }, useMap: { value: false } }]),
      vertexShader,
      fragmentShader,
      transparent: true,
      depthWrite: false,
      fog: true,
    })
    this.object = new Mesh(new InstancedBufferGeometry(), material)
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
  }

  setTexture(texture: Texture | null): void {
    const uniforms = this.object.material.uniforms
    uniforms.map.value = texture
    uniforms.useMap.value = texture !== null
  }

  play(): void {
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
    this.writeAttributes()
  }

  dispose(): void {
    this.disposed = true
  }

  /** Steps the simulation. `frame` is the emitter's world matrix (its parent's, since `object` sits at the origin). */
  update(dt: number, frame: Matrix4): void {
    const c = this.config
    if (this._emitting) {
      this.elapsed += dt
      this.pending += Math.max(0, c.rate) * dt
      // A burst-only emitter (no rate, no duration) is done once its burst is out.
      if ((c.duration > 0 && this.elapsed >= c.duration) || (c.rate <= 0 && c.duration <= 0)) this._emitting = false
    }
    this.simulate(dt, frame)
    this.emit(frame)
    this.writeAttributes()

    if (!this.finished) return
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
    let i = 0
    while (i < this._count) {
      age[i] += dt
      if (age[i] >= life[i]) {
        this.swapRemove(i)
        continue
      }
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
    const c = this.config
    const n = Math.floor(this.pending)
    if (n <= 0) return
    this.pending -= n
    const spawn = Math.min(n, this.capacity - this._count)
    if (spawn > 0) this.started = true
    const r = this.random
    const jitter = () => 1 - Math.max(0, Math.min(1, c.randomness)) * r()
    const cosSpread = Math.cos((Math.min(180, Math.max(0, c.spread)) * Math.PI) / 180)
    for (let k = 0; k < spawn; k++) {
      const i = this._count++
      const j = i * 3
      // Start position in the emitter's local space.
      if (c.shape === 'sphere') {
        randomDirection(v3, -1, r).multiplyScalar(c.radius * Math.cbrt(r()))
      } else if (c.shape === 'box') {
        v3.set((r() - 0.5) * c.boxSize[0], (r() - 0.5) * c.boxSize[1], (r() - 0.5) * c.boxSize[2])
      } else {
        v3.set(0, 0, 0)
      }
      if (c.worldSpace) v3.applyMatrix4(frame)
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
    }
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
  }

  private writeAttributes(): void {
    const c = this.config
    const geometry = this.object.geometry
    const offset = geometry.getAttribute('offset') as BufferAttribute | undefined
    if (!offset) return
    const color = geometry.getAttribute('color') as BufferAttribute
    const size = geometry.getAttribute('size') as BufferAttribute
    const o = offset.array as Float32Array
    const col = color.array as Float32Array
    const s = size.array as Float32Array
    const { startColor, endColor } = this
    const n = this._count
    o.set(this.position.subarray(0, n * 3))
    for (let i = 0; i < n; i++) {
      const t = this.age[i] / this.life[i]
      s[i] = (c.startSize + (c.endSize - c.startSize) * t) * this.scale[i]
      col[i * 4] = startColor.r + (endColor.r - startColor.r) * t
      col[i * 4 + 1] = startColor.g + (endColor.g - startColor.g) * t
      col[i * 4 + 2] = startColor.b + (endColor.b - startColor.b) * t
      col[i * 4 + 3] = c.startOpacity + (c.endOpacity - c.startOpacity) * t
    }
    for (const attribute of [offset, color, size]) {
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
