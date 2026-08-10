import type {
  AnimationCel,
  BrushPaintMode,
  BrushShape,
  BrushTexture,
  FillKind,
  FillMode,
  GradientDither,
  ImageBrush,
  ImageBrushSettings,
  OutlineDirections,
  OutlineKernel,
  OutlinePosition,
  ProceduralBrushId,
  ProceduralBrushSettings,
  RecoveryRecord,
  RgbaColor,
  SelectionKind,
  SelectionMask,
  SelectionMode,
  ShapeKind,
  ShapeRatio,
  SpriteDocument,
  ToolId,
  ViewState
} from '@shared/types'
import type { ContentInvalidationHint, HistoryStack, PixelEdit } from '@/core/history'
import type { SelectionTransformSource } from '@/core/tools'
import type { SymmetryAxes, SymmetryCenter } from '@/core/symmetry'
import type { BrushTool } from '@/core/tool-preferences'

export interface CanvasResizePreview {
  width: number
  height: number
  offsetX: number
  offsetY: number
}

export interface AdjustmentSnapshot {
  layers: Array<{
    layerId: string
    frameId?: string
    width: number
    height: number
    offsetX: number
    offsetY: number
    storageOriginX: number
    storageOriginY: number
    pixels: Uint8ClampedArray | Uint32Array
  }>
  palette: SpriteDocument['palette']
  nextColorId: number
}

export interface OutlinePreview {
  color: RgbaColor
  thickness: number
  position: OutlinePosition
  directions: OutlineDirections
  kernel: OutlineKernel
}

export interface AnimationFrameClipboardItem {
  frameId: string
  duration: number
  cels: AnimationCel[]
}

export interface FloatingPaste {
  layerId: string
  beforeSelection: SelectionMask | null
  source: SelectionTransformSource
  target: SelectionMask
  previewEdit: PixelEdit
  copy: boolean
  label: string
}

export interface BrushProfile {
  brushSize: number
  brushShape: BrushShape
  brushTexture: BrushTexture
  brushTextureScale: number
  brushPaintMode: BrushPaintMode
  brushImageId: string | null
  brushImage: ImageBrush | null
  brushImageTemporary: boolean
  brushImageSettings: ImageBrushSettings
  proceduralBrushSettings: Record<ProceduralBrushId, ProceduralBrushSettings>
  proceduralAntialias: boolean
  proceduralAntialiasStrength: number
}

export type DocumentContentInvalidation = ContentInvalidationHint & {
  fromRevision: number
  revision: number
}

export interface DocumentSession {
  document: SpriteDocument
  history: HistoryStack
  tool: ToolId
  primaryColor: RgbaColor
  secondaryColor: RgbaColor
  brushSize: number
  brushShape: BrushShape
  brushTexture: BrushTexture
  brushTextureScale: number
  brushPaintMode: BrushPaintMode
  brushImageId: string | null
  brushImage: ImageBrush | null
  brushImageTemporary: boolean
  brushImageSettings: ImageBrushSettings
  brushProfiles: Record<BrushTool, BrushProfile>
  proceduralBrushSettings: Record<ProceduralBrushId, ProceduralBrushSettings>
  proceduralAntialias: boolean
  proceduralAntialiasStrength: number
  shapeKind: ShapeKind
  shapeRatio: ShapeRatio | null
  fillMode: FillMode
  fillKind: FillKind
  gradientDither: GradientDither
  moveAutoSelect: boolean
  selection: SelectionMask | null
  selectionKind: SelectionKind
  selectionMode: SelectionMode
  wandTolerance: number
  wandContiguous: boolean
  perfectPixels: boolean
  symmetryAxes: SymmetryAxes
  symmetryCenter: SymmetryCenter
  lastPencilPoint: { x: number; y: number } | null
  lastEraserPoint: { x: number; y: number } | null
  canvasResizePreview: CanvasResizePreview | null
  outlinePreview: OutlinePreview | null
  pendingPaste: FloatingPaste | null
  view: ViewState
  viewportSize: { width: number; height: number }
  paletteSelectionId: number | null
  paletteSecondarySelectionId: number | null
  selectedPaletteIds: number[]
  selectedGroupId: string | null
  selectedGroupIds: string[]
  selectedLayerIds: string[]
  layerSelectionAnchorId: string | null
  collapsedGroupIds: string[]
  animationPlaying: boolean
  animationPlaybackRate: number
  animationPlaybackStartFrameId: string | null
  animationReturnToStart: boolean
  selectedAnimationFrameIds: string[]
  animationFrameSelectionAnchorId: string | null
  selectedAnimationCellKeys: string[]
  animationCellSelectionAnchorKey: string | null
  animationCellClipboard: AnimationCel[]
  animationCellClipboardAnchorKey: string | null
  animationFrameClipboard: AnimationFrameClipboardItem[]
  revision: number
  contentRevision: number
  /** Changes that require the layer/timeline panel structure to render again. */
  layersPanelRevision: number
  contentInvalidation: DocumentContentInvalidation | null
  recoverySuppressed: boolean
}

export interface DialogChoice {
  id: string
  label: string
  tone?: 'primary' | 'danger' | 'quiet'
}

export interface AppDialog {
  title: string
  message: string
  detail?: string
  choices: DialogChoice[]
  resolve: (choice: string) => void
}

export interface WorkspaceDataState {
  sessions: DocumentSession[]
  activeId: string | null
  message: string | null
  saveProgress: { title: string; value: number; label: string } | null
  dialog: AppDialog | null
  recoveryRecords: RecoveryRecord[]
}
