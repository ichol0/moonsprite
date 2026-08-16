import { beforeEach, describe, expect, it, vi } from 'vitest'
import { applyTextStyleRun, cloneTextCelData, DEFAULT_TEXT_FONT_FAMILY, DEFAULT_TEXT_FONT_SIZE, normalizeTextCelData, rasterizeText, reconcileTextStyleRuns, TEXT_FONT_FAMILIES, textActualLineBaselines, textFontDefaultSize, textGlyphPositions, textLineAdvance, textLineWidth, textPixelAdvance, textPixelCoverage, textVisibleGlyphPositions, translateTextCelData } from './text-raster'

class MockTextCanvasContext {
  font = ''
  fontKerning: CanvasFontKerning = 'none'
  imageSmoothingEnabled = false
  textBaseline: CanvasTextBaseline = 'alphabetic'
  fillStyle: string | CanvasGradient | CanvasPattern = ''
  private drawX = 0
  private drawY = 0
  measureText(): TextMetrics {
    return { width: 6, actualBoundingBoxAscent: 6, actualBoundingBoxDescent: 2 } as TextMetrics
  }
  fillText(_text: string, x: number, y: number): void { this.drawX = Math.round(x); this.drawY = Math.round(y) }
  getImageData(_x: number, _y: number, width: number, height: number): ImageData {
    const data = new Uint8ClampedArray(width * height * 4)
    const offset = (this.drawY * width + this.drawX) * 4
    if (offset >= 0 && offset + 3 < data.length) data.set([255, 255, 255, 255], offset)
    return { data, width, height, colorSpace: 'srgb' } as ImageData
  }
}

class MockTextCanvas {
  private readonly context = new MockTextCanvasContext()
  constructor(public width: number, public height: number) {}
  getContext(): MockTextCanvasContext { return this.context }
}

