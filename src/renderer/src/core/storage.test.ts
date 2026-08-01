import { describe, expect, it } from 'vitest'
import { readStoredJson, readStoredString, removeStoredValue, writeStoredJson, writeStoredString } from './storage'

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
  })
})
