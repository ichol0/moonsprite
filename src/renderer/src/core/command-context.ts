export type EditorCommandScope = 'canvas' | 'layers' | 'palette'

export const COMMAND_SCOPE_EVENT = 'moonsprite:command-scope'

export type DeleteCommandTarget = 'selection' | 'layers' | 'palette' | null
export type CopyCommandTarget = 'selection' | 'layers' | null

export function resolveDeleteCommand(scope: EditorCommandScope, hasSelection: boolean): DeleteCommandTarget {
  if (scope === 'layers') return 'layers'
  if (scope === 'palette') return 'palette'
  return hasSelection ? 'selection' : null
}

export function resolveCopyCommand(scope: EditorCommandScope, hasSelection: boolean): CopyCommandTarget {
  if (scope === 'layers') return 'layers'
  return scope === 'canvas' && hasSelection ? 'selection' : null
}

export const shouldTriggerDeleteCommand = (configuredShortcutMatches: boolean, key: string): boolean =>
  configuredShortcutMatches || key === 'Backspace'

export const shouldHandleGlobalSelectionEnter = (outlineOpen: boolean, hasSelection: boolean): boolean =>
  !outlineOpen && hasSelection

export interface AnimationPlaybackShortcutContext {
  defaultPrevented: boolean
  repeat: boolean
  hasSession: boolean
  frameCount: number
  homeOpen: boolean
  timelineHidden: boolean
  hasSelection: boolean
  hasTextBoxTransform: boolean
  isInteractiveTarget: boolean
  hasBlockingSurface: boolean
}

export const shouldHandleAnimationPlaybackShortcut = (context: AnimationPlaybackShortcutContext): boolean =>
  !context.defaultPrevented
  && !context.repeat
  && context.hasSession
  && context.frameCount > 1
  && !context.homeOpen
  && !context.timelineHidden
  && !context.hasSelection
  && !context.hasTextBoxTransform
  && !context.isInteractiveTarget
  && !context.hasBlockingSurface
