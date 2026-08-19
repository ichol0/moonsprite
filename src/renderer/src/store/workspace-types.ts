import type {
  AnimationCel,
  AnimationCelSurface,
  AnimationGroupMask,
  BrushPaintMode,
  BrushShape,
  BrushTexture,
  FillKind,
  FillMode,
  GradientDither,
  ImageBrush,
  LayerMask,
  ImageBrushSettings,
  LineKind,
  MoveKind,
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
  SelectionRect,
  ShapeKind,
  ShapeRatio,
  SpriteDocument,
  ToolId,
  TextCelData,
  ViewState
} from '@shared/types'
import type { ContentInvalidationHint, HistoryStack, PixelEdit } from '@/core/history'
import type { SelectionShearTransform } from '@/core/selection'
import type { SelectionTransformLayerState, SelectionTransformSource, SelectionTranslationPreview } from '@/core/tools'
import type { SymmetryAxes, SymmetryCenter, SymmetryMode } from '@/core/symmetry'
import type { BrushTool } from '@/core/tool-preferences'
import type { BrushDynamicsSettings, BrushPressureSettings } from '@/core/pressure'
import type { TilemapDrawingMode } from '@/core/tilemap'

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
  groupMasks: AnimationGroupMask[]
}

export interface AnimationMaskClipboardItem {
  key: string
  mask: LayerMask
}

export interface SelectionPivot {
  x: number
  y: number
}

export interface FloatingPaste {
  layerId: string
  layers?: SelectionTransformLayerState[]
  beforeSelection: SelectionMask | null
  beforeSelectionPivot?: SelectionPivot | null
  source: SelectionTransformSource
  target: SelectionMask
  transformTarget?: SelectionRect
  transformAngle?: number
  transformShear?: SelectionShearTransform
  previewEdit: PixelEdit | null
  translationPreview: SelectionTranslationPreview | null
  previewDeferred?: boolean
  tilemapEditCellIndex?: number
  copy: boolean
  label: string
}

export interface TextBoxTransformState {
  layerId: string
  frameId: string
  bounds: SelectionRect
  originalText: TextCelData
  originalSurface: AnimationCelSurface
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
  brushDynamics: BrushDynamicsSettings
  brushPressure: BrushPressureSettings
}

export type DocumentContentInvalidation = ContentInvalidationHint & {
  fromRevision: number
  revision: number
}

export interface DocumentSession {
  document: SpriteDocument
  history: HistoryStack
  tool: ToolId
  moveKind: MoveKind
  selectedSliceId: string | null
  selectedSliceIds: string[]
  selectedTilesetId: string | null
  selectedTileId: string | null
  secondaryTileId: string | null
  tilemapMode: TilemapDrawingMode
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
  brushDynamics: BrushDynamicsSettings
  brushPressure: BrushPressureSettings
  shapeKind: ShapeKind
  lineKind: LineKind
  curveAnchorCount: number
  shapeRatio: ShapeRatio | null
  fillMode: FillMode
  fillKind: FillKind
  fillTolerance: number
  gradientTolerance: number
  gradientContiguous: boolean
  gradientDither: GradientDither
  moveAutoSelect: boolean
  selection: SelectionMask | null
  /** View-only custom transform pivot. Null uses the current transformed selection center. */
  selectionPivot?: SelectionPivot | null
  selectionKind: SelectionKind
  selectionMode: SelectionMode
  wandTolerance: number
  wandContiguous: boolean
  perfectPixels: boolean
  symmetryAxes: SymmetryAxes
  symmetryAxesInitialized: Record<SymmetryMode, boolean>
  symmetryCenter: SymmetryCenter
  airbrushParticleRadius: number
  airbrushParticleShape: BrushShape
  airbrushScatterRadius: number
  airbrushDensity: number
  airbrushIntervalMs: number
  lastPencilPoint: { x: number; y: number } | null
  lastEraserPoint: { x: number; y: number } | null
  canvasResizePreview: CanvasResizePreview | null
  outlinePreview: OutlinePreview | null
  pendingPaste: FloatingPaste | null
  textBoxTransform: TextBoxTransformState | null
  view: ViewState
  viewportSize: { width: number; height: number }
  paletteSelectionId: number | null
  paletteSecondarySelectionId: number | null
  selectedPaletteIds: number[]
  selectedGroupId: string | null
  selectedGroupIds: string[]
  selectedLayerIds: string[]
  activeLayerMaskId: string | null
  layerMaskIsolatedView: boolean
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
  /** Timeline cells whose attached masks are selected in the panel. */
  selectedAnimationMaskCellKeys: string[]
  animationMaskCellSelectionAnchorKey: string | null
  animationCellClipboard: AnimationCel[]
  animationCellClipboardAnchorKey: string | null
  animationMaskClipboard: AnimationMaskClipboardItem[]
  animationMaskClipboardAnchorKey: string | null
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
