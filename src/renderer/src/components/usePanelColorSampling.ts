import { useCallback, useEffect, useState } from 'react'
import type { ToolId } from '@shared/types'
import { paletteSamplingShortcutActive } from '@/core/palette-sampling-shortcut'
import { loadShortcuts, modifierShortcutHeld } from '@/core/shortcuts'

type ModifierState = Pick<KeyboardEvent, 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>

const EMPTY_MODIFIERS: ModifierState = {
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  shiftKey: false
}

const modifierState = (event: ModifierState): ModifierState => ({
  ctrlKey: event.ctrlKey,
  metaKey: event.metaKey,
  altKey: event.altKey,
  shiftKey: event.shiftKey
})

export const panelColorSamplingActive = (
  tool: ToolId,
  modifiers: ModifierState,
  temporaryEyedropperShortcut: string,
  paletteSamplingActive = false
): boolean => tool === 'eyedropper'
  || paletteSamplingActive
  || modifierShortcutHeld(modifiers, temporaryEyedropperShortcut)

export function usePanelColorSampling(tool: ToolId): {
  active: boolean
  activeForEvent: (event: ModifierState) => boolean
} {
  const [shortcuts, setShortcuts] = useState(loadShortcuts)
  const [modifiers, setModifiers] = useState<ModifierState>(EMPTY_MODIFIERS)

  useEffect(() => {
    const updateModifiers = (event: KeyboardEvent): void => setModifiers(modifierState(event))
    const clearModifiers = (): void => setModifiers(EMPTY_MODIFIERS)
    const refreshShortcuts = (): void => setShortcuts(loadShortcuts())
    const visibilityChange = (): void => { if (document.hidden) clearModifiers() }
    window.addEventListener('keydown', updateModifiers)
    window.addEventListener('keyup', updateModifiers)
    window.addEventListener('blur', clearModifiers)
    window.addEventListener('moonsprite:shortcuts-changed', refreshShortcuts)
    document.addEventListener('visibilitychange', visibilityChange)
    return () => {
      window.removeEventListener('keydown', updateModifiers)
      window.removeEventListener('keyup', updateModifiers)
      window.removeEventListener('blur', clearModifiers)
      window.removeEventListener('moonsprite:shortcuts-changed', refreshShortcuts)
      document.removeEventListener('visibilitychange', visibilityChange)
    }
  }, [])

  const temporaryEyedropperShortcut = shortcuts.temporaryEyedropper ?? ''
  const activeForEvent = useCallback((event: ModifierState): boolean => panelColorSamplingActive(
    tool,
    event,
    temporaryEyedropperShortcut,
    paletteSamplingShortcutActive()
  ), [temporaryEyedropperShortcut, tool])

  return {
    active: panelColorSamplingActive(tool, modifiers, temporaryEyedropperShortcut, paletteSamplingShortcutActive()),
    activeForEvent
  }
}
