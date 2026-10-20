import { defineConfig } from 'vite'

/**
 * Builds the standalone game player as one self-contained, minified ES
 * module (engine, Rapier WASM, loaders). The editor inlines it into
 * exported games. A plain build (not lib mode) so whitespace is minified.
 * `--mode webgpu` builds the variant with three's WebGPU renderer, used by
 * projects set to WebGPU; the default build stays WebGL-only and smaller.
 */
export default defineConfig(({ mode }) => {
  const webgpu = mode === 'webgpu'
  return {
    publicDir: false,
    build: {
      target: 'es2022',
      outDir: 'public/player',
      // The two variants share the folder; the first build clears it.
      emptyOutDir: !webgpu,
      modulePreload: false,
      chunkSizeWarningLimit: 8000,
      rolldownOptions: {
        input: webgpu ? 'src/player/main-webgpu.ts' : 'src/player/main.ts',
        output: { entryFileNames: webgpu ? 'player-webgpu.js' : 'player.js', codeSplitting: false },
      },
    },
  }
})
