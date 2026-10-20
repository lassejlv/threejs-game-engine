import type { LoadProgress, Store } from '../../engine'

const CSS = `
.fd-root { position: absolute; inset: 0; z-index: 5; pointer-events: none; background: #05070b; opacity: 0; display: flex; align-items: center; justify-content: center; }
.fd-loading { display: none; flex-direction: column; align-items: center; gap: 10px; color: #fff; font: 600 13px system-ui, sans-serif; letter-spacing: 0.08em; text-transform: uppercase; opacity: 0.85; }
.fd-track { width: 180px; height: 4px; border-radius: 2px; background: rgba(255,255,255,0.15); overflow: hidden; }
.fd-fill { height: 100%; width: 0; background: #4c8dff; transition: width 0.2s; }
`

const faders = new WeakMap<HTMLElement, Fader>()

/**
 * A black overlay per game container that survives scene loads: scenes fade
 * out before a switch and fade in once loaded, with a progress bar in between.
 */
export class Fader {
  private readonly root: HTMLDivElement
  private readonly loading: HTMLDivElement
  private readonly fill: HTMLDivElement
  private unwatch: (() => void) | null = null
  private animation = 0

  static for(container: HTMLElement): Fader {
    let fader = faders.get(container)
    if (!fader) {
      fader = new Fader(container)
      faders.set(container, fader)
    }
    return fader
  }

  private constructor(container: HTMLElement) {
    if (!document.getElementById('fd-style')) {
      const style = document.createElement('style')
      style.id = 'fd-style'
      style.textContent = CSS
      document.head.appendChild(style)
    }
    this.root = document.createElement('div')
    this.root.className = 'fd-root'
    this.root.innerHTML = '<div class="fd-loading"><span>Loading</span><div class="fd-track"><div class="fd-fill"></div></div></div>'
    this.loading = this.root.querySelector('.fd-loading')!
    this.fill = this.root.querySelector('.fd-fill')!
    container.appendChild(this.root)
  }

  get opacity(): number {
    return Number(this.root.style.opacity || 0)
  }

  /** Animates the overlay's opacity (1 = black). Resolves when done. */
  fadeTo(target: number, seconds: number): Promise<void> {
    const id = ++this.animation
    const from = this.opacity
    const start = performance.now()
    return new Promise((resolve) => {
      const step = () => {
        if (id !== this.animation) return resolve() // replaced by a newer fade
        const t = seconds <= 0 ? 1 : Math.min(1, (performance.now() - start) / (seconds * 1000))
        this.root.style.opacity = String(from + (target - from) * t)
        this.root.style.pointerEvents = target > 0.5 ? 'auto' : 'none'
        if (t < 1) requestAnimationFrame(step)
        else resolve()
      }
      step()
    })
  }

  /** Shows "Loading" with a bar that follows asset loading, on a black screen. */
  showLoading(progress?: Store<LoadProgress>): void {
    this.animation++
    this.root.style.opacity = '1'
    this.loading.style.display = 'flex'
    this.unwatch?.()
    this.fill.style.width = '0'
    if (progress) {
      const update = () => {
        const { loaded, total } = progress.get()
        this.fill.style.width = `${total ? (loaded / total) * 100 : 100}%`
      }
      update()
      this.unwatch = progress.subscribe(update)
    }
  }

  hideLoading(): void {
    this.unwatch?.()
    this.unwatch = null
    this.loading.style.display = 'none'
  }

  /** Clears everything at once (e.g. the editor leaving play mode). */
  reset(): void {
    this.animation++
    this.hideLoading()
    this.root.style.opacity = '0'
    this.root.style.pointerEvents = 'none'
  }
}

/** Resolves once nothing is loading (or after `timeout` seconds), so scenes don't fade in half-loaded. */
export function assetsIdle(progress: Store<LoadProgress>, timeout = 8): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer)
      off()
      resolve()
    }
    const timer = setTimeout(done, timeout * 1000)
    const off = progress.subscribe(() => !progress.get().active && done())
    // Loads start a moment after setup; give them a frame to register.
    requestAnimationFrame(() => !progress.get().active && done())
  })
}
