import type { RgbaColor, SpriteDocument } from '@shared/types'
import { compositeDocument } from './document'
import { encodePng } from './png'
import { translateCurrent as tr } from './localization'

interface WeightedColor extends RgbaColor { count: number }

const colorKey = (color: RgbaColor): number =>
  (color.r | (color.g << 8) | (color.b << 16) | (color.a << 24)) >>> 0

export function countUsedPaletteColors(document: SpriteDocument): number {
  const opaqueEntries = document.palette.filter((entry) => entry.color.a > 0)
  if (opaqueEntries.length === 0) return 0

  const paletteIds = new Set(opaqueEntries.map((entry) => entry.id))
  const paletteIdsByColor = new Map<number, number[]>()
  for (const entry of opaqueEntries) {
    const key = colorKey(entry.color)
    const ids = paletteIdsByColor.get(key)
    if (ids) ids.push(entry.id)
    else paletteIdsByColor.set(key, [entry.id])
  }

  const usedIds = new Set<number>()
  const visitedPixels = new Set<Uint8ClampedArray | Uint32Array>()
  const surfaces = [
    ...document.layers,
    ...(document.animation?.cels.flatMap((cel) => cel.surface ? [cel.surface] : []) ?? [])
  ]

  for (const surface of surfaces) {
    if (visitedPixels.has(surface.pixels)) continue
    visitedPixels.add(surface.pixels)

    if (surface.format === 'indexed') {
      for (const id of surface.pixels) {
        if (paletteIds.has(id)) usedIds.add(id)
        if (usedIds.size === opaqueEntries.length) return usedIds.size
      }
      continue
    }

    for (let offset = 0; offset < surface.pixels.length; offset += 4) {
      if (surface.pixels[offset + 3] === 0) continue
      const key = (
        surface.pixels[offset]
        | (surface.pixels[offset + 1] << 8)
        | (surface.pixels[offset + 2] << 16)
        | (surface.pixels[offset + 3] << 24)
      ) >>> 0
      const ids = paletteIdsByColor.get(key)
      if (!ids) continue
      for (const id of ids) usedIds.add(id)
      if (usedIds.size === opaqueEntries.length) return usedIds.size
    }
  }

  return usedIds.size
}

const channelValue = (color: RgbaColor, channel: keyof RgbaColor): number => color[channel]

const bucketRange = (colors: WeightedColor[]): { channel: keyof RgbaColor; range: number } => {
  const channels: Array<keyof RgbaColor> = ['r', 'g', 'b', 'a']
  let best: { channel: keyof RgbaColor; range: number } = { channel: 'r', range: -1 }
  for (const channel of channels) {
    let minimum = 255
    let maximum = 0
    for (const color of colors) {
      minimum = Math.min(minimum, channelValue(color, channel))
      maximum = Math.max(maximum, channelValue(color, channel))
    }
    if (maximum - minimum > best.range) best = { channel, range: maximum - minimum }
  }
  return best
}

const splitBucket = (colors: WeightedColor[]): [WeightedColor[], WeightedColor[]] | null => {
  if (colors.length < 2) return null
  const { channel } = bucketRange(colors)
  const sorted = [...colors].sort((left, right) => channelValue(left, channel) - channelValue(right, channel) || colorKey(left) - colorKey(right))
  const total = sorted.reduce((sum, color) => sum + color.count, 0)
  let accumulated = 0
  let splitIndex = 1
  for (; splitIndex < sorted.length; splitIndex += 1) {
    accumulated += sorted[splitIndex - 1].count
    if (accumulated >= total / 2) break
  }
  return [sorted.slice(0, splitIndex), sorted.slice(splitIndex)]
}

const averageBucket = (colors: WeightedColor[]): RgbaColor => {
  const total = colors.reduce((sum, color) => sum + color.count, 0)
  const average = (channel: keyof RgbaColor): number => Math.round(colors.reduce((sum, color) => sum + channelValue(color, channel) * color.count, 0) / total)
  return { r: average('r'), g: average('g'), b: average('b'), a: average('a') }
}

