import { beforeEach, describe, expect, it } from 'vitest'
import { createDocument, createLayer, getActiveLayer, readLayerColor, writeLayerColor } from '@/core/document'
import { ensureAnimationDocument } from '@/core/animation'
import { useWorkspace } from './workspace'

const DEFAULT_PRIMARY = { r: 41, g: 121, b: 255, a: 255 }
const DEFAULT_SECONDARY = { r: 241, g: 244, b: 248, a: 255 }

beforeEach(() => {
  localStorage.clear()
  useWorkspace.setState({
    sessions: [],
    activeId: null,
    message: null,
    dialog: null,
    sharedPrimaryColor: { ...DEFAULT_PRIMARY },
    sharedSecondaryColor: { ...DEFAULT_SECONDARY }
  })
})

describe('palette color synchronization', () => {
  it('does not replace canvas pixels when synchronization is disabled', () => {
    localStorage.setItem('moonsprite.palette-edit-locked', 'false')
    const document = createDocument('palette color sync disabled', 1, 1, 'rgba')
    const layer = getActiveLayer(document)
    const entry = document.palette.find((candidate) => candidate.id !== 0)!
    const source = { ...entry.color }
    const replacement = { r: 17, g: 33, b: 49, a: 255 }
    writeLayerColor(document, layer, 0, source)
    useWorkspace.getState().addSession(document)
    useWorkspace.getState().selectPaletteColor(entry.id)
    useWorkspace.getState().sessions[0].history.clear()

    useWorkspace.getState().setPrimaryColor(replacement)

    expect(entry.color).toEqual(replacement)
    expect(readLayerColor(document, layer, 0)).toEqual(source)
  })

  it('synchronizes matching RGBA pixels across layers and frames as one undoable palette edit', () => {
    localStorage.setItem('moonsprite.palette-edit-locked', 'false')
    localStorage.setItem('moonsprite.palette-sync-colors', 'true')
    const document = createDocument('palette color sync rgba', 2, 1, 'rgba')
    const active = getActiveLayer(document)
    const other = createLayer('Other', 2, 1, 'rgba')
    document.layers.push(other)
    const entry = document.palette.find((candidate) => candidate.id !== 0)!
    const source = { ...entry.color }
    const replacement = { r: 48, g: 154, b: 210, a: 255 }
    const untouched = { r: 9, g: 19, b: 29, a: 255 }
    for (const layer of [active, other]) {
      writeLayerColor(document, layer, 0, source)
      writeLayerColor(document, layer, 1, untouched)
    }
    useWorkspace.getState().addSession(document)
    useWorkspace.getState().duplicateAnimationFrame()
    const timeline = ensureAnimationDocument(document)
    useWorkspace.getState().selectPaletteColor(entry.id)
    const session = useWorkspace.getState().sessions[0]
    session.history.clear()

    useWorkspace.getState().setPrimaryColor(replacement)

    expect(entry.color).toEqual(replacement)
    for (const frame of timeline.frames) {
      useWorkspace.getState().setActiveAnimationFrame(frame.id)
      for (const layerId of [active.id, other.id]) {
        const layer = document.layers.find((candidate) => candidate.id === layerId)!
        expect(readLayerColor(document, layer, 0)).toEqual(replacement)
        expect(readLayerColor(document, layer, 1)).toEqual(untouched)
      }
    }
    expect(session.history.canUndo).toBe(true)

    useWorkspace.getState().undo()

    expect(entry.color).toEqual(source)
    expect(session.history.canUndo).toBe(false)
    for (const frame of timeline.frames) {
      useWorkspace.getState().setActiveAnimationFrame(frame.id)
      for (const layerId of [active.id, other.id]) {
        const layer = document.layers.find((candidate) => candidate.id === layerId)!
        expect(readLayerColor(document, layer, 0)).toEqual(source)
        expect(readLayerColor(document, layer, 1)).toEqual(untouched)
      }
    }

    useWorkspace.getState().redo()
    expect(entry.color).toEqual(replacement)
  })

  it('updates indexed canvas colors through the palette without rewriting pixel ids', () => {
    localStorage.setItem('moonsprite.palette-edit-locked', 'false')
    localStorage.setItem('moonsprite.palette-sync-colors', 'true')
    const document = createDocument('palette color sync indexed', 1, 1, 'indexed')
    const layer = getActiveLayer(document)
    if (layer.format !== 'indexed') throw new Error('wrong layer mode')
    const entry = document.palette.find((candidate) => candidate.id !== 0)!
    const source = { ...entry.color }
    const replacement = { r: 201, g: 83, b: 47, a: 255 }
    layer.pixels[0] = entry.id
    useWorkspace.getState().addSession(document)
    useWorkspace.getState().selectPaletteColor(entry.id)
    const session = useWorkspace.getState().sessions[0]
    session.history.clear()
    const pixelId = layer.pixels[0]

    useWorkspace.getState().setPrimaryColor(replacement)

    expect(layer.pixels[0]).toBe(pixelId)
    expect(readLayerColor(document, layer, 0)).toEqual(replacement)
    useWorkspace.getState().undo()
    expect(layer.pixels[0]).toBe(pixelId)
    expect(readLayerColor(document, layer, 0)).toEqual(source)
  })
})
