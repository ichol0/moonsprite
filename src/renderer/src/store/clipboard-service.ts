import type { BackgroundLayerSettings, ClipboardImage, FreeTileCelData, FreeTileSourceLayer, LayerGroup, RasterLayer, TextCelData, TilemapCelData, Tileset } from '@shared/types'
import { unpackColor } from '@/core/raster'
import { cloneLayerStyles } from '@/core/layer-styles'

export interface SelectionClipboard {
  width: number
  height: number
  originX?: number
  originY?: number
  pixels: Uint32Array
  mask?: Uint8Array
}

export interface LayerClipboard {
  name: string
  linkedContentId?: string
  kind?: 'text' | 'tilemap' | 'free-tile'
  tilemapTilesetId?: string
  freeTileSetId?: string
  freeTileSources?: FreeTileSourceLayer[]
  width: number
  height: number
  offsetX: number
  offsetY: number
  visible: boolean
  locked: boolean
  opacity: number
  blendMode: RasterLayer['blendMode']
  clippingMask?: boolean
  layerStyles?: RasterLayer['layerStyles']
  background?: BackgroundLayerSettings
  displayColor?: RasterLayer['displayColor']
  description?: string
  groupKey?: string | null
  pixels: Uint8ClampedArray
  animationCels?: Array<{
    frameIndex: number
    width: number
    height: number
    offsetX: number
    offsetY: number
    storageOriginX?: number
    storageOriginY?: number
    opacity?: number
    text?: TextCelData
    tilemap?: TilemapCelData
    freeTiles?: FreeTileCelData
    pixels: Uint8ClampedArray
    mask?: LayerMaskClipboard
  }>
}

export interface LayerGroupClipboard {
  key: string
  name: string
  visible: boolean
  locked: boolean
  opacity: number
  blendMode: RasterLayer['blendMode']
  clippingMask?: boolean
  layerStyles?: LayerGroup['layerStyles']
  cumulativeBlend?: boolean
  displayColor?: RasterLayer['displayColor']
  description?: string
  parentKey?: string | null
  collapsed?: boolean
}

export interface LayerMaskClipboard {
  width: number
  height: number
  offsetX: number
  offsetY: number
  pixels: Uint8ClampedArray
}

export interface LayerCollectionClipboard {
  sourceDocumentId?: string
  animationFrames?: Array<{ duration: number }>
  tilesets?: Tileset[]
  layers: LayerClipboard[]
  groups: LayerGroupClipboard[]
}

const MAX_CLIPBOARD_PIXELS = 16 * 1024 * 1024

const cloneSelectionClipboard = (clipboard: SelectionClipboard): SelectionClipboard => ({
  width: clipboard.width,
  height: clipboard.height,
  originX: clipboard.originX,
  originY: clipboard.originY,
  pixels: clipboard.pixels.slice(),
  mask: clipboard.mask?.slice()
})

const cloneLayerClipboard = (clipboard: LayerClipboard): LayerClipboard => ({
  ...clipboard,
  layerStyles: cloneLayerStyles(clipboard.layerStyles),
  background: clipboard.background ? { ...clipboard.background } : undefined,
  displayColor: clipboard.displayColor ? { ...clipboard.displayColor } : undefined,
  freeTileSources: clipboard.freeTileSources?.map((source) => ({ ...source, displayColor: source.displayColor ? { ...source.displayColor } : undefined })),
  pixels: clipboard.pixels.slice(),
  animationCels: clipboard.animationCels?.map((cel) => ({
    ...cel,
    tilemap: cel.tilemap ? { ...cel.tilemap, cells: cel.tilemap.cells.map((cell) => cell ? { ...cell } : null) } : undefined,
    freeTiles: cel.freeTiles ? { instances: cel.freeTiles.instances.map((instance) => ({ ...instance })) } : undefined,
    pixels: cel.pixels.slice(),
    mask: cel.mask ? { ...cel.mask, pixels: cel.mask.pixels.slice() } : undefined
  }))
})

const cloneLayerCollectionClipboard = (clipboard: LayerCollectionClipboard): LayerCollectionClipboard => ({
  sourceDocumentId: clipboard.sourceDocumentId,
  animationFrames: clipboard.animationFrames?.map((frame) => ({ ...frame })),
  tilesets: clipboard.tilesets?.map((tileset) => ({ ...tileset, tileIds: [...tileset.tileIds], tileSlots: tileset.tileSlots ? [...tileset.tileSlots] : undefined, pixels: tileset.pixels.slice() })),
  layers: clipboard.layers.map(cloneLayerClipboard),
  groups: clipboard.groups.map((group) => ({ ...group, layerStyles: cloneLayerStyles(group.layerStyles), displayColor: group.displayColor ? { ...group.displayColor } : undefined }))
})

