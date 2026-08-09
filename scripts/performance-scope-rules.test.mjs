import assert from 'node:assert/strict'
import test from 'node:test'
import { classifyPerformanceAudit, classifyPerformanceImpact } from './performance-scope-rules.mjs'

test('文档和测试属于 P0', () => {
  assert.equal(classifyPerformanceImpact(['docs/testing/performance-baseline.md', 'src/core/example.test.ts']).level, 'P0')
})

test('普通 UI、交互热点和高频渲染分别归入 P1、P2、P3', () => {
  assert.equal(classifyPerformanceImpact(['src/renderer/src/components/AboutDialog.tsx']).level, 'P1')
  const input = classifyPerformanceImpact(['src/renderer/src/core/canvas-input.ts'])
  assert.equal(input.level, 'P2')
  assert.equal(input.suites[0].id, 'canvas-interaction')
  assert.deepEqual(input.commands, ['pnpm bench:canvas -- --size=512 --scenario=pan,zoom'])
  assert.equal(classifyPerformanceImpact(['src/renderer/src/components/CanvasStage.tsx']).level, 'P3')
})

test('依赖与构建配置归入 P4 并覆盖其他级别', () => {
  const result = classifyPerformanceImpact(['src/renderer/src/components/CanvasStage.tsx', 'pnpm-lock.yaml'])
  assert.equal(result.level, 'P4')
  assert.deepEqual(result.suites.map((suite) => suite.id), ['canvas-full', 'canvas-complex', 'selection', 'document-composite', 'bundle', 'desktop'])
  assert.deepEqual(result.suites.find((suite) => suite.id === 'canvas-complex').sizes, [128, 512, 1024])
})

test('仅修改 package 脚本不被误判为依赖升级', () => {
  assert.equal(classifyPerformanceImpact(['package.json']).level, 'P1')
})

test('发布审计至少运行 P3 并固定覆盖 1024 复杂工程', () => {
  const ordinaryRelease = classifyPerformanceAudit(['src/renderer/src/components/AboutDialog.tsx'], { minimumLevel: 'P3', releaseAudit: true })
  assert.equal(ordinaryRelease.level, 'P3')
  assert.deepEqual(ordinaryRelease.suites.map((suite) => suite.id), ['canvas-full', 'canvas-complex', 'bundle'])
  assert.deepEqual(ordinaryRelease.suites[0].scenarios, ['pan', 'zoom', 'rotated-zoom', 'draw', 'shape', 'marquee', 'bucket-fill', 'gradient'])
  const complexSuite = ordinaryRelease.suites.find((suite) => suite.id === 'canvas-complex')
  assert.deepEqual(complexSuite.sizes, [1024])
  assert.deepEqual(complexSuite.scenarios, ['complex-draw', 'complex-undo', 'complex-playback'])

  const animationRelease = classifyPerformanceAudit(['src/renderer/src/core/animation.ts'], { minimumLevel: 'P3' })
  assert.deepEqual(animationRelease.suites.map((suite) => suite.id), ['canvas-full', 'canvas-complex', 'document-composite', 'bundle'])
})
