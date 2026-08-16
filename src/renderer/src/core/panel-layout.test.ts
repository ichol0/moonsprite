import { describe, expect, it } from 'vitest'
import { DEFAULT_BOTTOM_WIDTHS, DEFAULT_INSPECTOR_ORDER, DEFAULT_INSPECTOR_SIZES, MINIMUM_BOTTOM_WIDTHS, MINIMUM_INSPECTOR_SIZES, loadInspectorLayout, moveInspectorPanel, proportionalPanelFlex } from './panel-layout'

describe('panel layout', () => {
  it('repairs duplicate, unknown and missing panel ids', () => {
    const layout = loadInspectorLayout(JSON.stringify({ order: ['layers', 'unknown', 'layers'] }))
    expect(layout.order).toEqual(['layers', 'color', 'palette', 'preview'])
  })

  it('clamps old or undersized persisted panel dimensions', () => {
    const layout = loadInspectorLayout(JSON.stringify({ sizes: { color: 250, layers: 1 }, bottomWidths: { palette: 1 } }))
    expect(layout.verticalWeights.color).toBe(DEFAULT_INSPECTOR_SIZES.color)
    expect(layout.verticalWeights.layers).toBe(MINIMUM_INSPECTOR_SIZES.layers)
    expect(layout.bottomWeights.palette).toBe(MINIMUM_BOTTOM_WIDTHS.palette)
  })

  it('prefers proportional weights while continuing to migrate old pixel fields', () => {
    const layout = loadInspectorLayout(JSON.stringify({
      verticalWeights: { color: 420, palette: 180 },
      bottomWeights: { layers: 720, preview: 280 },
      sizes: { color: 999 },
      bottomWidths: { preview: 999 }
    }))
    expect(layout.verticalWeights.color).toBe(420)
    expect(layout.verticalWeights.palette).toBe(180)
    expect(layout.bottomWeights.layers).toBe(720)
    expect(layout.bottomWeights.preview).toBe(280)
  })

  it('falls back to the complete default layout when storage is malformed', () => {
    const layout = loadInspectorLayout('{broken')
    expect(layout.order).toEqual(DEFAULT_INSPECTOR_ORDER)
    expect(layout.verticalWeights).toEqual(DEFAULT_INSPECTOR_SIZES)
    expect(layout.bottomWeights).toEqual(DEFAULT_BOTTOM_WIDTHS)
  })

  it('moves a panel before, after or to the end without duplication', () => {
    const order = ['color', 'palette', 'layers', 'preview'] as const
    expect(moveInspectorPanel([...order], 'layers', 'color', false)).toEqual(['layers', 'color', 'palette', 'preview'])
    expect(moveInspectorPanel([...order], 'color', 'layers', true)).toEqual(['palette', 'layers', 'color', 'preview'])
    expect(moveInspectorPanel([...order], 'palette')).toEqual(['color', 'layers', 'preview', 'palette'])
  })

  it('uses zero-basis flex weights so every dock keeps its proportions while resizing', () => {
    expect(proportionalPanelFlex(720)).toBe('720 1 0px')
    expect(proportionalPanelFlex(280)).toBe('280 1 0px')
    expect(proportionalPanelFlex(0)).toBe('1 1 0px')
  })
})
