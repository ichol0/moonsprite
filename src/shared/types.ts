export type ColorMode = 'rgba' | 'indexed' | 'grayscale'
export type RasterFormat = 'rgba' | 'indexed'
export type ImageResizeInterpolation = 'nearest' | 'smooth'
export type ToolId = 'pencil' | 'airbrush' | 'eraser' | 'fill' | 'eyedropper' | 'selection' | 'shape' | 'line' | 'text' | 'move' | 'hand' | 'zoom' | 'rotate'
export type MoveKind = 'move' | 'slice'
export type BrushShape = 'round' | 'square' | 'line'
export type BrushTexture = 'solid' | 'cracks' | 'wood' | 'grain'
export type BrushPaintMode = 'paint' | 'pattern-source' | 'pattern-target'
export type ProceduralBrushId = 'procedural:noise' | 'procedural:clouds' | 'procedural:cells' | 'procedural:fibers'

export interface ProceduralBrushSettings {
  seed: number
  scale: number
  detail: number
  variation: number
  angle: number
}

/** A grayscale brush stamp. Coverage is 0-255 and is not stored in projects. */
export interface ImageBrush {
  id: string
  name: string
  width: number
  height: number
  coverage: Uint8Array
  /** Optional source colors for selection-created brushes. Packed RGBA, one per pixel. */
  colors?: Uint32Array
  /** Temporary foreground/background remap used while painting; never serialized. */
  paintColors?: Uint32Array
  proceduralSettings?: ProceduralBrushSettings
  /** Selection-created brushes keep their source dimensions instead of scaling to brushSize. */
  intrinsicSize?: boolean
  /** Canvas-space origin used by source-aligned pattern painting. */
  sourceX?: number
  sourceY?: number
}

/** A selection-created brush embedded in its owning MoonSprite project. */
export interface ProjectBrush {
  id: string
  name: string
  width: number
  height: number
  coverage: Uint8Array
  /** Optional source colors for selection-created brushes. Packed RGBA, one per pixel. */
  colors?: Uint32Array
  sourceX?: number
  sourceY?: number
}

export type GrayscaleBrushMode = 'dither' | 'threshold'

export interface ImageBrushSettings {
  mode: GrayscaleBrushMode
  threshold: number
  blackPoint: number
  whitePoint: number
  invert: boolean
}

export interface StoredBrush {
  id: string
  name: string
  filePath: string
  intrinsicSize?: boolean
  sourceX?: number
  sourceY?: number
}

export interface BrushListing {
  directoryPath: string
  brushes: StoredBrush[]
}

export interface StoredFont {
  id: string
  family: string
  filePath: string
  imported: boolean
}

export interface FontListing {
  directoryPath: string
  fonts: StoredFont[]
}

export interface StoredBackgroundPreset {
  id: string
  name: string
  filePath: string
  builtIn: boolean
}

export interface BackgroundPresetListing {
  directoryPath: string
  presets: StoredBackgroundPreset[]
}
export type ShapeKind = 'rectangle' | 'ellipse' | 'rectangle-outline' | 'ellipse-outline' | 'freeform' | 'polygon'
export type LineKind = 'line' | 'curve'
export interface ShapeRatio { width: number; height: number }
export type FillMode = 'contiguous' | 'global'
export type FillKind = 'bucket' | 'gradient'
export type GradientDither = 'none' | 'checker' | 'diagonal' | 'diagonal-reverse' | 'horizontal' | 'vertical' | 'bayer-2' | 'bayer-4' | 'bayer-8'
export type BlendMode =
  | 'normal'
  | 'darken'
  | 'multiply'
  | 'color-burn'
  | 'linear-burn'
  | 'lighten'
  | 'screen'
  | 'color-dodge'
  | 'linear-dodge'
  | 'overlay'
  | 'soft-light'
  | 'hard-light'
  | 'vivid-light'
  | 'linear-light'
  | 'pin-light'
  | 'hard-mix'
  | 'difference'
  | 'exclusion'
  | 'subtract'
  | 'divide'
  | 'hue'
  | 'saturation'
  | 'color'
  | 'luminosity'