export const selectionClipboardFromImage = (image: ClipboardImage): SelectionClipboard | null => {
  const pixelCount = image.width * image.height
  if (!Number.isSafeInteger(pixelCount) || pixelCount < 1 || pixelCount > MAX_CLIPBOARD_PIXELS || image.data.length !== pixelCount * 4) return null

  let mask: Uint8Array | undefined
  let selected = 0
  for (let index = 0; index < pixelCount; index += 1) {
    if (image.data[index * 4 + 3] === 0) {
      if (!mask) {
        mask = new Uint8Array(pixelCount)
        mask.fill(1, 0, index)
      }
      continue
    }
    if (mask) mask[index] = 1
    selected += 1
  }
  if (selected === 0) return null

  let pixels: Uint32Array
  const littleEndian = new Uint8Array(new Uint32Array([1]).buffer)[0] === 1
  if (littleEndian && image.data.byteOffset % 4 === 0) {
    pixels = new Uint32Array(image.data.buffer, image.data.byteOffset, pixelCount)
  } else {
    pixels = new Uint32Array(pixelCount)
    for (let index = 0; index < pixelCount; index += 1) {
      const offset = index * 4
      pixels[index] = (image.data[offset]
        | image.data[offset + 1] << 8
        | image.data[offset + 2] << 16
        | image.data[offset + 3] << 24) >>> 0
    }
  }
  return { width: image.width, height: image.height, pixels, mask }
}

export const selectionClipboardImage = (clipboard: SelectionClipboard): ClipboardImage => {
  const data = new Uint8Array(clipboard.width * clipboard.height * 4)
  for (let index = 0; index < clipboard.pixels.length; index += 1) {
    if (clipboard.mask && clipboard.mask[index] !== 1) continue
    const color = unpackColor(clipboard.pixels[index])
    const offset = index * 4
    data[offset] = color.r
    data[offset + 1] = color.g
    data[offset + 2] = color.b
    data[offset + 3] = color.a
  }
  return { width: clipboard.width, height: clipboard.height, data }
}

export class ClipboardService {
  private selection: SelectionClipboard | null = null
  private layers: LayerCollectionClipboard | null = null

  clearSelection(): void {
    this.selection = null
  }

  clearLayer(): void {
    this.layers = null
  }

  setSelection(clipboard: SelectionClipboard): void {
    this.selection = cloneSelectionClipboard(clipboard)
    this.layers = null
  }

  getSelection(): SelectionClipboard | null {
    return this.selection ? cloneSelectionClipboard(this.selection) : null
  }

  setLayer(clipboard: LayerClipboard): void {
    this.setLayers({ layers: [clipboard], groups: [] })
  }

  setLayers(clipboard: LayerCollectionClipboard): void {
    this.layers = cloneLayerCollectionClipboard(clipboard)
    this.selection = null
  }

  getLayer(): LayerClipboard | null {
    return this.layers?.layers.length === 1 && this.layers.groups.length === 0 ? cloneLayerClipboard(this.layers.layers[0]) : null
  }

  getLayers(): LayerCollectionClipboard | null {
    return this.layers ? cloneLayerCollectionClipboard(this.layers) : null
  }

  async readSelection(readSystemImage: () => Promise<ClipboardImage | null>): Promise<SelectionClipboard | null> {
    const internal = this.selection
    try {
      const image = await readSystemImage()
      const system = image ? selectionClipboardFromImage(image) : null
      if (system && internal && system.width === internal.width && system.height === internal.height
        && system.pixels.every((value, index) => value === internal.pixels[index])
        && masksEqual(system.mask, internal.mask, system.width * system.height)) return cloneSelectionClipboard(internal)
      return system ?? (internal ? cloneSelectionClipboard(internal) : null)
    } catch {
      return internal ? cloneSelectionClipboard(internal) : null
    }
  }
}

const masksEqual = (left: Uint8Array | undefined, right: Uint8Array | undefined, size: number): boolean => {
  if (left === right) return true
  if (!left) return !right || right.length === size && right.every((value) => value === 1)
  if (!right) return left.length === size && left.every((value) => value === 1)
  return left.length === right.length && left.every((value, index) => value === right[index])
}
