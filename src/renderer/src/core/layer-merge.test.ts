import { describe, expect, it } from 'vitest'
import { compositeDocument, createDocument, createLayer, getActiveLayer, writeLayerColor } from './document'
import { mergeLayerGroup, mergeRasterLayers, mergeVisibleLayers } from './layer-merge'

const red = { r: 255, g: 0, b: 0, a: 180 }
const blue = { r: 0, g: 80, b: 255, a: 255 }
const green = { r: 0, g: 220, b: 80, a: 160 }

describe('layer merging', () => {
  it('merges contiguous raster layers without changing their normal-mode result', () => {
    const document = createDocument('layers', 1, 1, 'rgba')
    const bottom = getActiveLayer(document)
    bottom.name = 'Bottom'
    writeLayerColor(document, bottom, 0, blue)
    const top = createLayer('Top', 1, 1, 'rgba')
    writeLayerColor(document, top, 0, red)
    document.layers.push(top)
    const before = compositeDocument(document)

    const result = mergeRasterLayers(document, [bottom.id, top.id])

    expect(result.ok).toBe(true)
    expect(document.layers).toHaveLength(1)
    expect(document.layers[0].name).toBe('Top 合并')
    expect(Array.from(compositeDocument(document))).toEqual(Array.from(before))
  })

  it('flattens a nested group while preserving the outer group properties and visual result', () => {
    const document = createDocument('group', 1, 1, 'rgba')
    const background = getActiveLayer(document)
    writeLayerColor(document, background, 0, blue)
    const first = createLayer('First', 1, 1, 'rgba')
    first.groupId = 'parent'
    writeLayerColor(document, first, 0, red)
    const second = createLayer('Second', 1, 1, 'rgba')
    second.groupId = 'child'
    writeLayerColor(document, second, 0, green)
    document.layers.push(first, second)
    document.groups.push(
      { id: 'parent', name: 'Effects', parentGroupId: null, visible: true, locked: false, opacity: 0.65, blendMode: 'screen' },
      { id: 'child', name: 'Child', parentGroupId: 'parent', visible: true, locked: false, opacity: 0.7, blendMode: 'normal' }
    )
    const before = compositeDocument(document)

    const result = mergeLayerGroup(document, 'parent')

    expect(result.ok).toBe(true)
    expect(document.groups).toHaveLength(0)
    expect(document.layers).toHaveLength(2)
    const merged = document.layers[1]
    expect(merged).toMatchObject({ name: 'Effects', opacity: 0.65, blendMode: 'screen', visible: true })
    expect(Array.from(compositeDocument(document))).toEqual(Array.from(before))
  })

  it('merges visible layers while retaining hidden layers', () => {
    const document = createDocument('visible', 1, 1, 'rgba')
    const hidden = getActiveLayer(document)
    hidden.name = 'Hidden'
    hidden.visible = false
    writeLayerColor(document, hidden, 0, blue)
    const first = createLayer('Visible 1', 1, 1, 'rgba')
    const second = createLayer('Visible 2', 1, 1, 'rgba')
    writeLayerColor(document, first, 0, red)
    writeLayerColor(document, second, 0, green)
    document.layers.push(first, second)
    const before = compositeDocument(document)

    const result = mergeVisibleLayers(document)

    expect(result.ok).toBe(true)
    expect(document.layers).toHaveLength(2)
    expect(document.layers[0]).toBe(hidden)
    expect(document.layers[1].name).toBe('合并可见图层')
    expect(Array.from(compositeDocument(document))).toEqual(Array.from(before))
  })

  it('creates an indexed merged layer with stable palette ids', () => {
    const document = createDocument('indexed', 1, 1, 'indexed')
    const bottom = getActiveLayer(document)
    if (bottom.format !== 'indexed') throw new Error('wrong mode')
    bottom.pixels[0] = 1
    const top = createLayer('Top', 1, 1, 'indexed')
    if (top.format !== 'indexed') throw new Error('wrong mode')
    top.pixels[0] = 2
    top.opacity = 0.5
    document.layers.push(top)
    const before = compositeDocument(document)

    const result = mergeRasterLayers(document, [bottom.id, top.id])

    expect(result.ok).toBe(true)
    expect(document.layers[0].format).toBe('indexed')
    expect(document.palette.some((entry) => entry.id === document.layers[0].pixels[0])).toBe(true)
    expect(Array.from(compositeDocument(document))).toEqual(Array.from(before))
  })

  it('bakes selected blend modes into the merged layer', () => {
    const document = createDocument('blend mode', 1, 1, 'rgba')
    const bottom = getActiveLayer(document)
    writeLayerColor(document, bottom, 0, blue)
    const top = createLayer('Multiply', 1, 1, 'rgba')
    writeLayerColor(document, top, 0, red)
    top.blendMode = 'multiply'
    document.layers.push(top)
    const before = compositeDocument(document)

    const result = mergeRasterLayers(document, [bottom.id, top.id])

    expect(result.ok).toBe(true)
    expect(document.layers).toHaveLength(1)
    expect(Array.from(compositeDocument(document))).toEqual(Array.from(before))
  })
})
