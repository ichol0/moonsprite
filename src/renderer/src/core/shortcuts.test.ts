import { describe, expect, it } from 'vitest'
import { DEFAULT_SHORTCUTS, parseShortcutJson } from './shortcuts'

describe('shortcut persistence boundary', () => {
  it('only accepts known shortcut ids and string values', () => {
    expect(parseShortcutJson(JSON.stringify({ save: 'Ctrl+S', unknown: 'X', undo: 12 }))).toEqual({ save: 'Ctrl+S' })
  })

  it('keeps defaults available to callers after a malformed payload', () => {
    expect({ ...DEFAULT_SHORTCUTS, ...parseShortcutJson('{bad') }).toMatchObject({ save: 'Ctrl+S', fillForeground: 'F' })
  })
})
