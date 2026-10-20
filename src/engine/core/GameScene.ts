import type { Engine } from './Engine'

export interface SceneContext {
  engine: Engine
  /** Aborted when another scene starts loading. Check it after every `await`. */
  signal: AbortSignal
}

/**
 * A level/screen. `setup` spawns entities and registers systems; both are
 * torn down automatically when the next scene loads.
 */
export interface GameScene {
  readonly name: string
  /** Register the built-in physics, collision and interpolation systems. Default true. */
  readonly physics?: boolean
  setup(context: SceneContext): void | Promise<void>
  teardown?(engine: Engine): void
}

export function defineScene(scene: GameScene): GameScene {
  return scene
}
