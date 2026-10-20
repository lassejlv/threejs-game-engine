import { type CSSProperties, type ReactNode, useEffect, useRef, useState } from 'react'
import { Engine, type EngineOptions, type GameScene } from '../engine'
import { EngineContext } from './hooks'

export interface GameCanvasProps {
  /** Scene to run. Changing it loads the new scene. */
  scene?: GameScene
  /** Read once on mount (remount with a `key` to change them, e.g. the renderer). */
  options?: Omit<EngineOptions, 'container'>
  /** Called once with the engine after it starts. */
  onReady?: (engine: Engine) => void
  className?: string
  style?: CSSProperties
  /** UI overlay rendered above the canvas, with access to `useEngine()`. */
  children?: ReactNode
}

/**
 * Hosts an Engine. The engine owns its own canvas, so StrictMode's
 * mount/unmount/mount cycle gets a clean context each time.
 */
export function GameCanvas({ scene, options, onReady, className, style, children }: GameCanvasProps) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const init = useRef({ options, onReady })
  const [engine, setEngine] = useState<Engine | null>(null)

  useEffect(() => {
    let cancelled = false
    let instance: Engine | null = null
    const container = viewportRef.current!
    const { options, onReady } = init.current
    void (async () => {
      instance = new Engine({ ...options, container })
      try {
        await instance.ready
      } catch (error) {
        console.error('[engine] WebGPU renderer failed, using WebGL', error)
        instance.dispose()
        instance = new Engine({ ...options, renderer: 'webgl', container })
      }
      if (cancelled) return instance.dispose()
      instance.start()
      setEngine(instance)
      onReady?.(instance)
    })()
    return () => {
      cancelled = true
      instance?.dispose()
      setEngine(null)
    }
  }, [])

  useEffect(() => {
    if (!engine || !scene) return
    engine.loadScene(scene).catch((error: unknown) => console.error(`[engine] scene "${scene.name}" failed`, error))
  }, [engine, scene])

  return (
    <div className={className} style={{ position: 'relative', overflow: 'hidden', ...style }}>
      <div ref={viewportRef} style={{ position: 'absolute', inset: 0 }} />
      {engine && <EngineContext.Provider value={engine}>{children}</EngineContext.Provider>}
    </div>
  )
}
