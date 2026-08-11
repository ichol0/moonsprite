import type { LayerMask, SelectionRect, SpriteDocument, ViewState } from '@shared/types'
import { compositeRegion, DocumentCompositeCache, renderLayerMaskRegion } from '@/core/document'
import { applyRelativeLuminance } from '@/core/raster'
import type { CanvasDragState } from '@/core/canvas-input'
import type { RasterContext2D } from './canvas-selection-renderer'

interface CompositeSurface {
  canvas: OffscreenCanvas
  revision: number
  scaled?: ScaledCompositeSurface
}

interface ScaledCompositeSurface {
  canvas: OffscreenCanvas
  zoom: number
  imageSmoothingEnabled: boolean
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
  contentRevision?: number
  contentInvalidation?: {
    kind: 'full' | 'region'
    fromRevision: number
    revision: number
    frameId?: string
    rect?: SelectionRect
  } | null
  frameId?: string
  isolatedLayerMask?: LayerMask
  activeDrag?: CanvasDragState['kind']
  imageSmoothingEnabled?: boolean
}

const MAX_SURFACE_DIMENSION = 8192
const MAX_CACHED_FRAMES = 32
const DEFAULT_MAX_CACHE_BYTES = 128 * 1024 * 1024
const CACHE_VERSION = 3
const imageData = (pixels: Uint8ClampedArray, width: number, height: number): ImageData =>
  new ImageData(pixels as Uint8ClampedArray<ArrayBuffer>, width, height)

export const shouldCacheFullCompositeSurface = (width: number, height: number, maxCacheBytes = DEFAULT_MAX_CACHE_BYTES): boolean =>
  width > 0 && height > 0 && width <= MAX_SURFACE_DIMENSION && height <= MAX_SURFACE_DIMENSION && width * height * 4 <= maxCacheBytes

export class CanvasCompositeCache {
  private namespace = ''
  private surfaces = new Map<string, CompositeSurface>()
  private regions = new Map<string, CompositeRegionSurface>()
  private dirtyRects = new Map<string, SelectionRect[]>()
  private compositeCache = new DocumentCompositeCache()

  constructor(private readonly maxCacheBytes = DEFAULT_MAX_CACHE_BYTES) {}

  invalidateSurface(): void {
    this.surfaces.clear()
    this.regions.clear()
    this.dirtyRects.clear()
  }

  invalidateAll(): void {
    this.invalidateSurface()
  }

  invalidateRect(selection: SelectionRect | null | undefined, documentWidth: number, documentHeight: number, frameId = 'static'): void {
    if (!selection) return
    const left = Math.max(0, Math.floor(selection.x))
    const top = Math.max(0, Math.floor(selection.y))
    const right = Math.min(documentWidth, Math.ceil(selection.x + selection.width))
    const bottom = Math.min(documentHeight, Math.ceil(selection.y + selection.height))
    if (right <= left || bottom <= top) return
    const dirtyRects = this.dirtyRects.get(frameId) ?? []
    dirtyRects.push({ x: left, y: top, width: right - left, height: bottom - top })
    this.dirtyRects.set(frameId, dirtyRects)
    this.regions.clear()
  }

  draw({ context, document, view, originX, originY, canvasWidth, canvasHeight, fromX, fromY, toX, toY, revision, contentRevision = revision, contentInvalidation = null, frameId = 'static', isolatedLayerMask, imageSmoothingEnabled = false }: DrawCompositeOptions): void {
    const namespace = `${CACHE_VERSION}:${document.id}:${isolatedLayerMask ? `mask:${isolatedLayerMask.id}` : view.relativeLuminance ? 'luminance' : 'color'}`
    if (this.namespace !== namespace) {
      this.namespace = namespace
      this.invalidateAll()
    }
    const frameKey = `${namespace}:${frameId}`

    context.save()
    context.beginPath()
    context.rect(originX, originY, canvasWidth, canvasHeight)
    context.clip()
    context.imageSmoothingEnabled = imageSmoothingEnabled
    if (imageSmoothingEnabled) context.imageSmoothingQuality = 'high'
    if (shouldCacheFullCompositeSurface(document.width, document.height, this.maxCacheBytes)) this.drawSurface(context, document, view, originX, originY, canvasWidth, canvasHeight, fromX, fromY, toX, toY, frameKey, frameId, contentRevision, contentInvalidation, imageSmoothingEnabled, isolatedLayerMask)
    else this.drawRegion(context, document, view, originX, originY, fromX, fromY, toX, toY, frameKey, contentRevision, isolatedLayerMask)
    context.restore()
  }

