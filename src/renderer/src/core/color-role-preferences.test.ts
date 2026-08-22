import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  COLOR_ROLE_PREFERENCES_KEY,
  DEFAULT_COLOR_ROLE_PREFERENCES,
  flushColorRolePreferences,
  loadColorRolePreferences,
  persistColorRolePreferences
} from './color-role-preferences'

beforeEach(() => {
  vi.useFakeTimers()
  flushColorRolePreferences()
  localStorage.clear()
})

afterEach(() => vi.useRealTimers())

describe('color role preferences', () => {
  it('restores the last foreground and background colors', () => {
    persistColorRolePreferences(
      { r: 12, g: 34, b: 56, a: 78 },
      { r: 210, g: 180, b: 140, a: 100 }
    )
    flushColorRolePreferences()

    expect(loadColorRolePreferences()).toEqual({
      primary: { r: 12, g: 34, b: 56, a: 78 },
      secondary: { r: 210, g: 180, b: 140, a: 100 }
    })
  })

  it('repairs invalid stored channels without discarding valid ones', () => {
    localStorage.setItem(COLOR_ROLE_PREFERENCES_KEY, JSON.stringify({
      primary: { r: -20, g: 42.4, b: 999, a: 'invalid' },
      secondary: null
    }))

    expect(loadColorRolePreferences()).toEqual({
      primary: { r: 0, g: 42, b: 255, a: DEFAULT_COLOR_ROLE_PREFERENCES.primary.a },
      secondary: DEFAULT_COLOR_ROLE_PREFERENCES.secondary
    })
  })
})
