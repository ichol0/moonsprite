export function getStorage(storage?: Storage): Storage | null {
  if (storage) return storage
  try { return window.localStorage } catch { return null }
}

export function readStoredString(key: string, storage?: Storage): string | null {
  try { return getStorage(storage)?.getItem(key) ?? null } catch { return null }
}

export function writeStoredString(key: string, value: string, storage?: Storage): boolean {
  try {
    const target = getStorage(storage)
    if (!target) return false
    target.setItem(key, value)
    return true
  } catch {
    return false
  }
}

export function removeStoredValue(key: string, storage?: Storage): boolean {
  try {
    const target = getStorage(storage)
    if (!target) return false
    target.removeItem(key)
    return true
  } catch {
    return false
  }
}

export function clearStoredValues(storage?: Storage): boolean {
  try {
    const target = getStorage(storage)
    if (!target) return false
    target.clear()
    return true
  } catch {
    return false
  }
}

export function clearStoredValuesExcept(preservedKeys: readonly string[], storage?: Storage): boolean {
  try {
    const target = getStorage(storage)
    if (!target) return false
    const preserved = new Map(preservedKeys.flatMap((key) => {
      const value = target.getItem(key)
      return value === null ? [] : [[key, value] as const]
    }))
    target.clear()
    for (const [key, value] of preserved) target.setItem(key, value)
    return true
  } catch {
    return false
  }
}

export function readStoredJson<T>(key: string, fallback: T, storage?: Storage): T {
  const value = readStoredString(key, storage)
  if (!value) return fallback
  try { return JSON.parse(value) as T } catch { return fallback }
}

export function writeStoredJson(key: string, value: unknown, storage?: Storage): boolean {
  try { return writeStoredString(key, JSON.stringify(value), storage) } catch { return false }
}