describe('text raster helpers', () => {
  beforeEach(() => vi.stubGlobal('OffscreenCanvas', MockTextCanvas))

  it('normalizes persisted text settings to bounded values', () => {
    expect(normalizeTextCelData({ text: 'Moon', fontFamily: '', fontSize: 0, lineSpacing: -999, letterSpacing: 999, antialias: 'smooth', color: { r: 300, g: -2, b: 80, a: 128 } })).toMatchObject({
      text: 'Moon', fontFamily: DEFAULT_TEXT_FONT_FAMILY, fontSize: 1, lineSpacing: -256, letterSpacing: 256, spacingMode: 'font', antialias: 'smooth', color: { r: 255, g: 0, b: 80, a: 128 }
    })
  })

  it('uses the bundled native pixel font defaults for new text', () => {
    expect(normalizeTextCelData({ text: 'Moon' })).toMatchObject({
      fontFamily: DEFAULT_TEXT_FONT_FAMILY,
      fontSize: DEFAULT_TEXT_FONT_SIZE,
      antialias: 'pixel'
    })
  })

  it('keeps only the supported bundled pixel fonts and their native defaults', () => {
    expect(TEXT_FONT_FAMILIES).toEqual(['Fusion Pixel 10px Prop Zh_hans', 'Silkscreen', 'Tiny5', 'Noto Sans SC'])
    expect(textFontDefaultSize('Fusion Pixel 10px Prop Zh_hans')).toBe(10)
    expect(textFontDefaultSize('Silkscreen')).toBe(8)
    expect(textFontDefaultSize('Tiny5')).toBe(8)
  })

  it('keeps line layout deterministic', () => {
    expect(textLineWidth([4, 5, 6], 2)).toBe(19)
    expect(textLineAdvance({ fontSize: 12, lineSpacing: 3 })).toBe(15)
    expect(textLineAdvance({ fontSize: 12, lineSpacing: -30 })).toBe(1)
  })

  it('can space glyphs by their visible bounds instead of font advances', () => {
    const metrics = [
      { width: 10, actualBoundingBoxLeft: 2, actualBoundingBoxRight: 5 },
      { width: 12, actualBoundingBoxLeft: 1, actualBoundingBoxRight: 7 }
    ]
    expect(textGlyphPositions(metrics, 2, 'font')).toEqual([0, 12])
    expect(textGlyphPositions(metrics, 2, 'actual')).toEqual([2, 10])
  })

  it('places visible glyph pixels directly next to each other at zero actual spacing', () => {
    expect(textVisibleGlyphPositions([{ left: -2, width: 5 }, { left: -1, width: 7 }], [10, 12], 0)).toEqual([2, 6])
    expect(textVisibleGlyphPositions([{ left: -2, width: 5 }, null, { left: -1, width: 7 }], [10, 4, 12], 0)).toEqual([2, 5, 10])
  })

  it('places visible line pixels directly next to each other at zero actual spacing', () => {
    expect(textActualLineBaselines([{ top: -5, bottom: 1, lineSpacing: 0 }, { top: -4, bottom: 2, lineSpacing: 0 }])).toEqual([5, 11])
    expect(textActualLineBaselines([{ top: -5, bottom: 1, lineSpacing: 3 }, { top: -4, bottom: 2, lineSpacing: 0 }])).toEqual([5, 14])
  })

  it('moves editable origins and transform rectangles together', () => {
    const value = normalizeTextCelData({
      text: 'Moon', fontFamily: 'Consolas', fontSize: 12, lineSpacing: 0, letterSpacing: 0, spacingMode: 'font', antialias: 'pixel',
      color: { r: 1, g: 2, b: 3, a: 255 }, originX: 4, originY: 5,
      transforms: [{ source: { x: 4, y: 5, width: 3, height: 4 }, target: { x: 8, y: 9, width: 6, height: 8 }, angle: 15 }]
    })
    translateTextCelData(value, 3, -2)
    expect(value).toMatchObject({ originX: 7, originY: 3, transforms: [{ source: { x: 7, y: 3 }, target: { x: 11, y: 7 } }] })
  })

  it('applies and merges local text styles across the selected character range', () => {
    const runs = applyTextStyleRun([], 1, 4, { fontSize: 24, letterSpacing: 0, color: { r: 255, g: 0, b: 0, a: 255 } }, 6)
    expect(runs).toEqual([{ start: 1, end: 4, fontSize: 24, letterSpacing: 0, color: { r: 255, g: 0, b: 0, a: 255 } }])
    expect(applyTextStyleRun(runs, 2, 3, { fontSize: 24 }, 6)).toEqual(runs)
  })

  it('keeps local styles aligned when text is inserted or removed', () => {
    const runs = [{ start: 2, end: 5, fontSize: 20 }]
    expect(reconcileTextStyleRuns(runs, 'abcdef', 'abXYcdef')).toEqual([{ start: 4, end: 7, fontSize: 20 }])
    expect(reconcileTextStyleRuns(runs, 'abcdef', 'abef')).toEqual([{ start: 2, end: 3, fontSize: 20 }])
  })

  it('inherits the preceding local style when text is inserted at the final caret', () => {
    const runs = [{ start: 0, end: 4, color: { r: 255, g: 0, b: 0, a: 255 } }]
    expect(reconcileTextStyleRuns(runs, 'Moon', 'Moon!')).toEqual([{ start: 0, end: 5, color: { r: 255, g: 0, b: 0, a: 255 } }])
  })

  it('keeps pixel-font advances on the integer pixel grid', () => {
    expect(textPixelAdvance(9.49)).toBe(9)
    expect(textPixelAdvance(9.51)).toBe(10)
  })

  it('removes antialiased edge coverage instead of turning it into a solid pixel', () => {
    expect(textPixelCoverage(191)).toBe(0)
    expect(textPixelCoverage(192)).toBe(255)
  })

  it('normalizes editable transform metadata without sharing nested objects', () => {
    const source = { x: 1, y: 2, width: 3, height: 4 }
    const target = { x: 5, y: 6, width: 7, height: 8, flipHorizontal: true }
    const normalized = normalizeTextCelData({
      text: 'Moon', fontFamily: 'Consolas', fontSize: 12, lineSpacing: 0, letterSpacing: 0, antialias: 'pixel',
      color: { r: 1, g: 2, b: 3, a: 255 }, originX: 9, originY: 10,
      transforms: [{ source, target, angle: 45, shear: { axis: 'x', edge: 'n', amount: 2 } }]
    })
    source.x = 99
    target.flipHorizontal = false
    expect(normalized).toMatchObject({ originX: 9, originY: 10, transforms: [{ source: { x: 1 }, target: { flipHorizontal: true }, angle: 45 }] })
  })

  it('normalizes and clones fixed text-box dimensions only as a complete pair', () => {
    expect(normalizeTextCelData({ text: 'Moon', boxWidth: 0, boxHeight: 20_000 })).toMatchObject({ boxWidth: 1, boxHeight: 16_384 })
    expect(normalizeTextCelData({ text: 'Moon', boxWidth: 12 })).not.toHaveProperty('boxWidth')
    const cloned = cloneTextCelData(normalizeTextCelData({ text: 'Moon', boxWidth: 12, boxHeight: 9 }))
    expect(cloned).toMatchObject({ boxWidth: 12, boxHeight: 9 })
  })

  it('keeps point text content-sized while boxed text wraps and clips to its area', () => {
    const base = normalizeTextCelData({
      text: 'ABCDE', fontFamily: 'Consolas', fontSize: 8, lineSpacing: 0, letterSpacing: 0,
      spacingMode: 'font', antialias: 'pixel', color: { r: 1, g: 2, b: 3, a: 255 }
    })
    const point = rasterizeText(base, 2, 3).rgba
    const boxed = rasterizeText({ ...base, boxWidth: 16, boxHeight: 12 }, 2, 3).rgba
    expect(point).toMatchObject({ offsetX: 2, offsetY: 3 })
    expect(point.width).toBeGreaterThan(16)
    expect(boxed).toMatchObject({ width: 16, height: 12, offsetX: 2, offsetY: 3 })
    expect(Array.from(boxed.pixels).filter((value, index) => index % 4 === 3 && value > 0)).toHaveLength(4)
  })

  it('places actual-spacing boxed text against the text-area edges', () => {
    const surface = rasterizeText(normalizeTextCelData({
      text: 'A', fontFamily: 'Consolas', fontSize: 8, lineSpacing: 0, letterSpacing: 0,
      spacingMode: 'actual', antialias: 'pixel', color: { r: 1, g: 2, b: 3, a: 255 },
      boxWidth: 12, boxHeight: 12
    }), 0, 0).rgba
    const visible = Array.from({ length: surface.width * surface.height }, (_, index) => surface.pixels[index * 4 + 3] > 0 ? index : -1).filter((index) => index >= 0)
    expect(Math.min(...visible.map((index) => index % surface.width))).toBe(0)
    expect(Math.min(...visible.map((index) => Math.floor(index / surface.width)))).toBe(0)
  })
})
