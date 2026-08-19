import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { CheckCircle2, ExternalLink, GitFork } from 'lucide-react'
import type { ColorMode, ImageResizeInterpolation, StoredWorkspace, TextCelData, ToolRailSide, WorkspaceLayout } from '@shared/types'
import type { AdjustmentKind } from '@/core/adjustments'
import { compositePixelWithLayerColor, getActiveLayer, isLayerEffectivelyVisible, readLayerColorAt } from '@/core/document'
import { blendOver, packColor, unpackColor } from '@/core/raster'
import type { PanelDock, WorkspacePanelId } from '@/components/WorkspacePanels'
import { AppMenuBar } from '@/components/app/AppMenuBar'
import { AppWindowTitleBar } from '@/components/app/AppWindowTitleBar'
import { DocumentTabs, type DocumentTabDockDebugState } from '@/components/app/DocumentTabs'
import { EditorStatusBar } from '@/components/app/EditorStatusBar'
import { BrushDynamicsTelemetryCapture } from '@/components/app/BrushDynamicsTelemetryCapture'
import { EditorWorkspaceShell } from '@/components/app/EditorWorkspaceShell'
import { FloatingDocumentWindow } from '@/components/app/FloatingDocumentWindow'
import { resolveFloatingDocumentReturnTarget } from '@/components/app/floating-document-return'
import { preloadCanvasStage } from '@/components/app/EditorCanvasHost'
import type { QuickCommandSettingsTarget } from '@/components/app/quick-command-registry'
import { TOOL_DEFINITIONS } from '@/components/app/editor-tools'
import { publishCanvasResizePreview } from '@/core/canvas-resize-preview'
import { detectDocumentPixelScale } from '@/core/image-scale-detection'
import { appCoordinatorRenderKey } from '@/components/app/app-render-keys'
import { detachDocumentPaneWorkspace, documentPaneContains, documentPaneLeafIds, moveDocumentPane, removeDocumentPane, splitDocumentPaneFromTab, type DocumentPaneDirection, type DocumentPaneNode, type DocumentPanePlacement } from '@/core/document-pane-layout'
import { NewDocumentDialog } from '@/components/NewDocumentDialog'
import { CanvasResizeDialog } from '@/components/CanvasResizeDialog'
import { ColorReplacementDialog } from '@/components/ColorReplacementDialog'
import { ImageResizeDialog } from '@/components/ImageResizeDialog'
import { OutlineDialog } from '@/components/OutlineDialog'
import { OpenProgressOverlay } from '@/components/OpenProgressOverlay'
import { SaveProgressOverlay } from '@/components/SaveProgressOverlay'
import { AdjustmentDialog } from '@/components/dialogs/AdjustmentDialog'
import { PreferencesDialog, type PreferenceSection } from '@/components/dialogs/PreferencesDialog'
import { SaveAsDialog } from '@/components/dialogs/SaveAsDialog'
import { ShortcutDialog } from '@/components/dialogs/ShortcutDialog'
import { FutureRoadmapDialog } from '@/components/FutureRoadmapDialog'
import { LatestReleaseDialog } from '@/components/LatestReleaseDialog'
import { GridSettingsDialog } from '@/components/GridSettingsDialog'
import { ProjectInfoDialog } from '@/components/ProjectInfoDialog'
import { TimelapseDialog } from '@/components/TimelapseDialog'
import { TextToolDialog } from '@/components/TextToolDialog'
import { WorkspaceManagerDialog } from '@/components/WorkspaceManagerDialog'
import { publishTextToolPreview, TEXT_TOOL_DIALOG_EVENT, type TextToolDialogDetail } from '@/components/text-tool-events'
import { DialogHeader } from '@/components/DialogHeader'
import { FormField } from '@/components/FormField'
import { NumberInput } from '@/components/NumberInput'
import { ModalShell } from '@/components/ModalShell'
import { PixelUtilityIcon } from '@/components/PixelUtilityIcon'
import { TextInput } from '@/components/TextInput'
import { ThemedSelect } from '@/components/ThemedSelect'
import { animationFrameStepDirection, BRUSH_LIBRARY_DELETE_COMMAND_EVENT, COMMAND_SCOPE_EVENT, TILESET_DELETE_COMMAND_EVENT, resolveCopyCommand, resolveDeleteCommand, shouldHandleAnimationPlaybackShortcut, shouldHandleGlobalSelectionEnter, shouldTriggerDeleteCommand, type EditorCommandScope } from '@/core/command-context'
import { formatBytes } from '@/core/resource-policy'
import { adjacentFormInput } from '@/core/form-focus'
import { saveProgress } from '@/core/save-progress'
import { publishBrushLibraryImportPaths } from '@/core/brush-library-events'
import { startDocumentDropService } from '@/platform/document-drop-service'
import { APP_CHANNEL_LABEL } from '@/core/app-meta'
import moonspriteLogo from '@/assets/moonsprite-logo.svg'
import { cloneTextCelData, normalizeTextCelData, rasterizeText } from '@/core/text-raster'
import { getRecentProjects, type RecentProject } from '@/core/home-history'
import { RECENT_EXPORTS_CHANGED_EVENT, loadDocumentExportSettings, loadExportPresets, loadRecentExportPaths, parentDirectoryFromPath, saveExportPresets, withExportFileExtension, type ExportPreset } from '@/core/export-settings'
import { EXPORT_FORMAT_PREFERENCE_KEY, EXPORT_SCALE_PRESETS_KEY, NEW_DOCUMENT_SIZE_PRESETS_KEY, RELATIVE_LUMINANCE_SCOPE_KEY, SAVE_FORMAT_PREFERENCE_KEY, imageExportKindForPreference, loadEditorPreferences, parseDocumentSizePresets, parseExportScalePresets, parseRelativeLuminanceScope, saveEditorPreferences, type RelativeLuminanceScope } from '@/core/file-preferences'
import { applyThemeToDocument } from '@/core/theme'
import { DEFAULT_SHORTCUTS, deriveShortcutConflicts, keyboardEventKey, loadShortcuts, normalizeShortcut, saveShortcuts as persistShortcuts, shortcutReleasedByEvent, shortcutText } from '@/core/shortcuts'
import { beginPaletteSamplingShortcut, endPaletteSamplingShortcut } from '@/core/palette-sampling-shortcut'
import { readStoredString, writeStoredString } from '@/core/storage'
import type { FloatingPosition } from '@/core/panel-preferences'
import { applyCursorPreferences } from '@/platform/cursor-theme'
import { applyAppWindowLayout, initializeAppWindow, readAppWindowLayout, showAppWindow } from '@/platform/app-window'
import { applyToolIconScale, applyUiScale } from '@/platform/ui-scale'
import { ACTIVE_WORKSPACE_STORAGE_KEY, BOTTOM_DOCK_HEIGHT_RATIO_STORAGE_KEY, BOTTOM_DOCK_HEIGHT_STORAGE_KEY, COLOR_SQUARE_ANCHOR_STORAGE_KEY, COLOR_SQUARE_DOCK_STORAGE_KEY, constrainBottomDockHeight, constrainInspectorWidth, constrainLeftDockWidth, DEFAULT_BOTTOM_DOCK_HEIGHT_RATIO, DEFAULT_INSPECTOR_WIDTH_RATIO, DEFAULT_LEFT_DOCK_WIDTH_RATIO, DEFAULT_PANEL_DOCKS, dockSizeRatio, FLOATING_PANEL_STORAGE_KEYS, INSPECTOR_LAYOUT_STORAGE_KEY, INSPECTOR_WIDTH_RATIO_STORAGE_KEY, INSPECTOR_WIDTH_STORAGE_KEY, LEFT_DOCK_WIDTH_RATIO_STORAGE_KEY, LEFT_DOCK_WIDTH_STORAGE_KEY, PANEL_DOCKS_STORAGE_KEY, resolveDockSizeRatio, TOOL_RAIL_SIDE_STORAGE_KEY, loadBottomDockHeight, loadInspectorWidth, loadLeftDockWidth, loadMainWindowState, loadPanelDocks, loadPanelVisibility, loadToolRailSide, normalizeWorkspaceLayout, readLayoutStorage, saveMainWindowState, savePanelDocks, savePanelVisibility, toolRailDockTargetAtPointer, workspaceDockSizesForParent, workspacePanelDockPresence, writeLayoutStorage } from '@/core/workspace-layout-preferences'
import { type ExportOptions, type SaveAsOptions, type TextCelPreview, type TextLayerDraftTarget, useWorkspace } from '@/store/workspace'
import { useI18n } from '@/components/I18nProvider'
import './styles.css'

const LazyHomeWorkspace = lazy(() => import('@/components/HomeWorkspace').then(({ HomeWorkspace }) => ({ default: HomeWorkspace })))
const LazyComponentLibrary = lazy(() => import('@/components/ComponentLibrary').then(({ ComponentLibrary }) => ({ default: ComponentLibrary })))

const defaultShortcuts: Record<string, string> = { ...DEFAULT_SHORTCUTS }

type AdvancedMode = 'tool-options' | 'canvas-only'

interface FloatingDocumentEntry {
  documentId: string
  initialPosition: FloatingPosition
  pinned: boolean
}

const createFloatingDocumentPosition = (documentId: string, anchor: { x: number; y: number }): FloatingPosition => {
  const source = [...document.querySelectorAll<HTMLElement>('[data-document-pane-id]')]
    .find((element) => element.dataset.documentPaneId === documentId)
    ?? document.querySelector<HTMLElement>('.stage-wrap')
  const sourceBounds = source?.getBoundingClientRect()
  const width = Math.min(Math.max(280, window.innerWidth - 16), Math.max(360, Math.min(720, (sourceBounds?.width ?? 720) * 0.72)))
  const height = Math.min(Math.max(200, window.innerHeight - 16), Math.max(240, Math.min(560, (sourceBounds?.height ?? 560) * 0.72)))
  const maxX = Math.max(4, window.innerWidth - width - 4)
  const maxY = Math.max(4, window.innerHeight - height - 4)
  return {
    x: Math.max(4, Math.min(maxX, anchor.x - 48)),
    y: Math.max(4, Math.min(maxY, anchor.y - 14)),
    width,
    height
  }
}

const saveAsFormatForPreference = (value: string | null): SaveAsOptions['format'] => {
  if (value === 'ase' || value === 'aseprite' || value === 'jpeg' || value === 'webp') return value
  if (value === 'png') return 'png-auto'
  return 'moonsprite'
}

const workspaceDockParentSize = (workArea: HTMLElement | null): { width: number; height: number } => {
  const editorBounds = workArea?.parentElement?.getBoundingClientRect()
  const workBounds = workArea?.getBoundingClientRect()
  return {
    width: Math.max(1, editorBounds?.width ?? window.innerWidth),
    height: Math.max(1, workBounds?.height ?? window.innerHeight - 99)
  }
}

const defaultPanelDocks: Record<WorkspacePanelId, PanelDock> = { ...DEFAULT_PANEL_DOCKS }
const defaultInspectorLayout = JSON.stringify({
  order: ['palette', 'color', 'layers', 'brushes', 'tileset', 'preview'],
  verticalWeights: { color: 330, palette: 620, layers: 560, preview: 220, tileset: 280, brushes: 240 },
  bottomWeights: { color: 280, palette: 280, layers: 720, preview: 280, tileset: 360, brushes: 320 }
})
const createBuiltInDefaultWorkspace = (name: string): StoredWorkspace => ({
  id: 'builtin-default',
  name,
  filePath: '',
  updatedAt: '',
  builtIn: true,
  layout: {
    panelDocks: { ...defaultPanelDocks },
    panelVisibility: { color: true, palette: true, layers: true, preview: true, tileset: false, brushes: true },
    inspectorWidth: 300,
    leftDockWidth: 280,
    bottomDockHeight: 220,
    inspectorWidthRatio: DEFAULT_INSPECTOR_WIDTH_RATIO,
    leftDockWidthRatio: DEFAULT_LEFT_DOCK_WIDTH_RATIO,
    bottomDockHeightRatio: DEFAULT_BOTTOM_DOCK_HEIGHT_RATIO,
    toolRailSide: 'right',
    previewOpen: true,
    inspectorLayout: defaultInspectorLayout,
    colorSquareDock: 'left',
    colorSquareAnchor: 'end',
    floatingPanels: { color: null, palette: null, layers: null, preview: null, tileset: null, brushes: null },
    mainWindow: null
  },
  initialLayout: {
    panelDocks: { ...defaultPanelDocks },
    panelVisibility: { color: true, palette: true, layers: true, preview: true, tileset: false, brushes: true },
    inspectorWidth: 300,
    leftDockWidth: 280,
    bottomDockHeight: 220,
    inspectorWidthRatio: DEFAULT_INSPECTOR_WIDTH_RATIO,
    leftDockWidthRatio: DEFAULT_LEFT_DOCK_WIDTH_RATIO,
    bottomDockHeightRatio: DEFAULT_BOTTOM_DOCK_HEIGHT_RATIO,
    toolRailSide: 'right',
    previewOpen: true,
    inspectorLayout: defaultInspectorLayout,
    colorSquareDock: 'left',
    colorSquareAnchor: 'end',
    floatingPanels: { color: null, palette: null, layers: null, preview: null, tileset: null, brushes: null },
    mainWindow: null
  }
})

