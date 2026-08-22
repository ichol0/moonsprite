import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { MoonSpriteApi } from '@shared/types'
import { createDocument, getActiveLayer, readLayerColorAt, writeLayerColor } from '@/core/document'
import { beginPixelEdit, recordPixel } from '@/core/history'
import { rasterStorageIdentity } from '@/core/runtime-raster'
import { useWorkspace } from './workspace'

const red = { r: 255, g: 0, b: 0, a: 255 }
const blue = { r: 0, g: 80, b: 255, a: 255 }

beforeEach(() => {
  Object.defineProperty(window, 'moonSprite', {
    configurable: true,
    writable: true,
    value: { getResourceInfo: vi.fn(async () => ({ totalBytes: 8_000_000_000, freeBytes: 4_000_000_000 })) } as unknown as MoonSpriteApi
  })
  useWorkspace.setState({ sessions: [], activeId: null, message: null, saveProgress: null, dialog: null })
})

describe('linked layer workspace commands', () => {
  it('creates one undoable linked copy and restores the association on redo', () => {
    const document = createDocument('linked command', 2, 1, 'rgba')
    useWorkspace.getState().addSession(document)
    const source = getActiveLayer(document)
    writeLayerColor(document, source, 0, red)

    const linkedId = useWorkspace.getState().createLinkedLayer(source.id)
    const linked = document.layers.find((layer) => layer.id === linkedId)!

    expect(linkedId).toBeTruthy()
    expect(source.linkedContentId).toBeTruthy()
    expect(linked.linkedContentId).toBe(source.linkedContentId)
    expect(rasterStorageIdentity(linked)).toBe(rasterStorageIdentity(source))

    useWorkspace.getState().undo()
    expect(document.layers.some((layer) => layer.id === linked.id)).toBe(false)
    expect(source.linkedContentId).toBeUndefined()

    useWorkspace.getState().redo()
    const restored = document.layers.find((layer) => layer.id === linked.id)!
    expect(restored.linkedContentId).toBe(source.linkedContentId)
    expect(rasterStorageIdentity(restored)).toBe(rasterStorageIdentity(source))
  })

  it('keeps normal duplicates and same-document pasted layers in the same association', () => {
    const document = createDocument('linked copies', 2, 1, 'rgba')
    useWorkspace.getState().addSession(document)
    const source = getActiveLayer(document)
    writeLayerColor(document, source, 0, red)
    const linkedId = useWorkspace.getState().createLinkedLayer(source.id)!

    useWorkspace.getState().duplicateActiveLayer()
    const duplicated = getActiveLayer(document)
    expect(duplicated.linkedContentId).toBe(source.linkedContentId)

    useWorkspace.getState().copySelectedLayersToClipboard()
    expect(useWorkspace.getState().pasteLayersFromClipboard()).toBe(true)
    const pasted = getActiveLayer(document)
    expect(pasted.id).not.toBe(linkedId)
    expect(pasted.linkedContentId).toBe(source.linkedContentId)

    const edit = beginPixelEdit(pasted.id)
    recordPixel(document, pasted, edit, 1, 0xffff5000)
    useWorkspace.getState().commitPixelEdit(edit, 'edit linked paste')
    for (const layer of document.layers.filter((layer) => layer.linkedContentId === source.linkedContentId)) {
      expect(readLayerColorAt(document, layer, layer.offsetX + 1, layer.offsetY)).toEqual(blue)
    }
  })

  it('maps copied association groups to a new identity in another document', () => {
    const sourceDocument = createDocument('source links', 1, 1, 'rgba')
    useWorkspace.getState().addSession(sourceDocument)
    const source = getActiveLayer(sourceDocument)
    const linkedId = useWorkspace.getState().createLinkedLayer(source.id)!
    const linked = sourceDocument.layers.find((layer) => layer.id === linkedId)!
    const sourceSession = useWorkspace.getState().sessions.find((session) => session.document.id === sourceDocument.id)!
    sourceSession.selectedLayerIds = [source.id, linked.id]
    useWorkspace.getState().copySelectedLayersToClipboard()

    const targetDocument = createDocument('target links', 1, 1, 'rgba')
    useWorkspace.getState().addSession(targetDocument)
    expect(useWorkspace.getState().pasteLayersFromClipboard()).toBe(true)
    const pasted = targetDocument.layers.filter((layer) => layer.id !== targetDocument.layers[0].id && layer.linkedContentId)

    expect(pasted).toHaveLength(2)
    expect(pasted[0].linkedContentId).toBe(pasted[1].linkedContentId)
    expect(pasted[0].linkedContentId).not.toBe(source.linkedContentId)
    expect(rasterStorageIdentity(pasted[0])).toBe(rasterStorageIdentity(pasted[1]))
  })

  it('rejects text, tile, free-tile, and background layers', () => {
    const document = createDocument('unavailable links', 1, 1, 'rgba')
    useWorkspace.getState().addSession(document)
    const layer = getActiveLayer(document)
    layer.background = { mode: 'canvas' }
    expect(useWorkspace.getState().createLinkedLayer(layer.id)).toBeNull()
    delete layer.background
    layer.kind = 'text'
    expect(useWorkspace.getState().createLinkedLayer(layer.id)).toBeNull()
  })
})
