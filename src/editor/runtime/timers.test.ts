import { Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import { EASES, Timers } from './timers'

const step = (timers: Timers, seconds: number, dt = 1 / 60) => {
  for (let t = 0; t < seconds - 1e-9; t += dt) timers.update(dt)
}

describe('Timers', () => {
  it('calls `after` once when its time is up', () => {
    const timers = new Timers()
    let calls = 0
    timers.after('a', 0.5, () => calls++)
    step(timers, 0.45)
    expect(calls).toBe(0)
    step(timers, 0.1)
    expect(calls).toBe(1)
    step(timers, 1)
    expect(calls).toBe(1)
  })

  it('repeats `every` until cancelled', () => {
    const timers = new Timers()
    let calls = 0
    const handle = timers.every('a', 0.25, () => calls++)
    step(timers, 1.01)
    expect(calls).toBe(4)
    handle.cancel()
    step(timers, 1)
    expect(calls).toBe(4)
  })

  it('stops repeating when the callback throws', () => {
    let reported = 0
    const timers = new Timers((fn) => {
      try {
        fn()
        return true
      } catch {
        reported++
        return false
      }
    })
    timers.every('a', 0.1, () => {
      throw new Error('boom')
    })
    step(timers, 1)
    expect(reported).toBe(1)
  })

  it('tweens numeric properties with easing, delay and completion', () => {
    const timers = new Timers()
    const v = new Vector3(0, 0, 0)
    let finished = false
    timers.tween('a', v, { y: 10 }, 1, { ease: 'linear', delay: 0.5, onComplete: () => (finished = true) })
    step(timers, 0.5)
    expect(v.y).toBe(0)
    step(timers, 0.5)
    expect(v.y).toBeCloseTo(5, 0)
    step(timers, 0.6)
    expect(v.y).toBe(10)
    expect(finished).toBe(true)
  })

  it('loops back and forth with yoyo', () => {
    const timers = new Timers()
    const o = { x: 0 }
    timers.tween('a', o, { x: 1 }, 1, { ease: 'linear', loop: true, yoyo: true })
    step(timers, 1.5)
    expect(o.x).toBeCloseTo(0.5, 1)
    step(timers, 0.5)
    expect(o.x).toBeCloseTo(0, 1)
    expect(timers.count).toBe(1)
  })

  it('cancels everything an owner started', () => {
    const timers = new Timers()
    let calls = 0
    timers.after('enemy', 0.1, () => calls++)
    timers.every('enemy', 0.1, () => calls++)
    timers.after('player', 0.1, () => calls++)
    timers.cancelOwner('enemy')
    step(timers, 0.5)
    expect(calls).toBe(1)
  })

  it('has easing curves that start at 0 and end at 1', () => {
    for (const ease of Object.values(EASES)) {
      expect(ease(0)).toBeCloseTo(0)
      expect(ease(1)).toBeCloseTo(1)
    }
  })
})
