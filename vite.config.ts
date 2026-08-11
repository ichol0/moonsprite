import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => {
  const performanceBuild = mode === 'performance-production' || mode === 'performance-profile'
  const reactProfile = mode === 'performance-profile'
  return {
    root: resolve(__dirname, 'src/renderer'),
    define: {
      __MOONSPRITE_PERFORMANCE_BUILD__: JSON.stringify(performanceBuild),
      __MOONSPRITE_REACT_PROFILE__: JSON.stringify(reactProfile)
    },
    resolve: {
      alias: [
        ...(reactProfile ? [{ find: /^react-dom\/client$/, replacement: resolve(__dirname, 'node_modules/react-dom/profiling.js') }] : []),
        { find: '@shared', replacement: resolve(__dirname, 'src/shared') },
        { find: '@', replacement: resolve(__dirname, 'src/renderer/src') }
      ]
    },
    plugins: [react()],
    build: {
      outDir: resolve(__dirname, performanceBuild ? `out/${mode}` : 'out/renderer'),
      emptyOutDir: true
    },
    server: { port: 5173, strictPort: true }
  }
})
