import { useMemo, useSyncExternalStore } from 'react'
import { deriveShortcutConflicts, shortcutKeyPart, type ShortcutBindings, type ShortcutConflictState } from '@/core/shortcuts'
import { resolveHeldQuickTool, type QuickToolMatch } from '@/core/quick-tools'

const heldParts = new Set<string>()
const listeners = new Set<() => void>()
let revision = 0
let listening = false
let cachedMatch: {
  shortcuts: ShortcutBindings
  conflicts: ShortcutConflictState
  revision: number
  match: QuickToolMatch | null
} | null = null

const notify = (): void => {
  revision += 1
  cachedMatch = null
  for (const listener of listeners) listener()
}

const clearHeldParts = (): void => {
  if (heldParts.size === 0) return
  heldParts.clear()
  notify()
}

const keyboardTargetBlocksQuickTools = (target: EventTarget | null): boolean => target instanceof Element
  && Boolean(target.closest('input, textarea, select, [contenteditable="true"], [data-shortcut-recorder="true"]'))

const keyDown = (event: KeyboardEvent): void => {
  if (keyboardTargetBlocksQuickTools(event.target)) {
    clearHeldParts()
    return
  }
  const part = shortcutKeyPart(event)
  if (!part || part === 'WheelUp' || part === 'WheelDown' || heldParts.has(part)) return
  heldParts.add(part)
  notify()
}

const keyUp = (event: KeyboardEvent): void => {
  const part = shortcutKeyPart(event)
  if (!heldParts.delete(part)) return
  notify()
}

const visibilityChange = (): void => {
  if (document.hidden) clearHeldParts()
}

const startListening = (): void => {
  if (listening || typeof window === 'undefined') return
  listening = true
  window.addEventListener('keydown', keyDown, true)
  window.addEventListener('keyup', keyUp, true)
  window.addEventListener('blur', clearHeldParts)
  document.addEventListener('visibilitychange', visibilityChange)
}

const stopListening = (): void => {
  if (!listening || typeof window === 'undefined') return
  listening = false
  window.removeEventListener('keydown', keyDown, true)
  window.removeEventListener('keyup', keyUp, true)
  window.removeEventListener('blur', clearHeldParts)
  document.removeEventListener('visibilitychange', visibilityChange)
  clearHeldParts()
}

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener)
  startListening()
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0) stopListening()
  }
}

const getSnapshot = (): number => revision

export const currentHeldShortcutKeyParts = (): ReadonlySet<string> => heldParts

export function syncHeldShortcutModifiers(event: Pick<KeyboardEvent, 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>): void {
  let changed = false
  const sync = (part: 'Ctrl' | 'Alt' | 'Shift', active: boolean): void => {
    if (active) {
      if (!heldParts.has(part)) {
        heldParts.add(part)
        changed = true
      }
      return
    }
    if (heldParts.delete(part)) changed = true
  }
  sync('Ctrl', Boolean(event.ctrlKey || event.metaKey))
  sync('Alt', Boolean(event.altKey))
  sync('Shift', Boolean(event.shiftKey))
  if (changed) notify()
}

export function currentQuickToolMatch(
  shortcuts: ShortcutBindings,
  conflicts: ShortcutConflictState = deriveShortcutConflicts(shortcuts)
): QuickToolMatch | null {
  if (cachedMatch?.shortcuts === shortcuts && cachedMatch.conflicts === conflicts && cachedMatch.revision === revision) return cachedMatch.match
  const match = resolveHeldQuickTool(shortcuts, heldParts, conflicts)
  cachedMatch = { shortcuts, conflicts, revision, match }
  return match
}

export function useQuickToolShortcut(shortcuts: ShortcutBindings): QuickToolMatch | null {
  const heldRevision = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  const conflicts = useMemo(() => deriveShortcutConflicts(shortcuts), [shortcuts])
  return useMemo(() => currentQuickToolMatch(shortcuts, conflicts), [conflicts, heldRevision, shortcuts])
}
