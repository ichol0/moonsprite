import { decode, toRGBA8 } from 'upng-js'
import { zlibSync } from 'fflate'
import type { PaletteEntry, SpriteDocument } from '@shared/types'
import { encodeAseprite } from './aseprite'
import { createDocument } from './document'
import { compositeDocument } from './document'
import { TRANSPARENT } from './raster'
import { translateCurrent as tr } from './localization'

export interface PngExport {
  bytes: Uint8Array
  indexed: boolean
}

export type ImageExportKind = 'png-auto' | 'png-rgba' | 'jpeg' | 'webp' | 'svg' | 'gif'
export type SaveImageKind = Exclude<ImageExportKind, 'gif'> | 'ase' | 'aseprite'
export interface ImageExport {
  bytes: Uint8Array
  extension: 'png' | 'jpg' | 'webp' | 'svg' | 'ase' | 'aseprite'
  indexed: boolean
  width: number
  height: number
}

const crcTable = (() => {
  const table = new Uint32Array(256)
  for (let index = 0; index < 256; index += 1) {
    let value = index
    for (let bit = 0; bit < 8; bit += 1) value = (value & 1) ? 0xedb88320 ^ (value >>> 1) : value >>> 1
    table[index] = value >>> 0
  }
  return table
})()

const crc32 = (bytes: Uint8Array): number => {
  let crc = 0xffffffff
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

const chunk = (type: string, payload: Uint8Array): Uint8Array => {
  const output = new Uint8Array(payload.length + 12)
  const view = new DataView(output.buffer)
  view.setUint32(0, payload.length)
  for (let index = 0; index < 4; index += 1) output[4 + index] = type.charCodeAt(index)
  output.set(payload, 8)
  const checksumBytes = output.subarray(4, payload.length + 8)
  view.setUint32(payload.length + 8, crc32(checksumBytes))
  return output
}

const writeUint32 = (view: DataView, offset: number, value: number): void => view.setUint32(offset, value >>> 0)

export function encodePng(rgba: Uint8ClampedArray, width: number, height: number, forceRgba = false): PngExport {
  const colors: number[] = []
  const colorIds = new Map<number, number>()
  if (!forceRgba) {
    for (let offset = 0; offset < rgba.length; offset += 4) {
      const color = (rgba[offset] | (rgba[offset + 1] << 8) | (rgba[offset + 2] << 16) | (rgba[offset + 3] << 24)) >>> 0
      if (!colorIds.has(color)) {
        colorIds.set(color, colors.length)
        colors.push(color)
        if (colors.length > 256) break
      }
    }
  }
  const indexed = !forceRgba && colors.length <= 256
  const bitDepth = colors.length <= 2 ? 1 : colors.length <= 4 ? 2 : colors.length <= 16 ? 4 : 8
  const header = new Uint8Array(13)
  const headerView = new DataView(header.buffer)
  writeUint32(headerView, 0, width)
  writeUint32(headerView, 4, height)
  header[8] = indexed ? bitDepth : 8
  header[9] = indexed ? 3 : 6
  const rows = indexed ? Math.ceil(width * bitDepth / 8) : width * 4
  const raw = new Uint8Array((rows + 1) * height)
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (rows + 1)
    raw[rowStart] = 0
    if (indexed) {
      for (let x = 0; x < width; x += 1) {
        const offset = (y * width + x) * 4
        const color = (rgba[offset] | (rgba[offset + 1] << 8) | (rgba[offset + 2] << 16) | (rgba[offset + 3] << 24)) >>> 0
        const id = colorIds.get(color) ?? 0
        const bitOffset = x * bitDepth
        raw[rowStart + 1 + Math.floor(bitOffset / 8)] |= id << (8 - bitDepth - (bitOffset % 8))
      }
    } else {
      raw.set(rgba.subarray(y * width * 4, (y + 1) * width * 4), rowStart + 1)
    }
  }
  const signature = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])
  const chunks = [chunk('IHDR', header)]
  if (indexed) {
    const palette = new Uint8Array(colors.length * 3)
    const alpha = new Uint8Array(colors.length)
    for (let index = 0; index < colors.length; index += 1) {
      const color = colors[index]
      palette[index * 3] = color & 0xff
      palette[index * 3 + 1] = (color >>> 8) & 0xff
      palette[index * 3 + 2] = (color >>> 16) & 0xff
      alpha[index] = (color >>> 24) & 0xff
    }
    chunks.push(chunk('PLTE', palette), chunk('tRNS', alpha))
  }
  chunks.push(chunk('IDAT', zlibSync(raw)), chunk('IEND', new Uint8Array()))
  const output = new Uint8Array(signature.length + chunks.reduce((sum, item) => sum + item.length, 0))
  output.set(signature)
  let offset = signature.length
  for (const item of chunks) { output.set(item, offset); offset += item.length }
  return { bytes: output, indexed }
}