export function extractPaletteColors(document: SpriteDocument, requestedLimit: number): RgbaColor[] {
  const limit = Math.max(1, Math.min(4096, Math.round(requestedLimit) || 1))
  const pixels = compositeDocument(document)
  const colors = new Map<number, WeightedColor>()
  for (let offset = 0; offset < pixels.length; offset += 4) {
    if (pixels[offset + 3] === 0) continue
    const color = { r: pixels[offset], g: pixels[offset + 1], b: pixels[offset + 2], a: pixels[offset + 3] }
    const key = colorKey(color)
    const existing = colors.get(key)
    if (existing) existing.count += 1
    else colors.set(key, { ...color, count: 1 })
  }
  const unique = [...colors.values()]
  if (unique.length <= limit) return unique.map(({ r, g, b, a }) => ({ r, g, b, a }))

  const buckets: WeightedColor[][] = [unique]
  while (buckets.length < limit) {
    let candidateIndex = -1
    let candidateScore = -1
    for (let index = 0; index < buckets.length; index += 1) {
      if (buckets[index].length < 2) continue
      const score = bucketRange(buckets[index]).range * buckets[index].reduce((sum, color) => sum + color.count, 0)
      if (score > candidateScore) {
        candidateIndex = index
        candidateScore = score
      }
    }
    if (candidateIndex < 0) break
    const split = splitBucket(buckets[candidateIndex])
    if (!split || split[0].length === 0 || split[1].length === 0) break
    buckets.splice(candidateIndex, 1, split[0], split[1])
  }

  const result: RgbaColor[] = []
  const seen = new Set<number>()
  for (const bucket of buckets) {
    const average = averageBucket(bucket)
    const representative = seen.has(colorKey(average))
      ? [...bucket].sort((left, right) => right.count - left.count || colorKey(left) - colorKey(right)).find((color) => !seen.has(colorKey(color)))
      : average
    if (!representative) continue
    const color = { r: representative.r, g: representative.g, b: representative.b, a: representative.a }
    seen.add(colorKey(color))
    result.push(color)
  }

  // Different median-cut buckets can share the same weighted average. Fill any
  // collisions with deterministic source colors so the requested count is kept.
  const targetCount = Math.min(limit, unique.length)
  if (result.length < targetCount) {
    const candidates = [...unique].sort((left, right) => right.count - left.count || colorKey(left) - colorKey(right))
    for (const candidate of candidates) {
      const key = colorKey(candidate)
      if (seen.has(key)) continue
      seen.add(key)
      result.push({ r: candidate.r, g: candidate.g, b: candidate.b, a: candidate.a })
      if (result.length === targetCount) break
    }
  }
  return result
}

export function mergePaletteColors(current: RgbaColor[], incoming: RgbaColor[]): RgbaColor[] {
  const result = current.map((color) => ({ ...color }))
  const seen = new Set(result.map(colorKey))
  for (const color of incoming) {
    const key = colorKey(color)
    if (seen.has(key)) continue
    seen.add(key)
    result.push({ ...color })
  }
  return result
}

export function encodePalettePng(colors: RgbaColor[], tileSize = 16, maximumColumns = 8): { bytes: Uint8Array; width: number; height: number } {
  if (colors.length === 0) throw new Error(tr('core.palette.empty'))
  const size = Math.max(1, Math.min(64, Math.round(tileSize)))
  const columns = Math.max(1, Math.min(Math.round(maximumColumns), colors.length))
  const rows = Math.ceil(colors.length / columns)
  const width = columns * size
  const height = rows * size
  const pixels = new Uint8ClampedArray(width * height * 4)
  for (let index = 0; index < colors.length; index += 1) {
    const color = colors[index]
    const startX = (index % columns) * size
    const startY = Math.floor(index / columns) * size
    for (let y = startY; y < startY + size; y += 1) {
      for (let x = startX; x < startX + size; x += 1) {
        const offset = (y * width + x) * 4
        pixels[offset] = color.r
        pixels[offset + 1] = color.g
        pixels[offset + 2] = color.b
        pixels[offset + 3] = color.a
      }
    }
  }
  return { bytes: encodePng(pixels, width, height, true).bytes, width, height }
}
