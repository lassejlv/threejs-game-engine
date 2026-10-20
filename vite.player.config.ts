import { defineConfig } from 'vite'

/**
 * Builds the standalone game player as one self-contained, minified ES
 * module (engine, Rapier WASM, loaders). The editor inlines it into
 * exported games. A plain build (not lib mode) so whitespace is minified.
 */
export default defineConfig({
  publicDir: false,
  build: {
    target: 'es2022',
    outDir: 'public/player',
    emptyOutDir: true,
    modulePreload: false,
    chunkSizeWarningLimit: 6000,
    rolldownOptions: {
      input: 'src/player/main.ts',
      output: { entryFileNames: 'player.js', codeSplitting: false },
    },
  },
})
