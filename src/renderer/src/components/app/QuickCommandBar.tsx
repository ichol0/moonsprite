import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { PixelUtilityIcon } from '@/components/PixelUtilityIcon'
import { Tooltip } from '@/components/Tooltip'
import { useI18n } from '@/components/I18nProvider'
import { loadEditorPreferences, saveEditorPreferences, type QuickCommandId, type QuickCommandPreference } from '@/core/file-preferences'
import { useWorkspace } from '@/store/workspace'
import { QUICK_COMMAND_METADATA, type QuickCommandMetadata, type QuickCommandSettingsTarget } from './quick-command-registry'

interface QuickCommandBarProps {
  documentId: string
  shortcutFor: (id: string) => string
  onToggleMirror: (axis: 'horizontal' | 'vertical') => void
  onOpenPreferences: () => void
  onOpenCommandSettings?: (target: QuickCommandSettingsTarget) => void
}

interface QuickCommandRuntime {
  disabled?: boolean
  pressed?: boolean
  run: () => void
}

type QuickCommandDefinition = QuickCommandMetadata & QuickCommandRuntime

interface QuickCommandDragState {
  pointerId: number
  startClientX: number
  startCenterX: number
  containerLeft: number
  containerWidth: number
  minCenterX: number
  maxCenterX: number
  positionX: number
}

const QUICK_COMMAND_EDGE_INSET = 8
const QUICK_COMMAND_CENTER_SNAP_DISTANCE = 12
const DEFAULT_QUICK_COMMAND_POSITION_X = 0.5

const clampHorizontalCenter = (value: number, min: number, max: number): number => min <= max
  ? Math.min(max, Math.max(min, value))
  : (min + max) / 2

const normalizeQuickCommandPosition = (value: number | undefined): number => Number.isFinite(value)
  ? Math.min(1, Math.max(0, value!))
  : DEFAULT_QUICK_COMMAND_POSITION_X

const preserveCanvasFocus = (event: ReactPointerEvent<HTMLButtonElement>): void => {
  event.preventDefault()
}

