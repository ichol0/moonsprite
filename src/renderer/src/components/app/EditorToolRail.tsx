import { memo, useEffect, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { PerformanceProfiler } from '@/components/PerformanceProfiler'
import { PixelUtilityIcon } from '@/components/PixelUtilityIcon'
import { Tooltip } from '@/components/Tooltip'
import { useI18n } from '@/components/I18nProvider'
import { toolRailRenderKey } from '@/core/app-render-keys'
import { loadShortcuts } from '@/core/shortcuts'
import { useWorkspace } from '@/store/workspace'
import { ALL_EDITOR_TOOL_ICONS, FILL_KIND_ICONS, PixelAssetIcon, SELECTION_KIND_ICONS, activeToolPresentation, fillKindDefinitions, lineKindDefinitions, moveKindDefinitions, selectionKindDefinitions, shapeKindDefinitions, toolDefinitions } from './editor-tools'

interface EditorToolRailProps {
  side: 'left' | 'right'
  onGripPointerDown: (event: ReactPointerEvent<HTMLButtonElement>) => void
}

export const EditorToolRail = memo(function EditorToolRail({ side, onGripPointerDown }: EditorToolRailProps) {
  const { locale, t } = useI18n()
  const renderKey = useWorkspace((state) => toolRailRenderKey(
    state.sessions.find((item) => item.document.id === state.activeId) ?? null
  ))
  const [shapeFlyoutOpen, setShapeFlyoutOpen] = useState(false)
  const [lineFlyoutOpen, setLineFlyoutOpen] = useState(false)
  const [selectionFlyoutOpen, setSelectionFlyoutOpen] = useState(false)
  const [fillFlyoutOpen, setFillFlyoutOpen] = useState(false)
  const [moveFlyoutOpen, setMoveFlyoutOpen] = useState(false)
  const [shortcuts, setShortcuts] = useState(() => loadShortcuts())
  const state = useWorkspace.getState()
  const session = state.sessions.find((item) => item.document.id === state.activeId) ?? null

  useEffect(() => {
    const refreshShortcuts = (): void => setShortcuts(loadShortcuts())
    window.addEventListener('moonsprite:shortcuts-changed', refreshShortcuts)
    return () => window.removeEventListener('moonsprite:shortcuts-changed', refreshShortcuts)
  }, [])

  useEffect(() => {
    const closeOutside = (event: PointerEvent): void => {
      if (event.target instanceof Element && !event.target.closest('.tool-slot')) {
        setShapeFlyoutOpen(false)
        setLineFlyoutOpen(false)
        setSelectionFlyoutOpen(false)
        setFillFlyoutOpen(false)
        setMoveFlyoutOpen(false)
      }
    }
    const closeAll = (event: Event): void => {
      const target = (event as CustomEvent<{ target?: string }>).detail?.target
      if (target && target !== 'popover') return
      setShapeFlyoutOpen(false)
      setLineFlyoutOpen(false)
      setSelectionFlyoutOpen(false)
      setFillFlyoutOpen(false)
      setMoveFlyoutOpen(false)
    }
    window.addEventListener('pointerdown', closeOutside, true)
    window.addEventListener('moonsprite:close-dialog', closeAll)
    return () => {
      window.removeEventListener('pointerdown', closeOutside, true)
      window.removeEventListener('moonsprite:close-dialog', closeAll)
    }
  }, [])

  useEffect(() => {
    if (session?.tool !== 'shape') setShapeFlyoutOpen(false)
    if (session?.tool !== 'line') setLineFlyoutOpen(false)
    if (session?.tool !== 'selection') setSelectionFlyoutOpen(false)
    if (session?.tool !== 'fill') setFillFlyoutOpen(false)
    if (session?.tool !== 'move') setMoveFlyoutOpen(false)
    const focused = document.activeElement
    if (focused instanceof HTMLElement && focused.closest('.tool-rail')) focused.blur()
  }, [renderKey, session?.tool])

  if (!session) return null
  const workspace = useWorkspace.getState()
  const tools = toolDefinitions(locale)
  const selectionKinds = selectionKindDefinitions(locale)
  const shapeKinds = shapeKindDefinitions(locale)
  const lineKinds = lineKindDefinitions(locale)
  const fillKinds = fillKindDefinitions(locale)
  const moveKinds = moveKindDefinitions(locale)
  const fillKind = session.fillKind ?? 'bucket'
  const flyoutTooltip = (label: string, description: string, shortcut: string) => <><strong>{label}</strong><span>{description}</span><small>{t('tools.shortcut', { shortcut: shortcut || t('common.unset') })}</small></>

  return <PerformanceProfiler id="EditorToolRail"><aside className={`tool-rail side-${side}`} aria-label={t('tools.toolbar')}>
    <span className="tool-icon-preload" aria-hidden="true">
      {ALL_EDITOR_TOOL_ICONS.map((source) => <PixelAssetIcon key={source} src={source} />)}
    </span>
    <button className="tool-rail-grip" type="button" aria-label={t('tools.moveToolbar')} title={t('tools.moveToolbarHint')} onPointerDown={onGripPointerDown}><PixelUtilityIcon kind="move" /></button>
    {tools.map((tool) => {
      const presentation = activeToolPresentation(tool.id, session.selectionKind, session.shapeKind, locale, fillKind, session.lineKind, session.moveKind)
      const shortcut = shortcuts[presentation.shortcutId] ?? ''
      const openToolFlyout = (): void => {
        workspace.setTool(tool.id)
        setShapeFlyoutOpen(tool.id === 'shape' ? !shapeFlyoutOpen : false)
        setLineFlyoutOpen(tool.id === 'line' ? !lineFlyoutOpen : false)
        setSelectionFlyoutOpen(tool.id === 'selection' ? !selectionFlyoutOpen : false)
        setFillFlyoutOpen(tool.id === 'fill' ? !fillFlyoutOpen : false)
        setMoveFlyoutOpen(tool.id === 'move' ? !moveFlyoutOpen : false)
      }
      return <div className="tool-slot" key={tool.id}>
        <Tooltip className="rail-tool-tooltip" content={flyoutTooltip(presentation.label, presentation.description, shortcut)}><button className={session.tool === tool.id ? 'selected' : ''} aria-label={presentation.label} onClick={openToolFlyout}>
          <PixelAssetIcon src={presentation.icon} className="rail-tool-icon" />
          <small>{shortcut}</small>
        </button></Tooltip>
        {tool.id === 'selection' && selectionFlyoutOpen && <div className="tool-flyout selection-flyout" role="dialog" aria-label={t('tools.chooseSelectionTool')}>
          {selectionKinds.map((definition) => <Tooltip key={definition.id} className="tool-flyout-tooltip" content={flyoutTooltip(definition.label, definition.description, shortcuts[definition.shortcutId] ?? '')}><button className={session.selectionKind === definition.id ? 'selected' : ''} aria-label={definition.label} onClick={() => { workspace.setSelectionKind(definition.id); setSelectionFlyoutOpen(false) }}><PixelAssetIcon src={SELECTION_KIND_ICONS[definition.id]} /></button></Tooltip>)}
        </div>}
        {tool.id === 'move' && moveFlyoutOpen && <div className="tool-flyout move-flyout" role="dialog" aria-label={t('tools.chooseMoveTool')}>
          {moveKinds.map((definition) => <Tooltip key={definition.id} className="tool-flyout-tooltip" content={flyoutTooltip(definition.label, definition.description, shortcuts[definition.shortcutId] ?? '')}><button className={session.moveKind === definition.id ? 'selected' : ''} aria-label={definition.label} onClick={() => { workspace.setTool('move'); workspace.setMoveKind(definition.id); setMoveFlyoutOpen(false) }}><PixelAssetIcon src={definition.icon} /></button></Tooltip>)}
        </div>}
        {tool.id === 'shape' && shapeFlyoutOpen && <div className="tool-flyout shape-flyout" role="dialog" aria-label={t('tools.chooseShape')}>
          {shapeKinds.map((definition) => <Tooltip key={definition.id} className="tool-flyout-tooltip" content={flyoutTooltip(definition.label, definition.description, t('tools.shapeShortcut', { shortcut: shortcuts[definition.shortcutId] || t('common.unset') }))}><button className={session.shapeKind === definition.id ? 'selected' : ''} aria-label={definition.label} onClick={() => { workspace.setShapeKind(definition.id); setShapeFlyoutOpen(false) }}><PixelAssetIcon src={definition.icon} /></button></Tooltip>)}
        </div>}
        {tool.id === 'line' && lineFlyoutOpen && <div className="tool-flyout line-flyout" role="dialog" aria-label={t('tools.chooseLineTool')}>
          {lineKinds.map((definition) => <Tooltip key={definition.id} className="tool-flyout-tooltip" content={flyoutTooltip(definition.label, definition.description, shortcuts[definition.shortcutId] ?? '')}><button className={session.lineKind === definition.id ? 'selected' : ''} aria-label={definition.label} onClick={() => { workspace.setTool('line'); workspace.setLineKind(definition.id); setLineFlyoutOpen(false) }}><PixelAssetIcon src={definition.icon} /></button></Tooltip>)}
        </div>}
        {tool.id === 'fill' && fillFlyoutOpen && <div className="tool-flyout fill-flyout" role="dialog" aria-label={t('tools.chooseFillTool')}>
          {fillKinds.map((definition) => <Tooltip key={definition.id} className="tool-flyout-tooltip" content={flyoutTooltip(definition.label, definition.description, shortcuts[definition.shortcutId] ?? '')}><button className={fillKind === definition.id ? 'selected' : ''} aria-label={definition.label} onClick={() => { workspace.setFillKind(definition.id); setFillFlyoutOpen(false) }}><PixelAssetIcon src={FILL_KIND_ICONS[definition.id]} /></button></Tooltip>)}
        </div>}
      </div>
    })}
  </aside></PerformanceProfiler>
})