export const BLEND_MODES: readonly BlendMode[] = [
  'normal', 'darken', 'multiply', 'color-burn', 'linear-burn', 'lighten', 'screen', 'color-dodge', 'linear-dodge',
  'overlay', 'soft-light', 'hard-light', 'vivid-light', 'linear-light', 'pin-light', 'hard-mix', 'difference',
  'exclusion', 'subtract', 'divide', 'hue', 'saturation', 'color', 'luminosity'
]
export type ImageExportFormat = 'png' | 'jpeg' | 'webp' | 'svg' | 'gif' | 'mp4' | 'webm' | 'aseprite'
export type SaveDialogFormat = 'moonsprite' | 'png' | 'jpeg' | 'webp' | 'ase' | 'aseprite'

export interface RgbaColor {
  r: number
  g: number
  b: number
  a: number
}

export type TextAntialiasMode = 'pixel' | 'smooth'
export type TextSpacingMode = 'font' | 'actual'

export interface TextStyleRun {
  start: number
  end: number
  fontSize?: number
  lineSpacing?: number
  letterSpacing?: number
  color?: RgbaColor
}

export interface TextCelTransform {
  source: SelectionRect
  target: SelectionRect
  angle: number
  shear?: {
    axis: 'x' | 'y'
    edge: 'n' | 'e' | 's' | 'w'
    amount: number
  }
}

export interface TextCelData {
  text: string
  fontFamily: string
  fontSize: number
  lineSpacing: number
  letterSpacing: number
  spacingMode: TextSpacingMode
  antialias: TextAntialiasMode
  color: RgbaColor
  styleRuns?: TextStyleRun[]
  /** Original insertion point used when editable text is rasterized again. */
  originX?: number
  originY?: number
  /** Optional fixed canvas area for wrapped paragraph text. */
  boxWidth?: number
  boxHeight?: number
  /** Ordered transforms keep Ctrl+T edits reproducible after changing the text. */
  transforms?: TextCelTransform[]
}

export interface PaletteEntry {
  id: number
  name: string
  color: RgbaColor
}

export interface RuntimeRasterTiles {
  kind: 'sparse-tiles-v1'
  format: RasterFormat
  width: number
  height: number
  tileSize: number
  data: Uint8Array
  /** One-based payload offset per tile slot; zero means the tile is absent. */
  tileOffsets: Int32Array
  /** Exact visible bounds for immutable RGBA tiles; null means fully transparent. */
  visibleBounds?: { x: number; y: number; width: number; height: number } | null
}

export interface LayerStyleStroke {
  enabled: boolean
  color: RgbaColor
  size: number
  position: OutlinePosition
  kernel: OutlineKernel
  directions: OutlineDirections
  smartHue: boolean
  smartHueDarkness: number
}

export interface LayerStyleShadow {
  enabled: boolean
  color: RgbaColor
  offsetX: number
  offsetY: number
  blur: number
  smartShadow: boolean
  smartShadowDarkness: number
}

export interface LayerStyleInnerGlow {
  enabled: boolean
  color: RgbaColor
  size: number
}

export interface LayerStyleColorOverlay {
  enabled: boolean
  color: RgbaColor
}

export interface LayerStyleGradientOverlay {
  enabled: boolean
  from: RgbaColor
  to: RgbaColor
  angle: number
  dither: GradientDither
}

export interface LayerStyles {
  stroke: LayerStyleStroke
  shadow: LayerStyleShadow
  innerGlow: LayerStyleInnerGlow
  colorOverlay: LayerStyleColorOverlay
  gradientOverlay: LayerStyleGradientOverlay
}

export type BackgroundPatternId = 'solid' | 'grid' | 'stripes' | 'diamond' | 'diamond-nested' | 'circles'

export interface BackgroundLayerSettings {
  mode: 'preset' | 'canvas'
  pattern?: BackgroundPatternId
}

