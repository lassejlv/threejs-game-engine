// @vitest-environment jsdom
import { AudioContext as ThreeAudioContext } from 'three'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import type { Engine } from '../../engine'
import { AudioMixer } from './audioMixer'

/** Just enough of Web Audio to follow what the mixer schedules. */
function fakeContext() {
  const param = () => ({ value: 1, setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn(), setTargetAtTime: vi.fn(), cancelScheduledValues: vi.fn() })
  const sources: { buffer: unknown; start: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn> }[] = []
  return {
    sources,
    currentTime: 0,
    destination: {},
    createGain: () => ({ gain: param(), connect: vi.fn(), disconnect: vi.fn() }),
    createBufferSource: () => {
      const source = { buffer: null, loop: false, connect: vi.fn(), start: vi.fn(), stop: vi.fn() }
      sources.push(source)
      return source
    },
  }
}

const context = fakeContext()
beforeAll(() => ThreeAudioContext.setContext(context as unknown as globalThis.AudioContext))

function fakeEngine() {
  return {
    assets: { audio: vi.fn(async (url: string) => ({ url })) },
    events: { on: vi.fn() },
  } as unknown as Engine
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('AudioMixer', () => {
  it('cross-fades to a new track and keeps the same one playing', async () => {
    const engine = fakeEngine()
    const mixer = AudioMixer.for(engine)
    mixer.playMusic('a', 'a.mp3', 'blob:a')
    await flush()
    expect(context.sources).toHaveLength(1)
    expect(mixer.currentMusic).toBe('a.mp3')
    mixer.playMusic('a', 'a.mp3', 'blob:a') // same track: no restart
    await flush()
    expect(context.sources).toHaveLength(1)
    mixer.playMusic('b', 'b.mp3', 'blob:b')
    await flush()
    expect(context.sources).toHaveLength(2)
    expect(context.sources[0].stop).toHaveBeenCalled() // the old track fades out and stops
    expect(mixer.currentMusic).toBe('b.mp3')
  })

  it("doesn't start a track that was replaced while it loaded", async () => {
    const engine = fakeEngine()
    const mixer = AudioMixer.for(engine)
    const before = context.sources.length
    mixer.playMusic('slow', 'slow.mp3', 'blob:slow')
    mixer.stopMusic(0)
    await flush()
    expect(context.sources.length).toBe(before)
    expect(mixer.currentMusic).toBeNull()
  })

  it('remembers volumes per project', () => {
    const first = AudioMixer.for(fakeEngine())
    first.useProject('Volume Test')
    first.volume.set('music', 0.25)
    first.volume.set('master', 2) // clamped
    const second = AudioMixer.for(fakeEngine())
    second.useProject('Volume Test')
    expect(second.volume.get('music')).toBe(0.25)
    expect(second.volume.get('master')).toBe(1)
  })
})
