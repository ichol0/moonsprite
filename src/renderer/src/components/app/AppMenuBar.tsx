import { Check, ChevronRight, FileOutput, FolderOpen, Plus, Save } from 'lucide-react'
import type { ToolRailSide, WorkspacePanelId } from '@shared/types'
import type { AdjustmentKind } from '@/core/adjustments'
import { APP_CHANNEL_LABEL } from '@/core/app-meta'
import { useWorkspace } from '@/store/workspace'
import moonspriteLogo from '@/assets/moonsprite-logo.svg'
import { PerformanceProfiler } from '@/components/PerformanceProfiler'
import { appMenuRenderKey } from '@/core/app-render-keys'
import { nextTopMenuOnHover, TOP_MENU_IDS } from '@/core/menu-behavior'
import type { RecentProject } from '@/core/home-history'

interface AppMenuBarProps {
  openMenu: string | null
  setOpenMenu: (menu: string | null) => void
  shortcutFor: (id: string) => string
  homeOpen: boolean
  panelVisibility: Record<WorkspacePanelId, boolean>
  toolRailSide: ToolRailSide
  advancedModeActive: boolean
  recentFiles: RecentProject[]
  onHome: () => void
  onNew: () => void
  onOpen: () => void
  onOpenRecent: (filePath: string) => void
  onSaveAs: () => void
  onExport: () => void
  onOpenProjectFolder: (documentId: string) => void
  onOpenOutline: () => void
  onOpenAdjustment: (kind: AdjustmentKind) => void
  onOpenShortcuts: () => void
  onOpenPreferences: () => void
  onOpenCanvasResize: () => void
  onOpenImageResize: () => void
  onToggleMirror: (axis: 'horizontal' | 'vertical') => void
  onTogglePanel: (id: WorkspacePanelId) => void
  onToolRailSideChange: (side: ToolRailSide) => void
  onCycleAdvancedMode: () => void
  onOpenComponentLibrary: () => void
  onOpenAbout: () => void
}

