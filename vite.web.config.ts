import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import { readFileSync } from 'fs'
import { runtimeConfigFromEnv } from './vite.runtimeConfig'

const pkg = JSON.parse(readFileSync('./package.json', 'utf-8'))

export default defineConfig({
  // Relative base so index.html references assets as ./assets/...
  // This makes the build deployable to any path (root or subdirectory).
  base: './',
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version)
  },
  plugins: [react(), runtimeConfigFromEnv()],
  // OAuth redirect URIs are registered for this exact port; fail rather than drift to another.
  server: {
    port: 5173,
    strictPort: true
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src')
    }
  },
  build: {
    outDir: 'dist-web',
    emptyOutDir: true
  }
})
