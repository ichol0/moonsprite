import { describe, expect, it } from 'vitest'
import { imageExportKindForPreference, parseDocumentSizePresets, parseDrawingBrushPreviewEnabled, parseExportScalePresets, parseRelativeLuminanceScope, saveImageKindForPreference } from './file-preferences'

describe('file format preferences', () => {
  it('maps export formats to encoder kinds', () => {
    expect(imageExportKindForPreference('png')).toBe('png-auto')
    expect(imageExportKindForPreference('jpeg')).toBe('jpeg')
    expect(imageExportKindForPreference('webp')).toBe('webp')
    expect(imageExportKindForPreference('svg')).toBe('svg')
    expect(imageExportKindForPreference('aseprite')).toBe('png-auto')
  })

  it('keeps the native project format separate from image saves', () => {
    expect(saveImageKindForPreference('moonsprite')).toBeNull()
    expect(saveImageKindForPreference('png')).toBe('png-auto')
    expect(saveImageKindForPreference('ase')).toBe('ase')
    expect(saveImageKindForPreference('aseprite')).toBe('aseprite')
  })

  it('loads validated document-size and export-scale presets', () => {
    expect(parseDocumentSizePresets('[{"width":32,"height":16},{"width":32,"height":16},{"width":0,"height":4}]')).toEqual([{ width: 32, height: 16 }])
    expect(parseExportScalePresets('[100,250,250,0,7000]')).toEqual([100, 250])
  })

  it('falls back when stored preset lists are invalid or empty', () => {
    expect(parseDocumentSizePresets('[]').length).toBeGreaterThan(0)
    expect(parseExportScalePresets('invalid')).toContain(100)
  })
})

describe('canvas preferences', () => {
  it('keeps drawing-time brush preview enabled by default and restores an explicit disabled value', () => {
    expect(parseDrawingBrushPreviewEnabled(null)).toBe(true)
    expect(parseDrawingBrushPreviewEnabled('true')).toBe(true)
    expect(parseDrawingBrushPreviewEnabled('false')).toBe(false)
  })

  it('defaults relative luminance to the canvas and accepts the app-wide scope', () => {
    expect(parseRelativeLuminanceScope(null)).toBe('canvas')
    expect(parseRelativeLuminanceScope('canvas')).toBe('canvas')
    expect(parseRelativeLuminanceScope('app')).toBe('app')
    expect(parseRelativeLuminanceScope('unexpected')).toBe('canvas')
  })
})