const unpackIndexedSamples = (bytes: Uint8Array, depth: number, count: number): Uint8Array => {
  if (depth === 8) return bytes.slice(0, count)
  const output = new Uint8Array(count)
  const mask = (1 << depth) - 1
  for (let index = 0; index < count; index += 1) {
    const byte = bytes[Math.floor((index * depth) / 8)]
    const shift = 8 - depth - ((index * depth) % 8)
    output[index] = (byte >>> shift) & mask
  }
  return output
}

export function decodePng(input: Uint8Array, fallbackName = tr('core.document.importedImage')): SpriteDocument {
  let image
  try {
    image = decode(new Uint8Array(input).buffer)
  } catch {
    throw new Error(tr('core.png.readFailed'))
  }
  if (!image.width || !image.height) throw new Error(tr('core.png.invalidSize'))
  if (image.ctype === 3 && image.tabs.PLTE) {
    const document = createDocument(fallbackName, image.width, image.height, 'indexed')
    const layer = document.layers[0]
    if (layer.format !== 'indexed') throw new Error(tr('core.png.createIndexed'))
    const paletteValues = image.tabs.PLTE
    const transparencyValues = image.tabs.tRNS
    const transparency = Array.isArray(transparencyValues) ? new Uint8Array(transparencyValues) : new Uint8Array()
    const palette: PaletteEntry[] = [{ id: 0, name: tr('core.document.transparentColor'), color: TRANSPARENT }]
    const paletteLookup: number[] = []
    for (let offset = 0, colorIndex = 0; offset < paletteValues.length; offset += 3, colorIndex += 1) {
      const alpha = Number(transparency[colorIndex] ?? 255)
      if (alpha === 0) {
        paletteLookup[colorIndex] = 0
      } else {
        const id = palette.length
        paletteLookup[colorIndex] = id
        palette.push({ id, name: tr('core.document.colorName', { id }), color: { r: paletteValues[offset], g: paletteValues[offset + 1], b: paletteValues[offset + 2], a: alpha } })
      }
    }
    const samples = unpackIndexedSamples(new Uint8Array(image.data), image.depth, image.width * image.height)
    for (let index = 0; index < layer.pixels.length; index += 1) layer.pixels[index] = paletteLookup[samples[index]] ?? 0
    document.palette = palette
    document.paletteOrder = palette.map((entry) => entry.id)
    document.nextColorId = palette.length
    return document
  }
  const rgba = new Uint8ClampedArray(toRGBA8(image)[0])
  const document = createDocument(fallbackName, image.width, image.height, 'rgba')
  const layer = document.layers[0]
  if (layer.format !== 'rgba') throw new Error(tr('core.png.createRgba'))
  layer.pixels.set(rgba)
  return document
}

export function exportDocumentPng(document: SpriteDocument, scale = 1, forceRgba = false): PngExport {
  const source = compositeDocument(document)
  if (scale === 1) return encodePng(source, document.width, document.height, forceRgba)
  const width = document.width * scale
  const height = document.height * scale
  const output = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y += 1) {
    const sourceY = Math.floor(y / scale)
    for (let x = 0; x < width; x += 1) {
      const sourceOffset = (sourceY * document.width + Math.floor(x / scale)) * 4
      output.set(source.subarray(sourceOffset, sourceOffset + 4), (y * width + x) * 4)
    }
  }
  return encodePng(output, width, height, forceRgba)
}

