import { describe, expect, it } from 'vitest'
import { addBlankAnimationFrame } from './animation'
import { createDocument, writeLayerColor } from './document'
import { exportAnimationGif, gifFrameSequence } from './gif'

const firstGifFrame = (bytes: Uint8Array): { width: number; height: number; pixels: Uint8Array } => {
  const width = bytes[6] | bytes[7] << 8
  const height = bytes[8] | bytes[9] << 8
  const globalTableSize = 2 << (bytes[10] & 0x07)
  const paletteOffset = 13
  let offset = paletteOffset + globalTableSize * 3
  while (offset < bytes.length && bytes[offset] !== 0x2c) {
    if (bytes[offset] !== 0x21) throw new Error(`Unexpected GIF block ${bytes[offset].toString(16)}`)
    offset += 2
    while (bytes[offset] !== 0) offset += 1 + bytes[offset]
    offset += 1
  }
  if (bytes[offset] !== 0x2c) throw new Error('GIF image descriptor missing')
  const imagePacked = bytes[offset + 9]
  offset += 10
  if ((imagePacked & 0x80) !== 0) offset += (2 << (imagePacked & 0x07)) * 3
  const minimumCodeSize = bytes[offset++]
  const compressed: number[] = []
  while (bytes[offset] !== 0) {
    const length = bytes[offset++]
    compressed.push(...bytes.subarray(offset, offset + length))
    offset += length
  }
  const clearCode = 1 << minimumCodeSize
  const endCode = clearCode + 1
  let codeSize = minimumCodeSize + 1
  let nextCode = endCode + 1
  let bitOffset = 0
  let dictionary: number[][] = []
  let previous: number[] | null = null
  const indices: number[] = []
  const reset = (): void => {
    dictionary = Array.from({ length: clearCode }, (_, index) => [index])
    codeSize = minimumCodeSize + 1
    nextCode = endCode + 1
    previous = null
  }
  reset()
  const readCode = (): number => {
    let value = 0
    for (let bit = 0; bit < codeSize; bit += 1) {
      const sourceBit = bitOffset + bit
      value |= ((compressed[sourceBit >>> 3] ?? 0) >>> (sourceBit & 7) & 1) << bit
    }
    bitOffset += codeSize
    return value
  }
  while (bitOffset + codeSize <= compressed.length * 8) {
    const code = readCode()
    if (code === clearCode) { reset(); continue }
    if (code === endCode) break
    const entry: number[] | null = dictionary[code] ?? (code === nextCode && previous ? [...previous, previous[0]] : null)
    if (!entry) throw new Error(`Invalid GIF LZW code ${code} at ${nextCode}`)
    indices.push(...entry)
    if (previous) {
      dictionary[nextCode++] = [...previous, entry[0]]
      if (nextCode === 1 << codeSize && codeSize < 12) codeSize += 1
    }
    previous = entry
  }
  const pixels = new Uint8Array(width * height * 4)
  for (let index = 0; index < pixels.length / 4; index += 1) {
    const paletteIndex = indices[index] ?? 0
    pixels[index * 4] = bytes[paletteOffset + paletteIndex * 3]
    pixels[index * 4 + 1] = bytes[paletteOffset + paletteIndex * 3 + 1]
    pixels[index * 4 + 2] = bytes[paletteOffset + paletteIndex * 3 + 2]
    pixels[index * 4 + 3] = paletteIndex === 0 ? 0 : 255
  }
  return { width, height, pixels }
}

describe('GIF animation export', () => {
  it('orders the four supported animation directions without repeating endpoints', () => {
    expect(gifFrameSequence([1, 2, 3, 4], 'forward')).toEqual([1, 2, 3, 4])
    expect(gifFrameSequence([1, 2, 3, 4], 'reverse')).toEqual([4, 3, 2, 1])
    expect(gifFrameSequence([1, 2, 3, 4], 'forward-ping-pong')).toEqual([1, 2, 3, 4, 3, 2])
    expect(gifFrameSequence([1, 2, 3, 4], 'reverse-ping-pong')).toEqual([4, 3, 2, 1, 2, 3])
  })

  it('encodes a valid GIF89a stream with all selected frames', () => {
    const document = createDocument('gif', 2, 1, 'rgba')
    addBlankAnimationFrame(document)
    const result = exportAnimationGif(document, { scalePercent: 200, direction: 'forward' })
    expect(new TextDecoder().decode(result.bytes.subarray(0, 6))).toBe('GIF89a')
    expect(result.bytes.at(-1)).toBe(0x3b)
    expect(result).toMatchObject({ width: 4, height: 2, frameCount: 2 })
    expect([...result.bytes].filter((value) => value === 0x2c)).toHaveLength(2)
  })

  it('crops every animation frame to the requested slice before scaling', () => {
    const document = createDocument('gif slice', 3, 2, 'rgba')
    const layer = document.layers[0]
    writeLayerColor(document, layer, 1, { r: 255, g: 0, b: 0, a: 255 })
    addBlankAnimationFrame(document)
    writeLayerColor(document, layer, 5, { r: 0, g: 0, b: 255, a: 255 })

    const result = exportAnimationGif(document, { scalePercent: 200, direction: 'forward', crop: { x: 1, y: 0, width: 2, height: 2 } })
    const decoded = firstGifFrame(result.bytes)

    expect(result).toMatchObject({ width: 4, height: 4, frameCount: 2 })
    expect([...decoded.pixels.subarray(0, 4)]).toEqual([255, 0, 0, 255])
    expect([...decoded.pixels.subarray(2 * 4, 3 * 4)]).toEqual([0, 0, 0, 0])
  })

  it('keeps every source pixel as an exact 10x10 block at 1000 percent across LZW code widths', () => {
    const document = createDocument('gif scale', 32, 32, 'rgba')
    const layer = document.layers[0]
    const colors = [
      { r: 255, g: 0, b: 0, a: 255 },
      { r: 0, g: 255, b: 0, a: 255 },
      { r: 0, g: 0, b: 255, a: 255 },
      { r: 255, g: 255, b: 255, a: 255 }
    ]
    for (let y = 0; y < 32; y += 1) for (let x = 0; x < 32; x += 1) writeLayerColor(document, layer, y * 32 + x, colors[(x * 3 + y * 5) % colors.length])
    const result = exportAnimationGif(document, { scalePercent: 1000, direction: 'forward' })
    const decoded = firstGifFrame(result.bytes)
    expect(decoded).toMatchObject({ width: 320, height: 320 })
    for (let y = 0; y < 320; y += 1) for (let x = 0; x < 320; x += 1) {
      const expected = colors[((Math.floor(x / 10) * 3) + Math.floor(y / 10) * 5) % colors.length]
      expect([...decoded.pixels.subarray((y * 320 + x) * 4, (y * 320 + x + 1) * 4)]).toEqual([expected.r, expected.g, expected.b, expected.a])
    }
  }, 15_000)
})
