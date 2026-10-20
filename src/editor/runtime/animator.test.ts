import { AnimationClip, Object3D, VectorKeyframeTrack } from 'three'
import { describe, expect, it } from 'vitest'
import { type AnimStateDef, Animator, parseCondition } from './animator'

/** A one-second clip that holds the object's x at `x` (so the blended x shows the weights). */
const clip = (name: string, x: number, duration = 1) => new AnimationClip(name, duration, [new VectorKeyframeTrack('.position', [0, duration], [x, 0, 0, x, 0, 0])])

const state = (name: string, patch: Partial<AnimStateDef> = {}): AnimStateDef => ({ name, clip: name, blendParam: '', blend: [], speed: 1, loop: true, ...patch })

function rig() {
  const root = new Object3D()
  const clips = [clip('idle', 0), clip('walk', 10), clip('run', 20), clip('jump', 100, 0.5)]
  return { root, clips, step: (a: Animator, seconds: number) => { for (let t = 0; t < seconds - 1e-9; t += 1 / 60) a.update(1 / 60) } }
}

describe('parseCondition', () => {
  it('reads comparisons, negation and && chains', () => {
    const params = new Map<string, number | boolean>([['speed', 2], ['grounded', true]])
    expect(parseCondition('speed > 1 && grounded').test(params)).toBe(true)
    expect(parseCondition('speed <= 1').test(params)).toBe(false)
    expect(parseCondition('!grounded').test(params)).toBe(false)
    expect(parseCondition('grounded == true').test(params)).toBe(true)
    expect(parseCondition('missing').test(params)).toBe(false)
    expect(parseCondition('').test(params)).toBe(true)
    expect(() => parseCondition('speed >')).toThrow()
  })
})

describe('Animator', () => {
  it('plays clips with a cross-fade', () => {
    const { root, clips, step } = rig()
    const a = new Animator()
    a.attach(root, clips)
    a.play('walk', { fade: 0 })
    step(a, 0.1)
    expect(root.position.x).toBeCloseTo(10)
    a.play('run', { fade: 0.5 })
    step(a, 0.25)
    expect(root.position.x).toBeGreaterThan(12)
    expect(root.position.x).toBeLessThan(18)
    step(a, 0.5)
    expect(root.position.x).toBeCloseTo(20)
    expect(a.current).toBe('run')
  })

  it('applies requests made before the model loaded', () => {
    const { root, clips, step } = rig()
    const a = new Animator()
    a.play('run', { fade: 0 })
    a.attach(root, clips)
    step(a, 0.1)
    expect(root.position.x).toBeCloseTo(20)
  })

  it('switches states on parameter conditions and blends by a parameter', () => {
    const { root, clips, step } = rig()
    const a = new Animator()
    a.configure(
      [
        state('Locomotion', { blendParam: 'speed', blend: [{ clip: 'idle', at: 0 }, { clip: 'walk', at: 2 }, { clip: 'run', at: 6 }] }),
        state('Air', { clip: 'jump', loop: false }),
      ],
      [
        { from: 'Locomotion', to: 'Air', when: '!grounded', fade: 0, afterEnd: false },
        { from: 'Air', to: 'Locomotion', when: 'grounded', fade: 0, afterEnd: true },
      ],
    )
    a.attach(root, clips)
    a.set('grounded', true)
    a.set('speed', 1)
    step(a, 0.1)
    expect(a.current).toBe('Locomotion')
    expect(root.position.x).toBeCloseTo(5) // halfway between idle (0) and walk (10)
    a.set('speed', 4)
    step(a, 0.1)
    expect(root.position.x).toBeCloseTo(15) // halfway between walk (10) and run (20)
    a.set('grounded', false)
    step(a, 0.1)
    expect(a.current).toBe('Air')
    a.set('grounded', true)
    step(a, 0.2)
    expect(a.current).toBe('Air') // waits for the jump clip to finish
    step(a, 0.4)
    expect(a.current).toBe('Locomotion')
  })

  it('consumes triggers when their transition fires', () => {
    const { root, clips, step } = rig()
    const a = new Animator()
    a.configure([state('idle'), state('jump', { loop: false })], [
      { from: 'idle', to: 'jump', when: 'jump', fade: 0, afterEnd: false },
      { from: 'jump', to: 'idle', when: '', fade: 0, afterEnd: true },
    ])
    a.attach(root, clips)
    a.trigger('jump')
    step(a, 0.05)
    expect(a.current).toBe('jump')
    expect(a.get('jump')).toBe(false)
    step(a, 0.6)
    expect(a.current).toBe('idle') // and it doesn't jump again
    step(a, 0.2)
    expect(a.current).toBe('idle')
  })

  it('reports bad transitions instead of throwing', () => {
    const a = new Animator()
    a.configure([state('idle')], [
      { from: 'idle', to: 'nowhere', when: '', fade: 0, afterEnd: false },
      { from: 'idle', to: 'idle', when: 'speed >>> 2', fade: 0, afterEnd: false },
    ])
    expect(a.errors).toHaveLength(2)
  })
})