export function AppMenuBar({
  openMenu,
  setOpenMenu,
  shortcutFor,
  homeOpen,
  panelVisibility,
  toolRailSide,
  advancedModeActive,
  recentFiles,
  onHome,
  onNew,
  onOpen,
  onOpenRecent,
  onSaveAs,
  onExport,
  onOpenProjectFolder,
  onOpenOutline,
  onOpenAdjustment,
  onOpenShortcuts,
  onOpenPreferences,
  onOpenCanvasResize,
  onOpenImageResize,
  onToggleMirror,
  onTogglePanel,
  onToolRailSideChange,
  onCycleAdvancedMode,
  onOpenComponentLibrary,
  onOpenAbout
}: AppMenuBarProps) {
  const renderKey = useWorkspace((state) => appMenuRenderKey(state.sessions.find((item) => item.document.id === state.activeId) ?? null))
  const state = useWorkspace.getState()
  const session = state.sessions.find((item) => item.document.id === state.activeId) ?? null
  const workspace = useWorkspace.getState()
  void renderKey
  const closeMenu = (): void => setOpenMenu(null)
  const toggleMenu = (menu: string): void => setOpenMenu(openMenu === menu ? null : menu)
  const hoverMenuAt = (index: number): void => {
    const hoveredMenu = TOP_MENU_IDS[index]
    if (!hoveredMenu) return
    const next = nextTopMenuOnHover(openMenu, hoveredMenu)
    if (next !== openMenu) setOpenMenu(next)
  }
  const shortcutHint = (id: string) => {
    const shortcut = shortcutFor(id)
    return shortcut ? <kbd>{shortcut}</kbd> : null
  }
  const openAdjustment = (kind: AdjustmentKind): void => {
    onOpenAdjustment(kind)
    closeMenu()
  }

  return <PerformanceProfiler id="AppMenuBar"><header className="topbar">
    <button className="brand" title="返回首页" aria-label="返回 MoonSprite 首页" onClick={() => { onHome(); closeMenu() }}><img className="brand-logo" src={moonspriteLogo} alt="" aria-hidden="true" /><span>MOONSPRITE</span><small>{APP_CHANNEL_LABEL}</small></button>
    <nav className="menu-strip" aria-label="主菜单" onPointerOver={(event) => { const button = (event.target as HTMLElement).closest('button[aria-expanded]'); const item = button?.parentElement; if (item?.parentElement !== event.currentTarget) return; hoverMenuAt(Array.from(event.currentTarget.children).indexOf(item)) }}>
      <div className="menu-item"><button aria-expanded={openMenu === 'file'} onClick={() => toggleMenu('file')}>文件</button>{openMenu === 'file' && <div className="menu-popover"><button onClick={() => { onNew(); closeMenu() }}>新建 <kbd>{shortcutFor('newDocument')}</kbd></button><button onClick={() => { onOpen(); closeMenu() }}>打开 <kbd>{shortcutFor('openDocument')}</kbd></button><div className="menu-submenu"><button className="menu-submenu-trigger">最近打开文件 <ChevronRight size={14} /></button><div className="menu-popover menu-submenu-popover recent-files-submenu">{recentFiles.length === 0 ? <button disabled>没有最近文件</button> : recentFiles.map((recent) => <button key={recent.filePath} title={recent.filePath} onClick={() => { onOpenRecent(recent.filePath); closeMenu() }}>{recent.fileName}</button>)}</div></div><span className="menu-divider" /><button disabled={!session} onClick={() => { void workspace.saveActive(); closeMenu() }}>保存 <kbd>{shortcutFor('save')}</kbd></button><button disabled={!session} onClick={() => { onSaveAs(); closeMenu() }}>另存为 <kbd>{shortcutFor('saveAs')}</kbd></button><button disabled={!session} onClick={() => { onExport(); closeMenu() }}>导出 <kbd>{shortcutFor('exportDocument')}</kbd></button><button disabled={!session?.document.filePath && !session?.document.sourceFilePath} onClick={() => { if (session) onOpenProjectFolder(session.document.id); closeMenu() }}>在文件夹中打开{shortcutHint('openProjectFolder')}</button></div>}</div>
      <div className="menu-item"><button aria-expanded={openMenu === 'edit'} onClick={() => toggleMenu('edit')}>编辑</button>{openMenu === 'edit' && <div className="menu-popover"><button disabled={!session?.history.canUndo} onClick={() => { workspace.undo(); closeMenu() }}>撤销 <kbd>{shortcutFor('undo')}</kbd></button><button disabled={!session?.history.canRedo} onClick={() => { workspace.redo(); closeMenu() }}>重做 <kbd>{shortcutFor('redo')}</kbd></button><div className="menu-submenu"><button className="menu-submenu-trigger">选择性粘贴 <ChevronRight size={14} /></button><div className="menu-popover menu-submenu-popover"><button onClick={() => { void workspace.pasteAsNewDocument(); closeMenu() }}>粘贴为新项目{shortcutHint('pasteAsNewDocument')}</button><button disabled={!session} onClick={() => { void workspace.pasteAsNewLayer(); closeMenu() }}>粘贴为新图层{shortcutHint('pasteAsNewLayer')}</button></div></div><button disabled={!session || Boolean(session.selectedGroupId) || session.selectedLayerIds.length !== 1} onClick={() => { workspace.beginLayerTransform(); closeMenu() }}>变换 <kbd>{shortcutFor('transform')}</kbd></button><button disabled={!session?.selection} onClick={() => { workspace.deleteSelection(); closeMenu() }}>删除选区 <kbd>{shortcutFor('deleteLayer')}</kbd></button><button disabled={!session?.selection} onClick={() => { onOpenOutline(); closeMenu() }}>选区描边 <kbd>{shortcutFor('outline')}</kbd></button><button disabled={!session?.selection} onClick={() => { workspace.invertSelection(); closeMenu() }}>反选选区{shortcutHint('invertSelection')}</button><button disabled={!session?.selection} onClick={() => { if (session?.selection) workspace.commitSelectionChange(session.selection, null, '取消选区'); closeMenu() }}>取消选择 <kbd>{shortcutFor('deselect')}</kbd></button><span className="menu-divider" /><div className="menu-submenu"><button className="menu-submenu-trigger" disabled={!session}>调整 <ChevronRight size={14} /></button><div className="menu-popover menu-submenu-popover"><button onClick={() => openAdjustment('color-balance')}>色彩平衡{shortcutHint('adjustmentColorBalance')}</button><button onClick={() => openAdjustment('brightness-contrast')}>亮度/对比度{shortcutHint('adjustmentBrightnessContrast')}</button><button onClick={() => openAdjustment('hue-saturation')}>色相/饱和度{shortcutHint('adjustmentHueSaturation')}</button><button onClick={() => openAdjustment('curves')}>曲线{shortcutHint('adjustmentCurves')}</button></div></div><span className="menu-divider" /><button onClick={() => { onOpenShortcuts(); closeMenu() }}>快捷键设置{shortcutHint('openShortcutSettings')}</button><button onClick={() => { onOpenPreferences(); closeMenu() }}>首选项{shortcutHint('openPreferences')}</button></div>}</div>
      <div className="menu-item"><button aria-expanded={openMenu === 'canvas'} onClick={() => toggleMenu('canvas')}>图像</button>{openMenu === 'canvas' && <div className="menu-popover"><button disabled={!session} onClick={() => { onOpenCanvasResize(); closeMenu() }}>调整画布尺寸 <kbd>{shortcutFor('canvasResize')}</kbd></button><button disabled={!session} onClick={() => { onOpenImageResize(); closeMenu() }}>调整图像尺寸 <kbd>{shortcutFor('imageResize')}</kbd></button><button disabled={!session} onClick={() => { if (session) void workspace.convertColorMode(session.document.colorMode === 'rgba' ? 'indexed' : 'rgba'); closeMenu() }}>{session?.document.colorMode === 'rgba' ? '转换为索引模式' : '转换为 RGBA 模式'}{shortcutHint('convertColorMode')}</button></div>}</div>
      <div className="menu-item"><button aria-expanded={openMenu === 'layer'} onClick={() => toggleMenu('layer')}>图层</button>{openMenu === 'layer' && <div className="menu-popover"><button disabled={!session} onClick={() => { void workspace.addLayer(); closeMenu() }}>新建图层{shortcutHint('newLayer')}</button><button disabled={!session} onClick={() => { workspace.createLayerGroup(); closeMenu() }}>新建图层组 <kbd>{shortcutFor('createLayerGroup')}</kbd></button><button disabled={!session || Boolean(session.selectedGroupId)} onClick={() => { workspace.duplicateActiveLayer(); closeMenu() }}>复制图层{shortcutHint('duplicateLayer')}</button><button disabled={!session || Boolean(session.selectedGroupId)} onClick={() => { workspace.mergeActiveLayerDown(); closeMenu() }}>向下合并{shortcutHint('mergeLayerDown')}</button><button disabled={!session || Boolean(session.selectedGroupId) || session.selectedLayerIds.length < 2} onClick={() => { workspace.mergeSelectedLayers(); closeMenu() }}>合并所选图层{shortcutHint('mergeSelectedLayers')}</button><button disabled={!session?.selectedGroupId} onClick={() => { workspace.mergeSelectedGroup(); closeMenu() }}>合并图层组{shortcutHint('mergeLayerGroup')}</button><button disabled={!session || session.document.layers.length < 2} onClick={() => { workspace.mergeVisibleLayers(); closeMenu() }}>合并可见图层{shortcutHint('mergeVisibleLayers')}</button><button disabled={!session?.selectedGroupId} onClick={() => { workspace.ungroupSelected(); closeMenu() }}>解组 <kbd>{shortcutFor('ungroupLayers')}</kbd></button><button disabled={!session?.selection} onClick={() => { workspace.toggleSelectionOutline(); closeMenu() }}>{session?.view.showSelectionOutline === false ? '显示蚂蚁线' : '隐藏蚂蚁线'}{shortcutHint('toggleSelectionOutline')}<span className="menu-check">{session?.view.showSelectionOutline === false && <Check size={14} />}</span></button></div>}</div>
      <div className="menu-item"><button aria-expanded={openMenu === 'window'} onClick={() => toggleMenu('window')}>窗口</button>{openMenu === 'window' && <div className="menu-popover">
        <button disabled={!session} onClick={() => { workspace.toggleGrid(); closeMenu() }}>显示像素网格{shortcutHint('toggleGrid')}<span className="menu-check">{session?.view.showGrid && <Check size={14} />}</span></button>
        <button disabled={!session} onClick={() => { if (session) workspace.setView({ relativeLuminance: !session.view.relativeLuminance }); closeMenu() }}>查看相对明暗 <kbd>{shortcutFor('relativeLuminance')}</kbd><span className="menu-check">{session?.view.relativeLuminance && <Check size={14} />}</span></button>
        <span className="menu-divider" />
        <div className="menu-submenu"><button className="menu-submenu-trigger" disabled={!session}>旋转视图 <ChevronRight size={14} /></button><div className="menu-popover menu-submenu-popover"><button disabled={!session} onClick={() => { if (session) workspace.setView({ rotation: (session.view.rotation + 90) % 360 }); closeMenu() }}>顺时针旋转 90°{shortcutHint('rotateViewClockwise90')}</button><button disabled={!session} onClick={() => { if (session) workspace.setView({ rotation: (session.view.rotation + 270) % 360 }); closeMenu() }}>逆时针旋转 90°{shortcutHint('rotateViewCounterClockwise90')}</button></div></div>
        <div className="menu-submenu"><button className="menu-submenu-trigger" disabled={!session}>镜像视图 <ChevronRight size={14} /></button><div className="menu-popover menu-submenu-popover"><button disabled={!session} onClick={() => { onToggleMirror('horizontal'); closeMenu() }}>水平镜像 <kbd>{shortcutFor('mirrorView')}</kbd><span className="menu-check">{session?.view.mirrored && <Check size={14} />}</span></button><button disabled={!session} onClick={() => { onToggleMirror('vertical'); closeMenu() }}>垂直镜像 <kbd>{shortcutFor('mirrorViewVertical')}</kbd><span className="menu-check">{session?.view.mirroredVertical && <Check size={14} />}</span></button></div></div>
        <button disabled={!session} onClick={() => { if (session) workspace.setView({ zoom: 16, panX: 0, panY: 0, rotation: 0, mirrored: false, mirroredVertical: false }); closeMenu() }}>复位视图{shortcutHint('resetView')}</button>
        <span className="menu-divider" />
        <div className="menu-submenu"><button className="menu-submenu-trigger" disabled={!session}>栏目 <ChevronRight size={14} /></button><div className="menu-popover menu-submenu-popover">{([['color', '颜色', 'toggleColorPanel'], ['palette', '调色板', 'togglePalettePanel'], ['layers', '图层', 'toggleLayersPanel'], ['preview', '预览', 'togglePreviewPanel']] as Array<[WorkspacePanelId, string, string]>).map(([id, label, shortcutId]) => <button key={id} disabled={!session} onClick={() => { onTogglePanel(id); closeMenu() }}>{label}{shortcutHint(shortcutId)}<span className="menu-check">{panelVisibility[id] && <Check size={14} />}</span></button>)}</div></div>
        <div className="menu-submenu"><button className="menu-submenu-trigger" disabled={!session}>工具栏位置 <ChevronRight size={14} /></button><div className="menu-popover menu-submenu-popover"><button disabled={!session} onClick={() => { onToolRailSideChange('left'); closeMenu() }}>左侧{shortcutHint('toolRailLeft')}<span className="menu-check">{toolRailSide === 'left' && <Check size={14} />}</span></button><button disabled={!session} onClick={() => { onToolRailSideChange('right'); closeMenu() }}>右侧{shortcutHint('toolRailRight')}<span className="menu-check">{toolRailSide === 'right' && <Check size={14} />}</span></button></div></div>
        <span className="menu-divider" />
        <button disabled={!session} onClick={() => { if (!session || homeOpen) return; onCycleAdvancedMode(); closeMenu() }}>高级模式 <kbd>{shortcutFor('advancedMode')}</kbd><span className="menu-check">{advancedModeActive && <Check size={14} />}</span></button>
      </div>}</div>
      <div className="menu-item"><button aria-expanded={openMenu === 'help'} onClick={() => toggleMenu('help')}>帮助</button>{openMenu === 'help' && <div className="menu-popover"><button onClick={() => { onOpenComponentLibrary(); closeMenu() }}>组件库{shortcutHint('openComponentLibrary')}</button><button onClick={() => { onOpenAbout(); closeMenu() }}>关于 MoonSprite{shortcutHint('openAbout')}</button></div>}</div>
    </nav>
    <div className="top-actions"><button className="icon-button" title={`新建 ${shortcutFor('newDocument')}`} aria-label="新建" onClick={onNew}><Plus size={17} /></button><button className="icon-button" title={`打开 ${shortcutFor('openDocument')}`} aria-label="打开" onClick={onOpen}><FolderOpen size={17} /></button><button className="icon-button" title={`保存 ${shortcutFor('save')}`} aria-label="保存" disabled={!session} onClick={() => void workspace.saveActive()}><Save size={17} /></button><button className="top-export-button" title={`导出 ${shortcutFor('exportDocument')}`} disabled={!session} onClick={onExport}><FileOutput size={16} /><span>导出</span></button></div>
  </header></PerformanceProfiler>
}
