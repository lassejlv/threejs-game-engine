// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { type Engine, EventBus } from '../engine'
import { log } from '../editor/console'
import { showErrors } from './errorScreen'

const engine = () => ({ events: new EventBus() }) as unknown as Engine
let stop: (() => void) | null = null

afterEach(() => {
  stop?.()
  document.body.innerHTML = ''
})

describe('exported game error screen', () => {
  it('collects script errors behind a button instead of only in the console', () => {
    stop = showErrors(engine())
    expect(document.querySelector('.ge-errors')).toBeNull()
    log('error', 'Script "Boom" threw: boom')
    log('warn', 'just a warning')
    log('error', 'Failed to load tree.glb')
    const box = document.querySelector('.ge-errors')!
    expect(box.querySelector('button')!.textContent).toBe('⚠ 2 errors')
    const list = box.querySelector('ol')!
    expect(list.hidden).toBe(true)
    ;(box.querySelector('button') as HTMLButtonElement).click()
    expect(list.hidden).toBe(false)
    expect([...list.children].map((li) => li.textContent)).toEqual(['Script "Boom" threw: boom', 'Failed to load tree.glb'])
  })

  it('shows a full-screen message when an error stops the game loop', () => {
    const e = engine()
    stop = showErrors(e)
    e.events.emit('error', { error: new Error('frame exploded') })
    const fatal = document.querySelector('.ge-fatal')!
    expect(fatal.getAttribute('role')).toBe('alert')
    expect(fatal.textContent).toContain('The game stopped because of an error.')
    expect(fatal.querySelector('pre')!.textContent).toContain('frame exploded')
    expect(fatal.querySelector('button')!.textContent).toBe('Reload')
  })
})
