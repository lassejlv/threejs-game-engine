// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { emptyProject } from '../editor/document'
import { startPlayer } from './player'

describe('exported game player', () => {
  it('tells the player when the browser has no 3D graphics instead of showing a blank page', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    document.body.innerHTML = '<div id="game"></div>'
    Object.assign(window, { __GAME__: { project: { ...emptyProject(), name: 'No GPU' }, assets: {} } })
    // jsdom has no WebGL, like a browser with hardware acceleration off.
    await startPlayer()
    const message = document.querySelector('#game [role="alert"]')
    expect(message?.textContent).toMatch(/couldn't start 3D graphics \(WebGL 2\)/)
    expect(document.querySelector('#game canvas')).toBeNull()
    expect(document.title).toBe('No GPU')
  })
})
