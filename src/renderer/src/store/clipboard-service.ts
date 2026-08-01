import type { ClipboardImage, RasterLayer } from '@shared/types'
import { packColor, unpackColor } from '@/core/raster'

export interface SelectionClipboard {
  width: number
  height: number
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
  pixels: Uint8ClampedArray
}

const MAX_CLIPBOARD_PIXELS = 16 * 1024 * 1024

const cloneSelectionClipboard = (clipboard: SelectionClipboard): SelectionClipboard => ({
  width: clipboard.width,
  height: clipboard.height,
  pixels: clipboard.pixels.slice(),
  mask: clipboard.mask.slice()
})

const cloneLayerClipboard = (clipboard: LayerClipboard): LayerClipboard => ({
  ...clipboard,
  pixels: clipboard.pixels.slice()
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
  private layer: LayerClipboard | null = null

  clearSelection(): void {
    this.selection = null
  }

  clearLayer(): void {
    this.layer = null
  }

  setSelection(clipboard: SelectionClipboard): void {
    this.selection = cloneSelectionClipboard(clipboard)
    this.layer = null
  }

  getSelection(): SelectionClipboard | null {
    return this.selection ? cloneSelectionClipboard(this.selection) : null
  }

  setLayer(clipboard: LayerClipboard): void {
    this.layer = cloneLayerClipboard(clipboard)
    this.selection = null
  }

  getLayer(): LayerClipboard | null {
    return this.layer ? cloneLayerClipboard(this.layer) : null
  }

  async readSelection(readSystemImage: () => Promise<ClipboardImage | null>): Promise<SelectionClipboard | null> {
    const internal = this.getSelection()
    try {
      const image = await readSystemImage()
      const system = image ? selectionClipboardFromImage(image) : null
      return system ?? internal
    } catch {
      return internal
    }
  }
}
