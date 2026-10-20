/// <reference types="vitest/config" />
import { type ChildProcess, spawn, spawnSync } from 'node:child_process'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

const FILES_PORT = Number(process.env.GE_FILES_PORT) || 5174

/**
 * `npm run dev` also starts the local file server (server/files.ts) so projects
 * are saved as folders in projects/. It needs Bun; without it the editor keeps
 * projects in the browser instead. GE_NO_FILES=1 skips it.
 */
function localFiles(): Plugin {
  let child: ChildProcess | null = null
  return {
    name: 'local-files',
    apply: 'serve',
    configureServer(server) {
      if (process.env.GE_NO_FILES || process.env.VITEST || child) return
      if (spawnSync('bun', ['--version']).status !== 0) {
        server.config.logger.warn('Bun not found: projects are saved in the browser. Install Bun to keep them as folders in projects/.')
        return
      }
      // Start once the dev server knows its port: the file server only accepts requests from the editor's own origin.
      server.httpServer?.once('listening', () => {
        const address = server.httpServer?.address()
        const port = typeof address === 'object' && address ? address.port : 5173
        const origins = [`http://localhost:${port}`, `http://127.0.0.1:${port}`, process.env.GE_ALLOWED_ORIGINS].filter(Boolean).join(',')
        child = spawn('bun', ['server/files.ts'], {
          stdio: 'inherit',
          env: { ...process.env, PORT: String(FILES_PORT), GE_ALLOWED_ORIGINS: origins },
        })
        const stop = () => child?.kill()
        server.httpServer?.once('close', stop)
        process.once('exit', stop)
      })
    },
  }
}

const api = { '/api': { target: `http://127.0.0.1:${FILES_PORT}`, changeOrigin: true } }

export default defineConfig({
  plugins: [react(), localFiles()],
  server: { proxy: api },
  preview: { proxy: api },
  build: {
    target: 'es2022',
    // three.js (~740 kB) has its own long-cached chunk. Monaco and its
    // TypeScript worker are big but only load when a script is opened.
    chunkSizeWarningLimit: 8000,
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            // Core only: the WebGPU renderer (three.webgpu.js, TSL) stays in a lazy chunk.
            { name: 'three', test: /node_modules[\\/]three[\\/]build[\\/]three\.(core|module)\.js/ },
            { name: 'react', test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/ },
          ],
        },
      },
    },
  },
  test: {
    include: ['src/**/*.test.ts'],
  },
})
