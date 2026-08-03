import type { SelectionRect, SpriteDocument, ViewState } from '@shared/types'
import { compositeRegion } from '@/core/document'
import { applyRelativeLuminance } from '@/core/raster'
import type { CanvasDragState } from '@/core/canvas-input'
import type { RasterContext2D } from './canvas-selection-renderer'

interface CompositeSurface {
  canvas: OffscreenCanvas
  revision: string
}

interface CompositeRegionSurface extends CompositeSurface {
  x: number
  y: number
  width: number
  height: number
}

interface DrawCompositeOptions {
  context: RasterContext2D
  document: SpriteDocument
  view: ViewState
  originX: number
  originY: number
  canvasWidth: number
  canvasHeight: number
  fromX: number
  fromY: number
  toX: number
  toY: number
  revision: number
  activeDrag?: CanvasDragState['kind']
}

const MAX_SURFACE_PIXELS = 2048 * 2048
const CACHE_VERSION = 3

export class CanvasCompositeCache {
  private revision = ''
  private surface: CompositeSurface | null = null
  private region: CompositeRegionSurface | null = null
  private dirtyRects: SelectionRect[] = []

  invalidateSurface(): void {
    this.surface = null
    this.region = null
    this.dirtyRects = []
  }

  invalidateAll(): void {
    this.invalidateSurface()
  }

  invalidateRect(selection: SelectionRect | null | undefined, documentWidth: number, documentHeight: number): void {
    if (!selection) return
    const left = Math.max(0, Math.floor(selection.x))
    const top = Math.max(0, Math.floor(selection.y))
    const right = Math.min(documentWidth, Math.ceil(selection.x + selection.width))
    const bottom = Math.min(documentHeight, Math.ceil(selection.y + selection.height))
    if (right <= left || bottom <= top) return
    this.dirtyRects.push({ x: left, y: top, width: right - left, height: bottom - top })
    this.region = null
  }

  draw({ context, document, view, originX, originY, canvasWidth, canvasHeight, fromX, fromY, toX, toY, revision }: DrawCompositeOptions): void {
    const contentRevision = `${CACHE_VERSION}:${document.id}:${revision}:${view.relativeLuminance ? 'luminance' : 'color'}`
    if (this.revision !== contentRevision) {
      this.revision = contentRevision
      this.invalidateAll()
    }

    context.save()
    context.beginPath()
    context.rect(originX, originY, canvasWidth, canvasHeight)
    context.clip()
    context.imageSmoothingEnabled = false
    if (document.width * document.height <= MAX_SURFACE_PIXELS) this.drawSurface(context, document, view, originX, originY, canvasWidth, canvasHeight, contentRevision)
    else this.drawRegion(context, document, view, originX, originY, fromX, fromY, toX, toY, contentRevision)
    context.restore()
  }

  private drawSurface(context: RasterContext2D, document: SpriteDocument, view: ViewState, originX: number, originY: number, canvasWidth: number, canvasHeight: number, revision: string): void {
    let surface = this.surface
    if (!surface || surface.revision !== revision || surface.canvas.width !== document.width || surface.canvas.height !== document.height) {
      const pixels = compositeRegion(document, 0, 0, document.width, document.height)
      if (view.relativeLuminance) applyRelativeLuminance(pixels)
      const canvas = new OffscreenCanvas(document.width, document.height)
      canvas.getContext('2d')?.putImageData(new ImageData(new Uint8ClampedArray(pixels), document.width, document.height), 0, 0)
      surface = { canvas, revision }
      this.surface = surface
      this.dirtyRects = []
    } else if (this.dirtyRects.length > 0) {
      const surfaceContext = surface.canvas.getContext('2d')
      if (surfaceContext) for (const rect of this.dirtyRects) {
        const pixels = compositeRegion(document, rect.x, rect.y, rect.width, rect.height)
        if (view.relativeLuminance) applyRelativeLuminance(pixels)
        surfaceContext.putImageData(new ImageData(new Uint8ClampedArray(pixels), rect.width, rect.height), rect.x, rect.y)
      }
      this.dirtyRects = []
    }
    context.drawImage(surface.canvas, originX, originY, canvasWidth, canvasHeight)
  }

  private drawRegion(context: RasterContext2D, document: SpriteDocument, view: ViewState, originX: number, originY: number, fromX: number, fromY: number, toX: number, toY: number, revision: string): void {
    const x = Math.max(0, Math.floor(fromX))
    const y = Math.max(0, Math.floor(fromY))
    const right = Math.min(document.width, Math.ceil(toX))
    const bottom = Math.min(document.height, Math.ceil(toY))
    const width = Math.max(0, right - x)
    const height = Math.max(0, bottom - y)
    if (width === 0 || height === 0) return
    let region = this.region
    if (!region || region.revision !== revision || region.x !== x || region.y !== y || region.width !== width || region.height !== height) {
      const pixels = compositeRegion(document, x, y, width, height)
      if (view.relativeLuminance) applyRelativeLuminance(pixels)
      const canvas = new OffscreenCanvas(width, height)
      canvas.getContext('2d')?.putImageData(new ImageData(new Uint8ClampedArray(pixels), width, height), 0, 0)
      region = { canvas, revision, x, y, width, height }
      this.region = region
    }
    context.save()
    context.translate(originX, originY)
    context.scale(view.zoom, view.zoom)
    context.drawImage(region.canvas, x, y)
    context.restore()
  }
}
