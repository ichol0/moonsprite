import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronDown, ChevronRight, Copy, ExternalLink, FileImage, FileOutput, FolderOpen, GitFork, GripVertical, Info, LayoutTemplate, Plus, Redo2, RefreshCw, Save, Trash2, Undo2, X } from 'lucide-react'
import { listen } from '@tauri-apps/api/event'
import { PhysicalPosition, PhysicalSize } from '@tauri-apps/api/dpi'
import { getCurrentWebview } from '@tauri-apps/api/webview'
import { availableMonitors, getCurrentWindow } from '@tauri-apps/api/window'
import type { ColorMode, ImageBrush, ImageBrushSettings, ImageResizeInterpolation, ProceduralBrushId, ProceduralBrushSettings, RgbaColor, StoredWorkspace, ToolId, WorkspaceLayout } from '@shared/types'
import type { AdjustmentKind } from '@/core/adjustments'
import { compositePixelWithLayerColor, getActiveLayer, isLayerEffectivelyVisible, readLayerColorAt } from '@/core/document'
import { blendOver, packColor, unpackColor } from '@/core/raster'
import { InspectorPanels, type PanelDock, type WorkspacePanelId } from '@/components/WorkspacePanels'
import { AppMenuBar } from '@/components/app/AppMenuBar'
import { useBrushLibrary } from '@/components/app/useBrushLibrary'
import { publishCanvasResizePreview } from '@/core/canvas-resize-preview'
import { NewDocumentDialog } from '@/components/NewDocumentDialog'
import { CanvasResizeDialog } from '@/components/CanvasResizeDialog'
import { ImageResizeDialog } from '@/components/ImageResizeDialog'
import { OutlineDialog } from '@/components/OutlineDialog'
import { AdjustmentDialog } from '@/components/dialogs/AdjustmentDialog'
import { PreferencesDialog } from '@/components/dialogs/PreferencesDialog'
import { SaveAsDialog } from '@/components/dialogs/SaveAsDialog'
import { ShortcutDialog } from '@/components/dialogs/ShortcutDialog'
import { NumberInput } from '@/components/NumberInput'
import { ThemedSelect } from '@/components/ThemedSelect'
import { isProceduralBrushId } from '@/core/brushes'
import { brushMaskOffsets, brushStampDimensions } from '@/core/tools'
import { formatBytes } from '@/core/resource-policy'
import { APP_CHANNEL_LABEL } from '@/core/app-meta'
import { DRAWING_BRUSH_PREVIEW_ENABLED_KEY, EXPORT_FORMAT_PREFERENCE_KEY, EXPORT_SCALE_PRESETS_KEY, NEW_DOCUMENT_SIZE_PRESETS_KEY, RELATIVE_LUMINANCE_SCOPE_KEY, ROTATION_INDICATOR_POSITION_KEY, SAVE_FORMAT_PREFERENCE_KEY, imageExportKindForPreference, parseDocumentSizePresets, parseDrawingBrushPreviewEnabled, parseExportScalePresets, parseRelativeLuminanceScope, parseRotationIndicatorPosition, type RelativeLuminanceScope } from '@/core/file-preferences'
import { DEFAULT_SHORTCUTS, deriveShortcutConflicts, keyboardEventKey, loadShortcuts, normalizeShortcut, saveShortcuts as persistShortcuts, shortcutText } from '@/core/shortcuts'
import { readStoredJson, readStoredString, writeStoredJson, writeStoredString } from '@/core/storage'
import { ACTIVE_WORKSPACE_STORAGE_KEY, BOTTOM_DOCK_HEIGHT_STORAGE_KEY, COLOR_SQUARE_ANCHOR_STORAGE_KEY, COLOR_SQUARE_DOCK_STORAGE_KEY, DEFAULT_PANEL_DOCKS, FLOATING_PANEL_STORAGE_KEYS, INSPECTOR_LAYOUT_STORAGE_KEY, INSPECTOR_WIDTH_STORAGE_KEY, LEFT_DOCK_WIDTH_STORAGE_KEY, PANEL_DOCKS_STORAGE_KEY, TOOL_RAIL_SIDE_STORAGE_KEY, loadBottomDockHeight, loadInspectorWidth, loadLeftDockWidth, loadMainWindowState, loadPanelDocks, loadToolRailSide, normalizeWorkspaceLayout, readLayoutStorage, saveMainWindowState, savePanelDocks, writeLayoutStorage } from '@/core/workspace-layout-preferences'
import { type ExportOptions, useWorkspace } from '@/store/workspace'
import toolSelectionIcon from '@/assets/tool-icons/tool-selection.png'
import toolPencilIcon from '@/assets/tool-icons/tool-pencil.png'
import toolEraserIcon from '@/assets/tool-icons/tool-eraser.png'
import toolFillIcon from '@/assets/tool-icons/tool-fill.png'
import toolEyedropperIcon from '@/assets/tool-icons/tool-eyedropper.png'
import toolHandIcon from '@/assets/tool-icons/tool-hand.png'
import toolMoveIcon from '@/assets/tool-icons/tool-move.png'
import toolRotateIcon from '@/assets/tool-icons/tool-rotate.png'
import toolZoomIcon from '@/assets/tool-icons/tool-zoom.png'
import toolShapeIcon from '@/assets/tool-icons/tool-shape.png'
import selectionRectangleIcon from '@/assets/tool-icons/selection-rectangle.png'
import selectionEllipseIcon from '@/assets/tool-icons/selection-ellipse.png'
import selectionLassoIcon from '@/assets/tool-icons/selection-lasso.png'
import selectionMagicIcon from '@/assets/tool-icons/selection-magic.png'
import selectionReplaceIcon from '@/assets/tool-icons/selection-replace.png'
import selectionAddIcon from '@/assets/tool-icons/selection-add.png'
import selectionSubtractIcon from '@/assets/tool-icons/selection-subtract.png'
import selectionIntersectIcon from '@/assets/tool-icons/selection-intersect.png'
import './styles.css'

const LazyCanvasStage = lazy(() => import('@/components/CanvasStage').then(({ CanvasStage }) => ({ default: CanvasStage })))
const LazyHomeWorkspace = lazy(() => import('@/components/HomeWorkspace').then(({ HomeWorkspace }) => ({ default: HomeWorkspace })))
const LazyComponentLibrary = lazy(() => import('@/components/ComponentLibrary').then(({ ComponentLibrary }) => ({ default: ComponentLibrary })))

const tools: Array<{ id: ToolId; label: string; icon: string; key: string }> = [
  { id: 'pencil', label: '铅笔', icon: toolPencilIcon, key: 'B' },
  { id: 'eraser', label: '橡皮擦', icon: toolEraserIcon, key: 'E' },
  { id: 'selection', label: '选区', icon: toolSelectionIcon, key: 'M' },
  { id: 'move', label: '移动', icon: toolMoveIcon, key: 'V' },
  { id: 'shape', label: '形状', icon: toolShapeIcon, key: 'U' },
  { id: 'fill', label: '油漆桶', icon: toolFillIcon, key: 'G' },
  { id: 'eyedropper', label: '吸管', icon: toolEyedropperIcon, key: 'I' },
  { id: 'hand', label: '抓手', icon: toolHandIcon, key: 'H' },
  { id: 'zoom', label: '缩放', icon: toolZoomIcon, key: 'Z' },
  { id: 'rotate', label: '旋转视图', icon: toolRotateIcon, key: 'R' }
]

const defaultShortcuts: Record<string, string> = { ...DEFAULT_SHORTCUTS }

const selectionKindIcons = {
  rectangle: selectionRectangleIcon,
  ellipse: selectionEllipseIcon,
  lasso: selectionLassoIcon,
  magic: selectionMagicIcon
} as const

const selectionModes = [
  { id: 'replace', label: '新建', icon: selectionReplaceIcon },
  { id: 'add', label: '加选', icon: selectionAddIcon },
  { id: 'subtract', label: '减选', icon: selectionSubtractIcon },
  { id: 'intersect', label: '交集', icon: selectionIntersectIcon }
] as const

interface ExportPreset extends ExportOptions { presetName: string }
interface DocumentPanePosition { x: number; y: number; width: number; height: number }
const presetStorageKey = 'moonsprite.export-presets.v1'
type ToolRailSide = 'left' | 'right'
type AdvancedMode = 'tool-options' | 'canvas-only'

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

const pixelMasks = {
  round: ['01110', '11111', '11111', '11111', '01110'],
  square: ['11111', '11111', '11111', '11111', '11111'],
  line: ['11111'],
  rectangle: ['111111', '111111', '111111', '111111'],
  ellipse: ['011110', '111111', '111111', '011110']
} as const

function PixelShapeIcon({ kind }: { kind: keyof typeof pixelMasks }) {
  const mask = pixelMasks[kind]
  return <span className={`pixel-shape-icon ${kind}`} aria-hidden="true">{mask.flatMap((row, y) => [...row].map((cell, x) => <i key={`${x}-${y}`} className={cell === '1' ? 'filled' : ''} />))}</span>
}

function PixelAssetIcon({ src, className = '' }: { src: string; className?: string }) {
  return <img className={`pixel-asset-icon ${className}`.trim()} src={src} alt="" draggable={false} aria-hidden="true" />
}

function GrayscaleBrushThumbnail({ brush }: { brush: ImageBrush }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const context = canvasRef.current?.getContext('2d')
    if (!context) return
    const size = 32
    const image = context.createImageData(size, size)
    for (let y = 0; y < size; y += 1) for (let x = 0; x < size; x += 1) {
      const sourceX = Math.min(brush.width - 1, Math.floor(x * brush.width / size))
      const sourceY = Math.min(brush.height - 1, Math.floor(y * brush.height / size))
      const gray = brush.coverage[sourceY * brush.width + sourceX] ?? 0
      const offset = (y * size + x) * 4
      image.data[offset] = gray
      image.data[offset + 1] = gray
      image.data[offset + 2] = gray
      image.data[offset + 3] = 255
    }
    context.putImageData(image, 0, 0)
  }, [brush])
  return <canvas ref={canvasRef} width={32} height={32} aria-hidden="true" />
}

