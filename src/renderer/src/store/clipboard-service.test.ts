import { describe, expect, it } from 'vitest'
import { ClipboardService, selectionClipboardFromImage, selectionClipboardImage } from './clipboard-service'

const red = new Uint8Array([255, 0, 0, 255])

describe('ClipboardService', () => {
  it('converts clipboard images without retaining transparent pixels', () => {
    const clipboard = selectionClipboardFromImage({ width: 2, height: 1, data: new Uint8Array([...red, 0, 0, 0, 0]) })
    expect(clipboard).not.toBeNull()
    expect(clipboard?.mask).toEqual(new Uint8Array([1, 0]))
    expect(clipboard && selectionClipboardImage(clipboard).data).toEqual(new Uint8Array([...red, 0, 0, 0, 0]))
  })

  it('uses a readable system image before the internal selection', async () => {
    const service = new ClipboardService()
    service.setSelection({ width: 1, height: 1, pixels: new Uint32Array([0xff0000ff]), mask: new Uint8Array([1]) })

    const clipboard = await service.readSelection(async () => ({ width: 1, height: 1, data: new Uint8Array([0, 255, 0, 255]) }))

    expect(clipboard && selectionClipboardImage(clipboard).data).toEqual(new Uint8Array([0, 255, 0, 255]))
  })

  it('falls back to the internal selection when the system clipboard cannot be read', async () => {
    const service = new ClipboardService()
    service.setSelection({ width: 1, height: 1, pixels: new Uint32Array([0xff0000ff]), mask: new Uint8Array([1]) })

    const clipboard = await service.readSelection(async () => { throw new Error('clipboard unavailable') })

    expect(clipboard && selectionClipboardImage(clipboard).data).toEqual(red)
  })

  it('copies clipboard data at service boundaries', () => {
    const service = new ClipboardService()
    const pixels = new Uint32Array([0xff0000ff])
    service.setSelection({ width: 1, height: 1, pixels, mask: new Uint8Array([1]) })
    pixels[0] = 0

    const clipboard = service.getSelection()
    if (!clipboard) throw new Error('missing clipboard')
    clipboard.pixels[0] = 0

    expect(selectionClipboardImage(service.getSelection()!).data).toEqual(red)
  })

  it('retains the internal origin when the matching system image is read back', async () => {
    const service = new ClipboardService()
    service.setSelection({ width: 1, height: 1, originX: 7, originY: -2, pixels: new Uint32Array([0xff0000ff]), mask: new Uint8Array([1]) })

    const clipboard = await service.readSelection(async () => ({ width: 1, height: 1, data: red }))

    expect(clipboard).toMatchObject({ originX: 7, originY: -2 })
  })

  it('copies a complete layer collection at service boundaries', () => {
    const service = new ClipboardService()
    const pixels = new Uint8ClampedArray([255, 0, 0, 255])
    service.setLayers({
      layers: [{ name: 'top', width: 1, height: 1, offsetX: 3, offsetY: -2, visible: true, locked: false, opacity: 0.5, blendMode: 'multiply', description: 'note', displayColor: { r: 1, g: 2, b: 3, a: 255 }, groupKey: 'group-a', pixels }],
      groups: [{ key: 'group-a', name: 'group', visible: true, locked: false, opacity: 1, blendMode: 'normal', parentKey: null }]
    })
    pixels[0] = 0

    const copied = service.getLayers()
    expect(copied?.layers[0].pixels[0]).toBe(255)
    copied!.layers[0].pixels[0] = 0
    expect(service.getLayers()?.layers[0].pixels[0]).toBe(255)
  })
})
