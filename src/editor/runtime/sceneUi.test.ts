// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { createUiElement } from '../document'
import { GameUi } from './gameUi'
import type { AssetResolver } from './nodes'
import { barValue, drawUiElement, fillText, isLive } from './sceneUi'

const assets: AssetResolver = { url: (id) => (id === 'logo' ? 'blob:logo' : null), byName: () => null }

describe('scene UI', () => {
  it('fills {key} placeholders from values', () => {
    expect(fillText('Coins: {Coins:got} / {Coins:total}', { 'Coins:got': 3, 'Coins:total': 32 })).toBe('Coins: 3 / 32')
    expect(fillText('{time}s', { time: 12.345 })).toBe('12.3s')
    expect(fillText('{missing}!', {})).toBe('!')
  })

  it('reads bar values from numbers, keys and ratios', () => {
    expect(barValue('0.25', {})).toBe(0.25)
    expect(barValue('hp', { hp: 0.5 })).toBe(0.5)
    expect(barValue('Coins:got/Coins:total', { 'Coins:got': 8, 'Coins:total': 32 })).toBe(0.25)
    expect(barValue('a/b', { a: 1, b: 0 })).toBe(0)
  })

  it('knows which elements need refreshing', () => {
    expect(isLive({ ...createUiElement('text', 't'), text: 'static' })).toBe(false)
    expect(isLive({ ...createUiElement('text', 't'), text: '{score}' })).toBe(true)
    expect(isLive({ ...createUiElement('bar', 'b'), value: 'hp' })).toBe(true)
  })

  it('draws elements by name, runs button actions and hides invisible ones', () => {
    const container = document.createElement('div')
    const ui = new GameUi(container)
    let clicks = 0
    const button = { ...createUiElement('button', 'Start'), text: 'Go {n}' }
    drawUiElement(ui, button, { n: 1 }, assets, () => clicks++)
    const node = ui.elementFor('Start') as HTMLButtonElement
    expect(node.textContent).toBe('Go 1')
    node.click()
    expect(clicks).toBe(1)
    drawUiElement(ui, { ...createUiElement('image', 'Logo'), image: 'logo' }, {}, assets)
    expect((ui.elementFor('Logo') as HTMLImageElement).src).toBe('blob:logo')
    drawUiElement(ui, { ...button, visible: false }, {}, assets)
    expect(ui.elementFor('Start')).toBeUndefined()
  })
})