function GrayscaleBrushPreview({ brush, settings, color, paintMode, proceduralAntialiasStrength = 0 }: { brush: ImageBrush; settings: ImageBrushSettings; color: RgbaColor; paintMode: 'paint' | 'pattern-source' | 'pattern-target'; proceduralAntialiasStrength?: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const canvas = canvasRef.current
    const context = canvas?.getContext('2d')
    if (!canvas || !context) return
    const checker = 8
    context.clearRect(0, 0, canvas.width, canvas.height)
    for (let y = 0; y < canvas.height; y += checker) for (let x = 0; x < canvas.width; x += checker) {
      context.fillStyle = ((x / checker) + (y / checker)) % 2 === 0 ? '#d7d7d9' : '#9b9b9f'
      context.fillRect(x, y, checker, checker)
    }
    const stampSize = Math.min(64, Math.max(8, Math.max(brush.width, brush.height)))
    const stamp = brushStampDimensions(stampSize, brush)
    const pixelScale = Math.max(1, Math.floor(64 / Math.max(stamp.width, stamp.height)))
    const startX = Math.floor((canvas.width - stamp.width * pixelScale) / 2)
    const startY = Math.floor((canvas.height - stamp.height * pixelScale) / 2)
    context.fillStyle = `rgb(${color.r} ${color.g} ${color.b})`
    const previewMode = paintMode === 'pattern-source' ? 'paint' : paintMode
    for (const point of brushMaskOffsets(stampSize, 'square', 'solid', 1, 0, 0, brush, settings, proceduralAntialiasStrength, previewMode)) {
      context.globalAlpha = color.a / 255 * point.coverage / 255
      context.fillRect(startX + point.x * pixelScale, startY + point.y * pixelScale, pixelScale, pixelScale)
    }
    context.globalAlpha = 1
  }, [brush, color, paintMode, proceduralAntialiasStrength, settings])
  return <canvas ref={canvasRef} className="brush-live-preview" width={232} height={82} aria-label="灰度笔刷实时预览" />
}

type ProceduralControl = { key: keyof ProceduralBrushSettings; label: string; min: number; max: number; suffix?: string }
const proceduralControls: Record<ProceduralBrushId, ProceduralControl[]> = {
  'procedural:noise': [
    { key: 'scale', label: '颗粒', min: 1, max: 12, suffix: 'px' },
    { key: 'detail', label: '密度', min: 5, max: 95, suffix: '%' },
    { key: 'variation', label: '对比', min: 0, max: 100, suffix: '%' }
  ],
  'procedural:clouds': [
    { key: 'scale', label: '尺度', min: 4, max: 64, suffix: 'px' },
    { key: 'detail', label: '细节', min: 1, max: 5 },
    { key: 'variation', label: '对比', min: 0, max: 100, suffix: '%' }
  ],
  'procedural:cells': [
    { key: 'scale', label: '大小', min: 4, max: 40, suffix: 'px' },
    { key: 'detail', label: '边缘', min: 0, max: 100, suffix: '%' },
    { key: 'variation', label: '随机', min: 0, max: 100, suffix: '%' }
  ],
  'procedural:fibers': [
    { key: 'scale', label: '间距', min: 2, max: 32, suffix: 'px' },
    { key: 'angle', label: '方向', min: 0, max: 180, suffix: '°' },
    { key: 'detail', label: '弯曲', min: 0, max: 100, suffix: '%' },
    { key: 'variation', label: '杂乱', min: 0, max: 100, suffix: '%' }
  ]
}

const proceduralPresets: Record<ProceduralBrushId, Array<{ label: string; values: Partial<ProceduralBrushSettings> }>> = {
  'procedural:noise': [
    { label: '细腻', values: { scale: 1, detail: 42, variation: 30 } },
    { label: '标准', values: { scale: 2, detail: 50, variation: 50 } },
    { label: '粗粒', values: { scale: 6, detail: 60, variation: 75 } }
  ],
  'procedural:clouds': [
    { label: '柔和', values: { scale: 12, detail: 4, variation: 25 } },
    { label: '标准', values: { scale: 18, detail: 3, variation: 45 } },
    { label: '翻涌', values: { scale: 38, detail: 2, variation: 80 } }
  ],
  'procedural:cells': [
    { label: '细胞', values: { scale: 7, detail: 25, variation: 35 } },
    { label: '标准', values: { scale: 12, detail: 38, variation: 70 } },
    { label: '岩块', values: { scale: 25, detail: 62, variation: 95 } }
  ],
  'procedural:fibers': [
    { label: '细丝', values: { scale: 5, detail: 18, variation: 12 } },
    { label: '标准', values: { scale: 9, detail: 35, variation: 28 } },
    { label: '木纹', values: { scale: 17, detail: 72, variation: 58 } }
  ]
}

function ProceduralBrushControls({ brushId, settings, onChange }: { brushId: ProceduralBrushId; settings: ProceduralBrushSettings; onChange: (settings: Partial<ProceduralBrushSettings>) => void }) {
  return <>
    <div className="procedural-preset-row">{proceduralPresets[brushId].map((preset) => <button type="button" key={preset.label} onClick={() => onChange(preset.values)}>{preset.label}</button>)}</div>
    <div className="procedural-parameter-list">
      {proceduralControls[brushId].map((control) => <label key={control.key}><span>{control.label}</span><input type="range" min={control.min} max={control.max} value={settings[control.key]} onChange={(event) => onChange({ [control.key]: Number(event.target.value) })} /><NumberInput min={control.min} max={control.max} value={settings[control.key]} onValueChange={(value) => onChange({ [control.key]: value })} /><strong>{control.suffix ?? ''}</strong></label>)}
      <label className="procedural-seed"><span>种子</span><NumberInput min={0} max={9999} value={settings.seed} onValueChange={(seed) => onChange({ seed })} /><button type="button" title="更换随机种子" aria-label="更换随机种子" onClick={() => onChange({ seed: Math.floor(Math.random() * 10000) })}><RefreshCw size={13} /></button></label>
    </div>
  </>
}

function BrushOutputControls({ settings, onChange }: { settings: ImageBrushSettings; onChange: (settings: Partial<ImageBrushSettings>) => void }) {
  return <>
    <div className="brush-gray-presets"><button type="button" onClick={() => onChange({ mode: 'dither', blackPoint: 0, whitePoint: 255, threshold: 128, invert: false })}>柔和</button><button type="button" onClick={() => onChange({ mode: 'dither', blackPoint: 40, whitePoint: 215, threshold: 128, invert: false })}>清晰</button><button type="button" onClick={() => onChange({ mode: 'threshold', blackPoint: 0, whitePoint: 255, threshold: 128, invert: false })}>硬边</button></div>
    <div className="brush-gray-mode"><button type="button" className={settings.mode === 'dither' ? 'selected' : ''} onClick={() => onChange({ mode: 'dither' })}>抖动</button><button type="button" className={settings.mode === 'threshold' ? 'selected' : ''} onClick={() => onChange({ mode: 'threshold' })}>阈值</button></div>
    <div className="brush-level-controls">
      <label><span>黑场</span><input type="range" min={0} max={settings.whitePoint - 1} value={settings.blackPoint} onChange={(event) => onChange({ blackPoint: Number(event.target.value) })} /><NumberInput min={0} max={settings.whitePoint - 1} value={settings.blackPoint} onValueChange={(blackPoint) => onChange({ blackPoint })} /></label>
      <label><span>白场</span><input type="range" min={settings.blackPoint + 1} max={255} value={settings.whitePoint} onChange={(event) => onChange({ whitePoint: Number(event.target.value) })} /><NumberInput min={settings.blackPoint + 1} max={255} value={settings.whitePoint} onValueChange={(whitePoint) => onChange({ whitePoint })} /></label>
      {settings.mode === 'threshold' && <label><span>阈值</span><input type="range" min={0} max={255} value={settings.threshold} onChange={(event) => onChange({ threshold: Number(event.target.value) })} /><NumberInput min={0} max={255} value={settings.threshold} onValueChange={(threshold) => onChange({ threshold })} /></label>}
    </div>
  </>
}

