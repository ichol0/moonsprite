import assert from 'node:assert/strict'
import test from 'node:test'
import { classifyPerformanceImpact } from './performance-scope-rules.mjs'

test('文档和测试属于 P0', () => {
  assert.equal(classifyPerformanceImpact(['docs/testing/performance-baseline.md', 'src/core/example.test.ts']).level, 'P0')
})

test('普通 UI、交互热点和高频渲染分别归入 P1、P2、P3', () => {
  assert.equal(classifyPerformanceImpact(['src/renderer/src/components/AboutDialog.tsx']).level, 'P1')
  const input = classifyPerformanceImpact(['src/renderer/src/core/canvas-input.ts'])
  assert.equal(input.level, 'P2')
  assert.deepEqual(input.commands, ['pnpm bench:canvas -- --size=512 --scenario=pan,zoom'])
  assert.equal(classifyPerformanceImpact(['src/renderer/src/components/CanvasStage.tsx']).level, 'P3')
})

test('依赖与构建配置归入 P4 并覆盖其他级别', () => {
  const result = classifyPerformanceImpact(['src/renderer/src/components/CanvasStage.tsx', 'pnpm-lock.yaml'])
  assert.equal(result.level, 'P4')
  assert.equal(result.commands.length, 3)
})

test('仅修改 package 脚本不被误判为依赖升级', () => {
  assert.equal(classifyPerformanceImpact(['package.json']).level, 'P1')
})
