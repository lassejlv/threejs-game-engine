export interface PostSettings {
  bloom: boolean
  /** Glow amount. */
  bloomStrength: number
  /** Glow spread, 0..1. */
  bloomRadius: number
  /** Brightness (linear, before tone mapping) above which pixels glow. */
  bloomThreshold: number
  /** Darkens the screen edges, 0..1. */
  vignette: number
  /** 1 = unchanged, 0 = grayscale. */
  saturation: number
  /** 1 = unchanged. */
  contrast: number
}

/** True when the settings change the image at all (otherwise the plain renderer is cheaper). */
export function postEnabled(s: PostSettings): boolean {
  return s.bloom || s.vignette > 0 || s.saturation !== 1 || s.contrast !== 1
}
