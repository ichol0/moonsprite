import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronRight, ExternalLink, FileOutput, FolderOpen, GitFork, Info, LayoutTemplate, Plus, Save, Trash2, X } from 'lucide-react'
import { PhysicalPosition, PhysicalSize } from '@tauri-apps/api/dpi'
import { availableMonitors, getCurrentWindow } from '@tauri-apps/api/window'
import type { ColorMode, ImageResizeInterpolation, StoredWorkspace, WorkspaceLayout } from '@shared/types'
import type { AdjustmentKind } from '@/core/adjustments'
import { compositePixelWithLayerColor, getActiveLayer, isLayerEffectivelyVisible, readLayerColorAt } from '@/core/document'
import { blendOver, packColor, unpackColor } from '@/core/raster'
import type { PanelDock, WorkspacePanelId } from '@/components/WorkspacePanels'
import { AppMenuBar } from '@/components/app/AppMenuBar'
import { DocumentTabs } from '@/components/app/DocumentTabs'
import { EditorStatusBar } from '@/components/app/EditorStatusBar'
import { EditorWorkspaceShell } from '@/components/app/EditorWorkspaceShell'
import { preloadCanvasStage } from '@/components/app/EditorCanvasHost'
import { TOOL_DEFINITIONS } from '@/components/app/editor-tools'
import { publishCanvasResizePreview } from '@/core/canvas-resize-preview'
import { appCoordinatorRenderKey } from '@/core/app-render-keys'
import { NewDocumentDialog } from '@/components/NewDocumentDialog'
import { CanvasResizeDialog } from '@/components/CanvasResizeDialog'
import { ImageResizeDialog } from '@/components/ImageResizeDialog'
import { OutlineDialog } from '@/components/OutlineDialog'
import { AdjustmentDialog } from '@/components/dialogs/AdjustmentDialog'
import { PreferencesDialog } from '@/components/dialogs/PreferencesDialog'
import { SaveAsDialog } from '@/components/dialogs/SaveAsDialog'
import { ShortcutDialog } from '@/components/dialogs/ShortcutDialog'
import { NumberInput } from '@/components/NumberInput'
import { ModalShell } from '@/components/ModalShell'
import { ThemedSelect } from '@/components/ThemedSelect'
import { resolveCopyCommand, resolveDeleteCommand, shouldHandleGlobalSelectionEnter, shouldTriggerDeleteCommand, type EditorCommandScope } from '@/core/command-context'
import { formatBytes } from '@/core/resource-policy'
import { adjacentFormInput } from '@/core/form-focus'
import { startDocumentDropService } from '@/platform/document-drop-service'
import { APP_CHANNEL_LABEL } from '@/core/app-meta'
import { getRecentProjects, type RecentProject } from '@/core/home-history'
import { EXPORT_FORMAT_PREFERENCE_KEY, EXPORT_SCALE_PRESETS_KEY, NEW_DOCUMENT_SIZE_PRESETS_KEY, RELATIVE_LUMINANCE_SCOPE_KEY, SAVE_FORMAT_PREFERENCE_KEY, imageExportKindForPreference, loadEditorPreferences, parseDocumentSizePresets, parseExportScalePresets, parseRelativeLuminanceScope, type RelativeLuminanceScope } from '@/core/file-preferences'
import { DEFAULT_SHORTCUTS, deriveShortcutConflicts, keyboardEventKey, loadShortcuts, normalizeShortcut, saveShortcuts as persistShortcuts, shortcutText } from '@/core/shortcuts'
import { readStoredJson, readStoredString, writeStoredJson, writeStoredString } from '@/core/storage'
import { applyCursorPreferences } from '@/platform/cursor-theme'
import { ACTIVE_WORKSPACE_STORAGE_KEY, BOTTOM_DOCK_HEIGHT_STORAGE_KEY, COLOR_SQUARE_ANCHOR_STORAGE_KEY, COLOR_SQUARE_DOCK_STORAGE_KEY, DEFAULT_PANEL_DOCKS, FLOATING_PANEL_STORAGE_KEYS, INSPECTOR_LAYOUT_STORAGE_KEY, INSPECTOR_WIDTH_STORAGE_KEY, LEFT_DOCK_WIDTH_STORAGE_KEY, PANEL_DOCKS_STORAGE_KEY, TOOL_RAIL_SIDE_STORAGE_KEY, loadBottomDockHeight, loadInspectorWidth, loadLeftDockWidth, loadMainWindowState, loadPanelDocks, loadPanelVisibility, loadToolRailSide, normalizeWorkspaceLayout, readLayoutStorage, saveMainWindowState, savePanelDocks, savePanelVisibility, writeLayoutStorage } from '@/core/workspace-layout-preferences'
import { type ExportOptions, type SaveAsOptions, useWorkspace } from '@/store/workspace'
import './styles.css'

const LazyHomeWorkspace = lazy(() => import('@/components/HomeWorkspace').then(({ HomeWorkspace }) => ({ default: HomeWorkspace })))
const LazyComponentLibrary = lazy(() => import('@/components/ComponentLibrary').then(({ ComponentLibrary }) => ({ default: ComponentLibrary })))

const defaultShortcuts: Record<string, string> = { ...DEFAULT_SHORTCUTS }

interface ExportPreset extends ExportOptions { presetName: string }
const presetStorageKey = 'moonsprite.export-presets.v1'
type ToolRailSide = 'left' | 'right'
type AdvancedMode = 'tool-options' | 'canvas-only'

const saveAsFormatForPreference = (value: string | null): SaveAsOptions['format'] => {
  if (value === 'ase' || value === 'aseprite' || value === 'jpeg' || value === 'webp') return value
  if (value === 'png') return 'png-auto'
  return 'moonsprite'
}

const defaultPanelDocks: Record<WorkspacePanelId, PanelDock> = { ...DEFAULT_PANEL_DOCKS }
const defaultInspectorLayout = JSON.stringify({
  order: ['palette', 'color', 'layers', 'preview'],
  sizes: { color: 330, palette: 620, layers: 560, preview: 220 },
  bottomWidths: { color: 280, palette: 280, layers: 320, preview: 280 }
})
const builtInDefaultWorkspace: StoredWorkspace = {
  id: 'builtin-default',
  name: '默认工作区',
  filePath: '',
  updatedAt: '',
  builtIn: true,
  layout: {
    panelDocks: { ...defaultPanelDocks },
    panelVisibility: { color: true, palette: true, layers: true, preview: true },
    inspectorWidth: 300,
    leftDockWidth: 280,
    bottomDockHeight: 180,
    toolRailSide: 'left',
    previewOpen: true,
    inspectorLayout: defaultInspectorLayout,
    colorSquareDock: 'left',
    colorSquareAnchor: 'end',
    floatingPanels: { color: null, palette: null, layers: null, preview: null },
    mainWindow: null
  },
  initialLayout: {
    panelDocks: { ...defaultPanelDocks },
    panelVisibility: { color: true, palette: true, layers: true, preview: true },
    inspectorWidth: 300,
    leftDockWidth: 280,
    bottomDockHeight: 180,
    toolRailSide: 'left',
    previewOpen: true,
    inspectorLayout: defaultInspectorLayout,
    colorSquareDock: 'left',
    colorSquareAnchor: 'end',
    floatingPanels: { color: null, palette: null, layers: null, preview: null },
    mainWindow: null
  }
}

const persistMainWindowState = async (notifyWorkspaceLayout = true): Promise<void> => {
  if (!('__TAURI_INTERNALS__' in window)) return
  const appWindow = getCurrentWindow()
  const maximized = await appWindow.isMaximized()
  const previous = loadMainWindowState()
  if (maximized && previous) {
    saveMainWindowState({ ...previous, maximized: true })
    if (notifyWorkspaceLayout) window.dispatchEvent(new Event('moonsprite-workspace-layout-change'))
    return
  }
  if (maximized) {
    if (notifyWorkspaceLayout) window.dispatchEvent(new Event('moonsprite-workspace-layout-change'))
    return
  }
  const [position, size] = await Promise.all([appWindow.outerPosition(), appWindow.innerSize()])
  saveMainWindowState({ x: position.x, y: position.y, width: size.width, height: size.height, maximized: false })
  if (notifyWorkspaceLayout) window.dispatchEvent(new Event('moonsprite-workspace-layout-change'))
}
const loadPresets = (): ExportPreset[] => {
  try {
    const value = readStoredJson<unknown>(presetStorageKey, [])
    if (!Array.isArray(value)) return []
    return value.flatMap((item): ExportPreset[] => {
      if (typeof item?.presetName !== 'string' || typeof item?.name !== 'string') return []
      const scalePercent = typeof item.scalePercent === 'number' ? item.scalePercent : typeof item.scale === 'number' ? item.scale * 100 : 100
      const format = item.format === 'jpeg' || item.format === 'webp' || item.format === 'png-rgba' ? item.format : 'png-auto'
      return [{ presetName: item.presetName, name: item.name, format, scalePercent }]
    })
  } catch { return [] }
}

