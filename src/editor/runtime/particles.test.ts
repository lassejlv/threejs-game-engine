import { Matrix4, Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import { mulberry32 } from '../../engine'
import { componentDefaults, type ParticlesDoc } from '../document'
import { lifeCurve, ParticleEmitter } from './particles'

const identity = new Matrix4()
const config = (patch: Partial<ParticlesDoc> = {}): ParticlesDoc => ({ ...componentDefaults.particles(), ...patch })
const emitter = (patch: Partial<ParticlesDoc> = {}, preview = false) =>
  new ParticleEmitter(config(patch), { preview, random: mulberry32(1) })

/** Runs `seconds` of simulation in 60 Hz steps. */
function run(e: ParticleEmitter, seconds: number, frame = identity): void {
  for (let t = 0; t < seconds - 1e-9; t += 1 / 60) e.update(1 / 60, frame)
}

describe('ParticleEmitter', () => {
  it('emits at its rate', () => {
    const e = emitter({ rate: 30, lifetime: 10 })
    e.play()
    run(e, 1)
    expect(e.count).toBeGreaterThanOrEqual(29)
    expect(e.count).toBeLessThanOrEqual(30)
  })

  it('fires its burst on play and caps at maxParticles', () => {
    const e = emitter({ rate: 0, burst: 50, maxParticles: 20, lifetime: 10 })
    e.play()
    e.update(1 / 60, identity)
    expect(e.count).toBe(20)
    e.burst(5)
    e.update(1 / 60, identity)
    expect(e.count).toBe(20)
  })

  it('removes particles at the end of their lifetime', () => {
    const e = emitter({ rate: 0, burst: 10, lifetime: 0.5, randomness: 0 })
    e.play()
    run(e, 0.3)
    expect(e.count).toBe(10)
    run(e, 0.3)
    expect(e.count).toBe(0)
  })

  it('stops after its duration and then finishes', () => {
    const e = emitter({ rate: 60, duration: 0.5, lifetime: 0.25, randomness: 0 })
    let finished = 0
    e.onFinished = () => finished++
    e.play()
    run(e, 0.4)
    expect(e.emitting).toBe(true)
    run(e, 0.2)
    expect(e.emitting).toBe(false)
    run(e, 0.5)
    expect(e.count).toBe(0)
    expect(e.finished).toBe(true)
    expect(finished).toBe(1)
  })

  it('treats an emitter with no rate and no duration as a one-shot burst', () => {
    const e = emitter({ rate: 0, duration: 0, burst: 5, lifetime: 0.2, randomness: 0 })
    let finished = 0
    e.onFinished = () => finished++
    e.play()
    run(e, 0.5)
    expect(finished).toBe(1)
  })

  it('does not report finishing before it has emitted anything', () => {
    const e = emitter({ rate: 0, burst: 0 })
    let finished = 0
    e.onFinished = () => finished++
    run(e, 0.5)
    expect(finished).toBe(0)
  })

  it('spawns at the emitter position in world space and at the origin in local space', () => {
    const frame = new Matrix4().makeTranslation(5, 2, -3)
    const world = emitter({ rate: 0, burst: 1, speed: 0, worldSpace: true })
    world.play()
    world.update(1 / 60, frame)
    const offset = world.object.geometry.getAttribute('offset')
    expect(new Vector3().fromBufferAttribute(offset, 0).toArray()).toEqual([5, 2, -3])

    const local = emitter({ rate: 0, burst: 1, speed: 0, worldSpace: false })
    local.play()
    local.update(1 / 60, frame)
    expect(new Vector3().fromBufferAttribute(local.object.geometry.getAttribute('offset'), 0).toArray()).toEqual([0, 0, 0])
  })

  it('emits within the spread cone around up', () => {
    const e = emitter({ rate: 0, burst: 200, spread: 30, speed: 1, randomness: 0, lifetime: 10 })
    e.play()
    e.update(1e-6, identity)
    e.update(0.1, identity)
    const offset = e.object.geometry.getAttribute('offset')
    const p = new Vector3()
    for (let i = 0; i < e.count; i++) {
      p.fromBufferAttribute(offset, i).normalize()
      expect(p.y).toBeGreaterThanOrEqual(Math.cos((30 * Math.PI) / 180) - 1e-6)
    }
  })

  it('applies gravity and interpolates size and opacity over life', () => {
    const e = emitter({ rate: 0, burst: 1, speed: 0, gravity: 10, lifetime: 1, randomness: 0, startSize: 1, endSize: 0, startOpacity: 1, endOpacity: 0 })
    e.play()
    e.update(1e-6, identity)
    run(e, 0.5)
    const geometry = e.object.geometry
    expect(new Vector3().fromBufferAttribute(geometry.getAttribute('offset'), 0).y).toBeLessThan(-1)
    expect(geometry.getAttribute('size').getX(0)).toBeCloseTo(0.5, 1)
    expect(geometry.getAttribute('color').getW(0)).toBeCloseTo(0.5, 1)
  })

  it('keeps live particles when reconfigured, trimming to a smaller capacity', () => {
    const e = emitter({ rate: 0, burst: 30, lifetime: 10 })
    e.play()
    e.update(1 / 60, identity)
    e.configure(config({ rate: 0, burst: 30, lifetime: 10, startColor: '#00ff00' }))
    expect(e.count).toBe(30)
    e.configure(config({ rate: 0, burst: 30, lifetime: 10, maxParticles: 10 }))
    expect(e.count).toBe(10)
  })

  it('replays a finished effect in editor preview', () => {
    const e = emitter({ rate: 0, burst: 5, lifetime: 0.1, randomness: 0 }, true)
    e.play()
    run(e, 0.3)
    expect(e.count).toBe(0)
    let replayed = 0
    for (let i = 0; i < 60; i++) {
      e.update(1 / 60, identity)
      replayed = Math.max(replayed, e.count)
    }
    expect(replayed).toBe(5)
  })

  it('emits per meter moved for trails, spread along the path', () => {
    const e = emitter({ rate: 0, rateOverDistance: 10, duration: 5, lifetime: 10, speed: 0, randomness: 0 })
    e.play()
    e.update(1 / 60, new Matrix4())
    e.update(1 / 60, new Matrix4().makeTranslation(2, 0, 0))
    expect(e.count).toBe(20)
    const offset = e.object.geometry.getAttribute('offset')
    const xs = Array.from({ length: e.count }, (_, i) => offset.getX(i))
    expect(Math.min(...xs)).toBeLessThan(1)
    expect(Math.max(...xs)).toBeGreaterThan(1)
  })

  it('fires sub-emitters where parent particles die', () => {
    const parent = emitter({ rate: 0, burst: 3, lifetime: 0.1, randomness: 0, speed: 0 })
    const sub = emitter({ trigger: 'parentDeath', burst: 4, lifetime: 10, speed: 0 })
    parent.subEmitters.push(sub)
    const frame = new Matrix4().makeTranslation(0, 5, 0)
    parent.play()
    sub.play() // ignored: sub-emitters only emit when triggered
    for (let i = 0; i < 12; i++) {
      parent.update(1 / 60, frame)
      sub.update(1 / 60, identity)
    }
    expect(parent.count).toBe(0)
    expect(sub.count).toBe(12)
    expect(new Vector3().fromBufferAttribute(sub.object.geometry.getAttribute('offset'), 0).y).toBeCloseTo(5)
  })

  it('shapes size and opacity with life curves', () => {
    expect(lifeCurve('linear', 0.5)).toBe(0.5)
    expect(lifeCurve('easeIn', 0.5)).toBe(0.25)
    expect(lifeCurve('easeOut', 0.5)).toBe(0.75)
    expect(lifeCurve('bump', 0)).toBe(0)
    expect(lifeCurve('bump', 0.5)).toBeCloseTo(1)
    const e = emitter({ rate: 0, burst: 1, lifetime: 1, randomness: 0, speed: 0, opacityCurve: 'bump', startOpacity: 0, endOpacity: 1 })
    e.play()
    e.update(1e-6, identity)
    run(e, 0.5)
    expect(e.object.geometry.getAttribute('color').getW(0)).toBeCloseTo(1, 1)
  })

  it('draws far particles first with normal blending', () => {
    const e = emitter({ rate: 0, burst: 50, lifetime: 10, speed: 5, spread: 180, blending: 'normal' })
    e.play()
    e.update(1e-6, identity)
    const eye = new Vector3(0, 0, 20)
    e.update(0.2, identity, eye)
    const offset = e.object.geometry.getAttribute('offset')
    const p = new Vector3()
    let previous = Infinity
    for (let i = 0; i < e.count; i++) {
      const d = p.fromBufferAttribute(offset, i).distanceTo(eye)
      expect(d).toBeLessThanOrEqual(previous + 1e-6)
      previous = d
    }
  })

  it('animates sprite-sheet frames over life and spins particles', () => {
    const e = emitter({ rate: 0, burst: 1, lifetime: 1, randomness: 0, speed: 0, sheetColumns: 2, sheetRows: 2, spin: 90 })
    e.play()
    e.update(1e-6, identity)
    const geometry = e.object.geometry
    expect(geometry.getAttribute('frame').getX(0)).toBe(0)
    const angle0 = geometry.getAttribute('angle').getX(0)
    run(e, 0.8)
    expect(geometry.getAttribute('frame').getX(0)).toBe(3)
    expect(Math.abs(geometry.getAttribute('angle').getX(0) - angle0)).toBeCloseTo((0.8 * Math.PI) / 2, 1)
  })
})