export interface RgbaLayer {
  id: string
  name: string
  /** Optional visual marker shown in the layer panel. */
  displayColor?: RgbaColor
  /** Optional user-facing note shown when hovering the layer row. */
  description?: string
  /** Editable text layers retain raster surfaces for the existing compositor. */
  kind?: 'text'
  visible: boolean
  locked: boolean
  opacity: number
  blendMode: BlendMode
  /** Restricts this layer to the visible alpha of its immediate lower sibling. */
  clippingMask?: boolean
  /** Non-destructive effects evaluated from the active cel surface during compositing. */
  layerStyles?: LayerStyles
  /** Treats this layer as editable canvas wallpaper with resize-time tiling. */
  background?: BackgroundLayerSettings
  groupId?: string | null
  /** Local bitmap dimensions. They may differ from the visible canvas after moving/resizing. */
  width: number
  height: number
  /** Canvas-space location of the layer bitmap's local (0, 0). */
  offsetX: number
  offsetY: number
  format: 'rgba'
  pixels: Uint8ClampedArray
  runtimeRaster?: RuntimeRasterTiles
}

export interface IndexedLayer {
  id: string
  name: string
  /** Optional visual marker shown in the layer panel. */
  displayColor?: RgbaColor
  /** Optional user-facing note shown when hovering the layer row. */
  description?: string
  /** Editable text layers retain raster surfaces for the existing compositor. */
  kind?: 'text'
  visible: boolean
  locked: boolean
  opacity: number
  blendMode: BlendMode
  /** Restricts this layer to the visible alpha of its immediate lower sibling. */
  clippingMask?: boolean
  /** Non-destructive effects evaluated from the active cel surface during compositing. */
  layerStyles?: LayerStyles
  /** Treats this layer as editable canvas wallpaper with resize-time tiling. */
  background?: BackgroundLayerSettings
  groupId?: string | null
  width: number
  height: number
  offsetX: number
  offsetY: number
  format: 'indexed'
  pixels: Uint32Array
  runtimeRaster?: RuntimeRasterTiles
}

export type RasterLayer = RgbaLayer | IndexedLayer

export interface LayerMask extends RgbaLayer {
  ownerKind: 'cel' | 'group'
  ownerId: string
  /** Optional independent link to another mask surface. */
  linkedMaskId?: string | null
}

export interface AnimationGroupMask {
  groupId: string
  frameId: string
  mask: LayerMask
}

export interface LayerGroup {
  id: string
  name: string
  /** 空组没有子图层可定位时，保存它在统一图层堆栈中的顺序锚点。 */
  panelOrder?: number
  /** Optional visual marker shown in the layer panel. */
  displayColor?: RgbaColor
  /** Optional user-facing note shown when hovering the group row. */
  description?: string
  parentGroupId?: string | null
  visible: boolean
  locked: boolean
  opacity: number
  blendMode: BlendMode
  /** Restricts this group to the visible alpha of its immediate lower sibling. */
  clippingMask?: boolean
  /** Non-destructive effects evaluated from the composited group contents. */
  layerStyles?: LayerStyles
  /** Re-applies the group blend mode after its children have composited against the external backdrop. */
  cumulativeBlend?: boolean
}

/** 动画时间轴中的一帧。持续时间以毫秒保存，便于后续导入 Aseprite 帧时保持原始节奏。 */
export interface AnimationFrame {
  id: string
  duration: number
}

/** cel 与图层、帧的稳定关联。像素存储会在实际动画编辑器落地时加入独立数据文件。 */
export type AnimationCelSurface =
  | {
      format: 'rgba'
      width: number
      height: number
      offsetX: number
      offsetY: number
      storageOriginX?: number
      storageOriginY?: number
      pixels: Uint8ClampedArray
      runtimeRaster?: RuntimeRasterTiles
    }
  | {
      format: 'indexed'
      width: number
      height: number
      offsetX: number
      offsetY: number
      storageOriginX?: number
      storageOriginY?: number
      pixels: Uint32Array
      runtimeRaster?: RuntimeRasterTiles
    }

export interface AnimationCel {
  id: string
  layerId: string
  frameId: string
  linkedCelId?: string | null
  /** Cel 独立的不透明度，未设置时沿用图层不透明度。 */
  opacity?: number
  surface?: AnimationCelSurface
  /** Editable source data for text cels. The surface remains the rendered cache. */
  text?: TextCelData
  /** Independent grayscale surface for this cell; transparent pixels are neutral/unpainted. */
  mask?: LayerMask
}

