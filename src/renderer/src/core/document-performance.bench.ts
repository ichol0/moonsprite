import type { LayerGroup } from '@shared/types'
import { bench, describe } from 'vitest'
import { compositeRegion, createDocument, createLayer } from './document'

const CANVAS_SIZE = 800
const LAYER_COUNT = 24
const GROUP_COUNT = 6

const document = createDocument('complex composite benchmark', CANVAS_SIZE, CANVAS_SIZE, 'rgba')
document.layers = []
document.groups = Array.from({ length: GROUP_COUNT }, (_, index): LayerGroup => ({
  id: `group-${index}`,
  name: `Group ${index}`,
  parentGroupId: index >= 3 ? `group-${index - 3}` : null,
  visible: true,
  locked: false,
  opacity: 1,
  blendMode: 'normal'
}))

for (let layerIndex = 0; layerIndex < LAYER_COUNT; layerIndex += 1) {
  const layer = createLayer(`Layer ${layerIndex}`, CANVAS_SIZE, CANVAS_SIZE, 'rgba')
  if (layer.format !== 'rgba') throw new Error('RGBA benchmark layer required')
  layer.groupId = `group-${layerIndex % GROUP_COUNT}`
  const colorOffset = layerIndex % 3
  for (let y = layerIndex % 8; y < CANVAS_SIZE; y += 8) {
    for (let x = 0; x < CANVAS_SIZE; x += 1) {
      const offset = (y * CANVAS_SIZE + x) * 4
      layer.pixels[offset + colorOffset] = 64 + layerIndex * 7
      layer.pixels[offset + 3] = 96 + layerIndex * 5
    }
  }
  document.layers.push(layer)
}
document.activeLayerId = document.layers.at(-1)!.id

describe('complex document compositing', () => {
  bench('composite 800x800 with 24 grouped layers', () => {
    compositeRegion(document, 0, 0, CANVAS_SIZE, CANVAS_SIZE)
  }, { iterations: 3, warmupIterations: 1 })

  bench('composite 64x64 dirty region with 24 grouped layers', () => {
    compositeRegion(document, 368, 368, 64, 64)
  }, { iterations: 10, warmupIterations: 2 })
})
