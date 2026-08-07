import { describe, expect, it } from 'vitest'
import { ALL_EDITOR_TOOL_ICONS, FILL_KIND_ICONS, SELECTION_KIND_DEFINITIONS, SHAPE_KIND_DEFINITIONS, TOOL_DEFINITIONS, activeToolPresentation, fillKindDefinitions, temporarySelectionModeForModifiers } from './editor-tools'

describe('editor tool flyout definitions', () => {
  it('gives every main tool complete custom-tooltip metadata', () => {
    expect(TOOL_DEFINITIONS.every((item) => item.description.length > 0 && item.shortcutId.length > 0)).toBe(true)
  })

  it('keeps all selection tools in the requested order with complete tooltip metadata', () => {
    expect(SELECTION_KIND_DEFINITIONS.map((item) => [item.id, item.label])).toEqual([
      ['rectangle', '矩形框选工具'],
      ['ellipse', '椭圆框选工具'],
      ['lasso', '套索工具'],
      ['polygon-lasso', '多边形套索工具'],
      ['magic', '魔棒工具']
    ])
    expect(SELECTION_KIND_DEFINITIONS.every((item) => item.description.length > 0 && item.shortcutId.length > 0)).toBe(true)
  })

  it('keeps all shape tools in outline-first order with shortcut help', () => {
    expect(SHAPE_KIND_DEFINITIONS.map((item) => [item.id, item.label])).toEqual([
      ['rectangle-outline', '矩形工具'],
      ['rectangle', '矩形填充工具'],
      ['ellipse-outline', '椭圆工具'],
      ['ellipse', '椭圆填充工具']
    ])
    expect(SHAPE_KIND_DEFINITIONS.every((item) => item.shortcutId === 'tool.shape')).toBe(true)
    expect(SHAPE_KIND_DEFINITIONS.every((item) => item.icon.length > 0)).toBe(true)
  })

  it('presents the selected child tool in the main rail and options bar', () => {
    expect(activeToolPresentation('selection', 'polygon-lasso', 'rectangle').label).toBe('多边形套索工具')
    expect(activeToolPresentation('shape', 'rectangle', 'ellipse-outline').label).toBe('椭圆工具')
    expect(activeToolPresentation('shape', 'rectangle', 'ellipse-outline').icon).toBe(
      SHAPE_KIND_DEFINITIONS.find((item) => item.id === 'ellipse-outline')?.icon
    )
  })

  it('keeps gradient as a paint bucket child tool with its own presentation', () => {
    expect(fillKindDefinitions('en-US').map((item) => item.id)).toEqual(['bucket', 'gradient'])
    const gradient = activeToolPresentation('fill', 'rectangle', 'rectangle', 'en-US', 'gradient')
    expect(gradient.label).toBe('Gradient Tool')
    expect(gradient.icon).toBe(FILL_KIND_ICONS.gradient)
  })

  it('exposes every tool image for eager decoding before a flyout opens', () => {
    expect(ALL_EDITOR_TOOL_ICONS).toContain(SHAPE_KIND_DEFINITIONS.find((item) => item.id === 'rectangle')?.icon)
    expect(ALL_EDITOR_TOOL_ICONS).toContain(SHAPE_KIND_DEFINITIONS.find((item) => item.id === 'ellipse-outline')?.icon)
    expect(ALL_EDITOR_TOOL_ICONS).toContain(FILL_KIND_ICONS.gradient)
  })

  it('shows temporary add and subtract modes without replacing the persisted mode', () => {
    expect(temporarySelectionModeForModifiers(true, false)).toBe('add')
    expect(temporarySelectionModeForModifiers(true, true)).toBe('subtract')
    expect(temporarySelectionModeForModifiers(false, false)).toBeNull()
  })
})
