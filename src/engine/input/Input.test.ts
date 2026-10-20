// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { Input } from './Input'

const key = (type: 'keydown' | 'keyup', code: string, repeat = false) => window.dispatchEvent(new KeyboardEvent(type, { code, repeat }))

describe('Input', () => {
  const input = new Input()
  afterEach(() => input.detach())

  it('releases keys on blur and takes them back from the next auto-repeat', () => {
    input.attach(document.createElement('div'))
    key('keydown', 'KeyD')
    expect(input.isDown('KeyD')).toBe(true)
    key('keydown', 'KeyD', true) // repeats of a held key change nothing
    expect(input.isDown('KeyD')).toBe(true)
    window.dispatchEvent(new Event('blur'))
    expect(input.isDown('KeyD')).toBe(false)
    // Still held after focus comes back: the browser keeps sending repeats.
    key('keydown', 'KeyD', true)
    expect(input.isDown('KeyD')).toBe(true)
    key('keyup', 'KeyD')
    expect(input.isDown('KeyD')).toBe(false)
  })
})