  private drawSurface(context: RasterContext2D, document: SpriteDocument, view: ViewState, originX: number, originY: number, canvasWidth: number, canvasHeight: number, fromX: number, fromY: number, toX: number, toY: number, key: string, frameId: string, contentRevision: number, invalidation: DrawCompositeOptions['contentInvalidation'], imageSmoothingEnabled: boolean, isolatedLayerMask?: LayerMask): void {
    let surface = this.surfaces.get(key)
    const canApplyInvalidation = surface
      && surface.revision !== contentRevision
      && invalidation?.revision === contentRevision
      && invalidation.fromRevision === surface.revision
    if (surface && surface.revision !== contentRevision && (!canApplyInvalidation || invalidation?.kind === 'full')) surface = undefined
    if (surface && canApplyInvalidation) {
      if (invalidation?.kind === 'region' && (isolatedLayerMask || (invalidation.frameId ?? 'static') === frameId) && invalidation.rect) {
        this.invalidateRect(invalidation.rect, document.width, document.height, frameId)
      }
      surface.revision = contentRevision
    }
    if (!surface || surface.canvas.width !== document.width || surface.canvas.height !== document.height) {
      const pixels = isolatedLayerMask
        ? renderLayerMaskRegion(isolatedLayerMask, 0, 0, document.width, document.height)
        : compositeRegion(document, 0, 0, document.width, document.height, this.compositeCache, contentRevision)
      if (!isolatedLayerMask && view.relativeLuminance) applyRelativeLuminance(pixels)
      const canvas = new OffscreenCanvas(document.width, document.height)
      canvas.getContext('2d')?.putImageData(imageData(pixels, document.width, document.height), 0, 0)
      surface = { canvas, revision: contentRevision }
      this.remember(this.surfaces, key, surface)
      this.dirtyRects.delete(frameId)
    } else {
      const dirtyRects = this.dirtyRects.get(frameId) ?? []
      const surfaceContext = surface.canvas.getContext('2d')
      if (surfaceContext) for (const rect of dirtyRects) {
        const pixels = isolatedLayerMask
          ? renderLayerMaskRegion(isolatedLayerMask, rect.x, rect.y, rect.width, rect.height)
          : compositeRegion(document, rect.x, rect.y, rect.width, rect.height)
        if (!isolatedLayerMask && view.relativeLuminance) applyRelativeLuminance(pixels)
        surfaceContext.putImageData(imageData(pixels, rect.width, rect.height), rect.x, rect.y)
      }
      if (dirtyRects.length > 0) surface.scaled = undefined
      this.dirtyRects.delete(frameId)
    }
    const visibleWidth = Math.max(0, toX - fromX)
    const visibleHeight = Math.max(0, toY - fromY)
    if (visibleWidth > 0 && visibleHeight > 0) {
      if (view.zoom < 1) {
        const scaledWidth = Math.max(1, Math.round(canvasWidth))
        const scaledHeight = Math.max(1, Math.round(canvasHeight))
        let scaled = surface.scaled
        if (!scaled || scaled.zoom !== view.zoom || scaled.imageSmoothingEnabled !== imageSmoothingEnabled || scaled.canvas.width !== scaledWidth || scaled.canvas.height !== scaledHeight) {
          const canvas = new OffscreenCanvas(scaledWidth, scaledHeight)
          const scaledContext = canvas.getContext('2d')
          if (scaledContext) {
            scaledContext.imageSmoothingEnabled = imageSmoothingEnabled
            if (imageSmoothingEnabled) scaledContext.imageSmoothingQuality = 'high'
            scaledContext.drawImage(surface.canvas, 0, 0, surface.canvas.width, surface.canvas.height, 0, 0, scaledWidth, scaledHeight)
          }
          scaled = { canvas, zoom: view.zoom, imageSmoothingEnabled }
          surface.scaled = scaled
        }
        const scaledFromX = fromX / document.width * scaledWidth
        const scaledFromY = fromY / document.height * scaledHeight
        const scaledVisibleWidth = visibleWidth / document.width * scaledWidth
        const scaledVisibleHeight = visibleHeight / document.height * scaledHeight
        if (fromX === 0 && fromY === 0 && toX === document.width && toY === document.height) {
          context.drawImage(scaled.canvas, originX, originY, canvasWidth, canvasHeight)
          return
        }
        context.drawImage(scaled.canvas, scaledFromX, scaledFromY, scaledVisibleWidth, scaledVisibleHeight, originX + fromX * view.zoom, originY + fromY * view.zoom, visibleWidth * view.zoom, visibleHeight * view.zoom)
        return
      }
      context.drawImage(
        surface.canvas,
        fromX,
        fromY,
        visibleWidth,
        visibleHeight,
        originX + fromX * view.zoom,
        originY + fromY * view.zoom,
        visibleWidth * view.zoom,
        visibleHeight * view.zoom
      )
    }
  }

  private drawRegion(context: RasterContext2D, document: SpriteDocument, view: ViewState, originX: number, originY: number, fromX: number, fromY: number, toX: number, toY: number, key: string, contentRevision: number, isolatedLayerMask?: LayerMask): void {
    const x = Math.max(0, Math.floor(fromX))
    const y = Math.max(0, Math.floor(fromY))
    const right = Math.min(document.width, Math.ceil(toX))
    const bottom = Math.min(document.height, Math.ceil(toY))
    const width = Math.max(0, right - x)
    const height = Math.max(0, bottom - y)
    if (width === 0 || height === 0) return
    let region = this.regions.get(key)
    if (!region || region.revision !== contentRevision || region.x !== x || region.y !== y || region.width !== width || region.height !== height) {
      const pixels = isolatedLayerMask
        ? renderLayerMaskRegion(isolatedLayerMask, x, y, width, height)
        : compositeRegion(document, x, y, width, height)
      if (!isolatedLayerMask && view.relativeLuminance) applyRelativeLuminance(pixels)
      const canvas = new OffscreenCanvas(width, height)
      canvas.getContext('2d')?.putImageData(imageData(pixels, width, height), 0, 0)
      region = { canvas, revision: contentRevision, x, y, width, height }
      this.remember(this.regions, key, region)
    }
    context.save()
    context.translate(originX, originY)
    context.scale(view.zoom, view.zoom)
    context.drawImage(region.canvas, x, y)
    context.restore()
  }

  private remember<T extends CompositeSurface>(cache: Map<string, T>, key: string, value: T): void {
    cache.delete(key)
    cache.set(key, value)
    const cacheBytes = (): number => {
      let total = 0
      for (const entry of cache.values()) total += entry.canvas.width * entry.canvas.height * 4
      return total
    }
    while (cache.size > 1 && (cache.size > MAX_CACHED_FRAMES || cacheBytes() > this.maxCacheBytes)) cache.delete(cache.keys().next().value!)
  }
}
