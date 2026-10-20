/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: {
    target: 'es2022',
    // three.js (~740 kB) has its own long-cached chunk. Monaco and its
    // TypeScript worker are big but only load when a script is opened.
    chunkSizeWarningLimit: 8000,
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            { name: 'three', test: /node_modules[\\/]three[\\/]build[\\/]/ },
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
