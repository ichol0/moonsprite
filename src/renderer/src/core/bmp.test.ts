import { describe, expect, it } from 'vitest'
import { encodeBmp } from './bmp'

describe('BMP encoding', () => {
  it('writes a 32-bit sRGB bitmap with bottom-up BGRA pixels', () => {
    const bytes = encodeBmp(Uint8ClampedArray.from([
      255, 0, 0, 255,
      0, 255, 0, 128
    ]), 1, 2)
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)

    expect(String.fromCharCode(bytes[0], bytes[1])).toBe('BM')
    expect(view.getUint32(10, true)).toBe(122)
    expect(view.getUint32(14, true)).toBe(108)
    expect(view.getInt32(18, true)).toBe(1)
    expect(view.getInt32(22, true)).toBe(2)
    expect(view.getUint16(28, true)).toBe(32)
    expect(view.getUint32(30, true)).toBe(3)
    expect([...bytes.subarray(122, 130)]).toEqual([0, 255, 0, 128, 0, 0, 255, 255])
  })
})
