import { defineConfig } from 'vitest/config'
import path from 'path'

// Standalone config: the app's vite.config.ts loads vite-plugin-electron,
// which must never run under the test runner.
export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify('0.0.0-test'),
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}'],
  },
})