function scaleDocumentPixels(document: SpriteDocument, scalePercent: number): { pixels: Uint8ClampedArray; width: number; height: number } {
  const source = compositeDocument(document)
  const ratio = Math.max(0.01, Math.min(64, scalePercent / 100))
  const width = Math.max(1, Math.round(document.width * ratio))
  const height = Math.max(1, Math.round(document.height * ratio))
  if (width === document.width && height === document.height) return { pixels: source, width, height }
  const output = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y += 1) {
    const sourceY = Math.min(document.height - 1, Math.floor(y * document.height / height))
    for (let x = 0; x < width; x += 1) {
      const sourceX = Math.min(document.width - 1, Math.floor(x * document.width / width))
      const sourceOffset = (sourceY * document.width + sourceX) * 4
      output.set(source.subarray(sourceOffset, sourceOffset + 4), (y * width + x) * 4)
    }
  }
  return { pixels: output, width, height }
}

function encodeSvg(rgba: Uint8ClampedArray, width: number, height: number): Uint8Array {
  const parts: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" shape-rendering="crispEdges">`
  ]
  for (let y = 0; y < height; y += 1) {
    let x = 0
    while (x < width) {
      const offset = (y * width + x) * 4
      const alpha = rgba[offset + 3]
      if (alpha === 0) {
        x += 1
        continue
      }
      const red = rgba[offset]
      const green = rgba[offset + 1]
      const blue = rgba[offset + 2]
      let runWidth = 1
      while (x + runWidth < width) {
        const runOffset = (y * width + x + runWidth) * 4
        if (rgba[runOffset] !== red || rgba[runOffset + 1] !== green || rgba[runOffset + 2] !== blue || rgba[runOffset + 3] !== alpha) break
        runWidth += 1
      }
      const color = `#${red.toString(16).padStart(2, '0')}${green.toString(16).padStart(2, '0')}${blue.toString(16).padStart(2, '0')}`
      const opacity = alpha < 255 ? ` fill-opacity="${(alpha / 255).toFixed(6).replace(/0+$/, '').replace(/\.$/, '')}"` : ''
      parts.push(`<path d="M${x} ${y}h${runWidth}v1H${x}z" fill="${color}"${opacity}/>`)
      x += runWidth
    }
  }
  parts.push('</svg>')
  return new TextEncoder().encode(parts.join(''))
}

export async function exportDocumentImage(document: SpriteDocument, scalePercent: number, format: SaveImageKind): Promise<ImageExport> {
  if (format === 'ase' || format === 'aseprite') {
    return { bytes: encodeAseprite(document, scalePercent), extension: format, indexed: false, width: Math.max(1, Math.round(document.width * scalePercent / 100)), height: Math.max(1, Math.round(document.height * scalePercent / 100)) }
  }
  const scaled = scaleDocumentPixels(document, scalePercent)
  if (format === 'svg') {
    return { bytes: encodeSvg(scaled.pixels, scaled.width, scaled.height), extension: 'svg', indexed: false, width: scaled.width, height: scaled.height }
  }
  if (format === 'png-auto' || format === 'png-rgba') {
    const png = encodePng(scaled.pixels, scaled.width, scaled.height, format === 'png-rgba')
    return { ...png, extension: 'png', width: scaled.width, height: scaled.height }
  }
  const canvas = new OffscreenCanvas(scaled.width, scaled.height)
  const context = canvas.getContext('2d')
  if (!context) throw new Error(tr('core.png.encoderCanvas'))
  if (format === 'jpeg') {
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, scaled.width, scaled.height)
  }
  context.putImageData(new ImageData(new Uint8ClampedArray(scaled.pixels), scaled.width, scaled.height), 0, 0)
  const blob = await canvas.convertToBlob({ type: format === 'jpeg' ? 'image/jpeg' : 'image/webp', quality: 0.92 })
  return { bytes: new Uint8Array(await blob.arrayBuffer()), extension: format === 'jpeg' ? 'jpg' : 'webp', indexed: false, width: scaled.width, height: scaled.height }
}
