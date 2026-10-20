import { type AudioListener, AudioContext as ThreeAudioContext } from 'three'
import type { Engine } from '../../engine'
import { log } from '../console'

export type VolumeGroup = 'master' | 'music' | 'sfx'

/** Script-facing background music (`ctx.music`). */
export interface MusicApi {
  /** Plays an audio asset (by file name) as music, cross-fading from the current track. The same track keeps playing. */
  play(asset: string, options?: { fade?: number; volume?: number; loop?: boolean }): void
  stop(fade?: number): void
  /** File name of the track playing (or fading in). */
  readonly current: string | null
}

/** Script-facing volume groups (`ctx.volume`), remembered between visits. */
export interface VolumeApi {
  set(group: VolumeGroup, value: number): void
  get(group: VolumeGroup): number
}

interface Track {
  key: string
  name: string
  source: AudioBufferSourceNode | null
  gain: GainNode
}

const mixers = new WeakMap<Engine, AudioMixer>()

/**
 * Music and volume groups for one engine. It outlives scene loads, so music
 * keeps playing (or cross-fades) when a game switches scenes. Sound effects
 * (Audio Sources, one-shots, tones) run through the scene's listener, whose
 * volume is master × sfx; music has its own bus at master × music.
 */
export class AudioMixer {
  private readonly context = ThreeAudioContext.getContext() as unknown as globalThis.AudioContext
  private readonly bus: GainNode
  private readonly volumes: Record<VolumeGroup, number> = { master: 1, music: 1, sfx: 1 }
  private storageKey: string | null = null
  private listener: AudioListener | null = null
  private track: Track | null = null
  /** Bumped by every play/stop, so a slow load can't start a track that was replaced meanwhile. */
  private generation = 0

  static for(engine: Engine): AudioMixer {
    let mixer = mixers.get(engine)
    if (!mixer) {
      mixer = new AudioMixer(engine)
      mixers.set(engine, mixer)
      engine.events.on('dispose', () => mixer!.stopAll())
    }
    return mixer
  }

  /** Silences an engine's music if it ever had any (without creating an AudioContext). */
  static stopAllFor(engine: Engine): void {
    mixers.get(engine)?.stopAll()
  }

  private constructor(private readonly engine: Engine) {
    this.bus = this.context.createGain()
    this.bus.connect(this.context.destination)
  }

  /** Loads the volumes a player chose for this project last time. */
  useProject(name: string): void {
    const key = `game-volume:${name}`
    if (key === this.storageKey) return
    this.storageKey = key
    try {
      const saved = JSON.parse(localStorage.getItem(key) ?? 'null') as Partial<Record<VolumeGroup, number>> | null
      if (saved) for (const g of ['master', 'music', 'sfx'] as const) if (typeof saved[g] === 'number') this.volumes[g] = saved[g]
    } catch {
      // Storage unavailable: keep the defaults.
    }
    this.applyVolumes()
  }

  attachListener(listener: AudioListener): void {
    this.listener = listener
    this.applyVolumes()
  }

  readonly volume: VolumeApi = {
    set: (group, value) => {
      this.volumes[group] = Math.max(0, Math.min(1, value))
      this.applyVolumes()
      try {
        if (this.storageKey) localStorage.setItem(this.storageKey, JSON.stringify(this.volumes))
      } catch {
        // Not saved; still applied for this session.
      }
    },
    get: (group) => this.volumes[group],
  }

  /** Plays `url` as music. `key` identifies the track (asset id), so asking for it again doesn't restart it. */
  playMusic(key: string, name: string, url: string, { fade = 1, volume = 1, loop = true } = {}): void {
    if (this.track?.key === key) {
      this.track.gain.gain.setTargetAtTime(volume, this.context.currentTime, Math.max(0.01, fade / 3))
      return
    }
    const generation = ++this.generation
    this.fadeOut(fade)
    const gain = this.context.createGain()
    gain.gain.value = 0
    gain.connect(this.bus)
    const track: Track = { key, name, source: null, gain }
    this.track = track
    void this.engine.assets
      .audio(url)
      .then((buffer) => {
        if (generation !== this.generation) return
        const source = this.context.createBufferSource()
        source.buffer = buffer
        source.loop = loop
        source.connect(gain)
        source.start()
        track.source = source
        const now = this.context.currentTime
        gain.gain.setValueAtTime(0, now)
        gain.gain.linearRampToValueAtTime(volume, now + Math.max(0.01, fade))
      })
      .catch((error: unknown) => log('error', `music: failed to load ${name}`, error))
  }

  stopMusic(fade = 1): void {
    this.generation++
    this.fadeOut(fade)
  }

  get currentMusic(): string | null {
    return this.track?.name ?? null
  }

  /** Silences everything right away (leaving play mode). */
  stopAll(): void {
    this.stopMusic(0)
  }

  private fadeOut(fade: number): void {
    const old = this.track
    this.track = null
    if (!old) return
    const now = this.context.currentTime
    old.gain.gain.cancelScheduledValues(now)
    old.gain.gain.setValueAtTime(old.gain.gain.value, now)
    old.gain.gain.linearRampToValueAtTime(0, now + Math.max(0.01, fade))
    try {
      old.source?.stop(now + Math.max(0.01, fade) + 0.05)
    } catch {
      // Already stopped.
    }
    setTimeout(() => old.gain.disconnect(), (fade + 0.2) * 1000)
  }

  private applyVolumes(): void {
    this.bus.gain.value = this.volumes.master * this.volumes.music
    this.listener?.setMasterVolume(this.volumes.master * this.volumes.sfx)
  }
}
