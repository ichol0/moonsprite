import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

test('性能 Canvas 使用独立生产预览构建和应用内 Harness', async () => {
  const [canvas, vite, main, profiler, timelapseWorker, timelapse, projectFormat, brushes, packageSource] = await Promise.all([
    readFile('scripts/canvas-performance.mjs', 'utf8'),
    readFile('vite.config.ts', 'utf8'),
    readFile('src/renderer/src/main.tsx', 'utf8'),
    readFile('src/renderer/src/components/PerformanceProfiler.tsx', 'utf8'),
    readFile('src/renderer/src/workers/timelapse-encode.worker.ts', 'utf8'),
    readFile('src/renderer/src/core/timelapse.ts', 'utf8'),
    readFile('src/renderer/src/core/project-format.ts', 'utf8'),
    readFile('src/renderer/src/core/brushes.ts', 'utf8'),
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
  assert.match(timelapseWorker, /core\/png-encode/)
  assert.doesNotMatch(timelapseWorker, /core\/png['"]/)
  assert.match(timelapse, /from '\.\/png-encode'/)
  assert.doesNotMatch(timelapse, /from '\.\/png'/)
  assert.match(projectFormat, /from '\.\/png-encode'/)
  assert.doesNotMatch(projectFormat, /from '\.\/png'/)
  assert.match(brushes, /from '\.\/png-encode'/)
  assert.doesNotMatch(brushes, /from '\.\/png'/)
  assert.match(brushes, /await import\('\.\/png'\)/)
  assert.match(scripts['build:web:performance'], /performance-production/)
  assert.match(scripts['build:web:performance-profile'], /performance-profile/)
})
