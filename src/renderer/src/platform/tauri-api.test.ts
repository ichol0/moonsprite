import { describe, expect, it } from 'vitest'
import { decodeClipboardImagePayload } from './tauri-api'

describe('clipboard image binary IPC', () => {
  it('decodes dimensions and exposes the RGBA body without copying it', () => {
    const payload = new Uint8Array(16)
    const view = new DataView(payload.buffer)
    view.setUint32(0, 2, true)
    view.setUint32(4, 1, true)
    payload.set([255, 0, 0, 255, 0, 0, 255, 255], 8)

    const image = decodeClipboardImagePayload(payload)

    expect(image).toMatchObject({ width: 2, height: 1 })
    expect(image?.data.buffer).toBe(payload.buffer)
    expect(image?.data.byteOffset).toBe(8)
    expect(image?.data).toEqual(new Uint8Array([255, 0, 0, 255, 0, 0, 255, 255]))
  })

  it('rejects truncated clipboard payloads', () => {
    expect(() => decodeClipboardImagePayload(new Uint8Array([1, 2, 3]))).toThrow('header')
  })
})
