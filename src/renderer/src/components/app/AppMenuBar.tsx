import { Plus } from 'lucide-react'
import type { ReactNode } from 'react'
import type { ColorMode, ToolRailSide, WorkspacePanelId } from '@shared/types'
import type { AdjustmentKind } from '@/core/adjustments'
import { APP_CHANNEL_LABEL } from '@/core/app-meta'
import { useWorkspace } from '@/store/workspace'
import moonspriteLogo from '@/assets/moonsprite-logo.svg'
import { PerformanceProfiler } from '@/components/PerformanceProfiler'
import { useI18n } from '@/components/I18nProvider'
import { appMenuRenderKey } from '@/core/app-render-keys'
import { nextTopMenuOnHover, TOP_MENU_IDS } from '@/core/menu-behavior'
import type { RecentProject } from '@/core/home-history'
import { PixelRightIcon as ChevronRight, PixelUtilityIcon } from '@/components/PixelUtilityIcon'

const Check = (_props: { size?: number }) => <PixelUtilityIcon kind="check" />

function SubmenuTrigger({ children, disabled = false }: { children: ReactNode; disabled?: boolean }) {
  return <button className="menu-submenu-trigger" disabled={disabled}>
    <span className="menu-submenu-label">{children}</span>
    <span className="menu-submenu-arrow" aria-hidden="true"><ChevronRight /></span>
  </button>
}

interface AppMenuBarProps {
  openMenu: string | null
  setOpenMenu: (menu: string | null) => void
  shortcutFor: (id: string) => string
  homeOpen: boolean
  panelVisibility: Record<WorkspacePanelId, boolean>
  timelineHidden: boolean
  sliceOutlinesVisible: boolean
  toolRailSide: ToolRailSide
  advancedModeActive: boolean
  recentFiles: RecentProject[]
  onHome: () => void
  onNew: () => void
  onOpen: () => void
  onOpenRecent: (filePath: string) => void
  onSaveAs: () => void
  onExport: () => void
  onExportAllFrames: () => void
  onOpenTimelapse: () => void
  onOpenProjectInfo: () => void
  onOpenProjectFolder: (documentId: string) => void
  onOpenOutline: () => void
  onOpenColorReplacement: () => void
  onOpenAdjustment: (kind: AdjustmentKind) => void
  onOpenShortcuts: () => void
  onOpenPreferences: () => void
  onOpenCanvasResize: () => void
  onOpenImageResize: () => void
  onOpenGridSettings: () => void
  onToggleMirror: (axis: 'horizontal' | 'vertical') => void
  onTogglePanel: (id: WorkspacePanelId) => void
  onToggleTimeline: () => void
  onToggleSliceOutlines: () => void
  onToolRailSideChange: (side: ToolRailSide) => void
  onCycleAdvancedMode: () => void
  onOpenComponentLibrary: () => void
  onOpenRoadmap: () => void
  onOpenLatestRelease: () => void
  onOpenAbout: () => void
}

