import { describe, expect, it } from 'vitest'
import { cursorPreferenceSource } from './cursor-theme'

describe('cursor preference source', () => {
  it('uses system cursors for supported scenes and MoonSprite cursors for missing scenes', () => {
    expect(cursorPreferenceSource('--cursor-default', true)).toBe('system')
    expect(cursorPreferenceSource('--cursor-pointer', true)).toBe('system')
    expect(cursorPreferenceSource('--cursor-selection-rotate-ne', true)).toBe('moonsprite')
    expect(cursorPreferenceSource('--cursor-rotate', true)).toBe('moonsprite')
  })

  it('uses MoonSprite cursors everywhere when local system cursors are disabled', () => {
    expect(cursorPreferenceSource('--cursor-default', false)).toBe('moonsprite')
    expect(cursorPreferenceSource('--cursor-selection-rotate-ne', false)).toBe('moonsprite')
  })
})
