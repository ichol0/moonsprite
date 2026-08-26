import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { MoonSpriteApi, StoredBackgroundPreset } from '@shared/types'
import { compositeDocument, createDocument, createLayer, getActiveLayer, writeLayerColor } from '@/core/document'
import { decodePng } from '@/core/png'
import { useWorkspace } from './workspace'

const red = { r: 255, g: 0, b: 0, a: 255 }
const blue = { r: 0, g: 80, b: 255, a: 255 }

const storedPreset = (name: string): StoredBackgroundPreset => ({
  id: 'selection-background-preset.png',
  name,
  filePath: 'BackgroundPresets/selection-background-preset.png',
  builtIn: false
})

beforeEach(() => {
  const api = {
    getResourceInfo: vi.fn(async () => ({ totalBytes: 8_000_000_000, freeBytes: 4_000_000_000 }))
  } as unknown as MoonSpriteApi
  Object.defineProperty(window, 'moonSprite', { configurable: true, writable: true, value: api })
  localStorage.clear()
  useWorkspace.setState({ sessions: [], activeId: null, message: null, saveProgress: null, dialog: null })
})

describe('workspace background presets', () => {
  it('saves the visible composited selection as a transparent-masked PNG without changing the document', async () => {
    const saveBackgroundPreset = vi.fn(async (name: string, _data: Uint8Array) => storedPreset(name))
    Object.assign(window.moonSprite, { saveBackgroundPreset })
    const document = createDocument('selection preset', 2, 1, 'rgba')
    const bottom = getActiveLayer(document)
    const top = createLayer('Top', 2, 1, 'rgba')
    writeLayerColor(document, bottom, 0, red)
    writeLayerColor(document, bottom, 1, red)
    writeLayerColor(document, top, 0, blue)
    document.layers.push(top)
    useWorkspace.getState().addSession(document)
    useWorkspace.getState().setSelection({ x: 0, y: 0, width: 2, height: 1, mask: Uint8Array.from([1, 0]) })

    await useWorkspace.getState().createBackgroundPresetFromSelection()

    const data = saveBackgroundPreset.mock.calls[0]?.[1]
    expect(saveBackgroundPreset).toHaveBeenCalledWith('选区背景预设', expect.any(Uint8Array))
    expect(data).toBeInstanceOf(Uint8Array)
    expect(Array.from(compositeDocument(decodePng(data!, 'saved preset')))).toEqual([
      0, 80, 255, 255,
      0, 0, 0, 0
    ])
    const session = useWorkspace.getState().sessions[0]
    expect(session.selection).toMatchObject({ x: 0, y: 0, width: 2, height: 1 })
    expect(session.history.canUndo).toBe(false)
    expect(document.dirty).toBe(false)
    expect(useWorkspace.getState().message).toBe('已将选区保存为背景预设。')
  })

  it('rejects missing or fully transparent selections before touching local storage', async () => {
    const saveBackgroundPreset = vi.fn(async (name: string, _data: Uint8Array) => storedPreset(name))
    Object.assign(window.moonSprite, { saveBackgroundPreset })
    const document = createDocument('empty selection preset', 1, 1, 'rgba')
    useWorkspace.getState().addSession(document)

    await useWorkspace.getState().createBackgroundPresetFromSelection()
    expect(useWorkspace.getState().message).toBe('请先创建选区。')

    useWorkspace.getState().setSelection({ x: 0, y: 0, width: 1, height: 1 })
    await useWorkspace.getState().createBackgroundPresetFromSelection()
    expect(useWorkspace.getState().message).toBe('选区内没有可用于背景预设的可见内容。')
    expect(saveBackgroundPreset).not.toHaveBeenCalled()
  })
})