export const QuickCommandBar = memo(function QuickCommandBar({ documentId, shortcutFor, onToggleMirror, onOpenPreferences, onOpenCommandSettings }: QuickCommandBarProps) {
  const { t } = useI18n()
  const [moving, setMoving] = useState(false)
  const [edgeOffsetX, setEdgeOffsetX] = useState(0)
  const barRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<QuickCommandDragState | null>(null)
  const [preferences, setPreferences] = useState(() => {
    const current = loadEditorPreferences()
    return { enabled: current.quickCommandBarEnabled, translucent: current.quickCommandBarTranslucent, commands: current.quickCommandPreferences }
  })
  const activeId = useWorkspace((state) => state.activeId)
  const storedPositionX = useWorkspace((state) => normalizeQuickCommandPosition(state.sessions.find((item) => item.document.id === documentId)?.view.quickCommandBarPositionX))
  const expanded = useWorkspace((state) => state.sessions.find((item) => item.document.id === documentId)?.view.quickCommandBarExpanded === true)
  const visuallyExpanded = expanded && activeId === documentId
  const [positionX, setPositionX] = useState(storedPositionX)
  const positionXRef = useRef(storedPositionX)
  const renderKey = useWorkspace((state) => {
    const session = state.sessions.find((item) => item.document.id === documentId)
    return session
      ? `${session.document.id}:${session.selection ? 1 : 0}:${session.view.mirrored ? 1 : 0}:${session.view.mirroredVertical ? 1 : 0}:${session.view.showPixelGrid ? 1 : 0}:${session.view.showGrid ? 1 : 0}:${session.view.showSelectionOutline === false ? 0 : 1}:${session.view.relativeLuminance ? 1 : 0}:${session.view.tileRepeatMode ?? 'off'}:${session.history.canUndo ? 1 : 0}:${session.history.canRedo ? 1 : 0}`
      : ''
  })
  const updatePositionX = useCallback((value: number): void => {
    const normalized = normalizeQuickCommandPosition(value)
    positionXRef.current = normalized
    setPositionX(normalized)
  }, [])
  useEffect(() => {
    const syncPreferences = (): void => {
      const current = loadEditorPreferences()
      setPreferences({ enabled: current.quickCommandBarEnabled, translucent: current.quickCommandBarTranslucent, commands: current.quickCommandPreferences })
    }
    window.addEventListener('moonsprite:preferences-changed', syncPreferences)
    return () => window.removeEventListener('moonsprite:preferences-changed', syncPreferences)
  }, [])
  useEffect(() => {
    if (!preferences.enabled && expanded) useWorkspace.getState().setViewForDocument(documentId, { quickCommandBarExpanded: false })
  }, [documentId, expanded, preferences.enabled])
  useLayoutEffect(() => {
    updatePositionX(storedPositionX)
    setEdgeOffsetX(0)
  }, [documentId, storedPositionX, updatePositionX])
  const enabledCommandCount = preferences.commands.reduce((count, command) => count + (command.enabled ? 1 : 0), 0)
  const keepBarInsideCanvas = useCallback((): void => {
    const bar = barRef.current
    const container = bar?.parentElement
    if (!bar || !container) return
    const barRect = bar.getBoundingClientRect()
    const containerRect = container.getBoundingClientRect()
    if (barRect.width <= 0 || containerRect.width <= 0) return
    const targetCenterX = containerRect.left + positionXRef.current * containerRect.width
    const minCenterX = containerRect.left + QUICK_COMMAND_EDGE_INSET + barRect.width / 2
    const maxCenterX = containerRect.right - QUICK_COMMAND_EDGE_INSET - barRect.width / 2
    const visibleCenterX = clampHorizontalCenter(targetCenterX, minCenterX, maxCenterX)
    const nextOffset = Math.round((visibleCenterX - targetCenterX) * 1000) / 1000
    setEdgeOffsetX((current) => current === nextOffset ? current : nextOffset)
  }, [])
  useLayoutEffect(() => {
    if (preferences.enabled) keepBarInsideCanvas()
  }, [documentId, enabledCommandCount, keepBarInsideCanvas, positionX, preferences.enabled, visuallyExpanded])
  useEffect(() => {
    if (!preferences.enabled || typeof ResizeObserver === 'undefined') return
    const bar = barRef.current
    const container = bar?.parentElement
    if (!bar || !container) return
    const observer = new ResizeObserver(keepBarInsideCanvas)
    observer.observe(bar)
    observer.observe(container)
    return () => observer.disconnect()
  }, [documentId, keepBarInsideCanvas, preferences.enabled])
  const workspace = useWorkspace.getState()
  const session = workspace.sessions.find((item) => item.document.id === documentId) ?? null
  void renderKey
  if (!session || !preferences.enabled) return null

  const runForDocument = (run: (state: ReturnType<typeof useWorkspace.getState>) => void): void => {
    const current = useWorkspace.getState()
    if (current.activeId !== documentId) current.setActive(documentId)
    run(useWorkspace.getState())
  }
  const openCommandSettings = (event: ReactMouseEvent<HTMLButtonElement>, target: QuickCommandSettingsTarget): void => {
    event.preventDefault()
    event.stopPropagation()
    runForDocument(() => onOpenCommandSettings?.(target))
  }
  const toggleExpanded = (): void => {
    const state = useWorkspace.getState()
    const wasActive = activeId === documentId
    if (!wasActive) state.setActive(documentId)
    const nextExpanded = wasActive ? !expanded : true
    state.setViewForDocument(documentId, { quickCommandBarExpanded: nextExpanded })
    const currentPreferences = loadEditorPreferences()
    if (currentPreferences.quickCommandBarExpanded !== nextExpanded) {
      saveEditorPreferences({ ...currentPreferences, quickCommandBarExpanded: nextExpanded })
      window.dispatchEvent(new Event('moonsprite:preferences-changed'))
    }
  }
  const startMoving = (event: ReactPointerEvent<HTMLButtonElement>): void => {
    if (event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    const bar = barRef.current
    const container = bar?.parentElement
    if (!bar || !container) return
    const barRect = bar.getBoundingClientRect()
    const containerRect = container.getBoundingClientRect()
    if (barRect.width <= 0 || containerRect.width <= 0) return
    const minCenterX = containerRect.left + QUICK_COMMAND_EDGE_INSET + barRect.width / 2
    const maxCenterX = containerRect.right - QUICK_COMMAND_EDGE_INSET - barRect.width / 2
    const startCenterX = clampHorizontalCenter((barRect.left + barRect.right) / 2, minCenterX, maxCenterX)
    const startPositionX = normalizeQuickCommandPosition((startCenterX - containerRect.left) / containerRect.width)
    dragRef.current = {
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startCenterX,
      containerLeft: containerRect.left,
      containerWidth: containerRect.width,
      minCenterX,
      maxCenterX,
      positionX: startPositionX
    }
    updatePositionX(startPositionX)
    setEdgeOffsetX(0)
    event.currentTarget.setPointerCapture?.(event.pointerId)
    setMoving(true)
  }
  const moveHorizontally = (event: ReactPointerEvent<HTMLButtonElement>): void => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    event.preventDefault()
    const rawCenterX = drag.startCenterX + event.clientX - drag.startClientX
    const canvasCenterX = drag.containerLeft + drag.containerWidth / 2
    const snappedCenterX = Math.abs(rawCenterX - canvasCenterX) <= QUICK_COMMAND_CENTER_SNAP_DISTANCE ? canvasCenterX : rawCenterX
    const centerX = clampHorizontalCenter(snappedCenterX, drag.minCenterX, drag.maxCenterX)
    drag.positionX = normalizeQuickCommandPosition((centerX - drag.containerLeft) / drag.containerWidth)
    updatePositionX(drag.positionX)
    setEdgeOffsetX(0)
  }
  const finishMoving = (): void => {
    const drag = dragRef.current
    if (!drag) return
    dragRef.current = null
    setMoving(false)
    useWorkspace.getState().setViewForDocument(documentId, { quickCommandBarPositionX: drag.positionX })
  }
  const stopMoving = (event: ReactPointerEvent<HTMLButtonElement>): void => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    event.preventDefault()
    finishMoving()
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }
  const toggleTileRepeatMode = (mode: 'x' | 'y' | 'both'): void => runForDocument((state) => {
    const active = state.sessions.find((item) => item.document.id === documentId)
    state.setTileRepeatMode((active?.view.tileRepeatMode ?? 'off') === mode ? 'off' : mode)
  })

  const runtimeFor = (id: QuickCommandId): QuickCommandRuntime => {
    const selectionUnavailable = !session.selection
    switch (id) {
      case 'selectionFlipHorizontal': return { disabled: selectionUnavailable, run: () => runForDocument((state) => state.flipActiveSelection('horizontal')) }
      case 'selectionFlipVertical': return { disabled: selectionUnavailable, run: () => runForDocument((state) => state.flipActiveSelection('vertical')) }
      case 'canvasMirrorHorizontal': return { pressed: session.view.mirrored, run: () => runForDocument(() => onToggleMirror('horizontal')) }
      case 'canvasMirrorVertical': return { pressed: session.view.mirroredVertical, run: () => runForDocument(() => onToggleMirror('vertical')) }
      case 'invertSelection': return { disabled: selectionUnavailable, run: () => runForDocument((state) => state.invertSelection()) }
      case 'customGrid': return { pressed: session.view.showGrid, run: () => runForDocument((state) => state.toggleGrid()) }
      case 'tileRepeatX': return { pressed: session.view.tileRepeatMode === 'x', run: () => toggleTileRepeatMode('x') }
      case 'tileRepeatY': return { pressed: session.view.tileRepeatMode === 'y', run: () => toggleTileRepeatMode('y') }
      case 'tileRepeatBoth': return { pressed: session.view.tileRepeatMode === 'both', run: () => toggleTileRepeatMode('both') }
      case 'undo': return { disabled: !session.history.canUndo, run: () => runForDocument((state) => state.undo()) }
      case 'redo': return { disabled: !session.history.canRedo, run: () => runForDocument((state) => state.redo()) }
      case 'selectAll': return { run: () => runForDocument((state) => {
        const active = state.sessions.find((item) => item.document.id === documentId)
        if (!active) return
        state.commitFloatingPaste()
        state.setTool('selection')
        state.setSelection({ x: 0, y: 0, width: active.document.width, height: active.document.height })
      }) }
      case 'deselect': return { disabled: selectionUnavailable, run: () => runForDocument((state) => {
        const active = state.sessions.find((item) => item.document.id === documentId)
        if (!active?.selection) return
        const label = t('app.selection.cancelHistory')
        if (active.pendingPaste) state.commitFloatingPaste(label)
        else state.commitSelectionChange({ ...active.selection, mask: active.selection.mask?.slice() }, null, label)
      }) }
      case 'pixelGrid': return { pressed: Boolean(session.view.showPixelGrid), run: () => runForDocument((state) => state.togglePixelGrid()) }
      case 'selectionOutline': return { disabled: selectionUnavailable, pressed: !selectionUnavailable && session.view.showSelectionOutline !== false, run: () => runForDocument((state) => state.toggleSelectionOutline()) }
      case 'relativeLuminance': return { pressed: session.view.relativeLuminance, run: () => runForDocument((state) => {
        const active = state.sessions.find((item) => item.document.id === documentId)
        if (active) state.setView({ relativeLuminance: !active.view.relativeLuminance })
      }) }
      case 'resetView': return { run: () => runForDocument((state) => state.setView({ zoom: 16, panX: 0, panY: 0, rotation: 0, mirrored: false, mirroredVertical: false })) }
      case 'fillForeground': return { run: () => runForDocument((state) => state.fillForeground()) }
      case 'deleteSelection': return { disabled: selectionUnavailable, run: () => runForDocument((state) => state.deleteSelection()) }
      case 'swapForegroundBackground': return { run: () => runForDocument((state) => state.swapPrimarySecondaryColors()) }
      case 'createBrushFromSelection': return { disabled: selectionUnavailable, run: () => runForDocument((state) => state.createBrushFromSelection()) }
      case 'rotateViewClockwise90': return { run: () => runForDocument((state) => {
        const active = state.sessions.find((item) => item.document.id === documentId)
        if (active) state.setView({ rotation: (active.view.rotation + 90) % 360 })
      }) }
      case 'rotateViewCounterClockwise90': return { run: () => runForDocument((state) => {
        const active = state.sessions.find((item) => item.document.id === documentId)
        if (active) state.setView({ rotation: (active.view.rotation + 270) % 360 })
      }) }
    }
  }
  const commands: QuickCommandDefinition[] = preferences.commands
    .filter((item: QuickCommandPreference) => item.enabled)
    .map((item) => ({ ...QUICK_COMMAND_METADATA[item.id], ...runtimeFor(item.id) }))
  const positionPercent = Math.round(positionX * 100000) / 1000
  const style = {
    '--quick-command-actions-width': `${Math.max(1, commands.length + 2) * 28 + 5}px`,
    '--quick-command-position-x': `${positionPercent}%`,
    '--quick-command-edge-offset-x': `${edgeOffsetX}px`
  } as CSSProperties

  return <div ref={barRef} className={`quick-command-bar ${preferences.translucent ? 'translucent' : ''} ${visuallyExpanded ? 'expanded' : ''} ${moving ? 'moving' : ''}`.trim()} style={style} role="toolbar" aria-label={t('quickCommands.aria')} data-document-id={documentId} data-command-scope="canvas" data-preserve-animation-selection>
    <Tooltip className="quick-command-tooltip quick-command-toggle-tooltip" content={<><strong>{t(visuallyExpanded ? 'quickCommands.collapse' : 'quickCommands.expand')}</strong><span>{t('quickCommands.toggleDescription')}</span></>}>
      <button type="button" className="quick-command-toggle" aria-label={t(visuallyExpanded ? 'quickCommands.collapse' : 'quickCommands.expand')} aria-expanded={visuallyExpanded} onPointerDown={preserveCanvasFocus} onClick={toggleExpanded}><PixelUtilityIcon kind={visuallyExpanded ? 'up' : 'down'} /></button>
    </Tooltip>
    <div className="quick-command-actions-clip" aria-hidden={!visuallyExpanded}><div className="quick-command-actions">
        {commands.map((command) => {
          const shortcut = shortcutFor(command.shortcutId)
          return <Tooltip key={command.id} className="quick-command-tooltip" content={<><strong>{t(command.label)}</strong><span>{t(command.description)}</span>{shortcut && <small>{shortcut}</small>}</>}>
            <button type="button" className={`quick-command-button ${command.pressed ? 'selected' : ''}`} aria-label={t(command.label)} aria-pressed={command.pressed} disabled={!visuallyExpanded || command.disabled} tabIndex={visuallyExpanded ? 0 : -1} onPointerDown={preserveCanvasFocus} onClick={command.run} onContextMenu={command.settingsTarget && onOpenCommandSettings ? (event) => openCommandSettings(event, command.settingsTarget!) : undefined}><PixelUtilityIcon kind={command.icon} /></button>
          </Tooltip>
        })}
        <Tooltip className="quick-command-tooltip quick-command-settings-tooltip" content={<><strong>{t('quickCommands.settings')}</strong><span>{t('quickCommands.settingsDescription')}</span></>}>
          <button type="button" className="quick-command-button quick-command-settings" aria-label={t('quickCommands.settings')} disabled={!visuallyExpanded} tabIndex={visuallyExpanded ? 0 : -1} onPointerDown={preserveCanvasFocus} onClick={onOpenPreferences}><PixelUtilityIcon kind="properties" /></button>
        </Tooltip>
        <Tooltip className="quick-command-tooltip quick-command-move-tooltip" content={<><strong>{t('quickCommands.move')}</strong><span>{t('quickCommands.moveDescription')}</span></>}>
          <button type="button" className="quick-command-button quick-command-move" aria-label={t('quickCommands.move')} disabled={!visuallyExpanded} tabIndex={visuallyExpanded ? 0 : -1} onPointerDown={startMoving} onPointerMove={moveHorizontally} onPointerUp={stopMoving} onPointerCancel={stopMoving} onLostPointerCapture={finishMoving}><PixelUtilityIcon kind="move" /></button>
        </Tooltip>
      </div></div>
  </div>
})
