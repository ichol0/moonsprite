import { memo, useEffect, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { GripVertical } from 'lucide-react'
import { PerformanceProfiler } from '@/components/PerformanceProfiler'
import { Tooltip } from '@/components/Tooltip'
import { toolRailRenderKey } from '@/core/app-render-keys'
import { loadShortcuts } from '@/core/shortcuts'
import { useWorkspace } from '@/store/workspace'
import { ALL_EDITOR_TOOL_ICONS, PixelAssetIcon, SELECTION_KIND_DEFINITIONS, SELECTION_KIND_ICONS, SHAPE_KIND_DEFINITIONS, TOOL_DEFINITIONS, activeToolPresentation } from './editor-tools'

interface EditorToolRailProps {
  side: 'left' | 'right'
  onGripPointerDown: (event: ReactPointerEvent<HTMLButtonElement>) => void
}

export const EditorToolRail = memo(function EditorToolRail({ side, onGripPointerDown }: EditorToolRailProps) {
  const renderKey = useWorkspace((state) => toolRailRenderKey(
    state.sessions.find((item) => item.document.id === state.activeId) ?? null
  ))
  const [shapeFlyoutOpen, setShapeFlyoutOpen] = useState(false)
  const [selectionFlyoutOpen, setSelectionFlyoutOpen] = useState(false)
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
        setSelectionFlyoutOpen(false)
      }
    }
    const closeAll = (event: Event): void => {
      const target = (event as CustomEvent<{ target?: string }>).detail?.target
      if (target && target !== 'popover') return
      setShapeFlyoutOpen(false)
      setSelectionFlyoutOpen(false)
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
    if (session?.tool !== 'selection') setSelectionFlyoutOpen(false)
    const focused = document.activeElement
    if (focused instanceof HTMLElement && focused.closest('.tool-rail')) focused.blur()
  }, [renderKey, session?.tool])

  if (!session) return null
  const workspace = useWorkspace.getState()
  const flyoutTooltip = (label: string, description: string, shortcut: string) => <><strong>{label}</strong><span>{description}</span><small>快捷键：{shortcut || '未设置'}</small></>

  return <PerformanceProfiler id="EditorToolRail"><aside className={`tool-rail side-${side}`} aria-label="工具栏">
    <span className="tool-icon-preload" aria-hidden="true">
      {ALL_EDITOR_TOOL_ICONS.map((source) => <img key={source} src={source} alt="" decoding="sync" draggable={false} />)}
    </span>
    <button className="tool-rail-grip" type="button" aria-label="移动工具栏" title="拖动工具栏到左侧或右侧" onPointerDown={onGripPointerDown}><GripVertical size={14} /></button>
    {TOOL_DEFINITIONS.map((tool) => {
      const presentation = activeToolPresentation(tool.id, session.selectionKind, session.shapeKind)
      const shortcut = shortcuts[presentation.shortcutId] ?? ''
      const openToolFlyout = (): void => {
        workspace.setTool(tool.id)
        setShapeFlyoutOpen(tool.id === 'shape' ? !shapeFlyoutOpen : false)
        setSelectionFlyoutOpen(tool.id === 'selection' ? !selectionFlyoutOpen : false)
      }
      return <div className="tool-slot" key={tool.id}>
        <Tooltip className="rail-tool-tooltip" content={flyoutTooltip(presentation.label, presentation.description, shortcut)}><button className={session.tool === tool.id ? 'selected' : ''} aria-label={presentation.label} onClick={openToolFlyout}>
          <PixelAssetIcon src={presentation.icon} className="rail-tool-icon" />
          <small>{shortcut}</small>
        </button></Tooltip>
        {tool.id === 'selection' && selectionFlyoutOpen && <div className="tool-flyout selection-flyout" role="dialog" aria-label="选择选区方式">
          {SELECTION_KIND_DEFINITIONS.map((definition) => <Tooltip key={definition.id} className="tool-flyout-tooltip" content={flyoutTooltip(definition.label, definition.description, shortcuts[definition.shortcutId] ?? '')}><button className={session.selectionKind === definition.id ? 'selected' : ''} aria-label={definition.label} onClick={() => { workspace.setSelectionKind(definition.id); setSelectionFlyoutOpen(false) }}><PixelAssetIcon src={SELECTION_KIND_ICONS[definition.id]} /></button></Tooltip>)}
        </div>}
        {tool.id === 'shape' && shapeFlyoutOpen && <div className="tool-flyout shape-flyout" role="dialog" aria-label="快速选择形状">
          {SHAPE_KIND_DEFINITIONS.map((definition) => <Tooltip key={definition.id} className="tool-flyout-tooltip" content={flyoutTooltip(definition.label, definition.description, `${shortcuts[definition.shortcutId] || '未设置'}（进入形状工具）`)}><button className={session.shapeKind === definition.id ? 'selected' : ''} aria-label={definition.label} onClick={() => { workspace.setShapeKind(definition.id); setShapeFlyoutOpen(false) }}><PixelAssetIcon src={definition.icon} /></button></Tooltip>)}
        </div>}
      </div>
    })}
  </aside></PerformanceProfiler>
})
