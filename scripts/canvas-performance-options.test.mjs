import assert from 'node:assert/strict'
import test from 'node:test'
import { parseCanvasPerformanceOptions } from './canvas-performance-options.mjs'

test('画布性能参数默认运行完整场景', () => {
  assert.deepEqual(parseCanvasPerformanceOptions([]), {
    full: false,
    sizes: [128, 512, 1024],
    scenarios: ['pan', 'zoom', 'rotated-zoom', 'draw'],
  })
})

test('画布性能参数支持单尺寸和多场景筛选', () => {
  assert.deepEqual(parseCanvasPerformanceOptions(['--', '--size=512', '--scenario', 'pan,zoom']), {
    full: false,
    sizes: [512],
    scenarios: ['pan', 'zoom'],
  })
})

test('画布性能参数拒绝未知尺寸和场景', () => {
  assert.throws(() => parseCanvasPerformanceOptions(['--size', '256']), /不支持的画布尺寸/)
  assert.throws(() => parseCanvasPerformanceOptions(['--scenario', 'selection']), /不支持的画布场景/)
  assert.throws(() => parseCanvasPerformanceOptions(['--scenaro', 'zoom']), /未知的画布性能参数/)
})