export function AppMenuBar({
  openMenu,
  setOpenMenu,
  shortcutFor,
  homeOpen,
  panelVisibility,
  timelineHidden,
  sliceOutlinesVisible,
  toolRailSide,
  advancedModeActive,
  recentFiles,
  onHome,
  onNew,
  onOpen,
  onOpenRecent,
  onSaveAs,
  onExport,
  onExportAllFrames,
  onOpenTimelapse,
  onOpenProjectInfo,
  onOpenProjectFolder,
  onOpenOutline,
  onOpenColorReplacement,
  onOpenAdjustment,
  onOpenShortcuts,
  onOpenPreferences,
  onOpenCanvasResize,
  onOpenImageResize,
  onOpenGridSettings,
  onToggleMirror,
  onTogglePanel,
  onToggleTimeline,
  onToggleSliceOutlines,
  onToolRailSideChange,
  onCycleAdvancedMode,
  onOpenComponentLibrary,
  onOpenRoadmap,
  onOpenLatestRelease,
  onOpenAbout
}: AppMenuBarProps) {
  const { t } = useI18n()
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
  const colorModes: ColorMode[] = ['rgba', 'indexed', 'grayscale']
  const selectAll = (): void => {
    if (!session) return
    workspace.commitFloatingPaste()
    workspace.setTool('selection')
    workspace.setSelection({ x: 0, y: 0, width: session.document.width, height: session.document.height })
  }
  return <PerformanceProfiler id="AppMenuBar"><header className="topbar">
    <button className="brand" title={t('app.brand.homeTitle')} aria-label={t('app.brand.homeAria')} onClick={() => { onHome(); closeMenu() }}><img className="brand-logo" src={moonspriteLogo} alt="" aria-hidden="true" /><span>MOONSPRITE</span><small>{APP_CHANNEL_LABEL}</small></button>
    <nav className="menu-strip" aria-label={t('app.menu.mainAria')} onPointerOver={(event) => { const button = (event.target as HTMLElement).closest('button[aria-expanded]'); const item = button?.parentElement; if (item?.parentElement !== event.currentTarget) return; hoverMenuAt(Array.from(event.currentTarget.children).indexOf(item)) }}>
      <div className="menu-item"><button aria-expanded={openMenu === 'file'} onClick={() => toggleMenu('file')}>{t('app.menu.file')}</button>{openMenu === 'file' && <div className="menu-popover"><button onClick={() => { onNew(); closeMenu() }}>{t('app.menu.file.new')} <kbd>{shortcutFor('newDocument')}</kbd></button><button onClick={() => { onOpen(); closeMenu() }}>{t('app.menu.file.open')} <kbd>{shortcutFor('openDocument')}</kbd></button><div className="menu-submenu"><SubmenuTrigger>{t('app.menu.file.recent')}</SubmenuTrigger><div className="menu-popover menu-submenu-popover recent-files-submenu">{recentFiles.length === 0 ? <button disabled>{t('app.menu.file.noRecent')}</button> : recentFiles.map((recent) => <button key={recent.filePath} title={recent.filePath} onClick={() => { onOpenRecent(recent.filePath); closeMenu() }}>{recent.fileName}</button>)}</div></div><span className="menu-divider" /><button disabled={!session} onClick={() => { void workspace.saveActive(); closeMenu() }}>{t('app.menu.file.save')} <kbd>{shortcutFor('save')}</kbd></button><button disabled={!session} onClick={() => { onSaveAs(); closeMenu() }}>{t('app.menu.file.saveAs')} <kbd>{shortcutFor('saveAs')}</kbd></button><div className="menu-submenu"><SubmenuTrigger disabled={!session}>{t('app.menu.file.export')}</SubmenuTrigger><div className="menu-popover menu-submenu-popover"><button disabled={!session} onClick={() => { onExport(); closeMenu() }}>{t('app.menu.file.exportAs')} <kbd>{shortcutFor('exportDocument')}</kbd></button><button disabled={!session || (session.document.animation?.frames.length ?? 1) < 2} onClick={() => { onExportAllFrames(); closeMenu() }}>{t('app.menu.file.exportAllFrames')}{shortcutHint('exportAllFrames')}</button><button disabled={!session} onClick={() => { void workspace.createSpriteSheetFromActive(); closeMenu() }}>{t('app.menu.file.exportSpriteSheet')}{shortcutHint('exportSpriteSheet')}</button></div></div><button disabled={!session?.document.filePath && !session?.document.sourceFilePath} onClick={() => { if (session) onOpenProjectFolder(session.document.id); closeMenu() }}>{t('app.menu.file.openFolder')}{shortcutHint('openProjectFolder')}</button><span className="menu-divider" /><button disabled={!session} onClick={() => { onOpenTimelapse(); closeMenu() }}>{t('app.menu.file.timelapse')}{shortcutHint('openTimelapse')}</button><button disabled={!session} onClick={() => { onOpenProjectInfo(); closeMenu() }}>{t('app.menu.file.projectInfo')}{shortcutHint('openProjectInfo')}</button></div>}</div>
      <div className="menu-item"><button aria-expanded={openMenu === 'edit'} onClick={() => toggleMenu('edit')}>{t('app.menu.edit')}</button>{openMenu === 'edit' && <div className="menu-popover"><button disabled={!session?.history.canUndo} onClick={() => { workspace.undo(); closeMenu() }}>{t('app.menu.edit.undo')} <kbd>{shortcutFor('undo')}</kbd></button><button disabled={!session?.history.canRedo} onClick={() => { workspace.redo(); closeMenu() }}>{t('app.menu.edit.redo')} <kbd>{shortcutFor('redo')}</kbd></button><div className="menu-submenu"><SubmenuTrigger>{t('app.menu.edit.pasteSpecial')}</SubmenuTrigger><div className="menu-popover menu-submenu-popover"><button onClick={() => { void workspace.pasteAsNewDocument(); closeMenu() }}>{t('app.menu.edit.pasteAsDocument')}{shortcutHint('pasteAsNewDocument')}</button><button disabled={!session} onClick={() => { void workspace.pasteAsNewLayer(); closeMenu() }}>{t('app.menu.edit.pasteAsLayer')}{shortcutHint('pasteAsNewLayer')}</button></div></div><span className="menu-divider" /><button disabled={!session} onClick={() => { onOpenColorReplacement(); closeMenu() }}>{t('app.menu.edit.replaceColor')}{shortcutHint('replaceColor')}</button><div className="menu-submenu"><SubmenuTrigger disabled={!session}>{t('app.menu.edit.adjustments')}</SubmenuTrigger><div className="menu-popover menu-submenu-popover"><button onClick={() => openAdjustment('color-balance')}>{t('app.menu.edit.colorBalance')}{shortcutHint('adjustmentColorBalance')}</button><button onClick={() => openAdjustment('brightness-contrast')}>{t('app.menu.edit.brightnessContrast')}{shortcutHint('adjustmentBrightnessContrast')}</button><button onClick={() => openAdjustment('hue-saturation')}>{t('app.menu.edit.hueSaturation')}{shortcutHint('adjustmentHueSaturation')}</button><button onClick={() => openAdjustment('curves')}>{t('app.menu.edit.curves')}{shortcutHint('adjustmentCurves')}</button></div></div><span className="menu-divider" /><button onClick={() => { onOpenShortcuts(); closeMenu() }}>{t('app.menu.edit.shortcuts')}{shortcutHint('openShortcutSettings')}</button><button onClick={() => { onOpenPreferences(); closeMenu() }}>{t('app.menu.edit.preferences')}{shortcutHint('openPreferences')}</button></div>}</div>
      <div className="menu-item"><button aria-expanded={openMenu === 'select'} onClick={() => toggleMenu('select')}>{t('app.menu.select')}</button>{openMenu === 'select' && <div className="menu-popover"><button disabled={!session} onClick={() => { selectAll(); closeMenu() }}>{t('app.menu.select.selectAll')}{shortcutHint('selectAll')}</button><button disabled={!session?.selection} onClick={() => { if (session?.selection) workspace.commitSelectionChange(session.selection, null, t('app.menu.select.deselect')); closeMenu() }}>{t('app.menu.select.deselect')}{shortcutHint('deselect')}</button><button disabled={!session?.selection} onClick={() => { workspace.invertSelection(); closeMenu() }}>{t('app.menu.select.invert')}{shortcutHint('invertSelection')}</button><span className="menu-divider" /><button disabled={!session || Boolean(session.selectedGroupId) || session.selectedLayerIds.length !== 1} onClick={() => { workspace.beginLayerTransform(); closeMenu() }}>{t('app.menu.select.transform')}{shortcutHint('transform')}</button><button disabled={!session?.selection} onClick={() => { workspace.flipActiveSelection('horizontal'); closeMenu() }}>{t('app.menu.select.flipHorizontal')}{shortcutHint('flipHorizontal')}</button><button disabled={!session?.selection} onClick={() => { workspace.flipActiveSelection('vertical'); closeMenu() }}>{t('app.menu.select.flipVertical')}{shortcutHint('flipVertical')}</button><button disabled={!session?.selection} onClick={() => { workspace.deleteSelection(); closeMenu() }}>{t('app.menu.select.delete')}{shortcutHint('deleteLayer')}</button><button disabled={!session?.selection} onClick={() => { onOpenOutline(); closeMenu() }}>{t('app.menu.select.outline')}{shortcutHint('outline')}</button><button disabled={!session?.selection} onClick={() => { workspace.toggleSelectionOutline(); closeMenu() }}>{t(session?.view.showSelectionOutline === false ? 'app.menu.select.showOutline' : 'app.menu.select.hideOutline')}{shortcutHint('toggleSelectionOutline')}<span className="menu-check">{session?.view.showSelectionOutline === false && <Check size={14} />}</span></button><span className="menu-divider" /><button disabled={!session?.selection} onClick={() => { workspace.createBrushFromSelection(); closeMenu() }}>{t('app.menu.select.createBrush')}{shortcutHint('createBrushFromSelection')}</button></div>}</div>
      <div className="menu-item"><button aria-expanded={openMenu === 'canvas'} onClick={() => toggleMenu('canvas')}>{t('app.menu.image')}</button>{openMenu === 'canvas' && <div className="menu-popover"><button disabled={!session} onClick={() => { onOpenCanvasResize(); closeMenu() }}>{t('app.menu.image.canvasSize')} <kbd>{shortcutFor('canvasResize')}</kbd></button><button disabled={!session} onClick={() => { onOpenImageResize(); closeMenu() }}>{t('app.menu.image.imageSize')} <kbd>{shortcutFor('imageResize')}</kbd></button><div className="menu-submenu"><SubmenuTrigger disabled={!session}>{t('app.menu.image.colorMode')}</SubmenuTrigger><div className="menu-popover menu-submenu-popover">{colorModes.map((mode) => <button key={mode} disabled={!session} title={t(`colorMode.${mode}Description`)} onClick={() => { void workspace.convertColorMode(mode); closeMenu() }}>{t(`colorMode.${mode}`)}<span className="menu-check">{session?.document.colorMode === mode && <Check size={14} />}</span></button>)}</div></div></div>}</div>
      <div className="menu-item"><button aria-expanded={openMenu === 'layer'} onClick={() => toggleMenu('layer')}>{t('app.menu.layer')}</button>{openMenu === 'layer' && <div className="menu-popover"><button disabled={!session} onClick={() => { void workspace.addLayer(); closeMenu() }}>{t('app.menu.layer.new')}{shortcutHint('newLayer')}</button><button disabled={!session} onClick={() => { workspace.createLayerGroup(); closeMenu() }}>{t('app.menu.layer.newGroup')} <kbd>{shortcutFor('createLayerGroup')}</kbd></button><button disabled={!session || Boolean(session.selectedGroupId)} onClick={() => { workspace.duplicateActiveLayer(); closeMenu() }}>{t('app.menu.layer.duplicate')}{shortcutHint('duplicateLayer')}</button><button disabled={!session || Boolean(session.selectedGroupId)} onClick={() => { workspace.mergeActiveLayerDown(); closeMenu() }}>{t('app.menu.layer.mergeDown')}{shortcutHint('mergeLayerDown')}</button><button disabled={!session || Boolean(session.selectedGroupId) || session.selectedLayerIds.length < 2} onClick={() => { workspace.mergeSelectedLayers(); closeMenu() }}>{t('app.menu.layer.mergeSelected')}{shortcutHint('mergeSelectedLayers')}</button><button disabled={!session?.selectedGroupId} onClick={() => { workspace.mergeSelectedGroup(); closeMenu() }}>{t('app.menu.layer.mergeGroup')}{shortcutHint('mergeLayerGroup')}</button><button disabled={!session || session.document.layers.length < 2} onClick={() => { workspace.mergeVisibleLayers(); closeMenu() }}>{t('app.menu.layer.mergeVisible')}{shortcutHint('mergeVisibleLayers')}</button><button disabled={!session?.selectedGroupId} onClick={() => { workspace.ungroupSelected(); closeMenu() }}>{t('app.menu.layer.ungroup')} <kbd>{shortcutFor('ungroupLayers')}</kbd></button></div>}</div>
      <div className="menu-item"><button aria-expanded={openMenu === 'window'} onClick={() => toggleMenu('window')}>{t('app.menu.window')}</button>{openMenu === 'window' && <div className="menu-popover">
        <div className="menu-submenu"><SubmenuTrigger disabled={!session}>{t('app.menu.window.display')}</SubmenuTrigger><div className="menu-popover menu-submenu-popover"><button disabled={!session} onClick={() => { workspace.togglePixelGrid(); closeMenu() }}>{t('app.menu.window.pixelGrid')}{shortcutHint('toggleGrid')}<span className="menu-check">{session?.view.showPixelGrid && <Check size={14} />}</span></button><button disabled={!session} onClick={() => { workspace.toggleGrid(); closeMenu() }}>{t('app.menu.window.customGrid')}{shortcutHint('toggleCustomGrid')}<span className="menu-check">{session?.view.showGrid && <Check size={14} />}</span></button><button disabled={!session} onClick={() => { onToggleSliceOutlines(); closeMenu() }}>{t('app.menu.window.sliceOutlines')}<span className="menu-check">{sliceOutlinesVisible && <Check size={14} />}</span></button><button disabled={!session} onClick={() => { if (session) workspace.setView({ relativeLuminance: !session.view.relativeLuminance }); closeMenu() }}>{t('app.menu.window.relativeLuminance')} <kbd>{shortcutFor('relativeLuminance')}</kbd><span className="menu-check">{session?.view.relativeLuminance && <Check size={14} />}</span></button></div></div>
        <button disabled={!session} onClick={() => { onOpenGridSettings(); closeMenu() }}>{t('app.menu.window.gridSettings')}{shortcutHint('openGridSettings')}</button>
        <span className="menu-divider" />
        <div className="menu-submenu"><SubmenuTrigger disabled={!session}>{t('app.menu.window.rotateView')}</SubmenuTrigger><div className="menu-popover menu-submenu-popover"><button disabled={!session} onClick={() => { if (session) workspace.setView({ rotation: (session.view.rotation + 90) % 360 }); closeMenu() }}>{t('app.menu.window.rotateClockwise')}{shortcutHint('rotateViewClockwise90')}</button><button disabled={!session} onClick={() => { if (session) workspace.setView({ rotation: (session.view.rotation + 270) % 360 }); closeMenu() }}>{t('app.menu.window.rotateCounterClockwise')}{shortcutHint('rotateViewCounterClockwise90')}</button></div></div>
        <div className="menu-submenu"><SubmenuTrigger disabled={!session}>{t('app.menu.window.mirrorView')}</SubmenuTrigger><div className="menu-popover menu-submenu-popover"><button disabled={!session} onClick={() => { onToggleMirror('horizontal'); closeMenu() }}>{t('app.menu.window.mirrorHorizontal')} <kbd>{shortcutFor('mirrorView')}</kbd><span className="menu-check">{session?.view.mirrored && <Check size={14} />}</span></button><button disabled={!session} onClick={() => { onToggleMirror('vertical'); closeMenu() }}>{t('app.menu.window.mirrorVertical')} <kbd>{shortcutFor('mirrorViewVertical')}</kbd><span className="menu-check">{session?.view.mirroredVertical && <Check size={14} />}</span></button></div></div>
        <button disabled={!session} onClick={() => { if (session) workspace.setView({ zoom: 16, panX: 0, panY: 0, rotation: 0, mirrored: false, mirroredVertical: false }); closeMenu() }}>{t('app.menu.window.resetView')}{shortcutHint('resetView')}</button>
        <span className="menu-divider" />
        <div className="menu-submenu"><SubmenuTrigger disabled={!session}>{t('app.menu.window.panels')}</SubmenuTrigger><div className="menu-popover menu-submenu-popover">{([['color', t('app.menu.window.panelColor'), 'toggleColorPanel'], ['palette', t('app.menu.window.panelPalette'), 'togglePalettePanel'], ['layers', t('app.menu.window.panelLayers'), 'toggleLayersPanel'], ['preview', t('app.menu.window.panelPreview'), 'togglePreviewPanel']] as Array<[WorkspacePanelId, string, string]>).map(([id, label, shortcutId]) => <button key={id} disabled={!session} onClick={() => { onTogglePanel(id); closeMenu() }}>{label}{shortcutHint(shortcutId)}<span className="menu-check">{panelVisibility[id] && <Check size={14} />}</span></button>)}<button disabled={!session} onClick={() => { onToggleTimeline(); closeMenu() }}>{t('app.menu.window.timeline')}{shortcutHint('toggleTimeline')}<span className="menu-check">{!timelineHidden && <Check size={14} />}</span></button></div></div>
        <div className="menu-submenu"><SubmenuTrigger disabled={!session}>{t('app.menu.window.toolRailPosition')}</SubmenuTrigger><div className="menu-popover menu-submenu-popover">
          <button disabled={!session} onClick={() => { onToolRailSideChange('left'); closeMenu() }}>{t('app.menu.window.left')}{shortcutHint('toolRailLeft')}<span className="menu-check">{toolRailSide === 'left' && <Check size={14} />}</span></button>
          <button disabled={!session} onClick={() => { onToolRailSideChange('right'); closeMenu() }}>{t('app.menu.window.right')}{shortcutHint('toolRailRight')}<span className="menu-check">{toolRailSide === 'right' && <Check size={14} />}</span></button>
          <button disabled={!session} onClick={() => { onToolRailSideChange('top'); closeMenu() }}>{t('app.menu.window.top')}{shortcutHint('toolRailTop')}<span className="menu-check">{toolRailSide === 'top' && <Check size={14} />}</span></button>
          <button disabled={!session} onClick={() => { onToolRailSideChange('bottom'); closeMenu() }}>{t('app.menu.window.bottom')}{shortcutHint('toolRailBottom')}<span className="menu-check">{toolRailSide === 'bottom' && <Check size={14} />}</span></button>
        </div></div>
        <span className="menu-divider" />
        <button disabled={!session} onClick={() => { if (!session || homeOpen) return; onCycleAdvancedMode(); closeMenu() }}>{t('app.menu.window.advancedMode')} <kbd>{shortcutFor('advancedMode')}</kbd><span className="menu-check">{advancedModeActive && <Check size={14} />}</span></button>
      </div>}</div>
      <div className="menu-item"><button aria-expanded={openMenu === 'help'} onClick={() => toggleMenu('help')}>{t('app.menu.help')}</button>{openMenu === 'help' && <div className="menu-popover"><button onClick={() => { onOpenComponentLibrary(); closeMenu() }}>{t('app.menu.help.componentLibrary')}{shortcutHint('openComponentLibrary')}</button><button onClick={() => { onOpenLatestRelease(); closeMenu() }}>{t('app.menu.help.changelog')}{shortcutHint('openLatestRelease')}</button><button onClick={() => { onOpenRoadmap(); closeMenu() }}>{t('app.menu.help.roadmap')}{shortcutHint('openRoadmap')}</button><button onClick={() => { onOpenAbout(); closeMenu() }}>{t('app.menu.help.about')}{shortcutHint('openAbout')}</button></div>}</div>
    </nav>
    <div className="top-actions"><button className="icon-button" title={`${t('app.menu.file.new')} ${shortcutFor('newDocument')}`.trim()} aria-label={t('app.menu.file.new')} onClick={onNew}><PixelUtilityIcon kind="plus" /></button><button className="icon-button" title={`${t('app.menu.file.open')} ${shortcutFor('openDocument')}`.trim()} aria-label={t('app.menu.file.open')} onClick={onOpen}><PixelUtilityIcon kind="folderOpen" /></button><button className="icon-button" title={`${t('app.menu.file.save')} ${shortcutFor('save')}`.trim()} aria-label={t('app.menu.file.save')} disabled={!session} onClick={() => void workspace.saveActive()}><PixelUtilityIcon kind="save" /></button><button className="top-export-button" title={`${t('app.menu.file.export')} ${shortcutFor('exportDocument')}`.trim()} disabled={!session} onClick={onExport}><PixelUtilityIcon kind="export" /><span>{t('app.menu.file.export')}</span></button></div>
  </header></PerformanceProfiler>
}