export interface AnimationTimeline {
  frames: AnimationFrame[]
  cels: AnimationCel[]
  /** Frame-specific masks attached to layer groups. */
  groupMasks?: AnimationGroupMask[]
  activeFrameId: string
  loop: boolean
}

export interface ProjectDisplaySettings {
  showPixelGrid: boolean
  showGrid: boolean
  grid: GridSettings
}

export interface ProjectStatistics {
  strokeCount: number
  operationCount: number
  drawingTimeMs: number
}

export type TimelapseQuality = 'low' | 'medium' | 'high'
export type TimelapseVideoFormat = 'mp4' | 'webm'

export interface TimelapseSnapshot {
  id: string
  capturedAt: number
  elapsedMs: number
  width: number
  height: number
  data: Uint8Array
}

export interface TimelapseSettings {
  enabled: boolean
  quality: TimelapseQuality
  fps: number
  speed: number
  snapshots: TimelapseSnapshot[]
}

export interface ProjectLayerPanelState {
  activeLayerId: string
  selectedLayerIds: string[]
  selectedGroupIds: string[]
  selectedGroupId: string | null
  layerSelectionAnchorId: string | null
  collapsedGroupIds: string[]
}

export interface DocumentSlice {
  id: string
  name: string
  x: number
  y: number
  width: number
  height: number
}

export interface SpriteDocument {
  schemaVersion: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12
  id: string
  name: string
  width: number
  height: number
  colorMode: ColorMode
  layers: RasterLayer[]
  groups: LayerGroup[]
  activeLayerId: string
  palette: PaletteEntry[]
  paletteOrder: number[]
  /** Fixed visual palette slots. Empty entries preserve user-defined spacing and placement. */
  paletteSlots?: Array<number | null>
  /** Column count used to decode paletteSlots into stable two-dimensional positions. */
  paletteColumns?: number
  nextColorId: number
  /** Project-owned brushes are stored in the .moonsprite container. */
  customBrushes?: ProjectBrush[]
  /** Animation metadata is independent from layer ordering and optional for v1 compatibility. */
  animation?: AnimationTimeline
  /** Project-owned defaults for the selection outline dialog. */
  outlineSettings?: OutlineSettings
  /** Project-owned display toggles. View navigation remains session-only. */
  displaySettings?: ProjectDisplaySettings
  /** Layer panel context restored when the project is reopened. */
  layerPanelState?: ProjectLayerPanelState
  /** Persisted editing statistics used by the project information view. */
  statistics?: ProjectStatistics
  /** Optional bounded history of drawing snapshots for timelapse export. */
  timelapse?: TimelapseSettings
  /** Named export regions stored in document pixel coordinates. */
  slices?: DocumentSlice[]
  filePath: string | null
  /** Original path used to open imported images or Aseprite projects. */
  sourceFilePath?: string
  dirty: boolean
  createdAt: string
  updatedAt: string
}

export interface SelectionRect {
  x: number
  y: number
  width: number
  height: number
  flipHorizontal?: boolean
  flipVertical?: boolean
  /** 在跨越对侧边界时，记录被拖动轴线的连续像素坐标。 */
  flipOriginX?: number
  flipOriginY?: number
}

export type SelectionMode = 'replace' | 'add' | 'subtract' | 'intersect'
export type SelectionKind = 'rectangle' | 'ellipse' | 'magic' | 'lasso' | 'polygon-lasso'
export type OutlinePosition = 'inside' | 'outside' | 'both'
export type OutlineKernel = 'round' | 'square' | 'horizontal' | 'vertical'
export type OutlineDirection = 'nw' | 'n' | 'ne' | 'w' | 'e' | 'sw' | 's' | 'se'
export type OutlineDirections = Record<OutlineDirection, boolean>
export interface OutlineSettings {
  color: RgbaColor
  thickness: number
  position: OutlinePosition
  kernel: OutlineKernel
  directions: OutlineDirections
  previewEnabled: boolean
}
export type CanvasAnchor = 'nw' | 'n' | 'ne' | 'w' | 'center' | 'e' | 'sw' | 's' | 'se'

