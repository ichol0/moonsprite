import { memo, useEffect, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { GripVertical } from 'lucide-react'
import { PerformanceProfiler } from '@/components/PerformanceProfiler'
import { toolRailRenderKey } from '@/core/app-render-keys'
import { useWorkspace } from '@/store/workspace'
import { PixelAssetIcon, PixelShapeIcon, SELECTION_KIND_ICONS, TOOL_DEFINITIONS } from './editor-tools'

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
  const state = useWorkspace.getState()
  const session = state.sessions.find((item) => item.document.id === state.activeId) ?? null

  useEffect(() => {
    const closeOutside = (event: PointerEvent): void => {
      if (event.target instanceof Element && !event.target.closest('.tool-slot')) {
        setShapeFlyoutOpen(false)
        setSelectionFlyoutOpen(false)
      }
    }
    const closeAll = (): void => {
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

  return <PerformanceProfiler id="EditorToolRail"><aside className={`tool-rail side-${side}`} aria-label="工具栏">
    <button className="tool-rail-grip" type="button" aria-label="移动工具栏" title="拖动工具栏到左侧或右侧" onPointerDown={onGripPointerDown}><GripVertical size={14} /></button>
    {TOOL_DEFINITIONS.map((tool) => {
      const displayedIcon = tool.id === 'selection' ? SELECTION_KIND_ICONS[session.selectionKind] : tool.icon
      const openToolFlyout = (): void => {
        workspace.setTool(tool.id)
        setShapeFlyoutOpen(tool.id === 'shape' ? !shapeFlyoutOpen : false)
        setSelectionFlyoutOpen(tool.id === 'selection' ? !selectionFlyoutOpen : false)
      }
      return <div className="tool-slot" key={tool.id}>
        <button className={session.tool === tool.id ? 'selected' : ''} aria-label={tool.label} title={`${tool.label} (${tool.key})`} onClick={openToolFlyout}>
          <PixelAssetIcon src={displayedIcon} className="rail-tool-icon" />
          <small>{tool.key}</small>
        </button>
        {tool.id === 'selection' && selectionFlyoutOpen && <div className="tool-flyout selection-flyout" role="dialog" aria-label="选择选区方式">
          <button className={session.selectionKind === 'rectangle' ? 'selected' : ''} title="矩形选区" aria-label="矩形选区" onClick={() => { workspace.setSelectionKind('rectangle'); setSelectionFlyoutOpen(false) }}><PixelAssetIcon src={SELECTION_KIND_ICONS.rectangle} /></button>
          <button className={session.selectionKind === 'ellipse' ? 'selected' : ''} title="椭圆选区 (Shift+M)" aria-label="椭圆选区" onClick={() => { workspace.setSelectionKind('ellipse'); setSelectionFlyoutOpen(false) }}><PixelAssetIcon src={SELECTION_KIND_ICONS.ellipse} /></button>
          <button className={session.selectionKind === 'lasso' ? 'selected' : ''} title="套索选区 (Q)" aria-label="套索选区" onClick={() => { workspace.setSelectionKind('lasso'); setSelectionFlyoutOpen(false) }}><PixelAssetIcon src={SELECTION_KIND_ICONS.lasso} /></button>
          <button className={session.selectionKind === 'magic' ? 'selected' : ''} title="魔棒选区" aria-label="魔棒选区" onClick={() => { workspace.setSelectionKind('magic'); setSelectionFlyoutOpen(false) }}><PixelAssetIcon src={SELECTION_KIND_ICONS.magic} /></button>
        </div>}
        {tool.id === 'shape' && shapeFlyoutOpen && <div className="tool-flyout shape-flyout" role="dialog" aria-label="快速选择形状">
          <button className={session.shapeKind === 'rectangle' ? 'selected' : ''} title="矩形" aria-label="矩形" onClick={() => { workspace.setShapeKind('rectangle'); setShapeFlyoutOpen(false) }}><PixelShapeIcon kind="rectangle" /></button>
          <button className={session.shapeKind === 'ellipse' ? 'selected' : ''} title="圆形" aria-label="圆形" onClick={() => { workspace.setShapeKind('ellipse'); setShapeFlyoutOpen(false) }}><PixelShapeIcon kind="ellipse" /></button>
        </div>}
      </div>
    })}
  </aside></PerformanceProfiler>
})
