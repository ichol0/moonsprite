import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

test('性能 Canvas 使用独立生产预览构建和应用内 Harness', async () => {
  const [canvas, vite, main, profiler, packageSource] = await Promise.all([
    readFile('scripts/canvas-performance.mjs', 'utf8'),
    readFile('vite.config.ts', 'utf8'),
    readFile('src/renderer/src/main.tsx', 'utf8'),
    readFile('src/renderer/src/components/PerformanceProfiler.tsx', 'utf8'),
    readFile('package.json', 'utf8'),
  ])
  const scripts = JSON.parse(packageSource).scripts

  assert.doesNotMatch(canvas, /import\(['"]\/src\//)
  assert.match(canvas, /'preview'/)
  assert.match(canvas, /performance-production/)
  assert.match(canvas, /performance-profile/)
  assert.match(vite, /react-dom\/profiling\.js/)
  assert.match(vite, /out\/\$\{mode\}/)
  assert.match(main, /__MOONSPRITE_PERFORMANCE_BUILD__/)
  assert.match(main, /import\('\.\/performance\/benchmark-harness'\)/)
  assert.match(profiler, /__MOONSPRITE_REACT_PROFILE__/)
  assert.match(scripts['build:web:performance'], /performance-production/)
  assert.match(scripts['build:web:performance-profile'], /performance-profile/)
})