/** A cropped pixel mask. A missing mask retains legacy rectangular selection semantics. */
export interface SelectionMask extends SelectionRect {
  mask?: Uint8Array
}

export interface ViewState {
  zoom: number
  panX: number
  panY: number
  /** View-only clockwise rotation in degrees. Never changes document pixels. */
  rotation: number
  /** View-only horizontal mirror. Never changes document pixels. */
  mirrored: boolean
  /** View-only vertical mirror. Never changes document pixels. */
  mirroredVertical: boolean
  /** View-only one-pixel grid visibility. Optional for hot-reloaded legacy sessions. */
  showPixelGrid?: boolean
  showGrid: boolean
  /** View-only configurable grid origin and cell size. */
  grid?: GridSettings
  relativeLuminance: boolean
  /** View-only selection outline visibility. The selection itself remains active. */
  showSelectionOutline?: boolean
  /** View-only transform pivot visibility. The configured pivot still affects transforms while hidden. */
  showSelectionPivot?: boolean
  /** Quick Command Bar center as a normalized horizontal position in its owning canvas. */
  quickCommandBarPositionX?: number
  /** Whether this project keeps its Quick Command Bar expanded while it owns canvas focus. */
  quickCommandBarExpanded?: boolean
}

export interface GridSettings {
  x: number
  y: number
  width: number
  height: number
}

export interface ResourceInfo {
  totalBytes: number
  freeBytes: number
}

export interface OpenDialogResult {
  canceled: boolean
  filePaths: string[]
}

export interface SaveDialogResult {
  canceled: boolean
  filePath?: string
}

export interface DirectoryDialogResult {
  canceled: boolean
  directoryPath?: string
}

export interface DefaultFileDirectories {
  saveDirectory: string
  exportDirectory: string
}

export interface RecoveryRecord {
  id: string
  name: string
  updatedAt: string
}

export interface GalleryProject {
  filePath: string
  fileName: string
  modifiedAt: number
}

export interface GalleryListing {
  directoryPath: string
  projects: GalleryProject[]
}

export interface StoredPalette {
  id: string
  name: string
  filePath: string
  colors: RgbaColor[]
  builtIn: boolean
  columns?: number
  slots?: Array<number | null>
}

export interface PaletteSlotLayout {
  columns: number
  slots: Array<number | null>
}

export interface PaletteListing {
  directoryPath: string
  palettes: StoredPalette[]
}

export type WorkspacePanelId = 'color' | 'palette' | 'layers' | 'preview'
export type WorkspacePanelDock = 'right' | 'left' | 'bottom' | 'floating'
export type ToolRailSide = 'left' | 'right'

export interface WorkspaceLayout {
  panelDocks: Record<WorkspacePanelId, WorkspacePanelDock>
  /** Optional for backward compatibility with workspaces saved before panel visibility was persisted. */
  panelVisibility?: Partial<Record<WorkspacePanelId, boolean>>
  inspectorWidth: number
  leftDockWidth: number
  bottomDockHeight: number
  /** Preferred dock proportions within the editor layout. Pixel fields remain for older workspaces. */
  inspectorWidthRatio?: number
  leftDockWidthRatio?: number
  bottomDockHeightRatio?: number
  toolRailSide: ToolRailSide
  previewOpen: boolean
  inspectorLayout: string | null
  colorSquareDock: string | null
  colorSquareAnchor: string | null
  floatingPanels: Record<WorkspacePanelId, string | null>
  mainWindow: { x: number; y: number; width: number; height: number; maximized: boolean } | null
}

export interface StoredWorkspace {
  id: string
  name: string
  filePath: string
  updatedAt: string
  builtIn: boolean
  layout: WorkspaceLayout
  initialLayout: WorkspaceLayout
}

export interface WorkspaceListing {
  directoryPath: string
  workspaces: StoredWorkspace[]
}

export interface ClipboardImage {
  width: number
  height: number
  data: Uint8Array
}