export default function App() {
  const workspace = useWorkspace()
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
  const [previewOpen, setPreviewOpen] = useState(true)
  const [homeOpen, setHomeOpen] = useState(false)
  const [relativeLuminanceScope, setRelativeLuminanceScope] = useState<RelativeLuminanceScope>(() => parseRelativeLuminanceScope(readStoredString(RELATIVE_LUMINANCE_SCOPE_KEY)))
  const [advancedMode, setAdvancedMode] = useState<AdvancedMode | null>(null)
  const [advancedModeNotice, setAdvancedModeNotice] = useState<string | null>(null)
  const [advancedModeNoticeShortcut, setAdvancedModeNoticeShortcut] = useState('')
  const [shapeFlyoutOpen, setShapeFlyoutOpen] = useState(false)
  const [selectionFlyoutOpen, setSelectionFlyoutOpen] = useState(false)
  const [brushFlyoutOpen, setBrushFlyoutOpen] = useState(false)
  const [brushSizeFlyoutOpen, setBrushSizeFlyoutOpen] = useState(false)
  const [brushOutputOpen, setBrushOutputOpen] = useState(false)
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
  const [splitPanePositions, setSplitPanePositions] = useState<Record<string, DocumentPanePosition>>({})
  const [tabContextMenu, setTabContextMenu] = useState<{ documentId: string; x: number; y: number } | null>(null)
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
  const [workspaceLayoutChange, setWorkspaceLayoutChange] = useState(0)
  const workAreaRef = useRef<HTMLElement>(null)
  const inspectorWidthRef = useRef(inspectorWidth)
  const documentTabDrag = useRef<{ id: string; startX: number; startY: number; moved: boolean } | null>(null)
  const suppressTabClick = useRef(false)
  const closeInProgress = useRef(false)
  const splitPaneDrag = useRef<{ id: string; startX: number; startY: number; originX: number; originY: number } | null>(null)
  const session = useMemo(() => workspace.sessions.find((item) => item.document.id === workspace.activeId) ?? null, [workspace.sessions, workspace.activeId])
  const { brushSaveName, setBrushSaveName, proceduralBrushes, availableImageBrushes, selectionBrushes, grayscaleBrushes, selectedProjectBrush, selectedCustomBrush, loadLocalBrushes, saveTemporaryBrush, deleteLocalBrush } = useBrushLibrary(session)
  const saveShortcuts = (next: Record<string, string>): void => { setShortcuts(next); persistShortcuts(next) }
  const blockedShortcuts = useMemo(() => deriveShortcutConflicts(shortcuts).blocked, [shortcuts])
  const shortcutFor = useCallback((id: string): string => shortcuts[id] ?? defaultShortcuts[id] ?? '', [shortcuts])
  useEffect(() => {
    const syncPreferences = (): void => {
      setRelativeLuminanceScope(parseRelativeLuminanceScope(readStoredString(RELATIVE_LUMINANCE_SCOPE_KEY)))
    }
    window.addEventListener('moonsprite:preferences-changed', syncPreferences)
    return () => window.removeEventListener('moonsprite:preferences-changed', syncPreferences)
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
  const splitSessions = useMemo(() => splitDocumentIds
    ? splitDocumentIds.map((id, index) => ({ paneId: `${id}:${index}`, session: workspace.sessions.find((item) => item.document.id === id) })).filter((item): item is { paneId: string; session: NonNullable<typeof item.session> } => Boolean(item.session))
    : [], [splitDocumentIds, workspace.sessions])
  const tabContextSession = tabContextMenu ? workspace.sessions.find((item) => item.document.id === tabContextMenu.documentId) ?? null : null
  useEffect(() => {
    if (session?.tool !== 'pencil' && session?.tool !== 'eraser' && session?.tool !== 'fill') {
      setBrushFlyoutOpen(false)
      setBrushSizeFlyoutOpen(false)
    }
  }, [session?.tool])

  useEffect(() => {
    const closeBrushFlyout = (): void => setBrushFlyoutOpen(false)
    window.addEventListener('blur', closeBrushFlyout)
    return () => window.removeEventListener('blur', closeBrushFlyout)
  }, [])

  const updatePanelDock = useCallback((id: WorkspacePanelId, dock: PanelDock): void => {
    setPanelDocks((current) => {
      const next = { ...current, [id]: dock }
      savePanelDocks(next)
      return next
    })
  }, [])
  const visiblePanelIds = (Object.keys(panelDocks) as WorkspacePanelId[]).filter((id) => id !== 'preview' || previewOpen)
  const panelDockFor = (id: WorkspacePanelId): PanelDock => panelDocks[id] ?? defaultPanelDocks[id]
  const hasLeftDock = visiblePanelIds.some((id) => panelDockFor(id) === 'left')
  const hasBottomDock = visiblePanelIds.some((id) => panelDockFor(id) === 'bottom')
  const hasRightDock = visiblePanelIds.some((id) => panelDockFor(id) === 'right')

  const captureWorkspaceLayout = useCallback((): WorkspaceLayout => ({
    panelDocks: { ...panelDocks },
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
  }), [bottomLayersHeight, inspectorWidth, leftDockWidth, panelDocks, previewOpen, toolRailSide])
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
    setToolRailSide(nextToolRailSide)
    setPreviewOpen(layout.previewOpen !== false)
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
  }, [activeWorkspaceId, bottomLayersHeight, captureWorkspaceLayout, inspectorWidth, leftDockWidth, panelDocks, previewOpen, toolRailSide, workspaceLayoutChange, workspaceLayoutRevision])

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

  const duplicateDocumentView = async (documentId: string): Promise<void> => {
    const target = useWorkspace.getState().sessions.find((item) => item.document.id === documentId)
    if (!target) return
    const sourcePath = target.document.filePath ?? target.document.sourceFilePath
    if (!sourcePath) {
      workspace.setMessage('该工程没有可重新打开的本地路径。')
      return
    }
    setHomeOpen(false)
    setTabContextMenu(null)
    const opened = await workspace.openPath(sourcePath, { duplicate: true })
    if (!opened) workspace.setMessage('无法复制打开该工程。')
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
    void workspace.restoreRecoveries()
    const interval = window.setInterval(() => { void workspace.autosaveDirty() }, 30_000)
    const onBlur = (): void => { void workspace.autosaveDirty() }
    window.addEventListener('blur', onBlur)
    return () => { window.clearInterval(interval); window.removeEventListener('blur', onBlur) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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
      if (!event.target.closest('.document-tab, .document-tab-context-menu')) setTabContextMenu(null)
      if (!event.target.closest('.tool-slot')) {
        setShapeFlyoutOpen(false)
        setSelectionFlyoutOpen(false)
      }
      if (!event.target.closest('.brush-source')) setBrushFlyoutOpen(false)
      if (!event.target.closest('.brush-size-control')) setBrushSizeFlyoutOpen(false)
    }
    window.addEventListener('pointerdown', closeTransientPopovers, true)
    return () => window.removeEventListener('pointerdown', closeTransientPopovers, true)
  }, [])

  useEffect(() => {
    const closeTabContextMenu = (): void => setTabContextMenu(null)
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') closeTabContextMenu()
    }
    window.addEventListener('blur', closeTabContextMenu)
    window.addEventListener('keydown', closeOnEscape, true)
    return () => {
      window.removeEventListener('blur', closeTabContextMenu)
      window.removeEventListener('keydown', closeOnEscape, true)
    }
  }, [])

  useEffect(() => {
    if (session?.tool !== 'shape') setShapeFlyoutOpen(false)
    if (session?.tool !== 'selection') setSelectionFlyoutOpen(false)
    const focused = document.activeElement
    if (focused instanceof HTMLElement && focused.closest('.tool-rail')) focused.blur()
  }, [session?.tool])

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
    let active = true
    let removeNativeListener: (() => void) | null = null
    let removeWindowDropListener: (() => void) | null = null
    let removeWebviewDropListener: (() => void) | null = null
    const recentlyOpened = new Set<string>()
    const openDroppedPaths = (paths: string[]): void => {
      for (const path of paths) {
        if (!/\.(moonsprite|png|ase|aseprite)$/i.test(path) || recentlyOpened.has(path)) continue
        recentlyOpened.add(path)
        window.setTimeout(() => recentlyOpened.delete(path), 1_000)
        void useWorkspace.getState().openPath(path)
      }
    }
    const dragOver = (event: DragEvent): void => event.preventDefault()
    const drop = (event: DragEvent): void => {
      event.preventDefault()
      openDroppedPaths([...event.dataTransfer?.files ?? []].map((file) => window.moonSprite.pathForFile(file)).filter(Boolean))
    }
    window.addEventListener('dragover', dragOver, true)
    window.addEventListener('drop', drop, true)
    if ('__TAURI_INTERNALS__' in window) {
      void getCurrentWebview().onDragDropEvent((event) => {
        if (active && event.payload.type === 'drop') openDroppedPaths(event.payload.paths)
      }).then((remove) => { removeWebviewDropListener = remove; if (!active) remove() })
      void getCurrentWindow().onDragDropEvent((event) => {
        if (active && event.payload.type === 'drop') openDroppedPaths(event.payload.paths)
      }).then((remove) => { removeWindowDropListener = remove; if (!active) remove() })
      void listen<string[]>('app:file-drop', (event) => {
        if (active) openDroppedPaths(event.payload)
      }).then((remove) => { removeNativeListener = remove; if (!active) remove() })
    }
    return () => {
      active = false
      removeNativeListener?.()
      removeWindowDropListener?.()
      removeWebviewDropListener?.()
      window.removeEventListener('dragover', dragOver, true)
      window.removeEventListener('drop', drop, true)
    }
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
    const move = (event: PointerEvent): void => {
      const drag = documentTabDrag.current
      if (!drag || drag.moved) return
      if (Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) >= 5) drag.moved = true
    }
    const up = (event: PointerEvent): void => {
      const drag = documentTabDrag.current
      documentTabDrag.current = null
      if (!drag?.moved) return
      const activeId = useWorkspace.getState().activeId
      const overWorkspace = document.elementFromPoint(event.clientX, event.clientY)?.closest('.stage-wrap')
      if (overWorkspace && activeId && activeId !== drag.id) setSplitDocumentIds([activeId, drag.id])
      suppressTabClick.current = true
      window.setTimeout(() => { suppressTabClick.current = false }, 0)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    return () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up) }
  }, [])

  const beginDocumentTabDrag = (event: React.PointerEvent<HTMLButtonElement>, documentId: string): void => {
    if (event.button !== 0 || (event.target as HTMLElement).closest('.tab-close')) return
    documentTabDrag.current = { id: documentId, startX: event.clientX, startY: event.clientY, moved: false }
  }

  useEffect(() => {
    const keydown = (event: KeyboardEvent): void => {
      const key = keyboardEventKey(event).toLowerCase()
      const matches = (action: string): boolean => {
        if (blockedShortcuts[action as keyof typeof blockedShortcuts]) return false
        const configured = shortcuts[action]
        const expected = configured === undefined ? defaultShortcuts[action] : configured.trim()
        return expected !== '' && normalizeShortcut(shortcutText(event)).toLowerCase() === normalizeShortcut(expected).toLowerCase()
      }
      if (key === 'escape') {
        const hasTransientSurface = Boolean(workspace.dialog || workspace.saveProgress || newOpen || canvasResizeOpen || imageResizeOpen || outlineOpen || preferencesOpen || shortcutOpen || adjustmentOpen || aboutOpen || componentLibraryOpen || exportOpen || saveAsOpen || workspaceSaveOpen || workspaceManagerOpen || openMenu || tabContextMenu || shapeFlyoutOpen || selectionFlyoutOpen || brushFlyoutOpen || brushSizeFlyoutOpen || brushOutputOpen)
        const dialogChoice = workspace.dialog?.choices.find((choice) => choice.id === 'cancel')?.id ?? workspace.dialog?.choices.find((choice) => choice.tone === 'quiet')?.id
        if (workspace.dialog && dialogChoice) workspace.resolveDialog(dialogChoice)
        if (workspace.saveProgress) workspace.dismissSaveProgress()
        window.dispatchEvent(new Event('moonsprite:close-dialog'))
        setNewOpen(false); setCanvasResizeOpen(false); setImageResizeOpen(false); setOutlineOpen(false); setPreferencesOpen(false); setShortcutOpen(false); setAdjustmentOpen(false); setAboutOpen(false); setComponentLibraryOpen(false); setExportOpen(false); setSaveAsOpen(false); setWorkspaceSaveOpen(false); setWorkspaceManagerOpen(false)
        setOpenMenu(null); setTabContextMenu(null); setShapeFlyoutOpen(false); setSelectionFlyoutOpen(false); setBrushFlyoutOpen(false); setBrushSizeFlyoutOpen(false); setBrushOutputOpen(false)
        if (session?.pendingPaste) workspace.cancelFloatingPaste()
        else if (!hasTransientSurface) workspace.setSelection(null)
        event.preventDefault()
        event.stopPropagation()
        return
      }
      if (key === 'tab') {
        event.preventDefault()
        event.stopPropagation()
        return
      }
      if (key === 'alt') event.preventDefault()
      const commandKey = event.ctrlKey || event.metaKey
      const target = event.target as HTMLElement | null
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
      const browserShortcut = commandKey && (
        ['p', 'r', 'l', 'u', '0', '+', '=', '-'].includes(key)
        || (event.shiftKey && ['i', 'j', 'c'].includes(key))
      )
      if (browserShortcut || key === 'f5' || key === 'f12' || (event.altKey && (key === 'arrowleft' || key === 'arrowright'))) {
        event.preventDefault()
        event.stopPropagation()
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
      if (matches('saveAs')) {
        event.preventDefault()
        if (session && !homeOpen && !event.repeat) openSaveAs()
        return
      }
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
      if (event.ctrlKey || event.metaKey) {
        if (matches('selectAll')) {
          event.preventDefault()
          const state = useWorkspace.getState()
          const active = state.sessions.find((item) => item.document.id === state.activeId)
          if (active) {
            state.commitFloatingPaste()
            state.setTool('selection')
            state.setSelection({ x: 0, y: 0, width: active.document.width, height: active.document.height })
          }
          return
        }
        if (matches('createBrushFromSelection')) {
          event.preventDefault()
          if (session?.tool === 'selection' && session.selection) workspace.createBrushFromSelection()
          else workspace.setMessage('请先使用选区工具选择要作为笔刷的内容。')
          return
        }
        if (matches('deselect')) { event.preventDefault(); if (session?.pendingPaste) workspace.commitFloatingPaste(); if (session?.selection) workspace.commitSelectionChange({ ...session.selection }, null, '取消选区'); return }
        if (matches('newDocument')) { event.preventDefault(); setNewOpen(true) }
        if (matches('openDocument')) { event.preventDefault(); void openFilesAndShowDocument() }
        if (matches('save')) {
          event.preventDefault()
          if (!event.repeat) void workspace.saveActive()
          return
        }
        if (matches('relativeLuminance')) {
          event.preventDefault()
          if (session) workspace.setView({ relativeLuminance: !session.view.relativeLuminance })
        }
        if (matches('mirrorView') && session) {
          event.preventDefault()
          toggleMirrorView('horizontal')
        }
        if (matches('mirrorViewVertical') && session) {
          event.preventDefault()
          toggleMirrorView('vertical')
        }
        if (matches('imageResize') && session) {
          event.preventDefault()
          setImageResizeOpen(true)
        }
        if (matches('exportDocument')) { event.preventDefault(); openExport() }
        if (matches('copy')) { event.preventDefault(); if (session && !session.selection && !session.selectedGroupId && session.selectedLayerIds.length === 1) workspace.copyActiveLayerToClipboard(); else workspace.copySelection() }
        if (matches('cut')) { event.preventDefault(); workspace.cutSelection() }
        if (matches('paste')) { event.preventDefault(); if (!session?.selection && workspace.pasteLayerFromClipboard()) return; void workspace.pasteSelection() }
        if (matches('createLayerGroup')) { event.preventDefault(); workspace.createLayerGroup() }
        if (matches('ungroupLayers')) { event.preventDefault(); workspace.ungroupSelected() }
        if (matches('closeDocument') && workspace.activeId) { event.preventDefault(); void workspace.closeDocument(workspace.activeId) }
        return
      }
      if (matches('magic')) { workspace.setTool('selection'); workspace.setSelectionKind('magic'); return }
      if (matches('lasso')) { workspace.setTool('selection'); workspace.setSelectionKind('lasso'); return }
      if (matches('tool.selection.ellipse')) { workspace.setTool('selection'); workspace.setSelectionKind('ellipse'); return }
      if (matches('tool.selection')) { workspace.setTool('selection'); workspace.setSelectionKind('rectangle'); return }
      if (matches('canvasResize') && session) { setCanvasResizeOpen(true); return }
      if (matches('imageResize') && session) { setImageResizeOpen(true); return }
      if (matches('mirrorView') && session) {
        event.preventDefault()
        toggleMirrorView('horizontal')
        return
      }
      if (matches('mirrorViewVertical') && session) {
        event.preventDefault()
        toggleMirrorView('vertical')
        return
      }
      if (event.key === 'Enter' && session?.selection) {
        event.preventDefault()
        if (session.pendingPaste) workspace.commitFloatingPaste()
        const active = useWorkspace.getState().sessions.find((item) => item.document.id === session.document.id)
        if (active?.selection) workspace.commitSelectionChange(active.selection, null, '完成选区操作')
        return
      }
      const tool = tools.find((item) => matches(`tool.${item.id}`))
      if (tool) workspace.setTool(tool.id)
      if (matches('deleteLayer')) {
        event.preventDefault()
        if (session?.selection) workspace.deleteSelection()
        else if (session?.selectedLayerIds.length && !session.selectedGroupId) workspace.deleteActiveLayer()
        return
      }
      if (matches('brushSizeDecrease')) workspace.setBrushSize((session?.brushSize ?? 1) - 1)
      if (matches('brushSizeIncrease')) workspace.setBrushSize((session?.brushSize ?? 1) + 1)
    }
    const keyup = (event: KeyboardEvent): void => { if (event.key === 'Alt') event.preventDefault() }
    window.addEventListener('keydown', keydown, true)
    window.addEventListener('keyup', keyup, true)
    return () => { window.removeEventListener('keydown', keydown, true); window.removeEventListener('keyup', keyup, true) }
  }, [adjustmentOpen, advancedMode, aboutOpen, blockedShortcuts, brushFlyoutOpen, brushOutputOpen, brushSizeFlyoutOpen, canvasResizeOpen, componentLibraryOpen, cycleAdvancedMode, exportOpen, homeOpen, imageResizeOpen, newOpen, openMenu, openSaveAs, outlineOpen, preferencesOpen, saveAsOpen, selectionFlyoutOpen, shapeFlyoutOpen, shortcutOpen, tabContextMenu, toggleMirrorView, workspace, workspaceManagerOpen, workspaceSaveOpen, session?.brushSize, session?.document.id, session?.selection, shortcuts])

  useEffect(() => { void window.moonSprite.getResourceInfo().then((info) => setResourceLabel(`可用内存 ${formatBytes(info.freeBytes)}`)) }, [])
  useEffect(() => {
    if (splitDocumentIds && splitSessions.length !== 2) setSplitDocumentIds(null)
  }, [splitDocumentIds, splitSessions.length])

  useEffect(() => {
    const move = (event: PointerEvent): void => {
      const drag = splitPaneDrag.current
      const workspaceElement = document.querySelector('.split-workspace')
      if (!drag || !workspaceElement) return
      const workspaceBounds = workspaceElement.getBoundingClientRect()
      const pane = document.querySelector(`[data-document-pane-id="${drag.id}"]`)
      const paneBounds = pane?.getBoundingClientRect()
      const width = paneBounds?.width ?? workspaceBounds.width / 2
      const height = paneBounds?.height ?? workspaceBounds.height / 2
      const x = Math.max(0, Math.min(workspaceBounds.width - width, drag.originX + event.clientX - drag.startX))
      const y = Math.max(0, Math.min(workspaceBounds.height - height, drag.originY + event.clientY - drag.startY))
      setSplitPanePositions((current) => ({ ...current, [drag.id]: { x, y, width, height } }))
    }
    const up = (): void => { splitPaneDrag.current = null }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    return () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up) }
  }, [])

  const dropDocumentIntoWorkspace = (event: React.DragEvent<HTMLDivElement>): void => {
    event.preventDefault()
    event.stopPropagation()
    const documentId = event.dataTransfer.getData('application/x-moonsprite-document')
    if (!session || !documentId || documentId === session.document.id || !workspace.sessions.some((item) => item.document.id === documentId)) return
    setSplitDocumentIds([session.document.id, documentId])
    setSplitPanePositions({})
  }
  const beginSplitPaneDrag = (event: React.PointerEvent<HTMLElement>, paneId: string): void => {
    if (event.button !== 0 || (event.target as HTMLElement).closest('button')) return
    const pane = event.currentTarget.closest('.document-pane')
    const workspaceElement = pane?.closest('.split-workspace')
    if (!pane || !workspaceElement) return
    const paneBounds = pane.getBoundingClientRect()
    const workspaceBounds = workspaceElement.getBoundingClientRect()
    splitPaneDrag.current = { id: paneId, startX: event.clientX, startY: event.clientY, originX: paneBounds.left - workspaceBounds.left, originY: paneBounds.top - workspaceBounds.top }
    event.preventDefault()
  }
  const rememberSplitPaneGeometry = (paneId: string, pane: HTMLElement): void => {
    const workspaceElement = pane.closest('.split-workspace')
    if (!workspaceElement) return
    const paneBounds = pane.getBoundingClientRect()
    const workspaceBounds = workspaceElement.getBoundingClientRect()
    setSplitPanePositions((current) => ({ ...current, [paneId]: {
      x: paneBounds.left - workspaceBounds.left,
      y: paneBounds.top - workspaceBounds.top,
      width: paneBounds.width,
      height: paneBounds.height
    } }))
  }
  const paneStyle = (paneId: string, index: number): React.CSSProperties => {
    const saved = splitPanePositions[paneId]
    if (saved) return { left: saved.x, top: saved.y, width: saved.width, height: saved.height }
    return { left: index === 0 ? '0%' : '50%', top: '0%', width: '50%', height: '100%' }
  }
  const stageContent = session && splitSessions.length === 2
    ? <Suspense fallback={<div aria-hidden="true" />}>{<div className="split-workspace">{splitSessions.map((pane, index) => <section key={pane.paneId} data-document-pane-id={pane.paneId} style={paneStyle(pane.paneId, index)} className={`document-pane ${workspace.activeId === pane.session.document.id ? 'active' : ''}`} onPointerDownCapture={() => workspace.setActive(pane.session.document.id)} onPointerUpCapture={(event) => rememberSplitPaneGeometry(pane.paneId, event.currentTarget)}><header onPointerDown={(event) => beginSplitPaneDrag(event, pane.paneId)}><FileImage size={13} /><span>{pane.session.document.name}</span>{pane.session.document.dirty && <i />}<button title="退出分屏" aria-label={`退出 ${pane.session.document.name} 分屏`} onClick={() => { setSplitDocumentIds(null); setSplitPanePositions({}) }}><X size={13} /></button></header><div className="document-pane-canvas"><LazyCanvasStage session={pane.session} /></div></section>)}</div>}</Suspense>
    : session ? <Suspense fallback={<div aria-hidden="true" />}><LazyCanvasStage session={session} /></Suspense> : null
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
    {saveAsOpen && session && <SaveAsDialog initialName={session.document.name.replace(/\.(moonsprite|aseprite|ase|png|jpe?g|webp)$/i, '') || 'MoonSprite-project'} onClose={() => setSaveAsOpen(false)} onSave={(options) => workspace.saveActive(true, options)} />}
    <AppMenuBar
      openMenu={openMenu}
      setOpenMenu={setOpenMenu}
      shortcutFor={shortcutFor}
      homeOpen={homeOpen}
      previewOpen={previewOpen}
      advancedModeActive={advancedMode !== null}
      onHome={() => setHomeOpen(true)}
      onNew={() => setNewOpen(true)}
      onOpen={() => { void openFilesAndShowDocument() }}
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
      onTogglePreview={() => setPreviewOpen((value) => !value)}
      onCycleAdvancedMode={cycleAdvancedMode}
      onOpenComponentLibrary={() => setComponentLibraryOpen(true)}
      onOpenAbout={() => setAboutOpen(true)}
    />

    <section className="tab-strip" aria-label="文档标签">{workspace.sessions.map((item) => <button key={item.document.id} className={`document-tab ${item.document.id === workspace.activeId && !homeOpen ? 'active' : ''}`} onPointerDown={(event) => { if (event.button === 1) { event.preventDefault(); return }; beginDocumentTabDrag(event, item.document.id) }} onAuxClick={(event) => { if (event.button !== 1) return; event.preventDefault(); event.stopPropagation(); setTabContextMenu(null); void workspace.closeDocument(item.document.id) }} onContextMenu={(event) => { event.preventDefault(); event.stopPropagation(); setHomeOpen(false); workspace.setActive(item.document.id); setTabContextMenu({ documentId: item.document.id, x: event.clientX, y: event.clientY }) }} onClick={(event) => { if (suppressTabClick.current) { event.preventDefault(); return }; setHomeOpen(false); workspace.setActive(item.document.id); if (splitDocumentIds && !splitDocumentIds.includes(item.document.id)) setSplitDocumentIds(null) }}><FileImage size={14} /><span>{item.document.name}</span>{item.document.dirty && <i />}<span className="tab-close" role="button" tabIndex={0} aria-label={`关闭 ${item.document.name}`} onClick={(event) => { event.stopPropagation(); void workspace.closeDocument(item.document.id) }}><X size={12} /></span></button>)}<button className="new-tab-button" aria-label="新建作品" title="新建作品" onClick={() => setNewOpen(true)}><Plus size={16} /></button><span className="workspace-top-control workspace-tab-control"><button type="button" className={`icon-button ${openMenu === 'workspace' ? 'active' : ''}`} title="工作区" aria-label="工作区" aria-expanded={openMenu === 'workspace'} onPointerDown={(event) => event.stopPropagation()} onClick={() => { setOpenMenu(openMenu === 'workspace' ? null : 'workspace'); if (openMenu !== 'workspace') void loadSavedWorkspaces() }}><LayoutTemplate size={16} /></button>{openMenu === 'workspace' && createPortal(<div className="workspace-popover" role="menu" aria-label="工作区"><button type="button" role="menuitem" onPointerDown={(event) => { event.preventDefault(); event.stopPropagation(); setWorkspaceSaveName(''); setWorkspaceSaveOpen(true); closeMenu() }}>新建工作区...</button><span className="workspace-popover-divider" />{savedWorkspaces.map((saved) => <button key={saved.id} type="button" role="menuitem" className={saved.id === activeWorkspaceId ? 'selected-workspace' : ''} title={`载入工作区：${saved.name}`} onPointerDown={(event) => { event.preventDefault(); event.stopPropagation(); void applyWorkspaceLayout(saved); closeMenu() }}><span className="menu-check">{saved.id === activeWorkspaceId && <Check size={14} />}</span><span>{saved.name}</span></button>)}<span className="workspace-popover-divider" /><button type="button" role="menuitem" disabled={!activeWorkspaceId} onPointerDown={(event) => { event.preventDefault(); event.stopPropagation(); void resetCurrentWorkspace(); closeMenu() }}>复位当前工作区</button><button type="button" role="menuitem" onPointerDown={(event) => { event.preventDefault(); event.stopPropagation(); setWorkspaceManagerOpen(true); closeMenu() }}>管理工作区...</button></div>, document.body)}</span></section>

    {tabContextMenu && createPortal(<div className="context-menu document-tab-context-menu" role="menu" aria-label="项目标签操作" style={{ left: Math.min(tabContextMenu.x, Math.max(8, window.innerWidth - 232)), top: Math.min(tabContextMenu.y, Math.max(8, window.innerHeight - 150)) }}><button className="context-menu-item" role="menuitem" onClick={() => { void workspace.closeDocument(tabContextMenu.documentId); setTabContextMenu(null) }}><X size={15} /><span>关闭</span></button><button className="context-menu-item" role="menuitem" onClick={() => { void duplicateDocumentView(tabContextMenu.documentId) }}><Copy size={15} /><span>复制视图</span></button><button className="context-menu-item" role="menuitem" onClick={() => { openProjectFolder(tabContextMenu.documentId); setTabContextMenu(null) }}><FolderOpen size={15} /><span>在文件夹中打开</span></button></div>, document.body)}

    {session && !homeOpen ? <section className="editor-layout" style={{ gridTemplateColumns: editorOnly ? 'minmax(0, 1fr)' : editorColumns, gridTemplateAreas: editorOnly ? '"work"' : `"${editorAreas}"` }}>
      <aside className={`tool-rail side-${toolRailSide}`} aria-label="工具栏"><button className="tool-rail-grip" type="button" aria-label="移动工具栏" title="拖动工具栏到左侧或右侧" onPointerDown={(event) => { if (event.button !== 0) return; toolRailDrag.current = { startX: event.clientX, startY: event.clientY, moved: false, target: toolRailSide }; event.currentTarget.setPointerCapture?.(event.pointerId); event.preventDefault() }}><GripVertical size={14} /></button>{tools.map((tool) => {
        const displayedIcon = tool.id === 'selection' ? selectionKindIcons[session.selectionKind] : tool.icon
        const openToolFlyout = (): void => {
          workspace.setTool(tool.id)
          setShapeFlyoutOpen(tool.id === 'shape' ? !shapeFlyoutOpen : false)
          setSelectionFlyoutOpen(tool.id === 'selection' ? !selectionFlyoutOpen : false)
        }
        return <div className="tool-slot" key={tool.id}>
          <button className={session.tool === tool.id ? 'selected' : ''} aria-label={tool.label} title={`${tool.label} (${tool.key})`} onClick={openToolFlyout}><PixelAssetIcon src={displayedIcon} className="rail-tool-icon" /><small>{tool.key}</small></button>
          {tool.id === 'selection' && selectionFlyoutOpen && <div className="tool-flyout selection-flyout" role="dialog" aria-label="选择选区方式">
            <button className={session.selectionKind === 'rectangle' ? 'selected' : ''} title="矩形选区" aria-label="矩形选区" onClick={() => { workspace.setSelectionKind('rectangle'); setSelectionFlyoutOpen(false) }}><PixelAssetIcon src={selectionKindIcons.rectangle} /></button>
            <button className={session.selectionKind === 'ellipse' ? 'selected' : ''} title="椭圆选区 (Shift+M)" aria-label="椭圆选区" onClick={() => { workspace.setSelectionKind('ellipse'); setSelectionFlyoutOpen(false) }}><PixelAssetIcon src={selectionKindIcons.ellipse} /></button>
            <button className={session.selectionKind === 'lasso' ? 'selected' : ''} title="套索选区 (Q)" aria-label="套索选区" onClick={() => { workspace.setSelectionKind('lasso'); setSelectionFlyoutOpen(false) }}><PixelAssetIcon src={selectionKindIcons.lasso} /></button>
            <button className={session.selectionKind === 'magic' ? 'selected' : ''} title="魔棒选区" aria-label="魔棒选区" onClick={() => { workspace.setSelectionKind('magic'); setSelectionFlyoutOpen(false) }}><PixelAssetIcon src={selectionKindIcons.magic} /></button>
          </div>}
          {tool.id === 'shape' && shapeFlyoutOpen && <div className="tool-flyout shape-flyout" role="dialog" aria-label="快速选择形状"><button className={session.shapeKind === 'rectangle' ? 'selected' : ''} title="矩形" aria-label="矩形" onClick={() => { workspace.setShapeKind('rectangle'); setShapeFlyoutOpen(false) }}><PixelShapeIcon kind="rectangle" /></button><button className={session.shapeKind === 'ellipse' ? 'selected' : ''} title="圆形" aria-label="圆形" onClick={() => { workspace.setShapeKind('ellipse'); setShapeFlyoutOpen(false) }}><PixelShapeIcon kind="ellipse" /></button></div>}
        </div>
      })}</aside>
      {hasLeftDock && <aside ref={setLeftDockHost} className="left-panel-dock" data-panel-dock-zone="left" />}
      {hasLeftDock && <div className="left-dock-resizer" role="separator" aria-orientation="vertical" aria-label="调整左侧停靠区宽度" onPointerDown={(event) => { leftDockResizeStart.current = { x: event.clientX, width: leftDockWidth }; event.currentTarget.setPointerCapture?.(event.pointerId); event.preventDefault() }} />}
      <section ref={workAreaRef} className={`work-area ${hasBottomDock ? 'has-bottom-layers' : ''}`} style={{ '--bottom-layers-height': `${bottomLayersHeight}px` } as React.CSSProperties}>
        <div className="tool-options">
          <span className="tool-label">{tools.find((tool) => tool.id === session.tool)?.label}</span>
          {(session.tool === 'pencil' || session.tool === 'eraser' || session.tool === 'fill') && <>
            {session.brushImage && <button type="button" className="brush-return-button" title="返回基础笔刷" onClick={() => { workspace.setBrushImage(null); setBrushFlyoutOpen(false) }}>返回</button>}
            {(session.tool === 'pencil' || session.tool === 'eraser' || session.tool === 'fill') && <div className="brush-source">
              <button className={`brush-source-trigger ${brushFlyoutOpen ? 'selected' : ''}`} type="button" title="打开笔刷库" aria-label="打开笔刷库" onClick={() => setBrushFlyoutOpen((value) => !value)}>{session.brushImage ? <GrayscaleBrushThumbnail brush={session.brushImage} /> : <PixelShapeIcon kind={session.brushShape} />}</button>
              {brushFlyoutOpen && <>
                <div className="brush-library" role="dialog" aria-label="笔刷库">
                <div className="brush-library-selection-column">
                <section className="brush-library-section">
                  <header className="brush-library-section-title"><strong>基础笔刷</strong><span>形状</span></header>
                  <div className="brush-library-grid basic-brush-grid" aria-label="基础笔刷">
                    <button className={!session.brushImage && session.brushShape === 'round' ? 'selected' : ''} type="button" title="圆形笔刷" aria-label="圆形笔刷" onClick={() => { workspace.setBrushImage(null); workspace.setBrushShape('round') }}><PixelShapeIcon kind="round" /></button>
                    <button className={!session.brushImage && session.brushShape === 'square' ? 'selected' : ''} type="button" title="方形笔刷" aria-label="方形笔刷" onClick={() => { workspace.setBrushImage(null); workspace.setBrushShape('square') }}><PixelShapeIcon kind="square" /></button>
                    <button className={!session.brushImage && session.brushShape === 'line' ? 'selected' : ''} type="button" title="横线笔刷" aria-label="横线笔刷" onClick={() => { workspace.setBrushImage(null); workspace.setBrushShape('line') }}><PixelShapeIcon kind="line" /></button>
                  </div>
                </section>
                <section className="brush-library-section">
                  <header className="brush-library-section-title"><strong>程序纹理</strong><span>内置</span></header>
                  <div className="brush-library-grid" aria-label="内置程序纹理">{proceduralBrushes.map((item) => <button key={item.brush.id} className={session.brushImage?.id === item.brush.id ? 'selected procedural' : 'procedural'} title={item.brush.name} aria-label={item.brush.name} onClick={() => workspace.setBrushImage(item.brush)}><GrayscaleBrushThumbnail brush={item.brush} /></button>)}</div>
                </section>
                <section className="brush-library-section">
                  <header className="brush-library-section-title"><strong>自定义笔刷</strong><span>{selectionBrushes.length}</span></header>
                  {selectionBrushes.length > 0 ? <div className="brush-library-grid local-brush-grid selection-brush-grid" aria-label="自定义笔刷">
                    {selectionBrushes.map((item) => <div className="local-brush-item" key={item.brush.id}><button className={session.brushImage?.id === item.brush.id ? 'selected' : ''} title={`${item.brush.name} (${item.brush.width} x ${item.brush.height})`} aria-label={item.brush.name} onClick={() => workspace.setBrushImage(item.brush)}><GrayscaleBrushThumbnail brush={item.brush} /></button></div>)}
                  </div> : <p className="brush-library-empty">用选区创建的笔刷会显示在这里</p>}
                </section>
                <section className="brush-library-section">
                  <header className="brush-library-section-title"><strong>灰度图笔刷</strong><span>{grayscaleBrushes.length}</span></header>
                  {grayscaleBrushes.length > 0 ? <div className="brush-library-grid grayscale-brush-grid" aria-label="本地灰度图笔刷">{grayscaleBrushes.map((item) => <button key={item.brush.id} className={session.brushImage?.id === item.brush.id ? 'selected' : ''} title={`${item.brush.name} (${item.brush.width} x ${item.brush.height})`} aria-label={item.brush.name} onClick={() => workspace.setBrushImage(item.brush)}><GrayscaleBrushThumbnail brush={item.brush} /></button>)}</div> : <p className="brush-library-empty">笔刷文件夹中暂无灰度图笔刷</p>}
                </section>
                </div>
                <footer><button type="button" onClick={() => void loadLocalBrushes()}>刷新</button><button type="button" onClick={() => void window.moonSprite.openBrushFolder()}>打开笔刷文件夹</button></footer>
                </div>
                {session.brushImage ? <aside className="brush-details-panel">
                   {selectedProjectBrush ? <section className="brush-basic-settings custom-brush-settings">
                     <GrayscaleBrushPreview brush={session.brushImage} settings={session.brushImageSettings} color={session.primaryColor} paintMode={session.brushPaintMode} />
                     <strong>{session.brushImage.name}</strong>
                     <p>这是保存在当前工程中的自定义笔刷，只保留原始像素和笔刷模式，不提供灰度图参数调整。</p>
                     {selectedCustomBrush && <button type="button" className="brush-delete-command" onClick={() => void deleteLocalBrush(selectedCustomBrush)}><Trash2 size={13} />删除笔刷</button>}
                    </section> : <section className="brush-gray-settings">
                  <GrayscaleBrushPreview brush={session.brushImage} settings={session.brushImageSettings} color={session.primaryColor} paintMode="paint" proceduralAntialiasStrength={session.proceduralAntialias && session.brushImage.id.startsWith('procedural:') ? session.proceduralAntialiasStrength : 0} />
                  <header><strong>{session.brushImage.name}{session.brushImageTemporary && <small>临时</small>}</strong><button type="button" className={session.brushImageSettings.invert ? 'selected' : ''} onClick={() => workspace.setBrushImageSettings({ invert: !session.brushImageSettings.invert })}>{session.brushImageSettings.invert && <Check size={12} />}反相</button></header>
                  {isProceduralBrushId(session.brushImage.id) ? <>
                    <ProceduralBrushControls brushId={session.brushImage.id} settings={session.proceduralBrushSettings[session.brushImage.id]} onChange={workspace.setProceduralBrushSettings} />
                    <section className="brush-advanced-settings">
                      <button type="button" className="brush-advanced-trigger" aria-expanded={brushOutputOpen} onClick={() => setBrushOutputOpen((open) => !open)}><span>输出设置</span><ChevronDown size={14} /></button>
                      {brushOutputOpen && <div>
                      <div className="procedural-antialias-control"><label className="tool-checkbox"><input type="checkbox" checked={session.proceduralAntialias} onChange={(event) => workspace.setProceduralAntialias(event.target.checked)} />纹理抗锯齿</label>{session.proceduralAntialias && <label className="procedural-antialias-strength"><span>程度</span><input type="range" min="1" max="100" value={session.proceduralAntialiasStrength} onChange={(event) => workspace.setProceduralAntialiasStrength(Number(event.target.value))} /><NumberInput min={1} max={100} value={session.proceduralAntialiasStrength} onValueChange={workspace.setProceduralAntialiasStrength} /><strong>%</strong></label>}</div>
                      <BrushOutputControls settings={session.brushImageSettings} onChange={workspace.setBrushImageSettings} />
                      </div>}
                    </section>
                  </> : <BrushOutputControls settings={session.brushImageSettings} onChange={workspace.setBrushImageSettings} />}
                   </section>}
                  {session.brushImageTemporary && <div className="temporary-brush-save"><input aria-label="永久笔刷名称" value={brushSaveName} maxLength={64} onChange={(event) => setBrushSaveName(event.target.value)} /><button type="button" onClick={() => void saveTemporaryBrush()}>永久保存</button></div>}
                </aside> : <aside className="brush-details-panel">
                  <section className="brush-basic-settings">
                    <div className="brush-basic-settings-preview"><PixelShapeIcon kind={session.brushShape} /></div>
                     <strong>{session.brushShape === 'round' ? '圆形笔刷' : session.brushShape === 'line' ? '横线笔刷' : '方形笔刷'}</strong>
                    <p>基础笔刷使用顶部的尺寸控制。选择程序纹理或灰度图后，可在这里调整纹理与输出。</p>
                  </section>
                </aside>}
              </>}
            </div>}
            {!session.brushImage?.intrinsicSize && <div className="brush-size-control" onPointerDown={() => setBrushSizeFlyoutOpen(true)}><NumberInput aria-label="笔刷尺寸数值" min={1} max={128} suffix="px" value={session.brushSize} onValueChange={workspace.setBrushSize} onFocus={() => setBrushSizeFlyoutOpen(true)} />{brushSizeFlyoutOpen && <div className="brush-size-popover" role="dialog" aria-label="调整笔刷尺寸"><input aria-label="笔刷尺寸滑条" type="range" min="1" max="128" value={session.brushSize} onChange={(event) => workspace.setBrushSize(Number(event.target.value))} /><strong>{session.brushSize}px</strong></div>}</div>}
            {session.brushImage?.intrinsicSize && <select className="brush-paint-mode-select" aria-label="笔刷模式" title="图案与来源对齐：按笔刷来源位置平铺；图案与目标对齐：按当前落点平铺；油漆笔刷：按画布原点平铺" value={session.brushPaintMode} onChange={(event) => workspace.setBrushPaintMode(event.target.value as typeof session.brushPaintMode)}><option value="pattern-source">图案与来源对齐</option><option value="pattern-target">图案与目标对齐</option><option value="paint">油漆笔刷</option></select>}
            {(session.tool === 'pencil' || session.tool === 'eraser') && <label className="tool-checkbox"><input type="checkbox" checked={session.perfectPixels} onChange={(event) => workspace.setPerfectPixels(event.target.checked)} />完美像素</label>}
          </>}
          {session.tool === 'selection' && <>
            <div className="segmented-control selection-mode-control" aria-label="选区模式">{selectionModes.map((mode) => <button key={mode.id} title={mode.label} aria-label={mode.label} className={session.selectionMode === mode.id ? 'selected' : ''} onClick={() => workspace.setSelectionMode(mode.id)}><PixelAssetIcon src={mode.icon} /></button>)}</div>
            {session.selectionKind === 'magic' && <><label className="wand-tolerance">容差 <NumberInput aria-label="魔棒容差" min={0} max={255} value={session.wandTolerance} onValueChange={workspace.setWandTolerance} /></label><label className="tool-checkbox"><input aria-label="连续选择" type="checkbox" checked={session.wandContiguous} onChange={(event) => workspace.setWandContiguous(event.target.checked)} />连续</label></>}
          </>}
          {session.tool === 'fill' && <div className="segmented-control fill-mode-control" aria-label="填充范围"><button className={session.fillMode === 'contiguous' ? 'selected' : ''} onClick={() => workspace.setFillMode('contiguous')}>连续</button><button className={session.fillMode === 'global' ? 'selected' : ''} onClick={() => workspace.setFillMode('global')}>不连续</button></div>}
          {session.tool === 'move' && <label className="tool-checkbox"><input type="checkbox" checked={session.moveAutoSelect} onChange={(event) => workspace.setMoveAutoSelect(event.target.checked)} />自动选择图层</label>}
          {session.tool === 'rotate' && <div className="rotate-view-options"><label>旋转度数 <NumberInput aria-label="旋转度数" min={0} max={359.9} step={0.1} value={Math.round(session.view.rotation * 10) / 10} onValueChange={(rotation) => workspace.setView({ rotation: ((rotation % 360) + 360) % 360 })} /></label><button type="button" className="tool-text-button" onClick={() => workspace.setView({ rotation: 0 })}>复位视图</button></div>}
          <span className="tool-options-spacer" />
          <button className="tool-text-button" onClick={() => workspace.undo()} disabled={!session.history.canUndo}><Undo2 size={15} />撤销</button>
          <button className="tool-text-button" onClick={() => workspace.redo()} disabled={!session.history.canRedo}><Redo2 size={15} />重做</button>
        </div>
        <div className={`stage-wrap ${splitSessions.length === 2 ? 'has-split' : ''}`} onDragOver={(event) => { if (event.dataTransfer.types.includes('application/x-moonsprite-document')) { event.preventDefault(); event.dataTransfer.dropEffect = 'move' } }} onDrop={dropDocumentIntoWorkspace}>{stageContent}</div>
        {hasBottomDock && <div className="bottom-layers-resizer" role="separator" aria-orientation="horizontal" aria-label="调整底部停靠区高度" onPointerDown={(event) => { bottomLayersResizeStart.current = { y: event.clientY, height: bottomLayersHeight }; event.currentTarget.setPointerCapture?.(event.pointerId); event.preventDefault() }}><span /></div>}
        {hasBottomDock && <div ref={setBottomDockHost} className="bottom-layers-dock" data-panel-dock-zone="bottom" />}
      </section>
      {hasRightDock && <div className="inspector-resizer" role="separator" aria-orientation="vertical" aria-label="调整右侧面板宽度" onPointerDown={(event) => { resizeStart.current = { x: event.clientX, width: inspectorWidth }; event.currentTarget.setPointerCapture(event.pointerId) }} />}
      <aside className={`inspector ${hasRightDock ? '' : 'inspector-empty'}`} {...(hasRightDock ? { 'data-panel-dock-zone': 'right' } : {})}><InspectorPanels key={workspaceLayoutRevision} session={session} previewOpen={previewOpen} onClosePreview={() => setPreviewOpen(false)} panelDocks={panelDocks} leftDockHost={leftDockHost} bottomDockHost={bottomDockHost} onPanelDockChange={updatePanelDock} relativeLuminanceInPreview={relativeLuminanceScope === 'app'} /></aside>
      {toolRailDockPreview && <div className={`tool-rail-dock-preview ${toolRailDockPreview}`} aria-hidden="true" />}
    </section> : <Suspense fallback={<div aria-hidden="true" />}><LazyHomeWorkspace onNew={() => setNewOpen(true)} onOpen={() => void openFilesAndShowDocument()} onOpenProject={openGalleryProject} onRestoreRecovery={restoreRecoveryAndShowDocument} /></Suspense>}

    <footer className="statusbar">{session && !homeOpen ? <><span>{session.document.colorMode === 'rgba' ? 'RGBA 真彩色' : '索引模式'}</span><span>{session.document.layers.length} 图层</span><span>{Math.round(session.view.zoom * 100)}%</span><span>{session.selection ? `选区 ${session.selection.width} x ${session.selection.height}` : '无选区'}</span></> : <span>准备就绪</span>}<span className="status-spacer" />{workspace.message && <span className="status-message" onClick={() => workspace.setMessage(null)}>{workspace.message}</span>}<span>{resourceLabel}</span></footer>
    {advancedModeNotice && <div className="advanced-mode-notice" role="status" aria-live="polite"><strong>{advancedModeNotice}</strong><small>{advancedModeNotice.startsWith('高级模式') ? `${advancedModeNoticeShortcut} 恢复` : advancedModeNoticeShortcut}</small></div>}
    {workspace.saveProgress && <div className="modal-backdrop save-progress-backdrop" role="presentation"><section className="modal save-progress-modal" role="status" aria-live="polite"><header><div><span className="eyebrow">SAVE PROJECT</span><h2>正在保存</h2></div><button type="button" className="icon-button" aria-label="关闭保存进度" onClick={() => workspace.dismissSaveProgress()}><X size={16} /></button></header><div className="save-progress-body"><strong>{workspace.saveProgress.label}</strong><div className="save-progress-track" aria-label={`保存进度 ${workspace.saveProgress.value}%`}><i style={{ width: `${workspace.saveProgress.value}%` }} /></div><small>{workspace.saveProgress.value}%</small></div></section></div>}
    {workspace.dialog && <div className="modal-backdrop dialog-backdrop" role="presentation"><section className="modal confirm-modal" role="alertdialog" aria-modal="true" aria-labelledby="app-dialog-title"><header><div><span className="eyebrow">MOONSPRITE</span><h2 id="app-dialog-title">{workspace.dialog.title}</h2></div></header><div className="confirm-content"><strong>{workspace.dialog.message}</strong>{workspace.dialog.detail && <p>{workspace.dialog.detail}</p>}</div><footer>{workspace.dialog.choices.map((choice) => <button key={choice.id} className={choice.tone === 'primary' ? 'primary-button' : choice.tone === 'danger' ? 'danger-button' : 'quiet-button'} onClick={() => workspace.resolveDialog(choice.id)}>{choice.label}</button>)}</footer></section></div>}
    {exportOpen && <div className="modal-backdrop" role="presentation" onPointerDown={(event) => { if (event.target === event.currentTarget) setExportOpen(false) }}><form className="modal export-modal" onSubmit={(event) => { event.preventDefault(); void workspace.exportActive(exportForm).then((exported) => { if (exported) setExportOpen(false) }) }}><header><div><span className="eyebrow">EXPORT IMAGE</span><h2>导出设置</h2></div><button type="button" className="icon-button" aria-label="关闭" onClick={() => setExportOpen(false)}><X size={16} /></button></header><div className="modal-body"><label>文件名称<input autoFocus value={exportForm.name} onChange={(event) => setExportForm({ ...exportForm, name: event.target.value })} /></label><label>格式<ThemedSelect<ExportOptions['format']> value={exportForm.format} groups={[{ label: '导出格式', options: [{ value: 'png-auto', label: 'PNG 自动索引' }, { value: 'png-rgba', label: 'PNG RGBA' }, { value: 'jpeg', label: 'JPEG（白色背景）' }, { value: 'webp', label: 'WebP' }, { value: 'svg', label: 'SVG' }] }]} label="导出格式" onChange={(format) => setExportForm({ ...exportForm, format, scalePercent: format === 'svg' ? 100 : exportForm.scalePercent })} /></label><label>{exportForm.format === 'svg' ? '缩放倍数' : '放大比率'}<div className="scale-control"><NumberInput min={1} max={exportForm.format === 'svg' ? 64 : 6400} value={exportForm.format === 'svg' ? exportForm.scalePercent / 100 : exportForm.scalePercent} suffix={exportForm.format === 'svg' ? 'x' : '%'} onValueChange={(value) => setExportForm({ ...exportForm, scalePercent: exportForm.format === 'svg' ? Math.max(100, Math.round(value * 100)) : value })} /><div className="scale-presets" aria-label={exportForm.format === 'svg' ? '缩放倍数预设' : '放大比率预设'}>{exportScalePresets.map((scale) => <button type="button" key={scale} className={exportForm.scalePercent === scale ? 'selected' : ''} onClick={() => setExportForm({ ...exportForm, scalePercent: scale })}>{exportForm.format === 'svg' ? `${scale / 100}x` : `${scale}%`}</button>)}</div></div></label><label>导出预设<ThemedSelect value={presetName} groups={[{ label: '已保存预设', options: [{ value: '', label: '选择预设' }, ...presets.map((preset) => ({ value: preset.presetName, label: `${preset.presetName} · ${preset.scalePercent}%` }))] }]} label="导出预设" onChange={(value) => { const preset = presets.find((item) => item.presetName === value); setPresetName(value); if (preset) setExportForm({ name: preset.name, format: preset.format, scalePercent: preset.scalePercent }) }} /></label><div className="preset-row"><input aria-label="预设名称" placeholder="预设名称" value={presetName} onChange={(event) => setPresetName(event.target.value)} /><button type="button" className="quiet-button" onClick={savePreset}>保存预设</button><button type="button" className="icon-button preset-delete" title="删除当前预设" aria-label="删除当前预设" disabled={!presets.some((preset) => preset.presetName === presetName)} onClick={deletePreset}><Trash2 size={14} /></button></div></div><footer><button type="button" className="quiet-button" onClick={() => setExportOpen(false)}>取消</button><button className="primary-button" type="submit"><FileOutput size={15} />导出</button></footer></form></div>}
    {adjustmentOpen && <AdjustmentDialog kind={adjustmentKind} onClose={() => setAdjustmentOpen(false)} />}
    {aboutOpen && <div className="modal-backdrop" role="presentation" onPointerDown={(event) => { if (event.target === event.currentTarget) setAboutOpen(false) }}><section className="modal about-modal" role="dialog" aria-modal="true" aria-labelledby="about-title"><header><div><span className="eyebrow">MOONSPRITE</span><h2 id="about-title">关于 MoonSprite</h2></div><button className="icon-button" aria-label="关闭" onClick={() => setAboutOpen(false)}><X size={16} /></button></header><div className="about-content"><Info size={28} /><div><strong>MoonSprite</strong><p className="about-description">为像素创作者打造的独立开源 Windows 绘画工作台，专注清晰、快速的像素级编辑体验。</p><dl><div><dt>版本</dt><dd>{APP_CHANNEL_LABEL}</dd></div><div><dt>作者</dt><dd>MoonPixel Studio 与 MoonSprite Contributors</dd></div><div><dt>许可</dt><dd>MIT License</dd></div></dl><a className="about-link" href="https://github.com/MoonPixelTeam/moonsprite" target="_blank" rel="noreferrer"><GitFork size={15} /><span>github.com/MoonPixelTeam/moonsprite</span><ExternalLink size={13} /></a><p className="about-notice">MoonSprite 是独立实现，与 Aseprite 无隶属关系，未使用其源码、品牌或视觉资产。</p></div></div><footer><button className="primary-button" onClick={() => setAboutOpen(false)}>确定</button></footer></section></div>}
    {componentLibraryOpen && <Suspense fallback={null}><LazyComponentLibrary onClose={() => setComponentLibraryOpen(false)} /></Suspense>}
    {workspaceSaveOpen && <div className="modal-backdrop" role="presentation" onPointerDown={(event) => { if (event.target === event.currentTarget && !workspaceBusy) setWorkspaceSaveOpen(false) }}><form className="modal workspace-save-dialog" onSubmit={(event) => { event.preventDefault(); void saveWorkspace(workspaceSaveName) }}><header><div><span className="eyebrow">WORKSPACE</span><h2>保存当前工作区</h2></div><button type="button" className="icon-button" aria-label="关闭" disabled={workspaceBusy} onClick={() => setWorkspaceSaveOpen(false)}><X size={16} /></button></header><div className="modal-body"><label>工作区名称<input autoFocus maxLength={96} value={workspaceSaveName} placeholder="例如：绘画、调色、动画" onChange={(event) => setWorkspaceSaveName(event.target.value)} /></label><p className="modal-note">将保存窗口大小和位置、工具栏、栏目停靠位置、排序、尺寸及浮动栏目位置。</p><p className="modal-note">文件夹：{workspaceDirectory || 'workspaces'}</p></div><footer><button type="button" className="quiet-button" disabled={workspaceBusy} onClick={() => setWorkspaceSaveOpen(false)}>取消</button><button type="submit" className="primary-button" disabled={workspaceBusy || !workspaceSaveName.trim()}><Save size={15} />保存</button></footer></form></div>}
    {workspaceManagerOpen && <div className="modal-backdrop" role="presentation" onPointerDown={(event) => { if (event.target === event.currentTarget) setWorkspaceManagerOpen(false) }}><section className="modal workspace-manager-dialog" role="dialog" aria-labelledby="workspace-manager-title"><header><div><span className="eyebrow">WORKSPACE</span><h2 id="workspace-manager-title">管理工作区</h2></div><button type="button" className="icon-button" aria-label="关闭" onClick={() => setWorkspaceManagerOpen(false)}><X size={16} /></button></header><div className="workspace-manager-list">{savedWorkspaces.map((saved) => <div key={saved.id} className={`${saved.id === activeWorkspaceId ? 'active ' : ''}${saved.builtIn ? 'built-in' : ''}`}><button type="button" onClick={() => void applyWorkspaceLayout(saved)}><span>{saved.name}</span><small>{saved.id === activeWorkspaceId ? '当前' : '载入'}</small></button>{!saved.builtIn && <button type="button" className="icon-button" title={`删除 ${saved.name}`} aria-label={`删除 ${saved.name}`} onClick={() => void deleteSavedWorkspace(saved)}><Trash2 size={14} /></button>}</div>)}</div><footer className="workspace-manager-footer"><button type="button" className="quiet-button" onClick={() => void window.moonSprite.openWorkspaceFolder()}><FolderOpen size={15} />打开工作区文件夹</button><button type="button" className="primary-button" onClick={() => { setWorkspaceManagerOpen(false); setWorkspaceSaveName(''); setWorkspaceSaveOpen(true) }}><Plus size={15} />新建工作区</button></footer></section></div>}
    <NewDocumentDialog open={newOpen} presets={documentSizePresets} onClose={() => setNewOpen(false)} onCreate={(name, width, height, mode) => void createDocumentAndShow(name, width, height, mode)} />
    {session && <CanvasResizeDialog open={canvasResizeOpen} currentWidth={session.document.width} currentHeight={session.document.height} onClose={() => setCanvasResizeOpen(false)} onResize={workspace.resizeActiveCanvas} onPreview={(preview) => { workspace.setCanvasResizePreview(preview); publishCanvasResizePreview(session.document.id, preview) }} preview={session.canvasResizePreview} />}
    {session && <ImageResizeDialog open={imageResizeOpen} currentWidth={session.document.width} currentHeight={session.document.height} onClose={() => setImageResizeOpen(false)} onResize={(width, height, interpolation: ImageResizeInterpolation) => workspace.resizeActiveImage(width, height, interpolation)} />}
    {session && <OutlineDialog open={outlineOpen} session={session} onClose={() => setOutlineOpen(false)} />}
    {preferencesOpen && <PreferencesDialog onClose={() => setPreferencesOpen(false)} onPresetChange={(documentSizes, exportScales) => { setDocumentSizePresets(documentSizes); setExportScalePresets(exportScales) }} />}
    {shortcutOpen && <ShortcutDialog shortcuts={shortcuts} onSave={saveShortcuts} onClose={() => setShortcutOpen(false)} />}
  </main>
}
