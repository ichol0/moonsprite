export type ColorMode = 'rgba' | 'indexed'
export type ImageResizeInterpolation = 'nearest' | 'smooth'
export type ToolId = 'pencil' | 'eraser' | 'fill' | 'eyedropper' | 'selection' | 'shape' | 'move' | 'hand' | 'zoom' | 'rotate'
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
export type ShapeKind = 'rectangle' | 'ellipse'
export type FillMode = 'contiguous' | 'global'
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
export type ImageExportFormat = 'png' | 'jpeg' | 'webp' | 'svg' | 'aseprite'
export type SaveDialogFormat = 'moonsprite' | 'png' | 'jpeg' | 'webp' | 'ase' | 'aseprite'

export interface RgbaColor {
  r: number
  g: number
  b: number
  a: number
}

export interface PaletteEntry {
  id: number
  name: string
  color: RgbaColor
}

export interface RgbaLayer {
  id: string
  name: string
  visible: boolean
  locked: boolean
  opacity: number
  blendMode: BlendMode
  groupId?: string | null
  /** Local bitmap dimensions. They may differ from the visible canvas after moving/resizing. */
  width: number
  height: number
  /** Canvas-space location of the layer bitmap's local (0, 0). */
  offsetX: number
  offsetY: number
  format: 'rgba'
  pixels: Uint8ClampedArray
}

export interface IndexedLayer {
  id: string
  name: string
  visible: boolean
  locked: boolean
  opacity: number
  blendMode: BlendMode
  groupId?: string | null
  width: number
  height: number
  offsetX: number
  offsetY: number
  format: 'indexed'
  pixels: Uint32Array
}

export type RasterLayer = RgbaLayer | IndexedLayer

export interface LayerGroup {
  id: string
  name: string
  parentGroupId?: string | null
  visible: boolean
  locked: boolean
  opacity: number
  blendMode: BlendMode
}

/** 动画时间轴中的一帧。持续时间以毫秒保存，便于后续导入 Aseprite 帧时保持原始节奏。 */
export interface AnimationFrame {
  id: string
  duration: number
}

/** cel 与图层、帧的稳定关联。像素存储会在实际动画编辑器落地时加入独立数据文件。 */
export interface AnimationCel {
  id: string
  layerId: string
  frameId: string
  linkedCelId?: string | null
}

export interface AnimationTimeline {
  frames: AnimationFrame[]
  cels: AnimationCel[]
  activeFrameId: string
  loop: boolean
}

export interface SpriteDocument {
  schemaVersion: 1 | 2
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
  nextColorId: number
  /** Project-owned brushes are stored in the .moonsprite container. */
  customBrushes?: ProjectBrush[]
  /** Animation metadata is independent from layer ordering and optional for v1 compatibility. */
  animation?: AnimationTimeline
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
}

export type SelectionMode = 'replace' | 'add' | 'subtract' | 'intersect'
export type SelectionKind = 'rectangle' | 'ellipse' | 'magic' | 'lasso'
export type OutlinePosition = 'inside' | 'outside' | 'both'
export type OutlineKernel = 'round' | 'square' | 'horizontal' | 'vertical'
export type OutlineDirection = 'nw' | 'n' | 'ne' | 'w' | 'e' | 'sw' | 's' | 'se'
export type OutlineDirections = Record<OutlineDirection, boolean>
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
  showGrid: boolean
  relativeLuminance: boolean
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
  inspectorWidth: number
  leftDockWidth: number
  bottomDockHeight: number
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

export interface MoonSpriteApi {
  openFiles(): Promise<OpenDialogResult>
  takeStartupFiles(): Promise<string[]>
  saveProject(defaultPath?: string, format?: SaveDialogFormat): Promise<SaveDialogResult>
  exportImage(defaultPath: string | undefined, format: ImageExportFormat): Promise<SaveDialogResult>
  savePaletteImage(defaultPath?: string): Promise<SaveDialogResult>
  readBinary(filePath: string): Promise<Uint8Array>
  writeBinaryAtomic(filePath: string, data: Uint8Array): Promise<void>
  writeClipboardImage(image: ClipboardImage): Promise<void>
  readClipboardImage(): Promise<ClipboardImage | null>
  listPalettes(): Promise<PaletteListing>
  savePalette(id: string | null, name: string, colors: RgbaColor[]): Promise<StoredPalette>
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
  listRecoveries(): Promise<RecoveryRecord[]>
  readRecovery(id: string): Promise<Uint8Array>
  writeRecovery(id: string, name: string, data: Uint8Array): Promise<void>
  deleteRecovery(id: string): Promise<void>
  listGalleryProjects(): Promise<GalleryListing>
  deleteGalleryProject(fileName: string): Promise<void>
  openGalleryFolder(): Promise<void>
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
