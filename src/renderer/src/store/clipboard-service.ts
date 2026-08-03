import type { ClipboardImage, RasterLayer } from '@shared/types'
import { packColor, unpackColor } from '@/core/raster'

export interface SelectionClipboard {
  width: number
  height: number
  originX?: number
  originY?: number
  pixels: Uint32Array
  mask: Uint8Array
}

export interface LayerClipboard {
  name: string
  width: number
  height: number
  offsetX: number
  offsetY: number
  visible: boolean
  locked: boolean
  opacity: number
  blendMode: RasterLayer['blendMode']
  displayColor?: RasterLayer['displayColor']
  description?: string
  groupKey?: string | null
  pixels: Uint8ClampedArray
}

export interface LayerGroupClipboard {
  key: string
  name: string
  visible: boolean
  locked: boolean
  opacity: number
  blendMode: RasterLayer['blendMode']
  displayColor?: RasterLayer['displayColor']
  description?: string
  parentKey?: string | null
}

export interface LayerCollectionClipboard {
  sourceDocumentId?: string
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
  mask: clipboard.mask.slice()
})

const cloneLayerClipboard = (clipboard: LayerClipboard): LayerClipboard => ({
  ...clipboard,
  displayColor: clipboard.displayColor ? { ...clipboard.displayColor } : undefined,
  pixels: clipboard.pixels.slice()
})

const cloneLayerCollectionClipboard = (clipboard: LayerCollectionClipboard): LayerCollectionClipboard => ({
  sourceDocumentId: clipboard.sourceDocumentId,
  layers: clipboard.layers.map(cloneLayerClipboard),
  groups: clipboard.groups.map((group) => ({ ...group, displayColor: group.displayColor ? { ...group.displayColor } : undefined }))
})

export const selectionClipboardFromImage = (image: ClipboardImage): SelectionClipboard | null => {
  const pixels = image.width * image.height
  if (!Number.isSafeInteger(pixels) || pixels < 1 || pixels > MAX_CLIPBOARD_PIXELS || image.data.length !== pixels * 4) return null

  const packed = new Uint32Array(pixels)
  const mask = new Uint8Array(pixels)
  let opaque = 0
  for (let index = 0; index < pixels; index += 1) {
    const offset = index * 4
    const alpha = image.data[offset + 3]
    if (alpha === 0) continue
    packed[index] = packColor({ r: image.data[offset], g: image.data[offset + 1], b: image.data[offset + 2], a: alpha })
    mask[index] = 1
    opaque += 1
  }
  return opaque > 0 ? { width: image.width, height: image.height, pixels: packed, mask } : null
}

export const selectionClipboardImage = (clipboard: SelectionClipboard): ClipboardImage => {
  const data = new Uint8Array(clipboard.width * clipboard.height * 4)
  for (let index = 0; index < clipboard.pixels.length; index += 1) {
    if (clipboard.mask[index] !== 1) continue
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
    const internal = this.getSelection()
    try {
      const image = await readSystemImage()
      const system = image ? selectionClipboardFromImage(image) : null
      if (system && internal && system.width === internal.width && system.height === internal.height
        && system.pixels.every((value, index) => value === internal.pixels[index])
        && system.mask.every((value, index) => value === internal.mask[index])) return internal
      return system ?? internal
    } catch {
      return internal
    }
  }
}