const persistMainWindowState = async (notifyWorkspaceLayout = true): Promise<void> => {
  const current = await readAppWindowLayout()
  if (!current) return
  const previous = loadMainWindowState()
  if (current.maximized && previous) {
    saveMainWindowState({ ...previous, maximized: true })
    if (notifyWorkspaceLayout) window.dispatchEvent(new Event('moonsprite-workspace-layout-change'))
    return
  }
  if (current.maximized) {
    if (notifyWorkspaceLayout) window.dispatchEvent(new Event('moonsprite-workspace-layout-change'))
    return
  }
  saveMainWindowState(current)
  if (notifyWorkspaceLayout) window.dispatchEvent(new Event('moonsprite-workspace-layout-change'))
}
export default function App() {
  const { t } = useI18n()
  const builtInDefaultWorkspace = useMemo(() => createBuiltInDefaultWorkspace(t('app.workspace.default')), [t])
  const coordinatorRenderKey = useWorkspace(appCoordinatorRenderKey)
  const workspace = useWorkspace.getState()
  const [newOpen, setNewOpen] = useState(false)
  const [canvasResizeOpen, setCanvasResizeOpen] = useState(false)
  const [imageResizeOpen, setImageResizeOpen] = useState(false)
  const [outlineOpen, setOutlineOpen] = useState(false)
  const [colorReplacementOpen, setColorReplacementOpen] = useState(false)
  const [preferencesOpen, setPreferencesOpen] = useState(false)
  const [preferencesInitialSection, setPreferencesInitialSection] = useState<PreferenceSection>('general')
  const [shortcutOpen, setShortcutOpen] = useState(false)
  const [shortcuts, setShortcuts] = useState<Record<string, string>>(loadShortcuts)
  const [adjustmentOpen, setAdjustmentOpen] = useState(false)
  const [adjustmentKind, setAdjustmentKind] = useState<AdjustmentKind>('brightness-contrast')
  const [aboutOpen, setAboutOpen] = useState(false)
  const [componentLibraryOpen, setComponentLibraryOpen] = useState(false)
  const [roadmapOpen, setRoadmapOpen] = useState(false)
  const [latestReleaseOpen, setLatestReleaseOpen] = useState(false)
  const [gridSettingsOpen, setGridSettingsOpen] = useState(false)
  const [projectInfoOpen, setProjectInfoOpen] = useState(false)
  const [timelapseOpen, setTimelapseOpen] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)
  const [saveAsOpen, setSaveAsOpen] = useState(false)
  const [workspaceSaveOpen, setWorkspaceSaveOpen] = useState(false)
  const [workspaceManagerOpen, setWorkspaceManagerOpen] = useState(false)
  const [textToolRequest, setTextToolRequest] = useState<TextToolDialogDetail | null>(null)
  const textPreviewSurfaceRef = useRef<TextCelPreview | null>(null)
  const textLayerDraftRef = useRef<(TextLayerDraftTarget & { documentId: string }) | null>(null)
  const openPreferences = useCallback((section: PreferenceSection = 'general'): void => {
    setPreferencesInitialSection(section)
    setPreferencesOpen(true)
  }, [])
  const openQuickCommandPreferences = useCallback((): void => openPreferences('quickCommands'), [openPreferences])
  const openQuickCommandSettings = useCallback((target: QuickCommandSettingsTarget): void => {
    if (target === 'grid') setGridSettingsOpen(true)
    else openPreferences('appearance')
  }, [openPreferences])
  const [workspaceSaveName, setWorkspaceSaveName] = useState('')
  const [savedWorkspaces, setSavedWorkspaces] = useState<StoredWorkspace[]>([])
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string | null>(null)
  const [workspaceDirectory, setWorkspaceDirectory] = useState('')
  const [workspaceBusy, setWorkspaceBusy] = useState(false)
  const [exportForm, setExportForm] = useState<ExportOptions>({ name: 'MoonSprite-export.png', format: 'png-auto', scalePercent: 100, directory: 'exports', target: 'document', gifFrameRange: 'all', gifDirection: 'forward' })
  const [presetName, setPresetName] = useState('')
  const [presets, setPresets] = useState<ExportPreset[]>(loadExportPresets)
  const [exportPathMenuOpen, setExportPathMenuOpen] = useState(false)
  const [defaultFileDirectories, setDefaultFileDirectories] = useState({ saveDirectory: 'gallery', exportDirectory: 'exports' })
  const [recentExportPaths, setRecentExportPaths] = useState(loadRecentExportPaths)
  const [documentSizePresets, setDocumentSizePresets] = useState(() => parseDocumentSizePresets(readStoredString(NEW_DOCUMENT_SIZE_PRESETS_KEY)))
  const [exportScalePresets, setExportScalePresets] = useState(() => parseExportScalePresets(readStoredString(EXPORT_SCALE_PRESETS_KEY)))
  const [resourceLabel, setResourceLabel] = useState('')
  const [openMenu, setOpenMenu] = useState<string | null>(null)
  const [recentFiles, setRecentFiles] = useState<RecentProject[]>(getRecentProjects)
  const [panelVisibility, setPanelVisibility] = useState<Record<WorkspacePanelId, boolean>>(loadPanelVisibility)
  const [popupPanelId, setPopupPanelId] = useState<WorkspacePanelId | null>(null)
  const [homeOpen, setHomeOpen] = useState(false)
  const [relativeLuminanceScope, setRelativeLuminanceScope] = useState<RelativeLuminanceScope>(() => parseRelativeLuminanceScope(readStoredString(RELATIVE_LUMINANCE_SCOPE_KEY)))
  const [runtimePreferences, setRuntimePreferences] = useState(loadEditorPreferences)
  const [advancedMode, setAdvancedMode] = useState<AdvancedMode | null>(null)
  const [advancedModeNotice, setAdvancedModeNotice] = useState<string | null>(null)
  const [advancedModeNoticeShortcut, setAdvancedModeNoticeShortcut] = useState('')
  const initialDockParentSize = workspaceDockParentSize(null)
  const [inspectorWidth, setInspectorWidth] = useState(() => loadInspectorWidth(window.innerWidth))
  const [panelDocks, setPanelDocks] = useState<Record<WorkspacePanelId, PanelDock>>(loadPanelDocks)
  const [bottomLayersHeight, setBottomLayersHeight] = useState(loadBottomDockHeight)
  const [bottomDockHost, setBottomDockHost] = useState<HTMLElement | null>(null)
  const [leftDockWidth, setLeftDockWidth] = useState(loadLeftDockWidth)
  const [leftDockHost, setLeftDockHost] = useState<HTMLElement | null>(null)
  const [toolRailSide, setToolRailSide] = useState<ToolRailSide>(loadToolRailSide)
  const [toolRailDockPreview, setToolRailDockPreview] = useState<ToolRailSide | null>(null)
  const [workspaceLayoutRevision, setWorkspaceLayoutRevision] = useState(0)
  const [documentPaneLayout, setDocumentPaneLayout] = useState<DocumentPaneNode | null>(null)
  const [documentPaneDockDebug, setDocumentPaneDockDebug] = useState<DocumentTabDockDebugState | null>(null)
  const [paneOnlyDocumentIds, setPaneOnlyDocumentIds] = useState<string[]>([])
  const [workspaceDocumentId, setWorkspaceDocumentId] = useState<string | null>(() => useWorkspace.getState().activeId)
  const [floatingDocuments, setFloatingDocuments] = useState<FloatingDocumentEntry[]>([])
  const resizeStart = useRef<{ x: number; width: number } | null>(null)
  const bottomLayersResizeStart = useRef<{ y: number; height: number } | null>(null)
  const bottomLayersHeightRef = useRef(bottomLayersHeight)
  const preferredBottomLayersHeightRef = useRef(bottomLayersHeight)
  const bottomLayersHeightRatioRef = useRef(resolveDockSizeRatio(readStoredString(BOTTOM_DOCK_HEIGHT_RATIO_STORAGE_KEY), bottomLayersHeight, initialDockParentSize.height, DEFAULT_BOTTOM_DOCK_HEIGHT_RATIO))
  const leftDockResizeStart = useRef<{ x: number; width: number } | null>(null)
  const leftDockWidthRef = useRef(leftDockWidth)
  const preferredLeftDockWidthRef = useRef(leftDockWidth)
  const leftDockWidthRatioRef = useRef(dockSizeRatio(leftDockWidth, initialDockParentSize.width, DEFAULT_LEFT_DOCK_WIDTH_RATIO))
  const toolRailDrag = useRef<{ startX: number; startY: number; moved: boolean; target: ToolRailSide } | null>(null)
  const activeWorkspaceRef = useRef<StoredWorkspace | null>(null)
  const workspaceApplyInProgress = useRef(false)
  const workspaceAutoSaveTimer = useRef<number | null>(null)
  const workspaceAutoSaveQueue = useRef<Promise<void>>(Promise.resolve())
  const commandScopeRef = useRef<EditorCommandScope>('canvas')
  const commandSurfaceRef = useRef<HTMLElement | null>(null)
  const selectionCommandOverrideRef = useRef(false)
  const [workspaceLayoutChange, setWorkspaceLayoutChange] = useState(0)
  const workAreaRef = useRef<HTMLElement>(null)
  const inspectorWidthRef = useRef(inspectorWidth)
  const preferredInspectorWidthRef = useRef(inspectorWidth)
  const inspectorWidthRatioRef = useRef(dockSizeRatio(inspectorWidth, initialDockParentSize.width, DEFAULT_INSPECTOR_WIDTH_RATIO))
  const closeInProgress = useRef(false)
  const session = workspace.sessions.find((item) => item.document.id === workspace.activeId) ?? null
  const floatingDocumentIds = useMemo(() => floatingDocuments.map((item) => item.documentId), [floatingDocuments])
  const hiddenDocumentIds = useMemo(() => [...new Set([...paneOnlyDocumentIds, ...floatingDocumentIds])], [floatingDocumentIds, paneOnlyDocumentIds])

  useEffect(() => setPopupPanelId(null), [homeOpen, session?.document.id])

  useEffect(() => {
    const openTextDialog = (event: Event): void => {
      const detail = (event as CustomEvent<TextToolDialogDetail>).detail
      if (detail?.documentId) setTextToolRequest(detail)
    }
    window.addEventListener(TEXT_TOOL_DIALOG_EVENT, openTextDialog)
    return () => window.removeEventListener(TEXT_TOOL_DIALOG_EVENT, openTextDialog)
  }, [])

  const textToolInitial = useMemo<Partial<TextCelData> | undefined>(() => {
    if (!textToolRequest) return undefined
    const target = workspace.sessions.find((item) => item.document.id === textToolRequest.documentId)
    if (!target) return undefined
    if (!textToolRequest.layerId || !textToolRequest.frameId) return {
      color: { ...target.primaryColor },
      ...(textToolRequest.width ? { boxWidth: textToolRequest.width } : {}),
      ...(textToolRequest.height ? { boxHeight: textToolRequest.height } : {})
    }
    const cel = target?.document.animation?.cels.find((candidate) => candidate.layerId === textToolRequest.layerId && candidate.frameId === textToolRequest.frameId)
    return cel?.text ? cloneTextCelData(cel.text) : { color: { ...target.primaryColor } }
  }, [coordinatorRenderKey, textToolRequest, workspace.sessions])
  const textToolBox = textToolRequest && textToolInitial?.boxWidth && textToolInitial.boxHeight ? {
    x: textToolInitial.originX ?? textToolRequest.x,
    y: textToolInitial.originY ?? textToolRequest.y,
    width: textToolInitial.boxWidth,
    height: textToolInitial.boxHeight
  } : null
  const clearTextToolPreview = useCallback((): void => {
    const request = textToolRequest
    if (!request) return
    if (request.layerId && request.frameId && textPreviewSurfaceRef.current) {
      useWorkspace.getState().setActive(request.documentId)
      useWorkspace.getState().restoreTextCelPreview(request.layerId, request.frameId, textPreviewSurfaceRef.current)
    }
    textPreviewSurfaceRef.current = null
    publishTextToolPreview({ documentId: request.documentId, surface: null, box: null })
  }, [textToolRequest])
  const changeTextTool = useCallback((value: TextCelData): void => {
    const request = textToolRequest
    if (!request) return
    const state = useWorkspace.getState()
    state.setActive(request.documentId)
    const draft = textLayerDraftRef.current
    const x = value.originX ?? request.x
    const y = value.originY ?? request.y
    const box = value.boxWidth && value.boxHeight ? { x, y, width: value.boxWidth, height: value.boxHeight } : null
    if (draft?.documentId === request.documentId) {
      state.updateTextLayerDraft(draft.layerId, draft.frameId, value, x, y)
      publishTextToolPreview({ documentId: request.documentId, surface: null, box })
      return
    }
    if (request.layerId || !value.text.length) return
    const target = state.beginTextLayerDraft(value, x, y)
    if (!target) return
    textLayerDraftRef.current = { ...target, documentId: request.documentId }
    setTextToolRequest((current) => current?.documentId === request.documentId ? { ...current, ...target } : current)
    publishTextToolPreview({ documentId: request.documentId, surface: null, box })
  }, [textToolRequest])
  const previewTextTool = useCallback((value: TextCelData | null): void => {
    const request = textToolRequest
    if (!request) return
    const state = useWorkspace.getState()
    state.setActive(request.documentId)
    const draft = textLayerDraftRef.current
    const x = value?.originX ?? request.x
    const y = value?.originY ?? request.y
    const boxWidth = value?.boxWidth ?? request.width
    const boxHeight = value?.boxHeight ?? request.height
    const box = boxWidth && boxHeight ? { x, y, width: boxWidth, height: boxHeight } : null
    if (draft?.documentId === request.documentId) {
      publishTextToolPreview({ documentId: request.documentId, surface: null, box })
      return
    }
    if (request.layerId && request.frameId) {
      if (textPreviewSurfaceRef.current) state.restoreTextCelPreview(request.layerId, request.frameId, textPreviewSurfaceRef.current)
      textPreviewSurfaceRef.current = value ? state.previewTextCel(request.layerId, request.frameId, value, x, y) : null
      return
    }
    const target = state.sessions.find((item) => item.document.id === request.documentId)
    const preview = value && target
      ? rasterizeText(normalizeTextCelData({ ...value, originX: x, originY: y }, target.primaryColor), x, y).rgba
      : null
    publishTextToolPreview({ documentId: request.documentId, surface: preview, box })
  }, [textToolRequest])
  const visibleDocumentPaneLayout = useMemo(() => {
    if (!workspaceDocumentId) return null
    return documentPaneLayout?.kind === 'split' && documentPaneContains(documentPaneLayout, workspaceDocumentId)
      ? documentPaneLayout
      : null
  }, [documentPaneLayout, workspaceDocumentId])
  void coordinatorRenderKey
  useEffect(() => {
    setDocumentPaneLayout((current) => {
      if (!current) return null
      const validDocumentIds = new Set(workspace.sessions.map((item) => item.document.id))
      let next: DocumentPaneNode | null = current
      for (const documentId of documentPaneLeafIds(current)) {
        if (next && !validDocumentIds.has(documentId)) next = removeDocumentPane(next, documentId) ?? null
      }
      return next?.kind === 'split' ? next : null
    })
  }, [workspace.sessions])
  useEffect(() => {
    const openIds = new Set(workspace.sessions.map((item) => item.document.id))
    setPaneOnlyDocumentIds((current) => documentPaneLayout?.kind === 'split'
      ? current.filter((documentId) => openIds.has(documentId) && documentPaneContains(documentPaneLayout, documentId))
      : [])
  }, [documentPaneLayout, workspace.sessions])
  useEffect(() => {
    const openIds = new Set(workspace.sessions.map((item) => item.document.id))
    setFloatingDocuments((current) => {
      const next = current.filter((item) => openIds.has(item.documentId))
      return next.length === current.length ? current : next
    })
  }, [workspace.sessions])
  useEffect(() => {
    const unavailable = new Set([...paneOnlyDocumentIds, ...floatingDocumentIds])
    const openIds = new Set(workspace.sessions.map((item) => item.document.id))
    const availableIds = workspace.sessions.map((item) => item.document.id).filter((id) => !unavailable.has(id))
    setWorkspaceDocumentId((current) => {
      if (workspace.activeId && openIds.has(workspace.activeId) && !unavailable.has(workspace.activeId)) return workspace.activeId
      if (current && openIds.has(current) && !unavailable.has(current)) return current
      return availableIds.at(-1) ?? null
    })
  }, [floatingDocumentIds, paneOnlyDocumentIds, workspace.activeId, workspace.sessions])
  const saveShortcuts = (next: Record<string, string>): void => { setShortcuts(next); persistShortcuts(next) }
  const blockedShortcuts = useMemo(() => deriveShortcutConflicts(shortcuts).blocked, [shortcuts])
  const shortcutFor = useCallback((id: string): string => shortcuts[id] ?? defaultShortcuts[id] ?? '', [shortcuts])
  useEffect(() => {
    const syncPreferences = (): void => {
      const next = loadEditorPreferences()
      setRuntimePreferences(next)
      setRelativeLuminanceScope(next.relativeLuminanceScope)
      applyThemeToDocument(next.theme)
    }
    window.addEventListener('moonsprite:preferences-changed', syncPreferences)
    return () => window.removeEventListener('moonsprite:preferences-changed', syncPreferences)
  }, [])
  const openColorReplacement = useCallback((): void => {
    if (useWorkspace.getState().activeId) setColorReplacementOpen(true)
  }, [])
  const toggleTimelineVisibility = useCallback((): void => {
    const next = { ...runtimePreferences, timelineHidden: !runtimePreferences.timelineHidden }
    saveEditorPreferences(next)
    setRuntimePreferences(next)
    window.dispatchEvent(new Event('moonsprite:preferences-changed'))
  }, [runtimePreferences])
  const toggleSliceOutlinesVisibility = useCallback((): void => {
    const next = { ...runtimePreferences, sliceOutlinesVisible: !runtimePreferences.sliceOutlinesVisible }
    saveEditorPreferences(next)
    setRuntimePreferences(next)
    window.dispatchEvent(new Event('moonsprite:preferences-changed'))
  }, [runtimePreferences])
  useEffect(() => {
    let disposed = false
    void window.moonSprite.getDefaultFileDirectories().then((directories) => {
      if (!disposed) setDefaultFileDirectories(directories)
    })
    const syncRecentExports = (): void => setRecentExportPaths(loadRecentExportPaths())
    window.addEventListener(RECENT_EXPORTS_CHANGED_EVENT, syncRecentExports)
    return () => {
      disposed = true
      window.removeEventListener(RECENT_EXPORTS_CHANGED_EVENT, syncRecentExports)
    }
  }, [])
  useEffect(() => {
    if (!exportPathMenuOpen) return
    const closePathMenu = (event: PointerEvent): void => {
      if (!(event.target as Element).closest('.export-file-control')) setExportPathMenuOpen(false)
    }
    window.addEventListener('pointerdown', closePathMenu)
    return () => window.removeEventListener('pointerdown', closePathMenu)
  }, [exportPathMenuOpen])
  useEffect(() => {
    const syncShortcuts = (): void => setShortcuts(loadShortcuts())
    window.addEventListener('moonsprite:shortcuts-changed', syncShortcuts)
    return () => window.removeEventListener('moonsprite:shortcuts-changed', syncShortcuts)
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
    void applyUiScale(runtimePreferences.uiScale).catch(() => {
      // Native WebView zoom can be unavailable in browser previews.
    })
  }, [runtimePreferences.uiScale])
  useEffect(() => {
    applyToolIconScale(runtimePreferences.toolIconScale)
  }, [runtimePreferences.toolIconScale])
  useEffect(() => {
    const rememberCommandScope = (event: Event): void => {
      if (event.type === 'pointerdown') selectionCommandOverrideRef.current = false
      const surface = (event.target as HTMLElement | null)?.closest<HTMLElement>('[data-command-scope], .stage-surface')
      const scope = surface?.classList.contains('stage-surface') ? 'canvas' : surface?.dataset.commandScope
      if (scope === 'canvas' || scope === 'layers' || scope === 'palette' || scope === 'tileset' || scope === 'brushes') {
        commandScopeRef.current = scope
        commandSurfaceRef.current = surface ?? null
      }
    }
    const applyCommandScope = (event: Event): void => {
      const detail = (event as CustomEvent<{ scope?: EditorCommandScope; preferSelection?: boolean }>).detail
      const scope = detail?.scope
      if (scope === 'canvas' || scope === 'layers' || scope === 'palette' || scope === 'tileset' || scope === 'brushes') {
        commandScopeRef.current = scope
        commandSurfaceRef.current = null
      }
      selectionCommandOverrideRef.current = detail?.preferSelection === true
    }
    window.addEventListener('pointerdown', rememberCommandScope, true)
    window.addEventListener('focusin', rememberCommandScope, true)
    window.addEventListener(COMMAND_SCOPE_EVENT, applyCommandScope)
    return () => {
      window.removeEventListener('pointerdown', rememberCommandScope, true)
      window.removeEventListener('focusin', rememberCommandScope, true)
      window.removeEventListener(COMMAND_SCOPE_EVENT, applyCommandScope)
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
    setAdvancedModeNotice(t('app.advanced.enabled'))
    setAdvancedModeNoticeShortcut(shortcutFor('advancedMode'))
  }, [advancedMode, shortcutFor])
  const toggleMirrorView = useCallback((axis: 'horizontal' | 'vertical'): void => {
    const active = useWorkspace.getState().sessions.find((item) => item.document.id === useWorkspace.getState().activeId)
    if (!active) return
    const vertical = axis === 'vertical'
    const next = vertical ? !active.view.mirroredVertical : !active.view.mirrored
    workspace.setView(vertical ? { mirroredVertical: next } : { mirrored: next })
    setAdvancedModeNotice(t(`app.mirror.${vertical ? 'vertical' : 'horizontal'}${next ? 'On' : 'Off'}` as 'app.mirror.horizontalOn' | 'app.mirror.horizontalOff' | 'app.mirror.verticalOn' | 'app.mirror.verticalOff'))
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
  useEffect(() => {
    const showPanel = (event: Event): void => {
      const id = (event as CustomEvent<{ id?: WorkspacePanelId }>).detail?.id
      if (id && id in DEFAULT_PANEL_DOCKS) updatePanelVisibility(id, true)
    }
    const hidePanel = (event: Event): void => {
      const id = (event as CustomEvent<{ id?: WorkspacePanelId }>).detail?.id
      if (!id || !(id in DEFAULT_PANEL_DOCKS)) return
      updatePanelVisibility(id, false)
      setPopupPanelId((current) => current === id ? null : current)
    }
    window.addEventListener('moonsprite:show-workspace-panel', showPanel)
    window.addEventListener('moonsprite:hide-workspace-panel', hidePanel)
    return () => {
      window.removeEventListener('moonsprite:show-workspace-panel', showPanel)
      window.removeEventListener('moonsprite:hide-workspace-panel', hidePanel)
    }
  }, [updatePanelVisibility])
  const togglePopupPanel = useCallback((id: WorkspacePanelId): void => {
    if (panelDocks[id] === 'floating') return
    setPopupPanelId((current) => current === id ? null : id)
  }, [panelDocks])
  useEffect(() => {
    if (popupPanelId && panelDocks[popupPanelId] === 'floating') setPopupPanelId(null)
  }, [panelDocks, popupPanelId])
  const updateToolRailSide = useCallback((side: ToolRailSide): void => {
    setToolRailSide(side)
    writeStoredString(TOOL_RAIL_SIDE_STORAGE_KEY, side)
  }, [])
  const previewOpen = panelVisibility.preview
  const dockedPopupPanelId = popupPanelId && panelDocks[popupPanelId] !== 'floating' ? popupPanelId : null
  const dockPresenceVisibility: Record<WorkspacePanelId, boolean> = dockedPopupPanelId && panelVisibility[dockedPopupPanelId]
    ? { ...panelVisibility, [dockedPopupPanelId]: false }
    : panelVisibility
  const visibleDocks = workspacePanelDockPresence(panelDocks, dockPresenceVisibility)
  const hasLeftDock = visibleDocks.left
  const hasBottomDock = visibleDocks.bottom
  const hasRightDock = visibleDocks.right

  const captureWorkspaceLayout = useCallback((): WorkspaceLayout => ({
    panelDocks: { ...panelDocks },
    panelVisibility: { ...panelVisibility },
    inspectorWidth: preferredInspectorWidthRef.current,
    leftDockWidth: preferredLeftDockWidthRef.current,
    bottomDockHeight: preferredBottomLayersHeightRef.current,
    inspectorWidthRatio: inspectorWidthRatioRef.current,
    leftDockWidthRatio: leftDockWidthRatioRef.current,
    bottomDockHeightRatio: bottomLayersHeightRatioRef.current,
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
      const localized = listing.workspaces.map((workspace) => workspace.builtIn ? { ...workspace, name: t('app.workspace.default') } : workspace)
      setSavedWorkspaces(localized)
      return localized
    } catch (error) {
      useWorkspace.getState().setMessage(error instanceof Error ? error.message : t('app.workspace.readError'))
      return []
    }
  }, [t])
  const applySavedMainWindow = async (state: WorkspaceLayout['mainWindow']): Promise<void> => {
    if (!state) return
    saveMainWindowState(state)
    try {
      // Repeating unmaximize -> resize -> maximize redraws the whole native window.
      // The platform adapter skips that work when the saved maximized state already matches.
      await applyAppWindowLayout(state)
    } catch {
      workspace.setMessage(t('app.workspace.windowRestoreError'))
    }
  }
  const applyWorkspaceLayout = async (saved: StoredWorkspace, announce = true): Promise<void> => {
    workspaceApplyInProgress.current = true
    const layout = saved.layout
    const dockParentSize = workspaceDockParentSize(workAreaRef.current)
    const normalized = normalizeWorkspaceLayout(layout, dockParentSize.width, dockParentSize.height)
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
    writeStoredString(INSPECTOR_WIDTH_RATIO_STORAGE_KEY, String(normalized.inspectorWidthRatio))
    writeStoredString(LEFT_DOCK_WIDTH_RATIO_STORAGE_KEY, String(normalized.leftDockWidthRatio))
    writeStoredString(BOTTOM_DOCK_HEIGHT_RATIO_STORAGE_KEY, String(normalized.bottomDockHeightRatio))
    writeStoredString(TOOL_RAIL_SIDE_STORAGE_KEY, nextToolRailSide)
    writeLayoutStorage(INSPECTOR_LAYOUT_STORAGE_KEY, layout.inspectorLayout)
    writeLayoutStorage(COLOR_SQUARE_DOCK_STORAGE_KEY, layout.colorSquareDock)
    writeLayoutStorage(COLOR_SQUARE_ANCHOR_STORAGE_KEY, layout.colorSquareAnchor)
    for (const id of Object.keys(FLOATING_PANEL_STORAGE_KEYS) as WorkspacePanelId[]) writeLayoutStorage(FLOATING_PANEL_STORAGE_KEYS[id], layout.floatingPanels?.[id] ?? null)
    inspectorWidthRef.current = nextInspectorWidth
    preferredInspectorWidthRef.current = nextInspectorWidth
    inspectorWidthRatioRef.current = normalized.inspectorWidthRatio
    leftDockWidthRef.current = nextLeftDockWidth
    preferredLeftDockWidthRef.current = nextLeftDockWidth
    leftDockWidthRatioRef.current = normalized.leftDockWidthRatio
    bottomLayersHeightRef.current = nextBottomHeight
    preferredBottomLayersHeightRef.current = nextBottomHeight
    bottomLayersHeightRatioRef.current = normalized.bottomDockHeightRatio
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
      if (announce) workspace.setMessage(t('app.workspace.loaded', { name: saved.name }))
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
      workspace.setMessage(t('app.workspace.saved', { name: saved.name }))
      setWorkspaceSaveOpen(false)
    } catch (error) {
      workspace.setMessage(error instanceof Error ? error.message : t('app.workspace.saveError'))
    } finally {
      setWorkspaceBusy(false)
    }
  }
  const resetCurrentWorkspace = async (): Promise<void> => {
    const current = activeWorkspaceRef.current
    if (!current || current.id !== activeWorkspaceId) {
      workspace.setMessage(t('app.workspace.loadFirst'))
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
      workspace.setMessage(t('app.workspace.reset', { name: current.name }))
    } catch (error) {
      workspaceApplyInProgress.current = false
      workspace.setMessage(error instanceof Error ? error.message : t('app.workspace.resetError'))
    }
  }
  const deleteSavedWorkspace = async (saved: StoredWorkspace): Promise<void> => {
    if (saved.builtIn) {
      workspace.setMessage(t('app.workspace.builtInDelete'))
      return
    }
    const choice = await workspace.requestDialog({
      title: t('app.workspace.deleteTitle'),
      message: t('app.workspace.deleteMessage', { name: saved.name }),
      detail: t('app.workspace.deleteDetail'),
      choices: [{ id: 'cancel', label: t('common.cancel'), tone: 'quiet' }, { id: 'delete', label: t('common.delete'), tone: 'danger' }]
    })
    if (choice !== 'delete') return
    try {
      await window.moonSprite.deleteWorkspace(saved.id)
      if (activeWorkspaceId === saved.id) {
        const fallback = savedWorkspaces.find((item) => item.builtIn) ?? builtInDefaultWorkspace
        await applyWorkspaceLayout(fallback, false)
      }
      await loadSavedWorkspaces()
      workspace.setMessage(t('app.workspace.deleted', { name: saved.name }))
    } catch (error) {
      workspace.setMessage(error instanceof Error ? error.message : t('app.workspace.deleteError'))
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
        workspace.setMessage(t('app.workspace.autosaveError'))
      })
    }, 320)
    return () => {
      if (workspaceAutoSaveTimer.current !== null) {
        window.clearTimeout(workspaceAutoSaveTimer.current)
        workspaceAutoSaveTimer.current = null
      }
    }
  }, [activeWorkspaceId, bottomLayersHeight, captureWorkspaceLayout, inspectorWidth, leftDockWidth, panelDocks, panelVisibility, previewOpen, toolRailSide, workspaceLayoutChange, workspaceLayoutRevision])

  const openExport = (requestedTarget?: NonNullable<ExportOptions['target']>): void => {
    if (!session) return
    const preferences = loadEditorPreferences()
    const remembered = loadDocumentExportSettings(session.document)
    const preferredFormat = imageExportKindForPreference(readStoredString(EXPORT_FORMAT_PREFERENCE_KEY))
    const frameCount = session.document.animation?.frames.length ?? 1
    const defaultFormat = requestedTarget === 'frames' ? (preferredFormat === 'gif' ? 'png-auto' : preferredFormat) : frameCount > 1 ? 'gif' : preferredFormat
    const format = requestedTarget === 'frames' && remembered?.format === 'gif' ? 'png-auto' : remembered?.format ?? defaultFormat
    let target = requestedTarget ?? remembered?.target ?? 'document'
    if (format === 'gif' && target === 'frames') target = 'document'
    else if (target === 'frames' && requestedTarget !== 'frames' && frameCount <= 1) target = 'document'
    else if (target === 'slices' && !session.document.slices?.length) target = 'document'
    const sliceId = target === 'slices' && remembered?.sliceId && session.document.slices?.some((slice) => slice.id === remembered.sliceId)
      ? remembered.sliceId
      : undefined
    const defaultScale = format === 'svg' ? 100 : exportScalePresets.includes(100) ? 100 : exportScalePresets[0] ?? 100
    const documentName = session.document.name.replace(/\.(moonsprite|aseprite|ase|png|jpe?g|webp|svg|gif)$/i, '') || 'MoonSprite-export'
    const gifFrameLimit = Math.max(1, frameCount)
    setExportForm({
      name: withExportFileExtension(remembered?.name ?? documentName, format),
      format,
      scalePercent: remembered?.scalePercent ?? defaultScale,
      directory: remembered?.directory || preferences.exportDirectory || defaultFileDirectories.exportDirectory,
      target,
      ...(sliceId ? { sliceId } : {}),
      gifFrameRange: remembered?.gifFrameRange ?? 'all',
      ...(remembered?.gifFrameStart !== undefined ? { gifFrameStart: Math.min(gifFrameLimit, remembered.gifFrameStart) } : {}),
      ...(remembered?.gifFrameEnd !== undefined ? { gifFrameEnd: Math.min(gifFrameLimit, remembered.gifFrameEnd) } : {}),
      gifDirection: remembered?.gifDirection ?? 'forward'
    })
    const rememberedPresetName = remembered?.presetName ?? ''
    setPresetName(presets.some((preset) => preset.presetName === rememberedPresetName && preset.format === format && (preset.target ?? 'document') === target) ? rememberedPresetName : '')
    setExportPathMenuOpen(false)
    setExportOpen(true)
  }

  const chooseExportDirectory = async (): Promise<void> => {
    const result = await window.moonSprite.chooseDirectory(exportForm.directory || defaultFileDirectories.exportDirectory)
    if (!result.canceled && result.directoryPath) setExportForm((current) => ({ ...current, directory: result.directoryPath }))
    setExportPathMenuOpen(false)
  }

  const useRecentExportDirectory = (filePath: string): void => {
    const directory = parentDirectoryFromPath(filePath)
    if (directory) setExportForm((current) => ({ ...current, directory }))
    setExportPathMenuOpen(false)
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
    const opened = await useWorkspace.getState().openPath(filePath, keepHomeOpen ? undefined : { onBeforeSession: () => setHomeOpen(false) })
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
      workspace.setMessage(t('app.project.notSaved'))
      return
    }
    void window.moonSprite.openProjectInFolder(sourcePath).then(() => {
      workspace.setMessage(t('app.project.folderOpened'))
    }).catch((error) => {
      workspace.setMessage(error instanceof Error ? error.message : t('app.project.folderError'))
    })
  }

  const createDocumentAndShow = async (name: string, width: number, height: number, mode: ColorMode, recordDrawing: boolean): Promise<void> => {
    const beforeIds = new Set(useWorkspace.getState().sessions.map((item) => item.document.id))
    await useWorkspace.getState().newDocument(name, width, height, mode, recordDrawing)
    const created = useWorkspace.getState().sessions.find((item) => !beforeIds.has(item.document.id))
    if (!created) return
    setHomeOpen(false)
    setWorkspaceDocumentId(created.document.id)
    const focusCanvas = (attempt = 0): void => {
      window.requestAnimationFrame(() => {
        if (useWorkspace.getState().activeId !== created.document.id) return
        const canvas = [...document.querySelectorAll<HTMLCanvasElement>('.stage-canvas')]
          .find((candidate) => candidate.dataset.documentId === created.document.id)
        if (canvas && !document.querySelector('.modal-backdrop')) {
          canvas.tabIndex = -1
          canvas.focus({ preventScroll: true })
          return
        }
        if (attempt < 12) focusCanvas(attempt + 1)
      })
    }
    focusCanvas()
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
  }, [])

  useEffect(() => {
    if (!runtimePreferences.recovery) return
    // Recovery encoding walks and compresses the full dirty document on the
    // renderer thread. Keep it interval-driven so switching windows never
    // queues that work for the first frame after focus returns.
    const interval = window.setInterval(() => { void useWorkspace.getState().autosaveDirty() }, runtimePreferences.recoveryMinutes * 60_000)
    return () => window.clearInterval(interval)
  }, [runtimePreferences.recovery, runtimePreferences.recoveryMinutes])

  useEffect(() => {
    let disposed = false
    let saveTimer: number | null = null
    let removeGeometryObservers: (() => void) | null = null
    const scheduleSave = (): void => {
      if (saveTimer !== null) window.clearTimeout(saveTimer)
      saveTimer = window.setTimeout(() => {
        saveTimer = null
        void persistMainWindowState()
      }, 220)
    }
    const setup = async (): Promise<void> => {
      const stored = loadMainWindowState()
      const removeObservers = await initializeAppWindow(stored, scheduleSave)
      if (!stored) await persistMainWindowState()
      if (disposed) removeObservers()
      else removeGeometryObservers = removeObservers
    }
    void setup().catch(() => {
      /* Keep the configured default window when restoration is unavailable, but never leave it invisible. */
      void showAppWindow().catch(() => {})
    })
    return () => {
      disposed = true
      if (saveTimer !== null) window.clearTimeout(saveTimer)
      removeGeometryObservers?.()
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
        const choice = await useWorkspace.getState().requestDialog({ title: t('app.unsaved.title'), message: t('app.unsaved.message', { name: item.document.name }), detail: t('app.unsaved.detail'), choices: [{ id: 'cancel', label: t('common.cancel'), tone: 'quiet' }, { id: 'discard', label: t('app.discard'), tone: 'danger' }, { id: 'save', label: t('common.save'), tone: 'primary' }] })
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
      claimPaths: (paths, position) => {
        if (!position) return false
        const target = document.elementFromPoint(position.x, position.y)
        if (!target?.closest('[data-brush-library-dropzone]')) return false
        publishBrushLibraryImportPaths(paths)
        return true
      },
      onOpened: () => setHomeOpen(false)
    })
  }, [])

  useEffect(() => {
    const move = (event: PointerEvent): void => {
      const drag = toolRailDrag.current
      if (!drag) return
      if (!drag.moved && Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < 4) return
      drag.moved = true
      drag.target = toolRailDockTargetAtPointer(event.clientX, event.clientY, window.innerWidth, window.innerHeight)
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
      const parentWidth = workspaceDockParentSize(workAreaRef.current).width
      const next = constrainInspectorWidth(resizeStart.current.width - (event.clientX - resizeStart.current.x), parentWidth)
      inspectorWidthRef.current = next
      preferredInspectorWidthRef.current = next
      inspectorWidthRatioRef.current = dockSizeRatio(next, parentWidth, DEFAULT_INSPECTOR_WIDTH_RATIO)
      setInspectorWidth(next)
    }
    const up = (): void => {
      if (resizeStart.current) {
        writeStoredString(INSPECTOR_WIDTH_STORAGE_KEY, String(Math.round(inspectorWidthRef.current)))
        writeStoredString(INSPECTOR_WIDTH_RATIO_STORAGE_KEY, String(inspectorWidthRatioRef.current))
      }
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
      const parentWidth = workspaceDockParentSize(workAreaRef.current).width
      const next = constrainLeftDockWidth(drag.width + event.clientX - drag.x, parentWidth)
      leftDockWidthRef.current = next
      preferredLeftDockWidthRef.current = next
      leftDockWidthRatioRef.current = dockSizeRatio(next, parentWidth, DEFAULT_LEFT_DOCK_WIDTH_RATIO)
      setLeftDockWidth(next)
    }
    const up = (): void => {
      if (!leftDockResizeStart.current) return
      leftDockResizeStart.current = null
      writeStoredString(LEFT_DOCK_WIDTH_STORAGE_KEY, String(Math.round(leftDockWidthRef.current)))
      writeStoredString(LEFT_DOCK_WIDTH_RATIO_STORAGE_KEY, String(leftDockWidthRatioRef.current))
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
      const next = constrainBottomDockHeight(drag.height - (event.clientY - drag.y), workArea.height)
      bottomLayersHeightRef.current = next
      preferredBottomLayersHeightRef.current = next
      bottomLayersHeightRatioRef.current = dockSizeRatio(next, workArea.height, DEFAULT_BOTTOM_DOCK_HEIGHT_RATIO)
      setBottomLayersHeight(next)
    }
    const up = (): void => {
      if (!bottomLayersResizeStart.current) return
      bottomLayersResizeStart.current = null
      writeStoredString(BOTTOM_DOCK_HEIGHT_STORAGE_KEY, String(Math.round(bottomLayersHeightRef.current)))
      writeStoredString(BOTTOM_DOCK_HEIGHT_RATIO_STORAGE_KEY, String(bottomLayersHeightRatioRef.current))
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    return () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up) }
  }, [])

  useEffect(() => {
    let frame: number | null = null
    const resize = (): void => {
      if (frame !== null) window.cancelAnimationFrame(frame)
      frame = window.requestAnimationFrame(() => {
        frame = null
        const parentSize = workspaceDockParentSize(workAreaRef.current)
        const { inspectorWidth: nextInspector, leftDockWidth: nextLeft, bottomDockHeight: nextBottom } = workspaceDockSizesForParent(
          preferredInspectorWidthRef.current,
          preferredLeftDockWidthRef.current,
          bottomLayersHeightRatioRef.current,
          parentSize.width,
          parentSize.height
        )
        inspectorWidthRef.current = nextInspector
        leftDockWidthRef.current = nextLeft
        bottomLayersHeightRef.current = nextBottom
        preferredBottomLayersHeightRef.current = nextBottom
        setInspectorWidth(nextInspector)
        setLeftDockWidth(nextLeft)
        setBottomLayersHeight(nextBottom)
      })
    }
    window.addEventListener('resize', resize)
    return () => {
      window.removeEventListener('resize', resize)
      if (frame !== null) window.cancelAnimationFrame(frame)
    }
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
        const hasOwnedPopover = Boolean(document.querySelector('.document-tab-context-menu, .tool-flyout, .brush-library, .brush-size-popover'))
        const dialogChoice = workspace.dialog?.choices.find((choice) => choice.id === 'cancel')?.id ?? workspace.dialog?.choices.find((choice) => choice.tone === 'quiet')?.id
        if (workspace.dialog && dialogChoice) workspace.resolveDialog(dialogChoice)
        else if (saveProgress.getSnapshot().phase !== 'hidden') saveProgress.dismiss()
        else if (workspace.saveProgress) { if (!workspace.saveProgress.requiresConfirmation) workspace.dismissSaveProgress() }
        else if (adjustmentOpen) window.dispatchEvent(new CustomEvent('moonsprite:close-dialog', { detail: { target: 'adjustment' } }))
        else if (document.querySelector('.layer-modal')) window.dispatchEvent(new CustomEvent('moonsprite:close-dialog', { detail: { target: 'layers' } }))
        else if (hasPaletteSurface) window.dispatchEvent(new CustomEvent('moonsprite:close-dialog', { detail: { target: 'palette' } }))
        else if (newOpen) setNewOpen(false)
        else if (canvasResizeOpen) setCanvasResizeOpen(false)
        else if (imageResizeOpen) setImageResizeOpen(false)
        else if (outlineOpen) setOutlineOpen(false)
        else if (colorReplacementOpen) setColorReplacementOpen(false)
        else if (preferencesOpen) setPreferencesOpen(false)
        else if (shortcutOpen) setShortcutOpen(false)
        else if (aboutOpen) setAboutOpen(false)
        else if (componentLibraryOpen) setComponentLibraryOpen(false)
        else if (roadmapOpen) setRoadmapOpen(false)
        else if (latestReleaseOpen) setLatestReleaseOpen(false)
        else if (gridSettingsOpen) setGridSettingsOpen(false)
        else if (timelapseOpen) setTimelapseOpen(false)
        else if (projectInfoOpen) setProjectInfoOpen(false)
        else if (exportOpen) setExportOpen(false)
        else if (saveAsOpen) setSaveAsOpen(false)
        else if (workspaceSaveOpen) setWorkspaceSaveOpen(false)
        else if (workspaceManagerOpen) setWorkspaceManagerOpen(false)
        else if (openMenu) setOpenMenu(null)
        else if (popupPanelId) setPopupPanelId(null)
        else if (hasOwnedPopover) window.dispatchEvent(new CustomEvent('moonsprite:close-dialog', { detail: { target: 'popover' } }))
        else if (session?.pendingPaste) workspace.cancelFloatingPaste()
        else if (session?.textBoxTransform) workspace.cancelTextBoxTransform()
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
      if (matches('addForegroundToPalette') && !isTextEntry) {
        event.preventDefault()
        event.stopPropagation()
        target?.blur()
        if (session && !event.repeat) beginPaletteSamplingShortcut()
        return
      }
      if (matches('transform') && !isTextEntry) {
        event.preventDefault()
        event.stopPropagation()
        if (!event.repeat) {
          workspace.beginLayerTransform()
        }
        return
      }
      if (!isTextEntry && (matches('undo') || matches('redo'))) {
        event.preventDefault()
        event.stopPropagation()
        matches('undo') ? workspace.undo() : workspace.redo()
        return
      }
      if (target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.tagName === 'SELECT') return
      const keyboardSurfaceBlocked = event.defaultPrevented || Boolean(document.querySelector('.modal-backdrop')) || Boolean(openMenu)
      if (!keyboardSurfaceBlocked && session && !session.selection
        && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey
        && (key === 'arrowup' || key === 'arrowdown')) {
        event.preventDefault()
        event.stopPropagation()
        workspace.stepLayerSelection(key === 'arrowup' ? -1 : 1)
        return
      }
      const frameStep = animationFrameStepDirection({ key, hasSelection: Boolean(session?.selection), ctrlKey: event.ctrlKey, metaKey: event.metaKey, shiftKey: event.shiftKey, altKey: event.altKey })
      if (!keyboardSurfaceBlocked && frameStep && !runtimePreferences.timelineHidden && session?.document.animation && session.document.animation.frames.length > 1) {
        event.preventDefault()
        event.stopPropagation()
        workspace.stepAnimationFrame(frameStep)
        return
      }
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
        else workspace.setMessage(t('app.selection.required'))
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
      if (!keyboardSurfaceBlocked && !isTextEntry && runCommand('createBrushFromSelection', () => {
        if (session?.selection) workspace.createBrushFromSelection()
        else workspace.setMessage(t('app.brushSelection.required'))
      })) return
      if (session?.selection && runCommand('deselect', () => {
        const label = t('app.selection.cancelHistory')
        if (session.pendingPaste) workspace.commitFloatingPaste(label)
        else workspace.commitSelectionChange({ ...session.selection! }, null, label)
      })) return
      if (session?.selectedAnimationCellKeys.length && !selectionCommandOverrideRef.current && runCommand('copyAnimationCel', () => workspace.copySelectedAnimationCels())) return
      if (runCommand('openHome', () => setHomeOpen(true))) return
      if (runCommand('newDocument', () => setNewOpen(true))) return
      if (runCommand('openDocument', () => { void openFilesAndShowDocument() })) return
      if (runCommand('save', () => { void workspace.saveActive() })) return
      if (runCommand('exportDocument', openExport)) return
      if (runCommand('exportAllFrames', () => openExport('frames'))) return
      if (runCommand('exportSpriteSheet', () => { if (session) void workspace.createSpriteSheetFromActive() })) return
      if (runCommand('closeDocument', () => { if (workspace.activeId) void workspace.closeDocument(workspace.activeId) })) return
      if (runCommand('openProjectFolder', () => { if (session) openProjectFolder(session.document.id) })) return
      if (runCommand('openTimelapse', () => { if (session) setTimelapseOpen(true) })) return
      if (runCommand('openProjectInfo', () => { if (session) setProjectInfoOpen(true) })) return
      if (session?.selectedAnimationMaskCellKeys.length && !selectionCommandOverrideRef.current && runCommand('copy', () => workspace.copySelectedAnimationMasks())) return
      if (session?.selectedAnimationCellKeys.length && !selectionCommandOverrideRef.current && runCommand('copy', () => workspace.copySelectedAnimationCels())) return
      if (session?.selectedAnimationFrameIds.length && runCommand('copy', () => workspace.copySelectedAnimationFrames())) return
      if (runCommand('copy', () => {
        const target = selectionCommandOverrideRef.current && session?.selection
          ? 'selection'
          : resolveCopyCommand(commandScopeRef.current, Boolean(session?.selection))
        if (target === 'layers') workspace.copySelectedLayersToClipboard()
        else if (target === 'selection') workspace.copySelection()
        else if (commandScopeRef.current === 'palette') workspace.setMessage(t('app.palette.copyUnsupported'))
        else if (session?.selectedLayerIds.length || session?.selectedGroupIds.length) workspace.copySelectedLayersToClipboard()
        else workspace.setMessage(t('app.copy.required'))
      })) return
      if (runCommand('cut', () => workspace.cutSelection())) return
      if (runCommand('paste', () => {
        if (!session || (!session.activeLayerMaskId && session.selectedLayerIds.length === 0 && session.selectedGroupIds.length === 0 && !session.selectedGroupId)) {
          workspace.setMessage(t('workspace.clipboard.selectTarget'))
          return
        }
        if (session?.selectedAnimationMaskCellKeys.length && !selectionCommandOverrideRef.current && session.animationMaskClipboard.length) { workspace.pasteAnimationMasks(); return }
        if (session?.activeLayerMaskId) { void workspace.pasteSelection(); return }
        if (session?.selectedAnimationCellKeys.length && !selectionCommandOverrideRef.current && session.animationCellClipboard.length) { workspace.pasteAnimationCels(); return }
        if (session?.selectedAnimationFrameIds.length && session.animationFrameClipboard.length) { workspace.pasteAnimationFrames(); return }
        if (commandScopeRef.current === 'layers' && workspace.pasteLayersFromClipboard()) return
        if (commandScopeRef.current === 'palette') { workspace.setMessage(t('app.palette.pasteUnsupported')); return }
        if (!session?.selection && workspace.pasteLayersFromClipboard()) return
        void workspace.pasteSelection()
      })) return
      if (runCommand('pasteAsNewLayer', () => { void workspace.pasteAsNewLayer() })) return
      if (runCommand('pasteAsNewDocument', () => { void workspace.pasteAsNewDocument() })) return
      if (runCommand('swapForegroundBackground', () => workspace.swapPrimarySecondaryColors())) return
      if (runCommand('replaceColor', () => { if (session) setColorReplacementOpen(true) })) return
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
      if (runCommand('openPreferences', () => openPreferences())) return
      if (runCommand('canvasResize', () => { if (session) setCanvasResizeOpen(true) })) return
      if (runCommand('imageResize', () => { if (session) setImageResizeOpen(true) })) return
      if (runCommand('convertColorMode', () => {
        if (!session) return
        const modes: ColorMode[] = ['rgba', 'indexed', 'grayscale']
        void workspace.convertColorMode(modes[(modes.indexOf(session.document.colorMode) + 1) % modes.length])
      })) return
      if (runCommand('createLayerGroup', () => workspace.createLayerGroup())) return
      if (runCommand('toggleClippingMask', () => workspace.toggleActiveClippingMask())) return
      if (runCommand('toggleSelectedLayerVisibility', () => {
        if (!session) return
        const layerIds = session.selectedLayerIds.length > 0 ? session.selectedLayerIds : [session.document.activeLayerId]
        for (const layerId of layerIds) workspace.toggleLayerVisibility(layerId)
        for (const groupId of session.selectedGroupIds) workspace.toggleGroupVisibility(groupId)
      })) return
      if (runCommand('toggleSelectedLayerLock', () => {
        if (!session) return
        const layerIds = session.selectedLayerIds.length > 0 ? session.selectedLayerIds : [session.document.activeLayerId]
        for (const layerId of layerIds) {
          const layer = session.document.layers.find((candidate) => candidate.id === layerId)
          if (layer) workspace.setLayerPropertiesWithBlend(layer.id, layer.name, layer.opacity, layer.blendMode, !layer.locked, layer.displayColor, layer.description)
        }
        for (const groupId of session.selectedGroupIds) {
          const group = session.document.groups.find((candidate) => candidate.id === groupId)
          if (group) workspace.setGroupProperties(group.id, group.name, group.opacity, group.blendMode, !group.locked, group.displayColor, group.description, group.cumulativeBlend)
        }
      })) return
      if (runCommand('toggleSelectedGroupCollapsed', () => {
        if (!session) return
        for (const groupId of session.selectedGroupIds) workspace.toggleGroupCollapsed(groupId)
      })) return
      if (runCommand('newLayer', () => { void workspace.addLayer() })) return
      if (runCommand('previousAnimationFrame', () => { if (session && !runtimePreferences.timelineHidden) workspace.stepAnimationFrame(-1) })) return
      if (runCommand('nextAnimationFrame', () => { if (session && !runtimePreferences.timelineHidden) workspace.stepAnimationFrame(1) })) return
      if (runCommand('addAnimationFrame', () => { if (session && !runtimePreferences.timelineHidden) workspace.duplicateAnimationFrame() })) return
      if (runCommand('addLinkedAnimationFrame', () => { if (session && !runtimePreferences.timelineHidden) workspace.addLinkedAnimationFrame() })) return
      if (runCommand('addBlankAnimationFrame', () => { if (session && !runtimePreferences.timelineHidden) workspace.addAnimationFrame() })) return
      if (runCommand('deleteAnimationFrame', () => { if (session && !runtimePreferences.timelineHidden) workspace.deleteSelectedAnimationItems() })) return
      if (runCommand('duplicateLayer', () => workspace.duplicateActiveLayer())) return
      if (runCommand('mergeLayerDown', () => workspace.mergeActiveLayerDown())) return
      if (runCommand('mergeSelectedLayers', () => workspace.mergeSelectedLayers())) return
      if (runCommand('mergeLayerGroup', () => workspace.mergeSelectedGroup())) return
      if (runCommand('mergeVisibleLayers', () => workspace.mergeVisibleLayers())) return
      if (runCommand('ungroupLayers', () => workspace.ungroupSelected())) return
      if (runCommand('relativeLuminance', () => { if (session) workspace.setView({ relativeLuminance: !session.view.relativeLuminance }) })) return
      if (runCommand('mirrorView', () => { if (session) toggleMirrorView('horizontal') })) return
      if (runCommand('mirrorViewVertical', () => { if (session) toggleMirrorView('vertical') })) return
      if (runCommand('toggleGrid', () => { if (session) workspace.togglePixelGrid() })) return
      if (runCommand('toggleCustomGrid', () => { if (session) workspace.toggleGrid() })) return
      if (runCommand('openGridSettings', () => { if (session) setGridSettingsOpen(true) })) return
      if (runCommand('toggleSelectionOutline', () => { if (session) workspace.toggleSelectionOutline() })) return
      if (runCommand('rotateViewClockwise90', () => { if (session) workspace.setView({ rotation: (session.view.rotation + 90) % 360 }) })) return
      if (runCommand('rotateViewCounterClockwise90', () => { if (session) workspace.setView({ rotation: (session.view.rotation + 270) % 360 }) })) return
      if (runCommand('resetView', () => { if (session) workspace.setView({ zoom: 16, panX: 0, panY: 0, rotation: 0, mirrored: false, mirroredVertical: false }) })) return
      if (runCommand('toggleColorPanel', () => updatePanelVisibility('color', !panelVisibility.color))) return
      if (runCommand('togglePalettePanel', () => updatePanelVisibility('palette', !panelVisibility.palette))) return
      if (runCommand('toggleLayersPanel', () => updatePanelVisibility('layers', !panelVisibility.layers))) return
      if (runCommand('togglePreviewPanel', () => updatePanelVisibility('preview', !panelVisibility.preview))) return
      if (runCommand('toggleTilesetPanel', () => updatePanelVisibility('tileset', !panelVisibility.tileset))) return
      if (runCommand('toggleBrushLibraryPanel', () => updatePanelVisibility('brushes', !panelVisibility.brushes))) return
      if (runCommand('popupColorPanel', () => togglePopupPanel('color'))) return
      if (runCommand('popupPalettePanel', () => togglePopupPanel('palette'))) return
      if (runCommand('popupLayersPanel', () => togglePopupPanel('layers'))) return
      if (runCommand('popupPreviewPanel', () => togglePopupPanel('preview'))) return
      if (runCommand('popupTilesetPanel', () => togglePopupPanel('tileset'))) return
      if (runCommand('popupBrushLibraryPanel', () => togglePopupPanel('brushes'))) return
      if (runCommand('toggleTimeline', toggleTimelineVisibility)) return
      if (runCommand('toolRailLeft', () => updateToolRailSide('left'))) return
      if (runCommand('toolRailRight', () => updateToolRailSide('right'))) return
      if (runCommand('toolRailTop', () => updateToolRailSide('top'))) return
      if (runCommand('toolRailBottom', () => updateToolRailSide('bottom'))) return
      if (runCommand('saveWorkspaceLayout', () => { setWorkspaceSaveName(''); setWorkspaceSaveOpen(true) })) return
      if (runCommand('openWorkspaceManager', () => { void loadSavedWorkspaces(); setWorkspaceManagerOpen(true) })) return
      if (runCommand('openComponentLibrary', () => setComponentLibraryOpen(true))) return
      if (runCommand('openLatestRelease', () => setLatestReleaseOpen(true))) return
      if (runCommand('openRoadmap', () => setRoadmapOpen(true))) return
      if (runCommand('openAbout', () => setAboutOpen(true))) return
      if (runCommand('magic', () => { workspace.setTool('selection'); workspace.setSelectionKind('magic') })) return
      if (runCommand('lasso', () => { workspace.setTool('selection'); workspace.setSelectionKind('lasso') })) return
      if (runCommand('polygonLasso', () => { workspace.setTool('selection'); workspace.setSelectionKind('polygon-lasso') })) return
      if (runCommand('tool.selection.ellipse', () => { workspace.setTool('selection'); workspace.setSelectionKind('ellipse') })) return
      if (runCommand('tool.selection', () => { workspace.setTool('selection'); workspace.setSelectionKind('rectangle') })) return
      if (runCommand('tool.fill.gradient', () => { workspace.setTool('fill'); workspace.setFillKind('gradient') })) return
      if (runCommand('tool.fill', () => { workspace.setTool('fill'); workspace.setFillKind('bucket') })) return
      if (runCommand('tool.shape.rectangleOutline', () => { workspace.setTool('shape'); workspace.setShapeKind('rectangle-outline') })) return
      if (runCommand('tool.shape.rectangle', () => { workspace.setTool('shape'); workspace.setShapeKind('rectangle') })) return
      if (runCommand('tool.shape.ellipseOutline', () => { workspace.setTool('shape'); workspace.setShapeKind('ellipse-outline') })) return
      if (runCommand('tool.shape.ellipse', () => { workspace.setTool('shape'); workspace.setShapeKind('ellipse') })) return
      if (runCommand('tool.curve', () => { workspace.setTool('line'); workspace.setLineKind('curve') })) return
      if (runCommand('tool.line', () => { workspace.setTool('line'); workspace.setLineKind('line') })) return
      if (runCommand('tool.text', () => workspace.setTool('text'))) return
      if (runCommand('tool.slice', () => { workspace.setTool('move'); workspace.setMoveKind('slice') })) return
      if (event.key === 'Enter' && session?.selection && shouldHandleGlobalSelectionEnter(outlineOpen, true)) {
        event.preventDefault()
        if (session.pendingPaste) workspace.commitFloatingPaste()
        const active = useWorkspace.getState().sessions.find((item) => item.document.id === session.document.id)
        if (active?.selection) workspace.commitSelectionChange(active.selection, null, t('app.selection.completeHistory'))
        return
      }
      if (event.key === 'Enter' && session?.textBoxTransform) {
        event.preventDefault()
        workspace.cancelTextBoxTransform()
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
        if (commandScopeRef.current === 'canvas' && session?.tool === 'move' && session.moveKind === 'slice' && (session.selectedSliceIds?.length || session.selectedSliceId)) { workspace.deleteSlices(session.selectedSliceIds?.length ? session.selectedSliceIds : [session.selectedSliceId!]); return }
        const target = resolveDeleteCommand(commandScopeRef.current, Boolean(session?.selection))
        if (target === 'layers' && (session?.selectedLayerIds.length || session?.selectedGroupIds.length)) { workspace.deleteSelectedLayers(); return }
        if (target === 'tileset') {
          const surface = commandSurfaceRef.current
          if (surface?.isConnected && surface.dataset.commandScope === 'tileset') surface.dispatchEvent(new Event(TILESET_DELETE_COMMAND_EVENT))
          return
        }
        if (target === 'brushes') {
          const surface = commandSurfaceRef.current
          if (surface?.isConnected && surface.dataset.commandScope === 'brushes') surface.dispatchEvent(new Event(BRUSH_LIBRARY_DELETE_COMMAND_EVENT))
          return
        }
        if (session?.selectedAnimationMaskCellKeys.length && !selectionCommandOverrideRef.current) { workspace.deleteSelectedLayerMasks(); return }
        if ((session?.selectedAnimationCellKeys.length || session?.selectedAnimationFrameIds.length) && !selectionCommandOverrideRef.current) { workspace.deleteSelectedAnimationItems(); return }
        if (target === 'palette' && session?.selectedPaletteIds.length) workspace.deletePaletteColors(session.selectedPaletteIds)
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
    const keyup = (event: KeyboardEvent): void => {
      if (event.key === 'Alt') event.preventDefault()
      const shortcut = shortcuts.addForegroundToPalette ?? defaultShortcuts.addForegroundToPalette
      if (shortcutReleasedByEvent(event, shortcut)) endPaletteSamplingShortcut()
    }
    const blur = (): void => endPaletteSamplingShortcut()
    window.addEventListener('keydown', keydown, true)
    window.addEventListener('keyup', keyup, true)
    window.addEventListener('blur', blur)
    return () => { window.removeEventListener('keydown', keydown, true); window.removeEventListener('keyup', keyup, true); window.removeEventListener('blur', blur) }
  }, [adjustmentOpen, advancedMode, aboutOpen, blockedShortcuts, canvasResizeOpen, colorReplacementOpen, componentLibraryOpen, cycleAdvancedMode, exportOpen, gridSettingsOpen, homeOpen, imageResizeOpen, latestReleaseOpen, loadSavedWorkspaces, newOpen, openMenu, openPreferences, openSaveAs, outlineOpen, panelVisibility, popupPanelId, preferencesOpen, projectInfoOpen, roadmapOpen, runtimePreferences.timelineHidden, saveAsOpen, shortcutOpen, timelapseOpen, toggleMirrorView, togglePopupPanel, toggleTimelineVisibility, updatePanelVisibility, updateToolRailSide, workspace, workspaceManagerOpen, workspaceSaveOpen, session?.brushSize, session?.document.id, session?.moveKind, session?.selectedSliceId, session?.selectedSliceIds, session?.selection, session?.textBoxTransform, session?.tool, shortcuts])

  useEffect(() => {
    const keydown = (event: KeyboardEvent): void => {
      if (blockedShortcuts.toggleAnimationPlayback) return
      const expected = (shortcuts.toggleAnimationPlayback ?? defaultShortcuts.toggleAnimationPlayback).trim()
      if (expected === '' || normalizeShortcut(shortcutText(event)).toLowerCase() !== normalizeShortcut(expected).toLowerCase()) return
      const target = event.target instanceof Element ? event.target : null
      const state = useWorkspace.getState()
      const active = state.sessions.find((item) => item.document.id === state.activeId) ?? null
      const isInteractiveTarget = Boolean(target?.closest('input, textarea, select, button, [contenteditable="true"], [role="button"], [role="menuitem"], [role="option"]'))
      const hasBlockingSurface = Boolean(openMenu || popupPanelId || document.querySelector('.modal-backdrop, .context-menu, .tool-flyout, .brush-library, .brush-size-popover, .pressure-popover, .themed-select-popover, .palette-operation-dialog, .palette-library-popover, .palette-actions-popover, .workspace-panel-popup-layer'))
      if (!shouldHandleAnimationPlaybackShortcut({
        defaultPrevented: event.defaultPrevented,
        repeat: event.repeat,
        hasSession: Boolean(active),
        frameCount: active?.document.animation?.frames.length ?? 0,
        homeOpen,
        timelineHidden: runtimePreferences.timelineHidden,
        hasSelection: Boolean(active?.selection),
        hasTextBoxTransform: Boolean(active?.textBoxTransform),
        isInteractiveTarget,
        hasBlockingSurface
      })) return
      event.preventDefault()
      event.stopPropagation()
      state.setAnimationPlaying(!active!.animationPlaying)
    }
    window.addEventListener('keydown', keydown)
    return () => window.removeEventListener('keydown', keydown)
  }, [blockedShortcuts.toggleAnimationPlayback, homeOpen, openMenu, popupPanelId, runtimePreferences.timelineHidden, shortcuts.toggleAnimationPlayback])

  useEffect(() => { void window.moonSprite.getResourceInfo().then((info) => setResourceLabel(t('app.resource.freeMemory', { value: formatBytes(info.freeBytes) }))) }, [t])
  useEffect(() => {
    if (!newOpen) return
    preloadCanvasStage()
    void window.moonSprite.getResourceInfo()
  }, [newOpen])
  const closeMenu = (): void => setOpenMenu(null)
  const savePreset = (): void => {
    const name = presetName.trim()
    if (!name) { workspace.setMessage(t('app.export.presetNameRequired')); return }
    const next = [...presets.filter((preset) => preset.presetName !== name), { ...exportForm, presetName: name }]
    if (!saveExportPresets(next)) { workspace.setMessage(t('app.export.presetSaveFailed')); return }
    setPresets(next)
    setPresetName(name)
    workspace.setMessage(t('app.export.presetSaved', { name }))
  }
  const deletePreset = (): void => {
    const name = presetName.trim()
    if (!name) return
    const next = presets.filter((preset) => preset.presetName !== name)
    if (!saveExportPresets(next)) { workspace.setMessage(t('app.export.presetSaveFailed')); return }
    setPresets(next)
    setPresetName('')
  }

  const openNewDocumentFromTab = useCallback((): void => setNewOpen(true), [])
  const activateDocumentTab = useCallback((documentId: string): void => {
    setHomeOpen(false)
    setWorkspaceDocumentId(documentId)
    useWorkspace.getState().setActive(documentId)
  }, [])
  const contextActivateDocumentTab = useCallback((documentId: string): void => {
    setHomeOpen(false)
    setWorkspaceDocumentId(documentId)
    useWorkspace.getState().setActive(documentId)
  }, [])
  const updateDocumentPaneDockDebug = useCallback((next: DocumentTabDockDebugState | null): void => {
    setDocumentPaneDockDebug((current) => current?.draggedDocumentId === next?.draggedDocumentId && current?.targetDocumentId === next?.targetDocumentId && current?.direction === next?.direction && current?.magnetVisible === next?.magnetVisible ? current : next)
  }, [])
  const splitDocumentFromTab = useCallback((placement: DocumentPanePlacement): void => {
    const workspace = useWorkspace.getState()
    const baseDocumentId = workspaceDocumentId
    if (!baseDocumentId || placement.documentId === placement.targetPaneId) return
    setDocumentPaneLayout((current) => splitDocumentPaneFromTab(current, baseDocumentId, placement))
    setPaneOnlyDocumentIds((current) => {
      const next = current.includes(placement.documentId) ? [...current] : [...current, placement.documentId]
      return baseDocumentId === placement.documentId
        ? next.filter((id) => id !== placement.targetPaneId)
        : next
    })
    if (baseDocumentId === placement.documentId) {
      setWorkspaceDocumentId(placement.targetPaneId)
      if (workspace.activeId === placement.documentId) workspace.setActive(placement.targetPaneId)
    }
  }, [workspaceDocumentId])
  const updateDocumentPaneLayout = useCallback((layout: DocumentPaneNode | null): void => setDocumentPaneLayout(layout), [])
  const moveDocumentPaneView = useCallback((documentId: string, targetPaneId: string, direction: DocumentPaneDirection): void => {
    setDocumentPaneLayout((current) => current ? moveDocumentPane(current, documentId, targetPaneId, direction) : current)
  }, [])
  const floatDocument = useCallback((documentId: string, anchor: { x: number; y: number }): void => {
    const state = useWorkspace.getState()
    if (!state.sessions.some((item) => item.document.id === documentId) || floatingDocumentIds.includes(documentId)) return
    const initialPosition = createFloatingDocumentPosition(documentId, anchor)
    const nextFloatingIds = new Set([...floatingDocumentIds, documentId])
    const availableDocumentIds = state.sessions
      .map((item) => item.document.id)
      .filter((id) => !nextFloatingIds.has(id))
      .reverse()
    const detached = detachDocumentPaneWorkspace(documentPaneLayout, documentId, workspaceDocumentId, paneOnlyDocumentIds, availableDocumentIds)
    setFloatingDocuments((current) => current.some((item) => item.documentId === documentId)
      ? current
      : [...current, { documentId, initialPosition, pinned: false }])
    setDocumentPaneLayout(detached.layout)
    setPaneOnlyDocumentIds(detached.paneOnlyDocumentIds)
    setWorkspaceDocumentId(detached.workspaceDocumentId)
    setHomeOpen(false)
    state.setActive(documentId)
  }, [documentPaneLayout, floatingDocumentIds, paneOnlyDocumentIds, workspaceDocumentId])
  const activateFloatingDocument = useCallback((documentId: string): void => {
    setHomeOpen(false)
    setFloatingDocuments((current) => {
      const target = current.find((item) => item.documentId === documentId)
      return target && current.at(-1)?.documentId !== documentId
        ? [...current.filter((item) => item.documentId !== documentId), target]
        : current
    })
    useWorkspace.getState().setActive(documentId)
  }, [])
  const setFloatingDocumentPinned = useCallback((documentId: string, pinned: boolean): void => {
    setFloatingDocuments((current) => {
      const target = current.find((item) => item.documentId === documentId)
      if (!target || target.pinned === pinned) return current
      return [...current.filter((item) => item.documentId !== documentId), { ...target, pinned }]
    })
  }, [])
  const returnFloatingDocumentToTabs = useCallback((documentId: string, visibleIndex?: number): void => {
    const state = useWorkspace.getState()
    if (!state.sessions.some((item) => item.document.id === documentId)) return
    const nextFloatingIds = floatingDocumentIds.filter((id) => id !== documentId)
    if (visibleIndex !== undefined) {
      const hiddenIds = new Set([...paneOnlyDocumentIds, ...nextFloatingIds])
      const returned = state.sessions.find((item) => item.document.id === documentId)
      const visible = state.sessions.filter((item) => item.document.id !== documentId && !hiddenIds.has(item.document.id))
      if (returned) visible.splice(Math.max(0, Math.min(visible.length, visibleIndex)), 0, returned)
      const hidden = state.sessions.filter((item) => hiddenIds.has(item.document.id))
      state.reorderSessions([...visible, ...hidden].map((item) => item.document.id))
    }
    const targetDocumentId = resolveFloatingDocumentReturnTarget({
      returnedDocumentId: documentId,
      workspaceDocumentId,
      preserveWorkspace: visibleIndex !== undefined,
      openDocumentIds: state.sessions.map((item) => item.document.id),
      remainingFloatingDocumentIds: nextFloatingIds
    })
    setFloatingDocuments((current) => current.filter((item) => item.documentId !== documentId))
    setPaneOnlyDocumentIds((current) => current.filter((id) => id !== documentId))
    setWorkspaceDocumentId(targetDocumentId)
    setHomeOpen(false)
    state.setActive(targetDocumentId)
  }, [floatingDocumentIds, paneOnlyDocumentIds, workspaceDocumentId])
  const closeFloatingDocument = useCallback((documentId: string): void => {
    void useWorkspace.getState().closeDocument(documentId).then(() => {
      if (!useWorkspace.getState().sessions.some((item) => item.document.id === documentId)) {
        setFloatingDocuments((current) => current.filter((item) => item.documentId !== documentId))
      }
    })
  }, [])
  const returnDocumentPaneToTabs = useCallback((documentId: string, visibleIndex: number): void => {
    if (!documentPaneLayout) return
    const sessions = useWorkspace.getState().sessions
    const availableDocumentIds = sessions
      .map((item) => item.document.id)
      .filter((id) => id !== documentId && !floatingDocumentIds.includes(id))
    const detached = detachDocumentPaneWorkspace(documentPaneLayout, documentId, workspaceDocumentId, paneOnlyDocumentIds, availableDocumentIds)
    const nextPaneOnlyIds = detached.paneOnlyDocumentIds
    const returned = sessions.find((item) => item.document.id === documentId)
    const hiddenIds = new Set([...nextPaneOnlyIds, ...floatingDocumentIds])
    const visible = sessions.filter((item) => item.document.id !== documentId && !hiddenIds.has(item.document.id))
    if (returned) visible.splice(Math.max(0, Math.min(visible.length, visibleIndex)), 0, returned)
    const hidden = sessions.filter((item) => hiddenIds.has(item.document.id))
    useWorkspace.getState().reorderSessions([...visible, ...hidden].map((item) => item.document.id))
    setPaneOnlyDocumentIds(nextPaneOnlyIds)
    setDocumentPaneLayout(detached.layout)
    const targetDocumentId = detached.workspaceDocumentId ?? documentId
    setWorkspaceDocumentId(targetDocumentId)
    useWorkspace.getState().setActive(targetDocumentId)
  }, [documentPaneLayout, floatingDocumentIds, paneOnlyDocumentIds, workspaceDocumentId])
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

  const editorAreaColumns = [
    ...(toolRailSide === 'left' ? ['var(--tool-rail-column-size)'] : []),
    ...(hasLeftDock ? [`${leftDockWidth}px`, '6px'] : []),
    'minmax(0, 1fr)',
    ...(hasRightDock ? ['6px', `${inspectorWidth}px`] : []),
    ...(toolRailSide === 'right' ? ['var(--tool-rail-column-size)'] : [])
  ]
  const editorAreaNames = [
    ...(toolRailSide === 'left' ? ['toolrail'] : []),
    ...(hasLeftDock ? ['leftdock', 'leftresize'] : []),
    'work',
    ...(hasRightDock ? ['rightresize', 'rightdock'] : []),
    ...(toolRailSide === 'right' ? ['toolrail'] : [])
  ]
  const editorColumns = editorAreaColumns.join(' ')
  const editorMainAreaRow = editorAreaNames.join(' ')
  const editorToolRailAreaRow = editorAreaNames.map(() => 'toolrail').join(' ')
  const editorRows = toolRailSide === 'top'
    ? 'var(--tool-rail-row-size) minmax(0, 1fr)'
    : toolRailSide === 'bottom'
      ? 'minmax(0, 1fr) var(--tool-rail-row-size)'
      : 'minmax(0, 1fr)'
  const editorAreas = toolRailSide === 'top'
    ? `"${editorToolRailAreaRow}" "${editorMainAreaRow}"`
    : toolRailSide === 'bottom'
      ? `"${editorMainAreaRow}" "${editorToolRailAreaRow}"`
      : `"${editorMainAreaRow}"`

  const editorOnly = advancedMode !== null && Boolean(session) && !homeOpen
  const documentPaneDockDebugTargetName = documentPaneDockDebug?.targetDocumentId
    ? workspace.sessions.find((item) => item.document.id === documentPaneDockDebug.targetDocumentId)?.document.name ?? documentPaneDockDebug.targetDocumentId
    : null
  const documentPaneDockDebugDirection = documentPaneDockDebug?.direction === 'left'
    ? t('app.documentDockDebug.left')
    : documentPaneDockDebug?.direction === 'right'
      ? t('app.documentDockDebug.right')
      : documentPaneDockDebug?.direction === 'top'
        ? t('app.documentDockDebug.top')
        : documentPaneDockDebug?.direction === 'bottom'
          ? t('app.documentDockDebug.bottom')
          : t('app.documentDockDebug.none')
  const exportSlices = session?.document.slices ?? []
  const exportTarget: NonNullable<ExportOptions['target']> = exportForm.format === 'gif' && exportForm.target === 'frames'
    ? 'document'
    : exportForm.target === 'slices' && exportSlices.length === 0
      ? 'document'
      : exportForm.target ?? 'document'
  const selectedExportSliceId = exportForm.sliceId && exportSlices.some((slice) => slice.id === exportForm.sliceId) ? exportForm.sliceId : ''
  return <main className={`app-shell ${session?.view.showPixelGrid ? 'pixel-grid-on' : ''} ${editorOnly ? 'advanced-mode' : ''} ${advancedMode === 'tool-options' ? 'advanced-tool-options' : ''} ${advancedMode === 'canvas-only' ? 'advanced-canvas-only' : ''}`}>
    <AppWindowTitleBar />
    <BrushDynamicsTelemetryCapture documentId={session?.document.id ?? null} />
    {saveAsOpen && session && <SaveAsDialog initialName={session.document.name.replace(/\.(moonsprite|aseprite|ase|png|jpe?g|webp)$/i, '') || 'MoonSprite-project'} initialFormat={saveAsFormatForPreference(readStoredString(SAVE_FORMAT_PREFERENCE_KEY))} initialDirectory={runtimePreferences.saveDirectory || defaultFileDirectories.saveDirectory} onClose={() => setSaveAsOpen(false)} onSave={(options) => workspace.saveActive(true, options)} />}
    <AppMenuBar
      openMenu={openMenu}
      setOpenMenu={setOpenMenu}
      shortcutFor={shortcutFor}
      homeOpen={homeOpen}
      panelVisibility={panelVisibility}
      timelineHidden={runtimePreferences.timelineHidden}
      sliceOutlinesVisible={runtimePreferences.sliceOutlinesVisible}
      toolRailSide={toolRailSide}
      advancedModeActive={advancedMode !== null}
      recentFiles={recentFiles}
      onHome={() => setHomeOpen(true)}
      onNew={() => setNewOpen(true)}
      onOpen={() => { void openFilesAndShowDocument() }}
      onOpenRecent={(filePath) => { void openGalleryProject(filePath) }}
      onSaveAs={openSaveAs}
      onExport={() => openExport()}
      onExportAllFrames={() => openExport('frames')}
      onOpenTimelapse={() => setTimelapseOpen(true)}
      onOpenProjectInfo={() => setProjectInfoOpen(true)}
      onOpenProjectFolder={openProjectFolder}
      onOpenOutline={() => setOutlineOpen(true)}
      onOpenColorReplacement={() => setColorReplacementOpen(true)}
      onOpenAdjustment={(kind) => { setAdjustmentKind(kind); setAdjustmentOpen(true) }}
      onOpenShortcuts={() => setShortcutOpen(true)}
      onOpenPreferences={() => openPreferences()}
      onOpenCanvasResize={() => setCanvasResizeOpen(true)}
      onOpenImageResize={() => setImageResizeOpen(true)}
      onOpenGridSettings={() => setGridSettingsOpen(true)}
      onToggleMirror={toggleMirrorView}
      onTogglePanel={(id) => updatePanelVisibility(id, !panelVisibility[id])}
      onToggleTimeline={toggleTimelineVisibility}
      onToggleSliceOutlines={toggleSliceOutlinesVisibility}
      onToolRailSideChange={updateToolRailSide}
      onCycleAdvancedMode={cycleAdvancedMode}
      onOpenComponentLibrary={() => setComponentLibraryOpen(true)}
      onOpenRoadmap={() => setRoadmapOpen(true)}
      onOpenLatestRelease={() => setLatestReleaseOpen(true)}
      onOpenAbout={() => setAboutOpen(true)}
    />

    <section className="tab-strip" aria-label={t('app.documentTabs.aria')}>
      <DocumentTabs homeOpen={homeOpen} hiddenDocumentIds={hiddenDocumentIds} onNew={openNewDocumentFromTab} onActivate={activateDocumentTab} onContextActivate={contextActivateDocumentTab} onSplit={splitDocumentFromTab} onFloat={floatDocument} onDockDebug={updateDocumentPaneDockDebug} />
      <span className="workspace-top-control workspace-tab-control"><button type="button" className={`icon-button ${openMenu === 'workspace' ? 'active' : ''}`} title={t('app.workspace.aria')} aria-label={t('app.workspace.aria')} aria-expanded={openMenu === 'workspace'} onPointerDown={(event) => event.stopPropagation()} onClick={() => { setOpenMenu(openMenu === 'workspace' ? null : 'workspace'); if (openMenu !== 'workspace') void loadSavedWorkspaces() }}><PixelUtilityIcon kind="workspace" /></button>{openMenu === 'workspace' && createPortal(<div className="workspace-popover" role="menu" aria-label={t('app.workspace.aria')}><button type="button" role="menuitem" onPointerDown={(event) => { event.preventDefault(); event.stopPropagation(); setWorkspaceSaveName(''); setWorkspaceSaveOpen(true); closeMenu() }}>{t('app.workspace.new')}{shortcutFor('saveWorkspaceLayout') && <kbd>{shortcutFor('saveWorkspaceLayout')}</kbd>}</button><span className="workspace-popover-divider" />{savedWorkspaces.map((saved) => <button key={saved.id} type="button" role="menuitem" className={saved.id === activeWorkspaceId ? 'selected-workspace' : ''} title={t('app.workspace.loadTitle', { name: saved.name })} onPointerDown={(event) => { event.preventDefault(); event.stopPropagation(); void applyWorkspaceLayout(saved); closeMenu() }}><span className="menu-check">{saved.id === activeWorkspaceId && <PixelUtilityIcon kind="check" />}</span><span>{saved.name}</span></button>)}<span className="workspace-popover-divider" /><button type="button" role="menuitem" disabled={!activeWorkspaceId} onPointerDown={(event) => { event.preventDefault(); event.stopPropagation(); void resetCurrentWorkspace(); closeMenu() }}>{t('app.workspace.resetCurrent')}</button><button type="button" role="menuitem" onPointerDown={(event) => { event.preventDefault(); event.stopPropagation(); setWorkspaceManagerOpen(true); closeMenu() }}>{t('app.workspace.manage')}{shortcutFor('openWorkspaceManager') && <kbd>{shortcutFor('openWorkspaceManager')}</kbd>}</button></div>, document.body)}</span>
    </section>

    {session && !homeOpen ? <EditorWorkspaceShell
      editorOnly={editorOnly}
      editorColumns={editorColumns}
      editorRows={editorRows}
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
      documentPaneLayout={visibleDocumentPaneLayout}
      workspaceDocumentId={workspaceDocumentId}
      paneOnlyDocumentIds={paneOnlyDocumentIds}
      onDocumentPaneLayoutChange={updateDocumentPaneLayout}
      onDocumentPaneMove={moveDocumentPaneView}
      onDocumentPaneReturnToTabs={returnDocumentPaneToTabs}
      onDocumentPaneFloat={floatDocument}
      hasRightDock={hasRightDock}
      onInspectorResize={beginInspectorResize}
      session={session}
      workspaceLayoutRevision={workspaceLayoutRevision}
      panelVisibility={panelVisibility}
      popupPanelId={dockedPopupPanelId}
      onPopupPanelClose={() => setPopupPanelId(null)}
      onClosePreview={closePreviewPanel}
      panelDocks={panelDocks}
      onPanelDockChange={updatePanelDock}
      onPanelVisibilityChange={updatePanelVisibility}
      relativeLuminanceInPreview={relativeLuminanceScope === 'app'}
      onOpenColorReplacement={openColorReplacement}
      onOpenPreferences={openQuickCommandPreferences}
      onOpenCommandSettings={openQuickCommandSettings}
      shortcutFor={shortcutFor}
      onToggleMirror={toggleMirrorView}
    /> : <Suspense fallback={<div aria-hidden="true" />}><LazyHomeWorkspace onNew={() => setNewOpen(true)} onOpen={() => void openFilesAndShowDocument()} onOpenProject={openGalleryProject} onRestoreRecovery={restoreRecoveryAndShowDocument} /></Suspense>}

    {floatingDocuments.map((item, stackIndex) => {
      const floatingSession = workspace.sessions.find((candidate) => candidate.document.id === item.documentId)
      return floatingSession ? <FloatingDocumentWindow key={item.documentId} session={floatingSession} initialPosition={item.initialPosition} pinned={item.pinned} stackIndex={stackIndex} onActivate={activateFloatingDocument} onPinnedChange={setFloatingDocumentPinned} onReturnToTabs={returnFloatingDocumentToTabs} onCloseDocument={closeFloatingDocument} shortcutFor={shortcutFor} onToggleMirror={toggleMirrorView} onOpenPreferences={openQuickCommandPreferences} onOpenCommandSettings={openQuickCommandSettings} /> : null
    })}

    <EditorStatusBar homeOpen={homeOpen} resourceLabel={resourceLabel} />
    <OpenProgressOverlay />
    <SaveProgressOverlay />
    {documentPaneDockDebug ? <div className="advanced-mode-notice" role="status" aria-live="polite"><strong>{documentPaneDockDebugTargetName ? t('app.documentDockDebug.target', { name: documentPaneDockDebugTargetName, direction: documentPaneDockDebugDirection }) : t('app.documentDockDebug.noTarget', { direction: documentPaneDockDebugDirection })}</strong><small>{t(documentPaneDockDebug.magnetVisible ? 'app.documentDockDebug.magnetVisible' : 'app.documentDockDebug.magnetHidden')}</small></div> : advancedModeNotice && <div className="advanced-mode-notice" role="status" aria-live="polite"><strong>{advancedModeNotice}</strong><small>{advancedModeNotice === t('app.advanced.enabled') ? `${advancedModeNoticeShortcut} ${t('app.advanced.restore')}` : advancedModeNoticeShortcut}</small></div>}
    {workspace.saveProgress && createPortal(<div className={`modal-backdrop save-progress-backdrop ${workspace.saveProgress.requiresConfirmation ? 'is-complete' : 'is-running'}`} role="presentation"><ModalShell storageKey="save-progress" defaultWidth={280} defaultHeight={workspace.saveProgress.requiresConfirmation ? 190 : 142} fitContentKey={workspace.saveProgress.requiresConfirmation ? 'complete' : 'progress'} minWidth={250} minHeight={workspace.saveProgress.requiresConfirmation ? 176 : 132} className="save-progress-modal" role="dialog" aria-modal="true" aria-live="polite" aria-labelledby="save-progress-title"><header><div className="save-progress-heading"><span className="save-progress-icon" aria-hidden="true">{workspace.saveProgress.requiresConfirmation ? <CheckCircle2 size={20} /> : <span className="save-progress-animation" />}</span><div><span className="eyebrow">FILE OPERATION</span><h2 id="save-progress-title">{workspace.saveProgress.title}</h2></div></div>{!workspace.saveProgress.requiresConfirmation && <button type="button" className="icon-button" aria-label={t('app.progress.close', { title: workspace.saveProgress.title })} onClick={() => workspace.dismissSaveProgress()}><PixelUtilityIcon kind="close" /></button>}</header><div className="save-progress-body"><strong>{workspace.saveProgress.label}</strong><div className={`save-progress-track ${workspace.saveProgress.value >= 100 ? 'is-full' : ''}`} aria-label={t('app.progress.aria', { title: workspace.saveProgress.title, value: workspace.saveProgress.value })}><i style={{ width: `${workspace.saveProgress.value}%` }} /></div><div className="save-progress-meta"><span>{t(workspace.saveProgress.requiresConfirmation ? 'app.progress.complete' : 'app.progress.processing')}</span><small>{workspace.saveProgress.value}%</small></div></div>{workspace.saveProgress.requiresConfirmation && <footer><button type="button" className="primary-button" onClick={() => workspace.dismissSaveProgress()}>{t('timelapse.confirmExport')}</button></footer>}</ModalShell></div>, document.body)}
    {workspace.dialog && <div className="modal-backdrop dialog-backdrop" role="presentation"><ModalShell storageKey="confirm-content-v2" fitContentKey={`${workspace.dialog.title}:${workspace.dialog.choices.length}`} defaultWidth={420} defaultHeight={180} minHeight={0} resizable={false} className="confirm-modal" role="alertdialog" aria-modal="true" aria-labelledby="app-dialog-title"><DialogHeader eyebrow="MOONSPRITE" title={workspace.dialog.title} titleId="app-dialog-title" /><div className="confirm-content"><strong>{workspace.dialog.message}</strong>{workspace.dialog.detail && <p>{workspace.dialog.detail}</p>}</div><footer>{workspace.dialog.choices.map((choice) => <button key={choice.id} className={choice.tone === 'primary' ? 'primary-button' : choice.tone === 'danger' ? 'danger-button' : 'quiet-button'} onClick={() => workspace.resolveDialog(choice.id)}>{choice.label}</button>)}</footer></ModalShell></div>}
    {exportOpen && <div className="modal-backdrop" role="presentation" onPointerDown={(event) => { if (event.target === event.currentTarget) setExportOpen(false) }}>
      <ModalShell as="form" storageKey="export-layout-v2" fitContentKey={`${exportForm.format}:${exportTarget}:${exportForm.gifFrameRange ?? 'all'}`} defaultWidth={520} defaultHeight={520} minWidth={420} minHeight={360} maxWidth={640} maxHeight={760} className="export-modal" onSubmit={(event) => {
        event.preventDefault()
        const selectedPresetName = presets.some((preset) => preset.presetName === presetName) ? presetName : undefined
        void workspace.exportActive({ ...exportForm, target: exportTarget, sliceId: exportTarget === 'slices' ? selectedExportSliceId || undefined : undefined, ...(selectedPresetName ? { presetName: selectedPresetName } : {}) }).then((exported) => { if (exported) setExportOpen(false) })
      }}>
        <DialogHeader eyebrow="EXPORT IMAGE" title={t('app.export.settings')} closeLabel={t('common.close')} onClose={() => setExportOpen(false)} />
        <div className="modal-body component-scrollbar export-modal-body">
          <FormField className="export-file-field" label={t('app.export.fileName')} hint={<span className="export-selected-directory" title={exportForm.directory || defaultFileDirectories.exportDirectory}>{t('app.export.selectedDirectory', { path: exportForm.directory || defaultFileDirectories.exportDirectory })}</span>}>
            <div className="export-file-control">
              <TextInput autoFocus aria-label={t('app.export.fileName')} value={exportForm.name} onChange={(event) => setExportForm({ ...exportForm, name: event.target.value })} />
              <button type="button" className={exportPathMenuOpen ? 'icon-button selected' : 'icon-button'} title={t('app.export.pathMenu')} aria-label={t('app.export.pathMenu')} aria-expanded={exportPathMenuOpen} onClick={() => setExportPathMenuOpen((open) => !open)}><PixelUtilityIcon kind="folderOpen" /></button>
              {exportPathMenuOpen && <div className="export-path-menu context-menu" role="menu" aria-label={t('app.export.pathMenu')}><button type="button" className="context-menu-item" role="menuitem" onClick={() => void chooseExportDirectory()}><PixelUtilityIcon kind="folderOpen" /><span>{t('app.export.choosePath')}</span></button><button type="button" className="context-menu-item" role="menuitem" onClick={() => { setExportForm((current) => ({ ...current, directory: defaultFileDirectories.saveDirectory })); setExportPathMenuOpen(false) }}><PixelUtilityIcon kind="image" /><span>{t('app.export.localGallery')}</span></button><span className="context-menu-divider" /><strong className="export-path-menu-heading">{t('app.export.recentPaths')}</strong>{recentExportPaths.length === 0 ? <span className="export-path-menu-empty">{t('app.export.noRecentPaths')}</span> : recentExportPaths.map((item) => <button type="button" className="context-menu-item export-recent-path" role="menuitem" key={item.filePath.toLocaleLowerCase()} title={item.filePath} onClick={() => useRecentExportDirectory(item.filePath)}><PixelUtilityIcon kind="export" /><span>{item.filePath}</span></button>)}</div>}
            </div>
          </FormField>
          <div className="export-primary-fields">
            <FormField label={t('app.export.format')}><ThemedSelect<ExportOptions['format']> value={exportForm.format} groups={[{ label: t('app.export.formatGroup'), options: [{ value: 'png-auto', label: t('app.export.pngAuto') }, { value: 'png-rgba', label: t('app.export.pngRgba') }, { value: 'jpeg', label: t('app.export.jpegWhite') }, { value: 'webp', label: t('app.export.webp') }, { value: 'svg', label: t('app.export.svg') }, { value: 'gif', label: t('app.export.gif') }] }]} label={t('app.export.format')} onChange={(format) => setExportForm({ ...exportForm, name: withExportFileExtension(exportForm.name, format), format, target: format === 'gif' && exportForm.target === 'frames' ? 'document' : exportForm.target, scalePercent: format === 'svg' ? 100 : exportForm.scalePercent })} /></FormField>
            <FormField label={t('app.export.target')}><ThemedSelect<NonNullable<ExportOptions['target']>> value={exportTarget} groups={[{ label: t('app.export.target'), options: [{ value: 'document', label: t('app.export.targetDocument') }, ...((session?.document.animation?.frames.length ?? 1) > 1 && exportForm.format !== 'gif' ? [{ value: 'frames' as const, label: t('app.export.targetFrames') }] : []), ...(exportSlices.length ? [{ value: 'slices' as const, label: t('app.export.targetSlices') }] : [])] }]} label={t('app.export.target')} onChange={(target) => setExportForm({ ...exportForm, target, sliceId: target === 'slices' ? selectedExportSliceId || undefined : undefined })} /></FormField>
            {exportTarget === 'slices' && <FormField className="export-slice-field" label={t('app.export.sliceSelection')}><ThemedSelect value={selectedExportSliceId} groups={[{ label: t('app.export.sliceSelection'), options: [{ value: '', label: t('app.export.allSlices') }, ...exportSlices.map((slice) => ({ value: slice.id, label: slice.name, description: `${slice.width} × ${slice.height} · ${slice.x}, ${slice.y}` }))] }]} label={t('app.export.sliceSelection')} onChange={(sliceId) => setExportForm({ ...exportForm, sliceId: sliceId || undefined })} /></FormField>}
          </div>
          {exportForm.format === 'gif' && <section className="gif-export-options">
            <FormField label={t('app.export.gifRange')}><ThemedSelect value={exportForm.gifFrameRange ?? 'all'} groups={[{ label: t('app.export.gifRange'), options: [{ value: 'all', label: t('app.export.gifAllFrames') }, { value: 'range', label: t('app.export.gifFrameRange') }] }]} label={t('app.export.gifRange')} onChange={(gifFrameRange) => setExportForm({ ...exportForm, gifFrameRange: gifFrameRange as 'all' | 'range' })} /></FormField>
            {exportForm.gifFrameRange === 'range' && <div className="gif-range-fields"><FormField label={t('app.export.gifStart')}><NumberInput min={1} max={session?.document.animation?.frames.length ?? 1} value={exportForm.gifFrameStart ?? 1} onValueChange={(gifFrameStart) => setExportForm({ ...exportForm, gifFrameStart })} /></FormField><FormField label={t('app.export.gifEnd')}><NumberInput min={1} max={session?.document.animation?.frames.length ?? 1} value={exportForm.gifFrameEnd ?? session?.document.animation?.frames.length ?? 1} onValueChange={(gifFrameEnd) => setExportForm({ ...exportForm, gifFrameEnd })} /></FormField></div>}
            <FormField label={t('app.export.gifDirection')}><ThemedSelect value={exportForm.gifDirection ?? 'forward'} groups={[{ label: t('app.export.gifDirection'), options: [{ value: 'forward', label: t('app.export.gifForward'), description: t('app.export.gifForwardHint') }, { value: 'reverse', label: t('app.export.gifReverse'), description: t('app.export.gifReverseHint') }, { value: 'forward-ping-pong', label: t('app.export.gifForwardPingPong'), description: t('app.export.gifForwardPingPongHint') }, { value: 'reverse-ping-pong', label: t('app.export.gifReversePingPong'), description: t('app.export.gifReversePingPongHint') }] }]} label={t('app.export.gifDirection')} onChange={(gifDirection) => setExportForm({ ...exportForm, gifDirection: gifDirection as NonNullable<ExportOptions['gifDirection']> })} /></FormField>
          </section>}
          <FormField className="export-scale-field" label={exportForm.format === 'svg' ? t('app.export.scale') : t('app.export.scalePercent')}><div className="scale-control"><NumberInput min={1} max={exportForm.format === 'svg' ? 64 : 6400} value={exportForm.format === 'svg' ? exportForm.scalePercent / 100 : exportForm.scalePercent} suffix={exportForm.format === 'svg' ? 'x' : '%'} onValueChange={(value) => setExportForm({ ...exportForm, scalePercent: exportForm.format === 'svg' ? Math.max(100, Math.round(value * 100)) : value })} /><div className="scale-presets" aria-label={exportForm.format === 'svg' ? t('app.export.scalePresets') : t('app.export.scalePercentPresets')}>{exportScalePresets.map((scale) => <button type="button" key={scale} className={exportForm.scalePercent === scale ? 'selected' : ''} onClick={() => setExportForm({ ...exportForm, scalePercent: scale })}>{exportForm.format === 'svg' ? `${scale / 100}x` : `${scale}%`}</button>)}</div></div></FormField>
          <FormField className="export-preset-field" label={t('app.export.preset')}>
            <div className="export-preset-control">
              <ThemedSelect value={presetName} groups={[{ label: t('app.export.savedPresets'), options: [{ value: '', label: t('app.export.choosePreset') }, ...presets.map((preset) => ({ value: preset.presetName, label: `${preset.presetName} · ${preset.scalePercent}%` }))] }]} label={t('app.export.preset')} onChange={(value) => { const preset = presets.find((item) => item.presetName === value); setPresetName(value); if (preset) { const { presetName: _presetName, ...options } = preset; const sliceId = options.target === 'slices' && options.sliceId && exportSlices.some((slice) => slice.id === options.sliceId) ? options.sliceId : undefined; setExportForm({ ...options, sliceId }) } }} />
              <div className="preset-row"><TextInput className="preset-name-input" aria-label={t('app.export.presetName')} placeholder={t('app.export.presetName')} value={presetName} onChange={(event) => setPresetName(event.target.value)} /><button type="button" className="quiet-button" onClick={savePreset}>{t('app.export.savePreset')}</button><button type="button" className="icon-button preset-delete" title={t('app.export.deletePreset')} aria-label={t('app.export.deletePreset')} disabled={!presets.some((preset) => preset.presetName === presetName)} onClick={deletePreset}><PixelUtilityIcon kind="delete" /></button></div>
            </div>
          </FormField>
        </div>
        <footer><button type="button" className="quiet-button" onClick={() => setExportOpen(false)}>{t('common.cancel')}</button><button className="primary-button" type="submit"><PixelUtilityIcon kind="export" />{t('app.menu.file.export')}</button></footer>
      </ModalShell>
    </div>}
    {adjustmentOpen && <AdjustmentDialog kind={adjustmentKind} onClose={() => setAdjustmentOpen(false)} />}
    {colorReplacementOpen && session && <ColorReplacementDialog key={session.document.id} onClose={() => setColorReplacementOpen(false)} />}
    {aboutOpen && <div className="modal-backdrop" role="presentation" onPointerDown={(event) => { if (event.target === event.currentTarget) setAboutOpen(false) }}>
      <ModalShell storageKey="about-v2" defaultWidth={460} defaultHeight={360} minWidth={380} minHeight={310} maxWidth={620} maxHeight={520} className="about-modal" role="dialog" aria-modal="true" aria-labelledby="about-title">
        <DialogHeader title={t('app.about.title')} titleId="about-title" closeLabel={t('common.close')} onClose={() => setAboutOpen(false)} />
        <div className="about-content">
          <section className="about-brand">
            <span className="about-logo" aria-hidden="true"><img src={moonspriteLogo} alt="" /></span>
            <div><strong>MoonSprite</strong><p className="about-description">{t('app.about.description')}</p></div>
          </section>
          <dl className="about-details">
            <div><dt>{t('app.about.version')}</dt><dd>{APP_CHANNEL_LABEL}</dd></div>
            <div><dt>{t('app.about.author')}</dt><dd>MoonPixel Studio & MoonSprite Contributors</dd></div>
            <div><dt>{t('app.about.license')}</dt><dd>{t('app.about.licenseName')}</dd></div>
          </dl>
          <button className="about-link" type="button" onClick={() => { void window.moonSprite.openExternalUrl('https://github.com/MoonPixelTeam/moonsprite').catch((error) => workspace.setMessage(error instanceof Error ? error.message : t('home.openLinkFailed'))) }}><GitFork size={15} /><span>github.com/MoonPixelTeam/moonsprite</span><ExternalLink size={13} /></button>
        </div>
        <footer><button className="primary-button" onClick={() => setAboutOpen(false)}>{t('common.done')}</button></footer>
      </ModalShell>
    </div>}
    {componentLibraryOpen && <Suspense fallback={null}><LazyComponentLibrary onClose={() => setComponentLibraryOpen(false)} /></Suspense>}
    {roadmapOpen && <FutureRoadmapDialog onClose={() => setRoadmapOpen(false)} />}
    {latestReleaseOpen && <LatestReleaseDialog onClose={() => setLatestReleaseOpen(false)} />}
    {session && gridSettingsOpen && <GridSettingsDialog value={session.view.grid} onApply={(grid) => workspace.setView({ grid })} onClose={() => setGridSettingsOpen(false)} />}
    {session && projectInfoOpen && <ProjectInfoDialog document={session.document} onClose={() => setProjectInfoOpen(false)} />}
    {session && timelapseOpen && <TimelapseDialog settings={session.document.timelapse!} onChange={(settings) => workspace.setTimelapseSettings(settings)} onClear={() => workspace.clearTimelapse()} onExport={(format, options) => workspace.exportTimelapse(format, options)} onClose={() => setTimelapseOpen(false)} />}
    {textToolRequest && <TextToolDialog editing={Boolean(textToolRequest.layerId && !textLayerDraftRef.current)} initial={textToolInitial} box={textToolBox} onChange={changeTextTool} onPreview={previewTextTool} onClose={() => {
      const draft = textLayerDraftRef.current
      clearTextToolPreview()
      if (draft) {
        useWorkspace.getState().setActive(draft.documentId)
        useWorkspace.getState().cancelTextLayerDraft(draft.layerId)
        textLayerDraftRef.current = null
      }
      setTextToolRequest(null)
    }} onSubmit={(value) => {
      const request = textToolRequest
      clearTextToolPreview()
      useWorkspace.getState().setActive(request.documentId)
      const draft = textLayerDraftRef.current
      const x = value.originX ?? request.x
      const y = value.originY ?? request.y
      if (draft?.documentId === request.documentId) {
        workspace.updateTextLayerDraft(draft.layerId, draft.frameId, value, x, y)
        workspace.commitTextLayerDraft(draft.layerId)
        textLayerDraftRef.current = null
      } else if (request.layerId && request.frameId) workspace.setTextCel(request.layerId, request.frameId, value, x, y)
      else workspace.createTextLayer(value, x, y)
      setTextToolRequest(null)
    }} />}
    {workspaceSaveOpen && <div className="modal-backdrop" role="presentation" onPointerDown={(event) => { if (event.target === event.currentTarget && !workspaceBusy) setWorkspaceSaveOpen(false) }}><ModalShell as="form" storageKey="workspace-save" defaultWidth={420} defaultHeight={330} className="workspace-save-dialog" onSubmit={(event) => { event.preventDefault(); void saveWorkspace(workspaceSaveName) }}><DialogHeader eyebrow="WORKSPACE" title={t('app.workspace.saveTitle')} closeLabel={t('common.close')} closeDisabled={workspaceBusy} onClose={() => setWorkspaceSaveOpen(false)} /><div className="modal-body"><FormField label={t('app.workspace.name')}><TextInput autoFocus maxLength={96} value={workspaceSaveName} placeholder={t('app.workspace.namePlaceholder')} onChange={(event) => setWorkspaceSaveName(event.target.value)} /></FormField><p className="modal-note">{t('app.workspace.saveHint')}</p><p className="modal-note">{t('app.workspace.folder', { path: workspaceDirectory || 'workspaces' })}</p></div><footer><button type="button" className="quiet-button" disabled={workspaceBusy} onClick={() => setWorkspaceSaveOpen(false)}>{t('common.cancel')}</button><button type="submit" className="primary-button" disabled={workspaceBusy || !workspaceSaveName.trim()}><PixelUtilityIcon kind="save" />{t('common.save')}</button></footer></ModalShell></div>}
    {workspaceManagerOpen && <WorkspaceManagerDialog activeWorkspaceId={activeWorkspaceId} directory={workspaceDirectory} workspaces={savedWorkspaces} onClose={() => setWorkspaceManagerOpen(false)} onLoad={(saved) => { void applyWorkspaceLayout(saved) }} onDelete={(saved) => { void deleteSavedWorkspace(saved) }} onOpenFolder={() => { void window.moonSprite.openWorkspaceFolder() }} onCreate={() => { setWorkspaceManagerOpen(false); setWorkspaceSaveName(''); setWorkspaceSaveOpen(true) }} />}
    <NewDocumentDialog open={newOpen} presets={documentSizePresets} onClose={() => setNewOpen(false)} onCreate={(name, width, height, mode, recordDrawing) => void createDocumentAndShow(name, width, height, mode, recordDrawing)} />
    {session && <CanvasResizeDialog open={canvasResizeOpen} currentWidth={session.document.width} currentHeight={session.document.height} onClose={() => { workspace.setCanvasResizePreview(null); setCanvasResizeOpen(false) }} onResize={async (width, height, anchor, offsetX, offsetY, trimOutside) => { await workspace.resizeActiveCanvas(width, height, anchor, offsetX, offsetY, trimOutside); workspace.setCanvasResizePreview(null) }} onPreview={(preview) => { workspace.setCanvasResizePreview(preview); publishCanvasResizePreview(session.document.id, preview) }} preview={session.canvasResizePreview} />}
    {session && <ImageResizeDialog open={imageResizeOpen} currentWidth={session.document.width} currentHeight={session.document.height} onClose={() => setImageResizeOpen(false)} onResize={(width, height, interpolation: ImageResizeInterpolation) => workspace.resizeActiveImage(width, height, interpolation)} onDetectScale={() => detectDocumentPixelScale(session.document)} />}
    {session && <OutlineDialog open={outlineOpen} session={session} onClose={() => setOutlineOpen(false)} />}
    {preferencesOpen && <PreferencesDialog initialSection={preferencesInitialSection} onClose={() => setPreferencesOpen(false)} onPresetChange={(documentSizes, exportScales) => { setDocumentSizePresets(documentSizes); setExportScalePresets(exportScales) }} />}
    {shortcutOpen && <ShortcutDialog shortcuts={shortcuts} onSave={saveShortcuts} onClose={() => setShortcutOpen(false)} />}
  </main>
}
