import { describe, expect, it } from 'vitest'
import { clearStoredValues, clearStoredValuesExcept, readStoredJson, readStoredString, removeStoredValue, writeStoredJson, writeStoredString } from './storage'

function createStorage(): Storage {
  const values = new Map<string, string>()
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value) },
    removeItem: (key) => { values.delete(key) },
    clear: () => { values.clear() },
    key: (index) => [...values.keys()][index] ?? null,
    get length() { return values.size }
  }
}

describe('safe renderer storage', () => {
  it('round-trips strings and JSON through an injected storage', () => {
    const storage = createStorage()
    expect(writeStoredString('text', 'value', storage)).toBe(true)
    expect(readStoredString('text', storage)).toBe('value')
    expect(writeStoredJson('json', { enabled: true }, storage)).toBe(true)
    expect(readStoredJson('json', { enabled: false }, storage)).toEqual({ enabled: true })
  })

  it('returns fallbacks for malformed JSON and supports removal', () => {
    const storage = createStorage()
    storage.setItem('broken', '{')
    expect(readStoredJson('broken', ['fallback'], storage)).toEqual(['fallback'])
    expect(removeStoredValue('broken', storage)).toBe(true)
    expect(readStoredString('broken', storage)).toBeNull()
    writeStoredString('remaining', 'value', storage)
    expect(clearStoredValues(storage)).toBe(true)
    expect(storage.length).toBe(0)
  })

  it('clears settings without removing explicitly preserved records', () => {
    const storage = createStorage()
    storage.setItem('moonsprite.recent-projects.v1', '[{"filePath":"demo.moonsprite"}]')
    storage.setItem('moonsprite.gallery-pins.v1', '["demo.moonsprite"]')
    storage.setItem('moonsprite.preference.brush-preview-mode', 'edge')

    expect(clearStoredValuesExcept(['moonsprite.recent-projects.v1', 'moonsprite.gallery-pins.v1'], storage)).toBe(true)
    expect(storage.getItem('moonsprite.recent-projects.v1')).toContain('demo.moonsprite')
    expect(storage.getItem('moonsprite.gallery-pins.v1')).toContain('demo.moonsprite')
    expect(storage.getItem('moonsprite.preference.brush-preview-mode')).toBeNull()
  })
})
