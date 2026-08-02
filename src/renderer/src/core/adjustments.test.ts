import { describe, expect, it } from 'vitest'
import { applyColorAdjustment, adjustColor, buildCurveHistogram, buildCurveLut, buildCurvePath } from './adjustments'
import { createDocument, getActiveLayer, readLayerColor, writeLayerColor } from './document'

describe('color adjustments', () => {
  it('keeps alpha while applying brightness and contrast', () => {
    const next = adjustColor({ r: 80, g: 100, b: 120, a: 140 }, { kind: 'brightness-contrast', brightness: 20, contrast: 10 })
    expect(next.a).toBe(140)
    expect(next.r).toBeGreaterThan(80)
  })

  it('records only changed active-layer pixels', () => {
    const document = createDocument('adjust', 2, 1, 'rgba')
    const layer = getActiveLayer(document)
    writeLayerColor(document, layer, 0, { r: 10, g: 20, b: 30, a: 255 })
    const edit = applyColorAdjustment(document, layer, { kind: 'brightness-contrast', brightness: 10 })
    expect(edit.before.size).toBe(1)
    expect(readLayerColor(document, layer, 0).r).toBeGreaterThan(10)
  })

  it('limits adjustments to the selection in document coordinates', () => {
    const document = createDocument('selected adjustment', 4, 2, 'rgba')
    const layer = getActiveLayer(document)
    layer.offsetX = 1
    layer.offsetY = 1
    writeLayerColor(document, layer, 0, { r: 10, g: 20, b: 30, a: 255 })
    writeLayerColor(document, layer, 1, { r: 40, g: 50, b: 60, a: 255 })

    const edit = applyColorAdjustment(document, layer, { kind: 'brightness-contrast', brightness: 10 }, { x: 2, y: 1, width: 1, height: 1 })

    expect(edit.before.size).toBe(1)
    expect(readLayerColor(document, layer, 0).r).toBe(10)
    expect(readLayerColor(document, layer, 1).r).toBeGreaterThan(40)
  })

  it('balances independent cyan-red, magenta-green and yellow-blue channels', () => {
    const source = { r: 128, g: 128, b: 128, a: 255 }
    const red = adjustColor(source, { kind: 'color-balance', midtonesCyanRed: 40, preserveLuminosity: false })
    const green = adjustColor(source, { kind: 'color-balance', midtonesMagentaGreen: 40, preserveLuminosity: false })
    const blue = adjustColor(source, { kind: 'color-balance', midtonesYellowBlue: 40, preserveLuminosity: false })
    expect(red.r).toBeGreaterThan(red.g)
    expect(green.g).toBeGreaterThan(green.r)
    expect(blue.b).toBeGreaterThan(blue.r)
  })

  it('builds an identity LUT from endpoint controls', () => {
    const lut = buildCurveLut([{ x: 0, y: 0 }, { x: 255, y: 255 }])
    expect(lut[0]).toBe(0)
    expect(lut[128]).toBe(128)
    expect(lut[255]).toBe(255)
  })

  it('applies manually positioned curve controls', () => {
    const next = adjustColor({ r: 128, g: 64, b: 200, a: 180 }, { kind: 'curves', curvePoints: [{ x: 0, y: 0 }, { x: 128, y: 192 }, { x: 255, y: 255 }] })
    expect(next.r).toBeGreaterThan(160)
    expect(next.g).toBeGreaterThan(64)
    expect(next.a).toBe(180)
  })

  it('applies RGB and independent channel bezier curves', () => {
    const next = adjustColor({ r: 64, g: 64, b: 64, a: 255 }, {
      kind: 'curves',
      curvePoints: [{ x: 0, y: 0 }, { x: 255, y: 255 }],
      curveRedPoints: [{ x: 0, y: 0 }, { x: 64, y: 160 }, { x: 255, y: 255 }]
    })
    expect(next.r).toBeGreaterThan(next.g)
    expect(next.g).toBe(64)
    expect(next.b).toBe(64)
  })

  it('uses a cubic bezier path for curve editing', () => {
    expect(buildCurvePath([{ x: 0, y: 0 }, { x: 128, y: 220 }, { x: 255, y: 255 }])).toContain('C')
  })

  it('builds channel histograms from opaque RGBA pixels', () => {
    const histogram = buildCurveHistogram(new Uint8ClampedArray([
      255, 0, 0, 255,
      0, 255, 0, 255,
      0, 0, 255, 0
    ]), 'rgba', [])
    expect(histogram.red[255]).toBe(1)
    expect(histogram.green[255]).toBe(1)
    expect(histogram.blue[255]).toBe(0)
    expect(histogram.rgb[85]).toBe(2)
  })

  it('builds channel histograms from indexed palette pixels', () => {
    const histogram = buildCurveHistogram(new Uint32Array([2, 1]), 'indexed', [
      { id: 1, color: { r: 12, g: 34, b: 56, a: 255 } },
      { id: 2, color: { r: 200, g: 100, b: 50, a: 255 } }
    ])
    expect(histogram.red[200]).toBe(1)
    expect(histogram.green[34]).toBe(1)
    expect(histogram.blue[50]).toBe(1)
  })
})
