import type { BackgroundPatternId, StoredBackgroundPreset } from '@shared/types'
import { compositeDocument } from './document'
import { decodePng } from './png'
import { decodeBrowserRasterImage } from './raster-image'
import type { BackgroundPatternTile } from './background-patterns'

const MAX_BACKGROUND_PRESET_DIMENSION = 4096
const MAX_BACKGROUND_PRESET_PIXELS = 16_777_216

const builtInPatternByFileName: Record<string, Exclude<BackgroundPatternId, 'solid'>> = {
  'grid.png': 'grid',
  'stripes.png': 'stripes',
  'diamond.png': 'diamond',
  'diamond-nested.png': 'diamond-nested',
  'circles.png': 'circles'
}

const browserMimeTypes: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  bmp: 'image/bmp',
  gif: 'image/gif'
}

export async function decodeBackgroundPresetTile(preset: StoredBackgroundPreset, input: Uint8Array): Promise<BackgroundPatternTile> {
  const extension = preset.id.split('.').at(-1)?.toLocaleLowerCase() ?? ''
  const document = extension === 'png'
    ? decodePng(input, preset.name)
    : await decodeBrowserRasterImage(input, preset.name, browserMimeTypes[extension] ?? 'application/octet-stream')
  if (document.width > MAX_BACKGROUND_PRESET_DIMENSION || document.height > MAX_BACKGROUND_PRESET_DIMENSION || document.width * document.height > MAX_BACKGROUND_PRESET_PIXELS) {
    throw new Error('Background preset image is too large.')
  }
  return {
    id: preset.id,
    name: preset.name,
    width: document.width,
    height: document.height,
    pixels: compositeDocument(document),
    pattern: builtInPatternByFileName[preset.id.toLocaleLowerCase()]
  }
}