export default function App() {
  const coordinatorRenderKey = useWorkspace(appCoordinatorRenderKey)
  const workspace = useWorkspace.getState()
  const [newOpen, setNewOpen] = useState(false)
  const [canvasResizeOpen, setCanvasResizeOpen] = useState(false)
  const [imageResizeOpen, setImageResizeOpen] = useState(false)
  const [outlineOpen, setOutlineOpen] = useState(false)
  const [preferencesOpen, setPreferencesOpen] = useState(false)
  const [shortcutOpen, setShortcutOpen] = useState(false)
  const [shortcuts, setShortcuts] = useState<Record<string, string>>(loadShortcuts)
  const [adjustmentOpen, setAdjustmentOpen] = useState(false)
  const [adjustmentKind, setAdjustmentKind] = useState<AdjustmentKind>('brightness-contrast')
  const [aboutOpen, setAboutOpen] = useState(false)
  const [componentLibraryOpen, setComponentLibraryOpen] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)
  const [saveAsOpen, setSaveAsOpen] = useState(false)
  const [workspaceSaveOpen, setWorkspaceSaveOpen] = useState(false)
  const [workspaceManagerOpen, setWorkspaceManagerOpen] = useState(false)
  const [workspaceSaveName, setWorkspaceSaveName] = useState('')
  const [savedWorkspaces, setSavedWorkspaces] = useState<StoredWorkspace[]>([])
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string | null>(null)
  const [workspaceDirectory, setWorkspaceDirectory] = useState('')
  const [workspaceBusy, setWorkspaceBusy] = useState(false)
  const [exportForm, setExportForm] = useState<ExportOptions>({ name: 'MoonSprite-export', format: 'png-auto', scalePercent: 100 })
  const [presetName, setPresetName] = useState('')
  const [presets, setPresets] = useState<ExportPreset[]>(loadPresets)
  const [documentSizePresets, setDocumentSizePresets] = useState(() => parseDocumentSizePresets(readStoredString(NEW_DOCUMENT_SIZE_PRESETS_KEY)))
  const [exportScalePresets, setExportScalePresets] = useState(() => parseExportScalePresets(readStoredString(EXPORT_SCALE_PRESETS_KEY)))
  const [resourceLabel, setResourceLabel] = useState('')
  const [openMenu, setOpenMenu] = useState<string | null>(null)
  const [recentFiles, setRecentFiles] = useState<RecentProject[]>(getRecentProjects)
  const [panelVisibility, setPanelVisibility] = useState<Record<WorkspacePanelId, boolean>>(loadPanelVisibility)
  const [homeOpen, setHomeOpen] = useState(false)
  const [relativeLuminanceScope, setRelativeLuminanceScope] = useState<RelativeLuminanceScope>(() => parseRelativeLuminanceScope(readStoredString(RELATIVE_LUMINANCE_SCOPE_KEY)))
  const [runtimePreferences, setRuntimePreferences] = useState(loadEditorPreferences)
  const [advancedMode, setAdvancedMode] = useState<AdvancedMode | null>(null)
  const [advancedModeNotice, setAdvancedModeNotice] = useState<string | null>(null)
  const [advancedModeNoticeShortcut, setAdvancedModeNoticeShortcut] = useState('')
  const [inspectorWidth, setInspectorWidth] = useState(() => loadInspectorWidth(window.innerWidth))
  const [panelDocks, setPanelDocks] = useState<Record<WorkspacePanelId, PanelDock>>(loadPanelDocks)
  const [bottomLayersHeight, setBottomLayersHeight] = useState(loadBottomDockHeight)
  const [bottomDockHost, setBottomDockHost] = useState<HTMLElement | null>(null)
  const [leftDockWidth, setLeftDockWidth] = useState(loadLeftDockWidth)
  const [leftDockHost, setLeftDockHost] = useState<HTMLElement | null>(null)
  const [toolRailSide, setToolRailSide] = useState<ToolRailSide>(loadToolRailSide)
  const [toolRailDockPreview, setToolRailDockPreview] = useState<ToolRailSide | null>(null)
  const [workspaceLayoutRevision, setWorkspaceLayoutRevision] = useState(0)
  const [splitDocumentIds, setSplitDocumentIds] = useState<[string, string] | null>(null)
  const resizeStart = useRef<{ x: number; width: number } | null>(null)
  const bottomLayersResizeStart = useRef<{ y: number; height: number } | null>(null)
  const bottomLayersHeightRef = useRef(bottomLayersHeight)
  const leftDockResizeStart = useRef<{ x: number; width: number } | null>(null)
  const leftDockWidthRef = useRef(leftDockWidth)
  const toolRailDrag = useRef<{ startX: number; startY: number; moved: boolean; target: ToolRailSide } | null>(null)
  const activeWorkspaceRef = useRef<StoredWorkspace | null>(null)
  const workspaceApplyInProgress = useRef(false)
  const workspaceAutoSaveTimer = useRef<number | null>(null)
  const workspaceAutoSaveQueue = useRef<Promise<void>>(Promise.resolve())
  const commandScopeRef = useRef<EditorCommandScope>('canvas')
  const [workspaceLayoutChange, setWorkspaceLayoutChange] = useState(0)
  const workAreaRef = useRef<HTMLElement>(null)
  const inspectorWidthRef = useRef(inspectorWidth)
  const closeInProgress = useRef(false)
  const session = workspace.sessions.find((item) => item.document.id === workspace.activeId) ?? null
  void coordinatorRenderKey
  const saveShortcuts = (next: Record<string, string>): void => { setShortcuts(next); persistShortcuts(next) }
  const blockedShortcuts = useMemo(() => deriveShortcutConflicts(shortcuts).blocked, [shortcuts])
  const shortcutFor = useCallback((id: string): string => shortcuts[id] ?? defaultShortcuts[id] ?? '', [shortcuts])
  useEffect(() => {
    const syncPreferences = (): void => {
      const next = loadEditorPreferences()
      setRuntimePreferences(next)
      setRelativeLuminanceScope(next.relativeLuminanceScope)
    }
    window.addEventListener('moonsprite:preferences-changed', syncPreferences)
    return () => window.removeEventListener('moonsprite:preferences-changed', syncPreferences)
  }, [])
  useEffect(() => {
    const syncRecentFiles = (): void => setRecentFiles(getRecentProjects())
    window.addEventListener('moonsprite:recent-files-changed', syncRecentFiles)
    return () => window.removeEventListener('moonsprite:recent-files-changed', syncRecentFiles)
  }, [])
  useEffect(() => {
    void applyCursorPreferences(runtimePreferences.useLocalCursors, runtimePreferences.cursorScale).catch(() => {
      // The CSS defaults remain usable when a custom cursor image cannot be decoded.
    })
  }, [runtimePreferences.cursorScale, runtimePreferences.useLocalCursors])
  useEffect(() => {
    const rememberCommandScope = (event: Event): void => {
      const surface = (event.target as HTMLElement | null)?.closest<HTMLElement>('[data-command-scope], .stage-surface')
      const scope = surface?.classList.contains('stage-surface') ? 'canvas' : surface?.dataset.commandScope
      if (scope === 'canvas' || scope === 'layers' || scope === 'palette') commandScopeRef.current = scope
    }
    window.addEventListener('pointerdown', rememberCommandScope, true)
    window.addEventListener('focusin', rememberCommandScope, true)
    return () => {
      window.removeEventListener('pointerdown', rememberCommandScope, true)
      window.removeEventListener('focusin', rememberCommandScope, true)
    }
  }, [])
  useEffect(() => {
    const enabled = Boolean(session?.view.relativeLuminance && relativeLuminanceScope === 'app')
    document.body.classList.toggle('relative-luminance-app', enabled)
    return () => { document.body.classList.remove('relative-luminance-app') }
  }, [relativeLuminanceScope, session?.view.relativeLuminance])
  useEffect(() => {
    if (!advancedModeNotice) return
    const timer = window.setTimeout(() => setAdvancedModeNotice(null), 1700)
    return () => window.clearTimeout(timer)
  }, [advancedModeNotice])
  useEffect(() => {
    if (!session || homeOpen) setAdvancedMode(null)
  }, [homeOpen, session?.document.id])
  const cycleAdvancedMode = useCallback((): void => {
    const next: AdvancedMode | null = advancedMode === null ? 'tool-options' : advancedMode === 'tool-options' ? 'canvas-only' : null
    setAdvancedMode(next)
    setAdvancedModeNotice('高级模式已开启')
    setAdvancedModeNoticeShortcut(shortcutFor('advancedMode'))
  }, [advancedMode, shortcutFor])
  const toggleMirrorView = useCallback((axis: 'horizontal' | 'vertical'): void => {
    const active = useWorkspace.getState().sessions.find((item) => item.document.id === useWorkspace.getState().activeId)
    if (!active) return
    const vertical = axis === 'vertical'
    const next = vertical ? !active.view.mirroredVertical : !active.view.mirrored
    workspace.setView(vertical ? { mirroredVertical: next } : { mirrored: next })
    setAdvancedModeNotice(`${vertical ? '垂直' : '水平'}镜像视图已${next ? '开启' : '关闭'}`)
    setAdvancedModeNoticeShortcut(shortcutFor(vertical ? 'mirrorViewVertical' : 'mirrorView'))
  }, [shortcutFor, workspace])

  const updatePanelDock = useCallback((id: WorkspacePanelId, dock: PanelDock): void => {
    setPanelDocks((current) => {
      const next = { ...current, [id]: dock }
      savePanelDocks(next)
      return next
    })
  }, [])
  const updatePanelVisibility = useCallback((id: WorkspacePanelId, visible: boolean): void => {
    setPanelVisibility((current) => {
      if (current[id] === visible) return current
      const next = { ...current, [id]: visible }
      savePanelVisibility(next)
      return next
    })
  }, [])
  const updateToolRailSide = useCallback((side: ToolRailSide): void => {
    setToolRailSide(side)
    writeStoredString(TOOL_RAIL_SIDE_STORAGE_KEY, side)
  }, [])
  const previewOpen = panelVisibility.preview
  const visiblePanelIds = (Object.keys(panelDocks) as WorkspacePanelId[]).filter((id) => panelVisibility[id])
  const panelDockFor = (id: WorkspacePanelId): PanelDock => panelDocks[id] ?? defaultPanelDocks[id]
  const hasLeftDock = visiblePanelIds.some((id) => panelDockFor(id) === 'left')
  const hasBottomDock = visiblePanelIds.some((id) => panelDockFor(id) === 'bottom')
  const hasRightDock = visiblePanelIds.some((id) => panelDockFor(id) === 'right')

  const captureWorkspaceLayout = useCallback((): WorkspaceLayout => ({
    panelDocks: { ...panelDocks },
    panelVisibility: { ...panelVisibility },
    inspectorWidth,
    leftDockWidth,
    bottomDockHeight: bottomLayersHeight,
    toolRailSide,
    previewOpen,
    inspectorLayout: readLayoutStorage(INSPECTOR_LAYOUT_STORAGE_KEY),
    colorSquareDock: readLayoutStorage(COLOR_SQUARE_DOCK_STORAGE_KEY),
    colorSquareAnchor: readLayoutStorage(COLOR_SQUARE_ANCHOR_STORAGE_KEY),
    floatingPanels: Object.fromEntries((Object.keys(FLOATING_PANEL_STORAGE_KEYS) as WorkspacePanelId[]).map((id) => [id, readLayoutStorage(FLOATING_PANEL_STORAGE_KEYS[id])])) as Record<WorkspacePanelId, string | null>,
    mainWindow: loadMainWindowState()
  }), [bottomLayersHeight, inspectorWidth, leftDockWidth, panelDocks, panelVisibility, previewOpen, toolRailSide])
  const loadSavedWorkspaces = useCallback(async (): Promise<StoredWorkspace[]> => {
    try {
      const listing = await window.moonSprite.listWorkspaces()
      setWorkspaceDirectory(listing.directoryPath)
      setSavedWorkspaces(listing.workspaces)
      return listing.workspaces
    } catch (error) {
      useWorkspace.getState().setMessage(error instanceof Error ? error.message : '无法读取工作区文件夹。')
      return []
    }
  }, [])
  const applySavedMainWindow = async (state: WorkspaceLayout['mainWindow']): Promise<void> => {
    if (!state) return
    saveMainWindowState(state)
    if (!('__TAURI_INTERNALS__' in window)) return
    try {
      const appWindow = getCurrentWindow()
      const isMaximized = await appWindow.isMaximized()
      // Repeating unmaximize -> resize -> maximize redraws the whole native window.
      // A workspace switch should only touch the shell when its saved geometry differs.
      if (state.maximized && isMaximized) return
      if (!state.maximized && isMaximized) await appWindow.unmaximize()
      const [currentPosition, currentSize] = await Promise.all([appWindow.outerPosition(), appWindow.innerSize()])
      if (Math.abs(currentSize.width - state.width) > 1 || Math.abs(currentSize.height - state.height) > 1) {
        await appWindow.setSize(new PhysicalSize(state.width, state.height))
      }
      const monitors = await availableMonitors()
      const visible = monitors.some((monitor) => {
        const area = monitor.workArea
        const overlapWidth = Math.min(state.x + state.width, area.position.x + area.size.width) - Math.max(state.x, area.position.x)
        const overlapHeight = Math.min(state.y + state.height, area.position.y + area.size.height) - Math.max(state.y, area.position.y)
        return overlapWidth >= 80 && overlapHeight >= 48
      })
      if (visible && (Math.abs(currentPosition.x - state.x) > 1 || Math.abs(currentPosition.y - state.y) > 1)) await appWindow.setPosition(new PhysicalPosition(state.x, state.y))
      else if (!visible) await appWindow.center()
      if (state.maximized) await appWindow.maximize()
    } catch {
      workspace.setMessage('工作区窗口位置无法恢复，已保留当前窗口。')
    }
  }
  const applyWorkspaceLayout = async (saved: StoredWorkspace, announce = true): Promise<void> => {
    workspaceApplyInProgress.current = true
    const layout = saved.layout
    const normalized = normalizeWorkspaceLayout(layout, window.innerWidth)
    const nextPanelDocks: Record<WorkspacePanelId, PanelDock> = normalized.panelDocks
    const nextInspectorWidth = normalized.inspectorWidth
    const nextLeftDockWidth = normalized.leftDockWidth
    const nextBottomHeight = normalized.bottomDockHeight
    const nextToolRailSide: ToolRailSide = normalized.toolRailSide
    savePanelDocks(nextPanelDocks)
    savePanelVisibility(normalized.panelVisibility)
    writeStoredString(INSPECTOR_WIDTH_STORAGE_KEY, String(Math.round(nextInspectorWidth)))
    writeStoredString(LEFT_DOCK_WIDTH_STORAGE_KEY, String(Math.round(nextLeftDockWidth)))
    writeStoredString(BOTTOM_DOCK_HEIGHT_STORAGE_KEY, String(Math.round(nextBottomHeight)))
    writeStoredString(TOOL_RAIL_SIDE_STORAGE_KEY, nextToolRailSide)
    writeLayoutStorage(INSPECTOR_LAYOUT_STORAGE_KEY, layout.inspectorLayout)
    writeLayoutStorage(COLOR_SQUARE_DOCK_STORAGE_KEY, layout.colorSquareDock)
    writeLayoutStorage(COLOR_SQUARE_ANCHOR_STORAGE_KEY, layout.colorSquareAnchor)
    for (const id of Object.keys(FLOATING_PANEL_STORAGE_KEYS) as WorkspacePanelId[]) writeLayoutStorage(FLOATING_PANEL_STORAGE_KEYS[id], layout.floatingPanels?.[id] ?? null)
    inspectorWidthRef.current = nextInspectorWidth
    leftDockWidthRef.current = nextLeftDockWidth
    bottomLayersHeightRef.current = nextBottomHeight
    setInspectorWidth(nextInspectorWidth)
    setLeftDockWidth(nextLeftDockWidth)
    setBottomLayersHeight(nextBottomHeight)
    setPanelDocks(nextPanelDocks)
    setPanelVisibility(normalized.panelVisibility)
    setToolRailSide(nextToolRailSide)
    setWorkspaceLayoutRevision((revision) => revision + 1)
    setActiveWorkspaceId(saved.id)
    activeWorkspaceRef.current = saved
    writeStoredString(ACTIVE_WORKSPACE_STORAGE_KEY, saved.id)
    try {
      await applySavedMainWindow(layout.mainWindow)
      if (announce) workspace.setMessage(`已载入工作区“${saved.name}”。`)
    } finally {
      window.setTimeout(() => { workspaceApplyInProgress.current = false }, 0)
    }
  }
  const saveWorkspace = async (name: string, id: string | null = null): Promise<void> => {
    const trimmedName = name.trim()
    if (!trimmedName) return
    setWorkspaceBusy(true)
    try {
      await persistMainWindowState()
      const saved = await window.moonSprite.saveWorkspace(id, trimmedName, captureWorkspaceLayout())
      setActiveWorkspaceId(saved.id)
      activeWorkspaceRef.current = saved
      writeStoredString(ACTIVE_WORKSPACE_STORAGE_KEY, saved.id)
      setWorkspaceSaveName(saved.name)
      await loadSavedWorkspaces()
      workspace.setMessage(`已保存工作区“${saved.name}”。`)
      setWorkspaceSaveOpen(false)
    } catch (error) {
      workspace.setMessage(error instanceof Error ? error.message : '无法保存工作区。')
    } finally {
      setWorkspaceBusy(false)
    }
  }
  const resetCurrentWorkspace = async (): Promise<void> => {
    const current = activeWorkspaceRef.current
    if (!current || current.id !== activeWorkspaceId) {
      workspace.setMessage('请先载入一个工作区。')
      return
    }
    if (workspaceAutoSaveTimer.current !== null) {
      window.clearTimeout(workspaceAutoSaveTimer.current)
      workspaceAutoSaveTimer.current = null
    }
    workspaceApplyInProgress.current = true
    try {
      const reset = await window.moonSprite.saveWorkspace(current.id, current.name, current.initialLayout)
      await applyWorkspaceLayout(reset, false)
      setSavedWorkspaces((items) => items.map((item) => item.id === reset.id ? reset : item))
      workspace.setMessage(`已复位工作区“${current.name}”。`)
    } catch (error) {
      workspaceApplyInProgress.current = false
      workspace.setMessage(error instanceof Error ? error.message : '无法复位当前工作区。')
    }
  }
  const deleteSavedWorkspace = async (saved: StoredWorkspace): Promise<void> => {
    if (saved.builtIn) {
      workspace.setMessage('内置工作区不能删除。')
      return
    }
    const choice = await workspace.requestDialog({
      title: '删除工作区',
      message: `确定删除“${saved.name}”吗？`,
      detail: '只会删除窗口布局文件，不会删除任何工程或图片。',
      choices: [{ id: 'cancel', label: '取消', tone: 'quiet' }, { id: 'delete', label: '删除', tone: 'danger' }]
    })
    if (choice !== 'delete') return
    try {
      await window.moonSprite.deleteWorkspace(saved.id)
      if (activeWorkspaceId === saved.id) {
        const fallback = savedWorkspaces.find((item) => item.builtIn) ?? builtInDefaultWorkspace
        await applyWorkspaceLayout(fallback, false)
      }
      await loadSavedWorkspaces()
      workspace.setMessage(`已删除工作区“${saved.name}”。`)
    } catch (error) {
      workspace.setMessage(error instanceof Error ? error.message : '无法删除工作区。')
    }
  }

  useEffect(() => {
    let disposed = false
    void (async () => {
      const workspaces = await loadSavedWorkspaces()
      if (disposed) return
      const rememberedId = readStoredString(ACTIVE_WORKSPACE_STORAGE_KEY)
      const initial = workspaces.find((item) => item.id === rememberedId)
        ?? workspaces.find((item) => item.builtIn)
        ?? builtInDefaultWorkspace
      await applyWorkspaceLayout(initial, false)
    })()
    return () => { disposed = true }
  }, [])
  useEffect(() => {
    const notifyLayoutChange = (): void => setWorkspaceLayoutChange((revision) => revision + 1)
    window.addEventListener('moonsprite-workspace-layout-change', notifyLayoutChange)
    return () => window.removeEventListener('moonsprite-workspace-layout-change', notifyLayoutChange)
  }, [])
  useEffect(() => {
    const active = activeWorkspaceRef.current
    if (!active || active.id !== activeWorkspaceId || workspaceApplyInProgress.current) return
    if (workspaceAutoSaveTimer.current !== null) window.clearTimeout(workspaceAutoSaveTimer.current)
    workspaceAutoSaveTimer.current = window.setTimeout(() => {
      workspaceAutoSaveTimer.current = null
      const target = activeWorkspaceRef.current
      if (!target || target.id !== activeWorkspaceId || workspaceApplyInProgress.current) return
      workspaceAutoSaveQueue.current = workspaceAutoSaveQueue.current.catch(() => {}).then(async () => {
        if (activeWorkspaceRef.current?.id !== target.id || workspaceApplyInProgress.current) return
        await persistMainWindowState(false)
        const saved = await window.moonSprite.saveWorkspace(target.id, target.name, captureWorkspaceLayout())
        activeWorkspaceRef.current = saved
        setSavedWorkspaces((current) => current.map((item) => item.id === saved.id ? saved : item))
      }).catch(() => {
        workspace.setMessage('当前工作区未能自动保存，请稍后再试。')
      })
    }, 320)
    return () => {
      if (workspaceAutoSaveTimer.current !== null) {
        window.clearTimeout(workspaceAutoSaveTimer.current)
        workspaceAutoSaveTimer.current = null
      }
    }
  }, [activeWorkspaceId, bottomLayersHeight, captureWorkspaceLayout, inspectorWidth, leftDockWidth, panelDocks, panelVisibility, previewOpen, toolRailSide, workspaceLayoutChange, workspaceLayoutRevision])

  const openExport = (): void => {
    if (!session) return
    const format = imageExportKindForPreference(readStoredString(EXPORT_FORMAT_PREFERENCE_KEY))
    const defaultScale = format === 'svg' ? 100 : exportScalePresets.includes(100) ? 100 : exportScalePresets[0] ?? 100
    setExportForm({ name: session.document.name.replace(/\.(moonsprite|aseprite|ase|png|jpe?g|webp|svg)$/i, '') || 'MoonSprite-export', format, scalePercent: defaultScale })
    setPresetName('')
    setExportOpen(true)
  }

  const openSaveAs = (): void => {
    if (!session) return
    setSaveAsOpen(true)
  }

  const openFilesAndShowDocument = async (): Promise<void> => {
    const beforeIds = new Set(useWorkspace.getState().sessions.map((item) => item.document.id))
    await useWorkspace.getState().openFiles()
    const current = useWorkspace.getState()
    if (current.sessions.some((item) => !beforeIds.has(item.document.id))) setHomeOpen(false)
  }

  const openGalleryProject = async (filePath: string, keepHomeOpen = false): Promise<boolean> => {
    const beforeIds = new Set(useWorkspace.getState().sessions.map((item) => item.document.id))
    const opened = await useWorkspace.getState().openPath(filePath)
    const current = useWorkspace.getState()
    if (!keepHomeOpen && current.sessions.some((item) => !beforeIds.has(item.document.id))) setHomeOpen(false)
    return opened
  }

  const restoreRecoveryAndShowDocument = async (id: string): Promise<boolean> => {
    const restored = await useWorkspace.getState().restoreRecovery(id)
    if (restored) setHomeOpen(false)
    return restored
  }

  const openProjectFolder = (documentId: string): void => {
    const target = useWorkspace.getState().sessions.find((item) => item.document.id === documentId)
    const sourcePath = target?.document.filePath ?? target?.document.sourceFilePath
    if (!sourcePath) {
      workspace.setMessage('该工程尚未保存到本地文件。')
      return
    }
    void window.moonSprite.openProjectInFolder(sourcePath).then(() => {
      workspace.setMessage('已打开工程所在文件夹。')
    }).catch((error) => {
      workspace.setMessage(error instanceof Error ? error.message : '无法打开工程所在文件夹。')
    })
  }

  const createDocumentAndShow = async (name: string, width: number, height: number, mode: ColorMode): Promise<void> => {
    const beforeCount = useWorkspace.getState().sessions.length
    await useWorkspace.getState().newDocument(name, width, height, mode)
    if (useWorkspace.getState().sessions.length > beforeCount) setHomeOpen(false)
  }

  useEffect(() => {
    let active = true
    void window.moonSprite.takeStartupFiles().then(async (paths) => {
      let opened = false
      for (const path of paths) {
        if (await useWorkspace.getState().openPath(path)) opened = true
      }
      if (active && opened) setHomeOpen(false)
    }).catch(() => { /* Keep the home screen available when startup arguments are invalid. */ })
    return () => { active = false }
  }, [])

  useEffect(() => {
    void useWorkspace.getState().restoreRecoveries()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!runtimePreferences.recovery) return
    const interval = window.setInterval(() => { void useWorkspace.getState().autosaveDirty() }, runtimePreferences.recoveryMinutes * 60_000)
    const onBlur = (): void => { void useWorkspace.getState().autosaveDirty() }
    window.addEventListener('blur', onBlur)
    return () => { window.clearInterval(interval); window.removeEventListener('blur', onBlur) }
  }, [runtimePreferences.recovery, runtimePreferences.recoveryMinutes])

  useEffect(() => {
    if (!('__TAURI_INTERNALS__' in window)) return
    const appWindow = getCurrentWindow()
    let disposed = false
    let saveTimer: number | null = null
    let removeMoved: (() => void) | null = null
    let removeResized: (() => void) | null = null
    const scheduleSave = (): void => {
      if (saveTimer !== null) window.clearTimeout(saveTimer)
      saveTimer = window.setTimeout(() => {
        saveTimer = null
        void persistMainWindowState()
      }, 220)
    }
    const setup = async (): Promise<void> => {
      const stored = loadMainWindowState()
      if (stored) {
        await appWindow.unmaximize()
        await appWindow.setSize(new PhysicalSize(stored.width, stored.height))
        let positionIsVisible = true
        try {
          const monitors = await availableMonitors()
          positionIsVisible = monitors.some((monitor) => {
            const area = monitor.workArea
            const overlapWidth = Math.min(stored.x + stored.width, area.position.x + area.size.width) - Math.max(stored.x, area.position.x)
            const overlapHeight = Math.min(stored.y + stored.height, area.position.y + area.size.height) - Math.max(stored.y, area.position.y)
            return overlapWidth >= 80 && overlapHeight >= 48
          })
        } catch { /* Fall back to the stored position when monitor metadata is unavailable. */ }
        if (positionIsVisible) await appWindow.setPosition(new PhysicalPosition(stored.x, stored.y))
        else await appWindow.center()
        if (stored.maximized) await appWindow.maximize()
      } else {
        await persistMainWindowState()
      }
      if (disposed) return
      await appWindow.show()
      removeMoved = await appWindow.onMoved(scheduleSave)
      removeResized = await appWindow.onResized(scheduleSave)
      if (disposed) { removeMoved(); removeResized() }
    }
    void setup().catch(() => {
      /* Keep the configured default window when restoration is unavailable, but never leave it invisible. */
      void appWindow.show().catch(() => {})
    })
    return () => {
      disposed = true
      if (saveTimer !== null) window.clearTimeout(saveTimer)
      removeMoved?.()
      removeResized?.()
    }
  }, [])

  useEffect(() => {
    const preventContextMenu = (event: MouseEvent): void => event.preventDefault()
    window.addEventListener('contextmenu', preventContextMenu)
    return () => window.removeEventListener('contextmenu', preventContextMenu)
  }, [])

  useEffect(() => {
    const closeTransientPopovers = (event: PointerEvent): void => {
      if (!(event.target instanceof Element)) return
      // The workspace menu is portalled to document.body so it can escape the tab strip.
      // Treat both its trigger and its portalled content as part of the same menu surface.
      if (!event.target.closest('.menu-strip, .workspace-top-control, .workspace-popover')) setOpenMenu(null)
    }
    window.addEventListener('pointerdown', closeTransientPopovers, true)
    return () => window.removeEventListener('pointerdown', closeTransientPopovers, true)
  }, [])

  useEffect(() => {
    let drag: { modal: HTMLElement; startX: number; startY: number; left: number; top: number } | null = null
    let zIndex = 220
    const pointerDown = (event: PointerEvent): void => {
      if (event.button !== 0 || !(event.target instanceof Element)) return
      const header = event.target.closest<HTMLElement>('.modal > header')
      if (!header || event.target.closest('button, input, select, textarea, label')) return
      const modal = header.parentElement
      if (!modal) return
      const bounds = modal.getBoundingClientRect()
      modal.style.left = `${bounds.left}px`
      modal.style.top = `${bounds.top}px`
      modal.style.transform = 'none'
      modal.style.zIndex = String(++zIndex)
      drag = { modal, startX: event.clientX, startY: event.clientY, left: bounds.left, top: bounds.top }
      event.preventDefault()
    }
    const pointerMove = (event: PointerEvent): void => {
      if (!drag) return
      const bounds = drag.modal.getBoundingClientRect()
      const left = Math.max(0, Math.min(window.innerWidth - bounds.width, drag.left + event.clientX - drag.startX))
      const top = Math.max(0, Math.min(window.innerHeight - bounds.height, drag.top + event.clientY - drag.startY))
      drag.modal.style.left = `${left}px`
      drag.modal.style.top = `${top}px`
    }
    const pointerUp = (): void => { drag = null }
    window.addEventListener('pointerdown', pointerDown)
    window.addEventListener('pointermove', pointerMove)
    window.addEventListener('pointerup', pointerUp)
    return () => { window.removeEventListener('pointerdown', pointerDown); window.removeEventListener('pointermove', pointerMove); window.removeEventListener('pointerup', pointerUp) }
  }, [])

  useEffect(() => {
    const unsubscribe = window.moonSprite.onRequestClose(async () => {
      if (closeInProgress.current) return
      if (useWorkspace.getState().dialog) { window.moonSprite.cancelClose(); return }
      closeInProgress.current = true
      try { await persistMainWindowState() } catch { /* Closing must continue if geometry persistence fails. */ }
      const dirty = useWorkspace.getState().sessions.filter((item) => item.document.dirty)
      for (const item of dirty) {
        useWorkspace.getState().setActive(item.document.id)
        const choice = await useWorkspace.getState().requestDialog({ title: '未保存的作品', message: `“${item.document.name}”包含未保存的修改。`, detail: '保存修改后关闭、放弃修改，或返回继续编辑。', choices: [{ id: 'cancel', label: '取消', tone: 'quiet' }, { id: 'discard', label: '放弃', tone: 'danger' }, { id: 'save', label: '保存', tone: 'primary' }] })
        if (choice === 'cancel') { closeInProgress.current = false; window.moonSprite.cancelClose(); return }
        if (choice === 'save' && !(await useWorkspace.getState().saveActive())) { closeInProgress.current = false; window.moonSprite.cancelClose(); return }
        if (choice === 'discard') await useWorkspace.getState().discardRecovery(item.document.id)
      }
      window.moonSprite.approveClose()
    })
    return unsubscribe
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    return startDocumentDropService({
      openPath: (path) => useWorkspace.getState().openPath(path),
      pathForFile: (file) => window.moonSprite.pathForFile(file),
      onOpened: () => setHomeOpen(false)
    })
  }, [])

  useEffect(() => {
    const move = (event: PointerEvent): void => {
      const drag = toolRailDrag.current
      if (!drag) return
      if (!drag.moved && Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < 4) return
      drag.moved = true
      drag.target = event.clientX < window.innerWidth / 2 ? 'left' : 'right'
      setToolRailDockPreview(drag.target)
    }
    const up = (): void => {
      const drag = toolRailDrag.current
      if (drag?.moved) {
        setToolRailSide(drag.target)
        writeStoredString(TOOL_RAIL_SIDE_STORAGE_KEY, drag.target)
      }
      toolRailDrag.current = null
      setToolRailDockPreview(null)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    return () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up) }
  }, [])

  useEffect(() => {
    const move = (event: PointerEvent): void => {
      if (!resizeStart.current) return
      const next = Math.max(180, Math.min(window.innerWidth - 220, resizeStart.current.width - (event.clientX - resizeStart.current.x)))
      inspectorWidthRef.current = next
      setInspectorWidth(next)
    }
    const up = (): void => {
      if (resizeStart.current) writeStoredString(INSPECTOR_WIDTH_STORAGE_KEY, String(Math.round(inspectorWidthRef.current)))
      resizeStart.current = null
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    return () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up) }
  }, [])

  useEffect(() => {
    const move = (event: PointerEvent): void => {
      const drag = leftDockResizeStart.current
      if (!drag) return
      const next = Math.max(180, Math.min(Math.min(520, window.innerWidth - 520), drag.width + event.clientX - drag.x))
      leftDockWidthRef.current = next
      setLeftDockWidth(next)
    }
    const up = (): void => {
      if (!leftDockResizeStart.current) return
      leftDockResizeStart.current = null
      writeStoredString(LEFT_DOCK_WIDTH_STORAGE_KEY, String(Math.round(leftDockWidthRef.current)))
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    return () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up) }
  }, [])

  useEffect(() => {
    const move = (event: PointerEvent): void => {
      const drag = bottomLayersResizeStart.current
      const workArea = workAreaRef.current?.getBoundingClientRect()
      if (!drag || !workArea) return
      const maximum = Math.max(120, Math.min(520, workArea.height - 43 - 150))
      const next = Math.max(120, Math.min(maximum, drag.height - (event.clientY - drag.y)))
      bottomLayersHeightRef.current = next
      setBottomLayersHeight(next)
    }
    const up = (): void => {
      if (!bottomLayersResizeStart.current) return
      bottomLayersResizeStart.current = null
      writeStoredString(BOTTOM_DOCK_HEIGHT_STORAGE_KEY, String(Math.round(bottomLayersHeightRef.current)))
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    return () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up) }
  }, [])

  useEffect(() => {
    const keydown = (event: KeyboardEvent): void => {
      const key = keyboardEventKey(event).toLowerCase()
      const target = event.target as HTMLElement | null
      if (shortcutOpen && key !== 'escape' && target?.dataset.shortcutRecorder === 'true') return
      const matches = (action: string): boolean => {
        if (blockedShortcuts[action as keyof typeof blockedShortcuts]) return false
        const configured = shortcuts[action]
        const expected = configured === undefined ? defaultShortcuts[action] : configured.trim()
        return expected !== '' && normalizeShortcut(shortcutText(event)).toLowerCase() === normalizeShortcut(expected).toLowerCase()
      }
      if (key === 'escape') {
        const hasPaletteSurface = Boolean(document.querySelector('.palette-operation-dialog, .palette-library-popover, .palette-actions-popover, .palette-library-context'))
        const hasOwnedPopover = Boolean(document.querySelector('.document-tab-context-menu, .tool-flyout, .brush-library, .brush-size-popover, .brush-advanced-settings [aria-expanded="true"]'))
        const dialogChoice = workspace.dialog?.choices.find((choice) => choice.id === 'cancel')?.id ?? workspace.dialog?.choices.find((choice) => choice.tone === 'quiet')?.id
        if (workspace.dialog && dialogChoice) workspace.resolveDialog(dialogChoice)
        else if (workspace.saveProgress) workspace.dismissSaveProgress()
        else if (adjustmentOpen) window.dispatchEvent(new CustomEvent('moonsprite:close-dialog', { detail: { target: 'adjustment' } }))
        else if (document.querySelector('.layer-modal')) window.dispatchEvent(new CustomEvent('moonsprite:close-dialog', { detail: { target: 'layers' } }))
        else if (hasPaletteSurface) window.dispatchEvent(new CustomEvent('moonsprite:close-dialog', { detail: { target: 'palette' } }))
        else if (newOpen) setNewOpen(false)
        else if (canvasResizeOpen) setCanvasResizeOpen(false)
        else if (imageResizeOpen) setImageResizeOpen(false)
        else if (outlineOpen) setOutlineOpen(false)
        else if (preferencesOpen) setPreferencesOpen(false)
        else if (shortcutOpen) setShortcutOpen(false)
        else if (aboutOpen) setAboutOpen(false)
        else if (componentLibraryOpen) setComponentLibraryOpen(false)
        else if (exportOpen) setExportOpen(false)
        else if (saveAsOpen) setSaveAsOpen(false)
        else if (workspaceSaveOpen) setWorkspaceSaveOpen(false)
        else if (workspaceManagerOpen) setWorkspaceManagerOpen(false)
        else if (openMenu) setOpenMenu(null)
        else if (hasOwnedPopover) window.dispatchEvent(new CustomEvent('moonsprite:close-dialog', { detail: { target: 'popover' } }))
        else if (session?.pendingPaste) workspace.cancelFloatingPaste()
        else workspace.setSelection(null)
        event.preventDefault()
        event.stopPropagation()
        return
      }
      if (key === 'tab') {
        const nextInput = adjacentFormInput(event.target, event.shiftKey)
        if (nextInput) {
          event.preventDefault()
          event.stopPropagation()
          nextInput.focus()
          nextInput.select()
          return
        }
      }
      if (key === 'enter' && outlineOpen) return
      if (key === 'alt') event.preventDefault()
      const commandKey = event.ctrlKey || event.metaKey
      const inputType = target?.tagName === 'INPUT' ? (target as HTMLInputElement).type : ''
      const isTextEntry = Boolean(target?.isContentEditable)
        || target?.tagName === 'TEXTAREA'
        || target?.tagName === 'SELECT'
        || (target?.tagName === 'INPUT' && !['range', 'number', 'checkbox', 'radio', 'button', 'submit', 'reset'].includes(inputType))
      if (matches('advancedMode')) {
        event.preventDefault()
        event.stopPropagation()
        if (session && !homeOpen && !isTextEntry && !event.repeat) {
          cycleAdvancedMode()
        }
        return
      }
      if (matches('fillForeground') && !isTextEntry) {
        event.preventDefault()
        event.stopPropagation()
        target?.blur()
        if (!event.repeat) workspace.fillForeground()
        return
      }
      if (matches('transform') && !isTextEntry) {
        event.preventDefault()
        event.stopPropagation()
        if (!event.repeat) workspace.beginLayerTransform()
        return
      }
      if (!isTextEntry && (matches('undo') || matches('redo'))) {
        event.preventDefault()
        event.stopPropagation()
        matches('undo') ? workspace.undo() : workspace.redo()
        return
      }
      if (target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.tagName === 'SELECT') return
      const runCommand = (action: string, command: () => void, allowRepeat = false): boolean => {
        if (!matches(action)) return false
        event.preventDefault()
        event.stopPropagation()
        if (allowRepeat || !event.repeat) command()
        return true
      }
      if (runCommand('saveAs', () => { if (session && !homeOpen) openSaveAs() })) return
      if (session && (matches('flipVertical') || matches('flipHorizontal'))) {
        event.preventDefault()
        event.stopPropagation()
        if (!event.repeat) workspace.flipActiveSelection(matches('flipVertical') ? 'vertical' : 'horizontal')
        return
      }
      if (matches('outline')) {
        event.preventDefault()
        if (session?.selection) setOutlineOpen(true)
        else workspace.setMessage('请先创建选区。')
        return
      }
      if (runCommand('selectAll', () => {
        const state = useWorkspace.getState()
        const active = state.sessions.find((item) => item.document.id === state.activeId)
        if (!active) return
        state.commitFloatingPaste()
        state.setTool('selection')
        state.setSelection({ x: 0, y: 0, width: active.document.width, height: active.document.height })
      })) return
      if (runCommand('invertSelection', () => workspace.invertSelection())) return
      if (runCommand('createBrushFromSelection', () => {
        if (session?.selection) workspace.createBrushFromSelection()
        else workspace.setMessage('请先创建要作为笔刷的选区。')
      })) return
      if (runCommand('deselect', () => {
        if (session?.pendingPaste) workspace.commitFloatingPaste()
        if (session?.selection) workspace.commitSelectionChange({ ...session.selection }, null, '取消选区')
      })) return
      if (runCommand('newDocument', () => setNewOpen(true))) return
      if (runCommand('openDocument', () => { void openFilesAndShowDocument() })) return
      if (runCommand('save', () => { void workspace.saveActive() })) return
      if (runCommand('exportDocument', openExport)) return
      if (runCommand('closeDocument', () => { if (workspace.activeId) void workspace.closeDocument(workspace.activeId) })) return
      if (runCommand('openProjectFolder', () => { if (session) openProjectFolder(session.document.id) })) return
      if (runCommand('copy', () => {
        const target = resolveCopyCommand(commandScopeRef.current, Boolean(session?.selection))
        if (target === 'layers') workspace.copySelectedLayersToClipboard()
        else if (target === 'selection') workspace.copySelection()
        else if (commandScopeRef.current === 'palette') workspace.setMessage('调色板颜色暂不支持复制。')
        else if (session?.selectedLayerIds.length || session?.selectedGroupIds.length) workspace.copySelectedLayersToClipboard()
        else workspace.setMessage('请先选择要复制的内容。')
      })) return
      if (runCommand('cut', () => workspace.cutSelection())) return
      if (runCommand('paste', () => {
        if (commandScopeRef.current === 'layers' && workspace.pasteLayersFromClipboard()) return
        if (commandScopeRef.current === 'palette') { workspace.setMessage('调色板区域暂不支持粘贴。'); return }
        if (!session?.selection && workspace.pasteLayersFromClipboard()) return
        void workspace.pasteSelection()
      })) return
      if (runCommand('pasteAsNewLayer', () => { void workspace.pasteAsNewLayer() })) return
      if (runCommand('pasteAsNewDocument', () => { void workspace.pasteAsNewDocument() })) return
      if (runCommand('swapForegroundBackground', () => workspace.swapPrimarySecondaryColors())) return
      const adjustmentShortcuts: Array<[string, AdjustmentKind]> = [
        ['adjustmentColorBalance', 'color-balance'],
        ['adjustmentBrightnessContrast', 'brightness-contrast'],
        ['adjustmentHueSaturation', 'hue-saturation'],
        ['adjustmentCurves', 'curves']
      ]
      const adjustment = adjustmentShortcuts.find(([action]) => matches(action))
      if (adjustment) {
        event.preventDefault()
        event.stopPropagation()
        if (session && !event.repeat) { setAdjustmentKind(adjustment[1]); setAdjustmentOpen(true) }
        return
      }
      if (runCommand('openShortcutSettings', () => setShortcutOpen(true))) return
      if (runCommand('openPreferences', () => setPreferencesOpen(true))) return
      if (runCommand('canvasResize', () => { if (session) setCanvasResizeOpen(true) })) return
      if (runCommand('imageResize', () => { if (session) setImageResizeOpen(true) })) return
      if (runCommand('convertColorMode', () => { if (session) void workspace.convertColorMode(session.document.colorMode === 'rgba' ? 'indexed' : 'rgba') })) return
      if (runCommand('createLayerGroup', () => workspace.createLayerGroup())) return
      if (runCommand('newLayer', () => { void workspace.addLayer() })) return
      if (runCommand('duplicateLayer', () => workspace.duplicateActiveLayer())) return
      if (runCommand('mergeLayerDown', () => workspace.mergeActiveLayerDown())) return
      if (runCommand('mergeSelectedLayers', () => workspace.mergeSelectedLayers())) return
      if (runCommand('mergeLayerGroup', () => workspace.mergeSelectedGroup())) return
      if (runCommand('mergeVisibleLayers', () => workspace.mergeVisibleLayers())) return
      if (runCommand('ungroupLayers', () => workspace.ungroupSelected())) return
      if (runCommand('relativeLuminance', () => { if (session) workspace.setView({ relativeLuminance: !session.view.relativeLuminance }) })) return
      if (runCommand('mirrorView', () => { if (session) toggleMirrorView('horizontal') })) return
      if (runCommand('mirrorViewVertical', () => { if (session) toggleMirrorView('vertical') })) return
      if (runCommand('toggleGrid', () => { if (session) workspace.toggleGrid() })) return
      if (runCommand('toggleSelectionOutline', () => { if (session) workspace.toggleSelectionOutline() })) return
      if (runCommand('rotateViewClockwise90', () => { if (session) workspace.setView({ rotation: (session.view.rotation + 90) % 360 }) })) return
      if (runCommand('rotateViewCounterClockwise90', () => { if (session) workspace.setView({ rotation: (session.view.rotation + 270) % 360 }) })) return
      if (runCommand('resetView', () => { if (session) workspace.setView({ zoom: 16, panX: 0, panY: 0, rotation: 0, mirrored: false, mirroredVertical: false }) })) return
      if (runCommand('toggleColorPanel', () => updatePanelVisibility('color', !panelVisibility.color))) return
      if (runCommand('togglePalettePanel', () => updatePanelVisibility('palette', !panelVisibility.palette))) return
      if (runCommand('toggleLayersPanel', () => updatePanelVisibility('layers', !panelVisibility.layers))) return
      if (runCommand('togglePreviewPanel', () => updatePanelVisibility('preview', !panelVisibility.preview))) return
      if (runCommand('toolRailLeft', () => updateToolRailSide('left'))) return
      if (runCommand('toolRailRight', () => updateToolRailSide('right'))) return
      if (runCommand('openComponentLibrary', () => setComponentLibraryOpen(true))) return
      if (runCommand('openAbout', () => setAboutOpen(true))) return
      if (runCommand('magic', () => { workspace.setTool('selection'); workspace.setSelectionKind('magic') })) return
      if (runCommand('lasso', () => { workspace.setTool('selection'); workspace.setSelectionKind('lasso') })) return
      if (runCommand('polygonLasso', () => { workspace.setTool('selection'); workspace.setSelectionKind('polygon-lasso') })) return
      if (runCommand('tool.selection.ellipse', () => { workspace.setTool('selection'); workspace.setSelectionKind('ellipse') })) return
      if (runCommand('tool.selection', () => { workspace.setTool('selection'); workspace.setSelectionKind('rectangle') })) return
      if (event.key === 'Enter' && session?.selection && shouldHandleGlobalSelectionEnter(outlineOpen, true)) {
        event.preventDefault()
        if (session.pendingPaste) workspace.commitFloatingPaste()
        const active = useWorkspace.getState().sessions.find((item) => item.document.id === session.document.id)
        if (active?.selection) workspace.commitSelectionChange(active.selection, null, '完成选区操作')
        return
      }
      const tool = TOOL_DEFINITIONS.find((item) => matches(`tool.${item.id}`))
      if (tool) {
        event.preventDefault()
        event.stopPropagation()
        if (!event.repeat) workspace.setTool(tool.id)
        return
      }
      if (shouldTriggerDeleteCommand(matches('deleteLayer'), event.key)) {
        event.preventDefault()
        event.stopPropagation()
        const target = resolveDeleteCommand(commandScopeRef.current, Boolean(session?.selection))
        if (target === 'palette' && session?.selectedPaletteIds.length) workspace.deletePaletteColors(session.selectedPaletteIds)
        else if (target === 'layers' && (session?.selectedLayerIds.length || session?.selectedGroupIds.length)) workspace.deleteSelectedLayers()
        else if (target === 'selection' && session?.selection) workspace.deleteSelection()
        return
      }
      if (runCommand('brushSizeDecrease', () => workspace.setBrushSize((session?.brushSize ?? 1) - 1), true)) return
      if (runCommand('brushSizeIncrease', () => workspace.setBrushSize((session?.brushSize ?? 1) + 1), true)) return
      const browserShortcut = commandKey && (
        ['p', 'r', 'l', 'u', '0', '+', '=', '-'].includes(key)
        || (event.shiftKey && ['i', 'j', 'c'].includes(key))
      )
      if (browserShortcut || key === 'f5' || key === 'f12' || (event.altKey && (key === 'arrowleft' || key === 'arrowright'))) {
        event.preventDefault()
        event.stopPropagation()
      }
    }
    const keyup = (event: KeyboardEvent): void => { if (event.key === 'Alt') event.preventDefault() }
    window.addEventListener('keydown', keydown, true)
    window.addEventListener('keyup', keyup, true)
    return () => { window.removeEventListener('keydown', keydown, true); window.removeEventListener('keyup', keyup, true) }
  }, [adjustmentOpen, advancedMode, aboutOpen, blockedShortcuts, canvasResizeOpen, componentLibraryOpen, cycleAdvancedMode, exportOpen, homeOpen, imageResizeOpen, newOpen, openMenu, openSaveAs, outlineOpen, preferencesOpen, saveAsOpen, shortcutOpen, toggleMirrorView, updatePanelVisibility, updateToolRailSide, workspace, workspaceManagerOpen, workspaceSaveOpen, session?.brushSize, session?.document.id, session?.selection, shortcuts])

  useEffect(() => { void window.moonSprite.getResourceInfo().then((info) => setResourceLabel(`可用内存 ${formatBytes(info.freeBytes)}`)) }, [])
  useEffect(() => {
    if (!newOpen) return
    preloadCanvasStage()
    void window.moonSprite.getResourceInfo()
  }, [newOpen])
  const closeMenu = (): void => setOpenMenu(null)
  const savePreset = (): void => {
    const name = presetName.trim()
    if (!name) return
    const next = [...presets.filter((preset) => preset.presetName !== name), { ...exportForm, presetName: name }]
    setPresets(next)
    writeStoredJson(presetStorageKey, next)
  }
  const deletePreset = (): void => {
    const name = presetName.trim()
    if (!name) return
    const next = presets.filter((preset) => preset.presetName !== name)
    setPresets(next)
    writeStoredJson(presetStorageKey, next)
    setPresetName('')
  }

  const openNewDocumentFromTab = useCallback((): void => setNewOpen(true), [])
  const activateDocumentTab = useCallback((documentId: string): void => {
    setHomeOpen(false)
    useWorkspace.getState().setActive(documentId)
    setSplitDocumentIds((current) => current && !current.includes(documentId) ? null : current)
  }, [])
  const contextActivateDocumentTab = useCallback((documentId: string): void => {
    setHomeOpen(false)
    useWorkspace.getState().setActive(documentId)
  }, [])
  const splitDocumentFromTab = useCallback((documentId: string): void => {
    const activeId = useWorkspace.getState().activeId
    if (activeId && activeId !== documentId) setSplitDocumentIds([activeId, documentId])
  }, [])
  const updateSplitDocuments = useCallback((ids: [string, string] | null): void => setSplitDocumentIds(ids), [])
  const beginToolRailDrag = useCallback((event: React.PointerEvent<HTMLButtonElement>): void => {
    if (event.button !== 0) return
    toolRailDrag.current = { startX: event.clientX, startY: event.clientY, moved: false, target: toolRailSide }
    event.currentTarget.setPointerCapture?.(event.pointerId)
    event.preventDefault()
  }, [toolRailSide])
  const beginLeftDockResize = useCallback((event: React.PointerEvent<HTMLDivElement>): void => {
    leftDockResizeStart.current = { x: event.clientX, width: leftDockWidth }
    event.currentTarget.setPointerCapture?.(event.pointerId)
    event.preventDefault()
  }, [leftDockWidth])
  const beginBottomDockResize = useCallback((event: React.PointerEvent<HTMLDivElement>): void => {
    bottomLayersResizeStart.current = { y: event.clientY, height: bottomLayersHeight }
    event.currentTarget.setPointerCapture?.(event.pointerId)
    event.preventDefault()
  }, [bottomLayersHeight])
  const beginInspectorResize = useCallback((event: React.PointerEvent<HTMLDivElement>): void => {
    resizeStart.current = { x: event.clientX, width: inspectorWidth }
    event.currentTarget.setPointerCapture(event.pointerId)
  }, [inspectorWidth])
  const closePreviewPanel = useCallback((): void => updatePanelVisibility('preview', false), [updatePanelVisibility])

  const editorColumns = [
    ...(toolRailSide === 'left' ? ['57px'] : []),
    ...(hasLeftDock ? [`${leftDockWidth}px`, '6px'] : []),
    'minmax(0, 1fr)',
    ...(hasRightDock ? ['6px', `${inspectorWidth}px`] : []),
    ...(toolRailSide === 'right' ? ['57px'] : [])
  ].join(' ')
  const editorAreas = [
    ...(toolRailSide === 'left' ? ['toolrail'] : []),
    ...(hasLeftDock ? ['leftdock', 'leftresize'] : []),
    'work',
    ...(hasRightDock ? ['rightresize', 'rightdock'] : []),
    ...(toolRailSide === 'right' ? ['toolrail'] : [])
  ].join(' ')

  const editorOnly = advancedMode !== null && Boolean(session) && !homeOpen
  return <main className={`app-shell ${session?.view.showGrid ? 'pixel-grid-on' : ''} ${editorOnly ? 'advanced-mode' : ''} ${advancedMode === 'tool-options' ? 'advanced-tool-options' : ''} ${advancedMode === 'canvas-only' ? 'advanced-canvas-only' : ''}`}>
    {saveAsOpen && session && <SaveAsDialog initialName={session.document.name.replace(/\.(moonsprite|aseprite|ase|png|jpe?g|webp)$/i, '') || 'MoonSprite-project'} initialFormat={saveAsFormatForPreference(readStoredString(SAVE_FORMAT_PREFERENCE_KEY))} onClose={() => setSaveAsOpen(false)} onSave={(options) => workspace.saveActive(true, options)} />}
    <AppMenuBar
      openMenu={openMenu}
      setOpenMenu={setOpenMenu}
      shortcutFor={shortcutFor}
      homeOpen={homeOpen}
      panelVisibility={panelVisibility}
      toolRailSide={toolRailSide}
      advancedModeActive={advancedMode !== null}
      recentFiles={recentFiles}
      onHome={() => setHomeOpen(true)}
      onNew={() => setNewOpen(true)}
      onOpen={() => { void openFilesAndShowDocument() }}
      onOpenRecent={(filePath) => { void openGalleryProject(filePath) }}
      onSaveAs={openSaveAs}
      onExport={openExport}
      onOpenProjectFolder={openProjectFolder}
      onOpenOutline={() => setOutlineOpen(true)}
      onOpenAdjustment={(kind) => { setAdjustmentKind(kind); setAdjustmentOpen(true) }}
      onOpenShortcuts={() => setShortcutOpen(true)}
      onOpenPreferences={() => setPreferencesOpen(true)}
      onOpenCanvasResize={() => setCanvasResizeOpen(true)}
      onOpenImageResize={() => setImageResizeOpen(true)}
      onToggleMirror={toggleMirrorView}
      onTogglePanel={(id) => updatePanelVisibility(id, !panelVisibility[id])}
      onToolRailSideChange={updateToolRailSide}
      onCycleAdvancedMode={cycleAdvancedMode}
      onOpenComponentLibrary={() => setComponentLibraryOpen(true)}
      onOpenAbout={() => setAboutOpen(true)}
    />

    <section className="tab-strip" aria-label="文档标签">
      <DocumentTabs homeOpen={homeOpen} onNew={openNewDocumentFromTab} onActivate={activateDocumentTab} onContextActivate={contextActivateDocumentTab} onSplit={splitDocumentFromTab} />
      <span className="workspace-top-control workspace-tab-control"><button type="button" className={`icon-button ${openMenu === 'workspace' ? 'active' : ''}`} title="工作区" aria-label="工作区" aria-expanded={openMenu === 'workspace'} onPointerDown={(event) => event.stopPropagation()} onClick={() => { setOpenMenu(openMenu === 'workspace' ? null : 'workspace'); if (openMenu !== 'workspace') void loadSavedWorkspaces() }}><LayoutTemplate size={16} /></button>{openMenu === 'workspace' && createPortal(<div className="workspace-popover" role="menu" aria-label="工作区"><button type="button" role="menuitem" onPointerDown={(event) => { event.preventDefault(); event.stopPropagation(); setWorkspaceSaveName(''); setWorkspaceSaveOpen(true); closeMenu() }}>新建工作区...</button><span className="workspace-popover-divider" />{savedWorkspaces.map((saved) => <button key={saved.id} type="button" role="menuitem" className={saved.id === activeWorkspaceId ? 'selected-workspace' : ''} title={`载入工作区：${saved.name}`} onPointerDown={(event) => { event.preventDefault(); event.stopPropagation(); void applyWorkspaceLayout(saved); closeMenu() }}><span className="menu-check">{saved.id === activeWorkspaceId && <Check size={14} />}</span><span>{saved.name}</span></button>)}<span className="workspace-popover-divider" /><button type="button" role="menuitem" disabled={!activeWorkspaceId} onPointerDown={(event) => { event.preventDefault(); event.stopPropagation(); void resetCurrentWorkspace(); closeMenu() }}>复位当前工作区</button><button type="button" role="menuitem" onPointerDown={(event) => { event.preventDefault(); event.stopPropagation(); setWorkspaceManagerOpen(true); closeMenu() }}>管理工作区...</button></div>, document.body)}</span>
    </section>

    {session && !homeOpen ? <EditorWorkspaceShell
      editorOnly={editorOnly}
      editorColumns={editorColumns}
      editorAreas={editorAreas}
      toolRailSide={toolRailSide}
      toolRailDockPreview={toolRailDockPreview}
      onToolRailGrip={beginToolRailDrag}
      hasLeftDock={hasLeftDock}
      leftDockHost={leftDockHost}
      setLeftDockHost={setLeftDockHost}
      onLeftDockResize={beginLeftDockResize}
      workAreaRef={workAreaRef}
      hasBottomDock={hasBottomDock}
      bottomDockHeight={bottomLayersHeight}
      bottomDockHost={bottomDockHost}
      setBottomDockHost={setBottomDockHost}
      onBottomDockResize={beginBottomDockResize}
      splitDocumentIds={splitDocumentIds}
      onSplitChange={updateSplitDocuments}
      hasRightDock={hasRightDock}
      onInspectorResize={beginInspectorResize}
      session={session}
      workspaceLayoutRevision={workspaceLayoutRevision}
      panelVisibility={panelVisibility}
      onClosePreview={closePreviewPanel}
      panelDocks={panelDocks}
      onPanelDockChange={updatePanelDock}
      onPanelVisibilityChange={updatePanelVisibility}
      relativeLuminanceInPreview={relativeLuminanceScope === 'app'}
    /> : <Suspense fallback={<div aria-hidden="true" />}><LazyHomeWorkspace onNew={() => setNewOpen(true)} onOpen={() => void openFilesAndShowDocument()} onOpenProject={openGalleryProject} onRestoreRecovery={restoreRecoveryAndShowDocument} /></Suspense>}

    <EditorStatusBar homeOpen={homeOpen} resourceLabel={resourceLabel} />
    {advancedModeNotice && <div className="advanced-mode-notice" role="status" aria-live="polite"><strong>{advancedModeNotice}</strong><small>{advancedModeNotice.startsWith('高级模式') ? `${advancedModeNoticeShortcut} 恢复` : advancedModeNoticeShortcut}</small></div>}
    {workspace.saveProgress && <div className="modal-backdrop save-progress-backdrop" role="presentation"><ModalShell storageKey="save-progress" defaultWidth={228} defaultHeight={142} className="save-progress-modal" role="status" aria-live="polite"><header><div><span className="eyebrow">FILE OPERATION</span><h2>{workspace.saveProgress.title}</h2></div><button type="button" className="icon-button" aria-label={`关闭${workspace.saveProgress.title}进度`} onClick={() => workspace.dismissSaveProgress()}><X size={16} /></button></header><div className="save-progress-body"><strong>{workspace.saveProgress.label}</strong><div className="save-progress-track" aria-label={`${workspace.saveProgress.title}进度 ${workspace.saveProgress.value}%`}><i style={{ width: `${workspace.saveProgress.value}%` }} /></div><small>{workspace.saveProgress.value}%</small></div></ModalShell></div>}
    {workspace.dialog && <div className="modal-backdrop dialog-backdrop" role="presentation"><ModalShell storageKey="confirm" defaultWidth={420} defaultHeight={260} className="confirm-modal" role="alertdialog" aria-modal="true" aria-labelledby="app-dialog-title"><header><div><span className="eyebrow">MOONSPRITE</span><h2 id="app-dialog-title">{workspace.dialog.title}</h2></div></header><div className="confirm-content"><strong>{workspace.dialog.message}</strong>{workspace.dialog.detail && <p>{workspace.dialog.detail}</p>}</div><footer>{workspace.dialog.choices.map((choice) => <button key={choice.id} className={choice.tone === 'primary' ? 'primary-button' : choice.tone === 'danger' ? 'danger-button' : 'quiet-button'} onClick={() => workspace.resolveDialog(choice.id)}>{choice.label}</button>)}</footer></ModalShell></div>}
    {exportOpen && <div className="modal-backdrop" role="presentation" onPointerDown={(event) => { if (event.target === event.currentTarget) setExportOpen(false) }}><ModalShell as="form" storageKey="export" defaultWidth={420} defaultHeight={520} className="export-modal" onSubmit={(event) => { event.preventDefault(); void workspace.exportActive(exportForm).then((exported) => { if (exported) setExportOpen(false) }) }}><header><div><span className="eyebrow">EXPORT IMAGE</span><h2>导出设置</h2></div><button type="button" className="icon-button" aria-label="关闭" onClick={() => setExportOpen(false)}><X size={16} /></button></header><div className="modal-body"><label>文件名称<input autoFocus value={exportForm.name} onChange={(event) => setExportForm({ ...exportForm, name: event.target.value })} /></label><label>格式<ThemedSelect<ExportOptions['format']> value={exportForm.format} groups={[{ label: '导出格式', options: [{ value: 'png-auto', label: 'PNG 自动索引' }, { value: 'png-rgba', label: 'PNG RGBA' }, { value: 'jpeg', label: 'JPEG（白色背景）' }, { value: 'webp', label: 'WebP' }, { value: 'svg', label: 'SVG' }] }]} label="导出格式" onChange={(format) => setExportForm({ ...exportForm, format, scalePercent: format === 'svg' ? 100 : exportForm.scalePercent })} /></label><label>{exportForm.format === 'svg' ? '缩放倍数' : '放大比率'}<div className="scale-control"><NumberInput min={1} max={exportForm.format === 'svg' ? 64 : 6400} value={exportForm.format === 'svg' ? exportForm.scalePercent / 100 : exportForm.scalePercent} suffix={exportForm.format === 'svg' ? 'x' : '%'} onValueChange={(value) => setExportForm({ ...exportForm, scalePercent: exportForm.format === 'svg' ? Math.max(100, Math.round(value * 100)) : value })} /><div className="scale-presets" aria-label={exportForm.format === 'svg' ? '缩放倍数预设' : '放大比率预设'}>{exportScalePresets.map((scale) => <button type="button" key={scale} className={exportForm.scalePercent === scale ? 'selected' : ''} onClick={() => setExportForm({ ...exportForm, scalePercent: scale })}>{exportForm.format === 'svg' ? `${scale / 100}x` : `${scale}%`}</button>)}</div></div></label><label>导出预设<ThemedSelect value={presetName} groups={[{ label: '已保存预设', options: [{ value: '', label: '选择预设' }, ...presets.map((preset) => ({ value: preset.presetName, label: `${preset.presetName} · ${preset.scalePercent}%` }))] }]} label="导出预设" onChange={(value) => { const preset = presets.find((item) => item.presetName === value); setPresetName(value); if (preset) setExportForm({ name: preset.name, format: preset.format, scalePercent: preset.scalePercent }) }} /></label><div className="preset-row"><input aria-label="预设名称" placeholder="预设名称" value={presetName} onChange={(event) => setPresetName(event.target.value)} /><button type="button" className="quiet-button" onClick={savePreset}>保存预设</button><button type="button" className="icon-button preset-delete" title="删除当前预设" aria-label="删除当前预设" disabled={!presets.some((preset) => preset.presetName === presetName)} onClick={deletePreset}><Trash2 size={14} /></button></div></div><footer><button type="button" className="quiet-button" onClick={() => setExportOpen(false)}>取消</button><button className="primary-button" type="submit"><FileOutput size={15} />导出</button></footer></ModalShell></div>}
    {adjustmentOpen && <AdjustmentDialog kind={adjustmentKind} onClose={() => setAdjustmentOpen(false)} />}
    {aboutOpen && <div className="modal-backdrop" role="presentation" onPointerDown={(event) => { if (event.target === event.currentTarget) setAboutOpen(false) }}><ModalShell storageKey="about" defaultWidth={460} defaultHeight={450} className="about-modal" role="dialog" aria-modal="true" aria-labelledby="about-title"><header><div><span className="eyebrow">MOONSPRITE</span><h2 id="about-title">关于 MoonSprite</h2></div><button className="icon-button" aria-label="关闭" onClick={() => setAboutOpen(false)}><X size={16} /></button></header><div className="about-content"><Info size={28} /><div><strong>MoonSprite</strong><p className="about-description">为像素创作者打造的独立开源 Windows 绘画工作台，专注清晰、快速的像素级编辑体验。</p><dl><div><dt>版本</dt><dd>{APP_CHANNEL_LABEL}</dd></div><div><dt>作者</dt><dd>MoonPixel Studio 与 MoonSprite Contributors</dd></div><div><dt>许可</dt><dd>MIT License</dd></div></dl><a className="about-link" href="https://github.com/MoonPixelTeam/moonsprite" target="_blank" rel="noreferrer"><GitFork size={15} /><span>github.com/MoonPixelTeam/moonsprite</span><ExternalLink size={13} /></a><p className="about-notice">MoonSprite 是独立实现，与 Aseprite 无隶属关系，未使用其源码、品牌或视觉资产。</p></div></div><footer><button className="primary-button" onClick={() => setAboutOpen(false)}>确定</button></footer></ModalShell></div>}
    {componentLibraryOpen && <Suspense fallback={null}><LazyComponentLibrary onClose={() => setComponentLibraryOpen(false)} /></Suspense>}
    {workspaceSaveOpen && <div className="modal-backdrop" role="presentation" onPointerDown={(event) => { if (event.target === event.currentTarget && !workspaceBusy) setWorkspaceSaveOpen(false) }}><ModalShell as="form" storageKey="workspace-save" defaultWidth={420} defaultHeight={330} className="workspace-save-dialog" onSubmit={(event) => { event.preventDefault(); void saveWorkspace(workspaceSaveName) }}><header><div><span className="eyebrow">WORKSPACE</span><h2>保存当前工作区</h2></div><button type="button" className="icon-button" aria-label="关闭" disabled={workspaceBusy} onClick={() => setWorkspaceSaveOpen(false)}><X size={16} /></button></header><div className="modal-body"><label>工作区名称<input autoFocus maxLength={96} value={workspaceSaveName} placeholder="例如：绘画、调色、动画" onChange={(event) => setWorkspaceSaveName(event.target.value)} /></label><p className="modal-note">将保存窗口大小和位置、工具栏、栏目停靠位置、排序、尺寸及浮动栏目位置。</p><p className="modal-note">文件夹：{workspaceDirectory || 'workspaces'}</p></div><footer><button type="button" className="quiet-button" disabled={workspaceBusy} onClick={() => setWorkspaceSaveOpen(false)}>取消</button><button type="submit" className="primary-button" disabled={workspaceBusy || !workspaceSaveName.trim()}><Save size={15} />保存</button></footer></ModalShell></div>}
    {workspaceManagerOpen && <div className="modal-backdrop" role="presentation" onPointerDown={(event) => { if (event.target === event.currentTarget) setWorkspaceManagerOpen(false) }}><ModalShell storageKey="workspace-manager" defaultWidth={520} defaultHeight={500} className="workspace-manager-dialog" role="dialog" aria-labelledby="workspace-manager-title"><header><div><span className="eyebrow">WORKSPACE</span><h2 id="workspace-manager-title">管理工作区</h2></div><button type="button" className="icon-button" aria-label="关闭" onClick={() => setWorkspaceManagerOpen(false)}><X size={16} /></button></header><div className="workspace-manager-list">{savedWorkspaces.map((saved) => <div key={saved.id} className={`${saved.id === activeWorkspaceId ? 'active ' : ''}${saved.builtIn ? 'built-in' : ''}`}><button type="button" onClick={() => void applyWorkspaceLayout(saved)}><span>{saved.name}</span><small>{saved.id === activeWorkspaceId ? '当前' : '载入'}</small></button>{!saved.builtIn && <button type="button" className="icon-button" title={`删除 ${saved.name}`} aria-label={`删除 ${saved.name}`} onClick={() => void deleteSavedWorkspace(saved)}><Trash2 size={14} /></button>}</div>)}</div><footer className="workspace-manager-footer"><button type="button" className="quiet-button" onClick={() => void window.moonSprite.openWorkspaceFolder()}><FolderOpen size={15} />打开工作区文件夹</button><button type="button" className="primary-button" onClick={() => { setWorkspaceManagerOpen(false); setWorkspaceSaveName(''); setWorkspaceSaveOpen(true) }}><Plus size={15} />新建工作区</button></footer></ModalShell></div>}
    <NewDocumentDialog open={newOpen} presets={documentSizePresets} onClose={() => setNewOpen(false)} onCreate={(name, width, height, mode) => void createDocumentAndShow(name, width, height, mode)} />
    {session && <CanvasResizeDialog open={canvasResizeOpen} currentWidth={session.document.width} currentHeight={session.document.height} onClose={() => setCanvasResizeOpen(false)} onResize={workspace.resizeActiveCanvas} onPreview={(preview) => { workspace.setCanvasResizePreview(preview); publishCanvasResizePreview(session.document.id, preview) }} preview={session.canvasResizePreview} />}
    {session && <ImageResizeDialog open={imageResizeOpen} currentWidth={session.document.width} currentHeight={session.document.height} onClose={() => setImageResizeOpen(false)} onResize={(width, height, interpolation: ImageResizeInterpolation) => workspace.resizeActiveImage(width, height, interpolation)} />}
    {session && <OutlineDialog open={outlineOpen} session={session} onClose={() => setOutlineOpen(false)} />}
    {preferencesOpen && <PreferencesDialog onClose={() => setPreferencesOpen(false)} onPresetChange={(documentSizes, exportScales) => { setDocumentSizePresets(documentSizes); setExportScalePresets(exportScales) }} />}
    {shortcutOpen && <ShortcutDialog shortcuts={shortcuts} onSave={saveShortcuts} onClose={() => setShortcutOpen(false)} />}
  </main>
}
