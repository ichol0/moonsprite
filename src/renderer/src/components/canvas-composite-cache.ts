import type { SelectionRect, SpriteDocument, ViewState } from '@shared/types'
import { compositeRegion } from '@/core/document'
import { applyRelativeLuminance } from '@/core/raster'
import type { CanvasDragState } from '@/core/canvas-input'
import type { RasterContext2D } from './canvas-selection-renderer'

interface CompositeTile {
  canvas: OffscreenCanvas
  x: number
  y: number
}

interface CompositeSurface {
  canvas: OffscreenCanvas
  revision: string
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

const TILE_SIZE = 128
const MAX_TILES = 192
const MAX_SURFACE_PIXELS = 2048 * 2048
const CACHE_VERSION = 2

export class CanvasCompositeCache {
  private readonly tiles = new Map<string, CompositeTile>()
  private revision = ''
  private surface: CompositeSurface | null = null

  invalidateSurface(): void {
    this.surface = null
  }

  invalidateAll(): void {
    this.tiles.clear()
    this.surface = null
  }

  invalidateRect(selection: SelectionRect | null | undefined, documentWidth: number, documentHeight: number): void {
    if (!selection) return
    // Tile sources include a one-pixel gutter. Invalidate neighboring gutters
    // so an edited edge cannot leave a stale copy in an adjacent tile.
    const left = Math.max(0, selection.x - 1)
    const top = Math.max(0, selection.y - 1)
    const right = Math.min(documentWidth, selection.x + selection.width + 1)
    const bottom = Math.min(documentHeight, selection.y + selection.height + 1)
    if (right <= left || bottom <= top) return
    const firstTileX = Math.floor(left / TILE_SIZE)
    const firstTileY = Math.floor(top / TILE_SIZE)
    const lastTileX = Math.floor((right - 1) / TILE_SIZE)
    const lastTileY = Math.floor((bottom - 1) / TILE_SIZE)
    for (let tileY = firstTileY; tileY <= lastTileY; tileY += 1) {
      for (let tileX = firstTileX; tileX <= lastTileX; tileX += 1) this.tiles.delete(`${tileX}:${tileY}`)
    }
    this.surface = null
  }

  draw({ context, document, view, originX, originY, canvasWidth, canvasHeight, fromX, fromY, toX, toY, revision, activeDrag }: DrawCompositeOptions): void {
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
    const canUseSurface = activeDrag !== 'draw'
      && activeDrag !== 'move-content'
      && activeDrag !== 'transform-content'
      && activeDrag !== 'rotate-content'
      && document.width * document.height <= MAX_SURFACE_PIXELS
    if (canUseSurface) this.drawSurface(context, document, view, originX, originY, canvasWidth, canvasHeight, contentRevision)
    else this.drawTiles(context, document, view, originX, originY, fromX, fromY, toX, toY)
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
    }
    context.drawImage(surface.canvas, originX, originY, canvasWidth, canvasHeight)
  }

  private drawTiles(context: RasterContext2D, document: SpriteDocument, view: ViewState, originX: number, originY: number, fromX: number, fromY: number, toX: number, toY: number): void {
    const firstTileX = Math.floor(fromX / TILE_SIZE)
    const firstTileY = Math.floor(fromY / TILE_SIZE)
    const lastTileX = Math.floor((toX - 1) / TILE_SIZE)
    const lastTileY = Math.floor((toY - 1) / TILE_SIZE)
    context.save()
    context.translate(originX, originY)
    context.scale(view.zoom, view.zoom)
    for (let tileY = firstTileY; tileY <= lastTileY; tileY += 1) {
      for (let tileX = firstTileX; tileX <= lastTileX; tileX += 1) {
        const startX = tileX * TILE_SIZE
        const startY = tileY * TILE_SIZE
        const width = Math.min(TILE_SIZE, document.width - startX)
        const height = Math.min(TILE_SIZE, document.height - startY)
        const key = `${tileX}:${tileY}`
        let tile = this.tiles.get(key)
        if (!tile) {
          const sourceX = Math.max(0, startX - 1)
          const sourceY = Math.max(0, startY - 1)
          const sourceRight = Math.min(document.width, startX + width + 1)
          const sourceBottom = Math.min(document.height, startY + height + 1)
          const sourceWidth = sourceRight - sourceX
          const sourceHeight = sourceBottom - sourceY
          const pixels = compositeRegion(document, sourceX, sourceY, sourceWidth, sourceHeight)
          if (view.relativeLuminance) applyRelativeLuminance(pixels)
          const source = new OffscreenCanvas(sourceWidth, sourceHeight)
          source.getContext('2d')?.putImageData(new ImageData(new Uint8ClampedArray(pixels), sourceWidth, sourceHeight), 0, 0)
          tile = { canvas: source, x: sourceX, y: sourceY }
          this.tiles.set(key, tile)
          if (this.tiles.size > MAX_TILES) {
            const oldest = this.tiles.keys().next().value
            if (oldest !== undefined) this.tiles.delete(oldest)
          }
        }
        context.drawImage(tile.canvas, tile.x, tile.y)
      }
    }
    context.restore()
  }
}
