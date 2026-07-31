import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  root: resolve(__dirname, 'src/renderer'),
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src/renderer/src'),
      '@shared': resolve(__dirname, 'src/shared')
    }
  },
  plugins: [react()],
  build: {
    outDir: resolve(__dirname, 'out/renderer'),
    emptyOutDir: true
  },
  server: { port: 5173, strictPort: true }
})
