import { afterEach, describe, expect, it } from 'vitest'
import { beginPaletteSamplingShortcut, endPaletteSamplingShortcut, paletteSamplingShortcutActive } from './palette-sampling-shortcut'

afterEach(endPaletteSamplingShortcut)

describe('palette sampling shortcut state', () => {
  it('stays active across repeated sampling operations until the shortcut is released', () => {
    beginPaletteSamplingShortcut()

    expect(paletteSamplingShortcutActive()).toBe(true)
    expect(paletteSamplingShortcutActive()).toBe(true)

    endPaletteSamplingShortcut()
    expect(paletteSamplingShortcutActive()).toBe(false)
  })
})
