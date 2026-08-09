import { describe, expect, it } from 'vitest'
import { DEFAULT_INSPECTOR_ORDER, DEFAULT_INSPECTOR_SIZES, MINIMUM_BOTTOM_WIDTHS, MINIMUM_INSPECTOR_SIZES, loadInspectorLayout, moveInspectorPanel, verticalInspectorPanelFlex } from './panel-layout'

describe('panel layout', () => {
  it('repairs duplicate, unknown and missing panel ids', () => {
    const layout = loadInspectorLayout(JSON.stringify({ order: ['layers', 'unknown', 'layers'] }))
    expect(layout.order).toEqual(['layers', 'color', 'palette', 'preview'])
  })

  it('clamps old or undersized persisted panel dimensions', () => {
    const layout = loadInspectorLayout(JSON.stringify({ sizes: { color: 250, layers: 1 }, bottomWidths: { palette: 1 } }))
    expect(layout.sizes.color).toBe(DEFAULT_INSPECTOR_SIZES.color)
    expect(layout.sizes.layers).toBe(MINIMUM_INSPECTOR_SIZES.layers)
    expect(layout.bottomWidths.palette).toBe(MINIMUM_BOTTOM_WIDTHS.palette)
  })

  it('falls back to the complete default layout when storage is malformed', () => {
    const layout = loadInspectorLayout('{broken')
    expect(layout.order).toEqual(DEFAULT_INSPECTOR_ORDER)
    expect(layout.sizes).toEqual(DEFAULT_INSPECTOR_SIZES)
  })

  it('moves a panel before, after or to the end without duplication', () => {
    const order = ['color', 'palette', 'layers', 'preview'] as const
    expect(moveInspectorPanel([...order], 'layers', 'color', false)).toEqual(['layers', 'color', 'palette', 'preview'])
    expect(moveInspectorPanel([...order], 'color', 'layers', true)).toEqual(['palette', 'layers', 'color', 'preview'])
    expect(moveInspectorPanel([...order], 'palette')).toEqual(['color', 'layers', 'preview', 'palette'])
  })

  it('keeps every vertical dock filled as panels are added or removed', () => {
    expect(verticalInspectorPanelFlex(230, false, false)).toBe('1 1 230px')
    expect(verticalInspectorPanelFlex(230, true, false)).toBe('0 1 237px')
    expect(verticalInspectorPanelFlex(230, false, true)).toBe('1 1 230px')
  })
})