export interface ClipboardImageSize {
  width: number
  height: number
}

export interface ProjectPreview {
  preview: Uint8Array
  width: number
  height: number
  colorMode: ColorMode
}

export interface BinaryReadProgress {
  bytesRead: number
  totalBytes: number
}

export interface MoonSpriteApi {
  openFiles(): Promise<OpenDialogResult>
  takeStartupFiles(): Promise<string[]>
  saveProject(defaultPath?: string, format?: SaveDialogFormat): Promise<SaveDialogResult>
  exportImage(defaultPath: string | undefined, format: ImageExportFormat): Promise<SaveDialogResult>
  savePaletteImage(defaultPath?: string): Promise<SaveDialogResult>
  saveShortcutFile(defaultPath?: string): Promise<SaveDialogResult>
  saveThemeFile(defaultPath?: string): Promise<SaveDialogResult>
  getDefaultFileDirectories(): Promise<DefaultFileDirectories>
  chooseDirectory(defaultPath?: string): Promise<DirectoryDialogResult>
  fileExists(filePath: string): Promise<boolean>
  readBinary(filePath: string, onProgress?: (progress: BinaryReadProgress) => void): Promise<Uint8Array>
  readProjectPreview(filePath: string): Promise<ProjectPreview>
  cacheProjectPreview(filePath: string, preview: ProjectPreview): Promise<void>
  writeBinaryAtomic(filePath: string, data: Uint8Array): Promise<void>
  writeProjectIncremental(filePath: string, sourcePath: string, data: Uint8Array): Promise<void>
  writeClipboardImage(image: ClipboardImage): Promise<void>
  readClipboardText(): Promise<string | null>
  readClipboardImage(): Promise<ClipboardImage | null>
  readClipboardImageSize(): Promise<ClipboardImageSize | null>
  listPalettes(): Promise<PaletteListing>
  savePalette(id: string | null, name: string, colors: RgbaColor[], columns: number, slots: Array<number | null>): Promise<StoredPalette>
  deletePalette(id: string): Promise<void>
  openPaletteFolder(): Promise<void>
  listWorkspaces(): Promise<WorkspaceListing>
  saveWorkspace(id: string | null, name: string, layout: WorkspaceLayout): Promise<StoredWorkspace>
  deleteWorkspace(id: string): Promise<void>
  openWorkspaceFolder(): Promise<void>
  listBrushes(): Promise<BrushListing>
  saveBrush(name: string, data: Uint8Array, intrinsicSize?: boolean, sourceX?: number, sourceY?: number): Promise<StoredBrush>
  deleteBrush(id: string): Promise<void>
  openBrushFolder(): Promise<void>
  listFonts(): Promise<FontListing>
  listSystemFonts(): Promise<StoredFont[]>
  importFont(): Promise<StoredFont | null>
  importSystemFont(id: string): Promise<StoredFont>
  deleteFont(id: string): Promise<void>
  listBackgroundPresets(): Promise<BackgroundPresetListing>
  openBackgroundPresetFolder(): Promise<void>
  listRecoveries(retentionDays: number): Promise<RecoveryRecord[]>
  readRecovery(id: string): Promise<Uint8Array>
  writeRecovery(id: string, name: string, data: Uint8Array): Promise<void>
  deleteRecovery(id: string): Promise<void>
  listGalleryProjects(): Promise<GalleryListing>
  listFolderProjects(directoryPath: string): Promise<GalleryListing>
  deleteGalleryProject(fileName: string): Promise<void>
  openGalleryFolder(): Promise<void>
  openDirectory(directoryPath: string): Promise<void>
  ensureBuiltinExample(): Promise<string | null>
  openProjectInFolder(filePath: string): Promise<void>
  openExternalUrl(url: string): Promise<void>
  getResourceInfo(): Promise<ResourceInfo>
  confirmUnsaved(name: string): Promise<'save' | 'discard' | 'cancel'>
  pathForFile(file: unknown): string
  onRequestClose(callback: () => void | Promise<void>): () => void
  cancelClose(): void
  approveClose(): void
}
