import { describe, expect, it } from 'vitest'
import { CURSOR_ICON_LIBRARY, cursorPreferenceSource } from './cursor-theme'

describe('cursor icon library', () => {
  it('exposes every registered cursor asset with a unique CSS variable', () => {
    expect(CURSOR_ICON_LIBRARY.length).toBeGreaterThan(0)
    expect(new Set(CURSOR_ICON_LIBRARY.map((item) => item.variable)).size).toBe(CURSOR_ICON_LIBRARY.length)
    expect(CURSOR_ICON_LIBRARY.every((item) => item.variable.startsWith('--cursor-') && item.source.length > 0 && item.fallback.length > 0)).toBe(true)
  })
})

describe('cursor preference source', () => {
  it('uses system cursors for supported scenes and MoonSprite cursors for missing scenes', () => {
    expect(cursorPreferenceSource('--cursor-default', true)).toBe('system')
    expect(cursorPreferenceSource('--cursor-pointer', true)).toBe('system')
    expect(cursorPreferenceSource('--cursor-crosshair', true)).toBe('moonsprite')
    expect(cursorPreferenceSource('--cursor-eyedropper', true)).toBe('moonsprite')
    expect(cursorPreferenceSource('--cursor-selection-rotate-ne', true)).toBe('moonsprite')
    expect(cursorPreferenceSource('--cursor-selection-rotate-n', true)).toBe('moonsprite')
    expect(cursorPreferenceSource('--cursor-selection-rotate-s', true)).toBe('moonsprite')
    expect(cursorPreferenceSource('--cursor-rotate', true)).toBe('moonsprite')
  })

  it('uses MoonSprite cursors everywhere when local system cursors are disabled', () => {
    expect(cursorPreferenceSource('--cursor-default', false)).toBe('moonsprite')
    expect(cursorPreferenceSource('--cursor-selection-rotate-ne', false)).toBe('moonsprite')
  })
})
