import { describe, expect, it } from 'vitest'
import { createDocument, getActiveLayer, readLayerPacked } from './document'
import { beginPixelEdit, commitPixelEdit, HistoryStack, recordPixel, recordPixelKnownCurrent } from './history'

const entry = (state: { value: number }, next: number, label = 'edit') => ({
  label,
  bytes: 10,
  undo: () => { state.value -= 1 },
  redo: () => { state.value = next }
})

describe('HistoryStack', () => {
  it('commits known-current pixel writes without retaining reverted pixels', () => {
    const document = createDocument('pixel history', 3, 2, 'rgba')
    const layer = getActiveLayer(document)
    const edit = beginPixelEdit(layer.id)
    const blue = 0xfff07929

    recordPixelKnownCurrent(document, layer, edit, 0, 0, blue)
    recordPixel(document, layer, edit, 1, blue)
    recordPixel(document, layer, edit, 0, 0)

    expect(edit.dirtyRect).toEqual({ x: 0, y: 0, width: 2, height: 1 })
    const committed = commitPixelEdit(document, edit, 'paint')!
    expect(committed.bytes).toBe(16)
    expect(committed.invalidation).toEqual({ kind: 'region', frameId: document.animation?.activeFrameId, rect: { x: 0, y: 0, width: 2, height: 1 } })

    committed.undo()
    expect(readLayerPacked(document, layer, 0)).toBe(0)
    expect(readLayerPacked(document, layer, 1)).toBe(0)
    committed.redo()
    expect(readLayerPacked(document, layer, 0)).toBe(0)
    expect(readLayerPacked(document, layer, 1)).toBe(blue)
  })

  it('keeps memory accounting consistent across undo and redo', () => {
    const state = { value: 1 }
    const history = new HistoryStack()
    history.push(entry(state, 2))
    expect(history.memoryBytes).toBe(10)
    history.undo()
    expect(history.memoryBytes).toBe(0)
    history.redo()
    expect(history.memoryBytes).toBe(10)
  })

  it('preserves an entry when undo or redo throws', () => {
    const history = new HistoryStack()
    history.push({ label: 'bad undo', bytes: 7, undo: () => { throw new Error('undo') }, redo: () => undefined })
    expect(() => history.undo()).toThrow('undo')
    expect(history.canUndo).toBe(true)
    expect(history.memoryBytes).toBe(7)

    history.clear()
    history.push({ label: 'bad redo', bytes: 9, undo: () => undefined, redo: () => { throw new Error('redo') } })
    history.undo()
    expect(() => history.redo()).toThrow('redo')
    expect(history.canRedo).toBe(true)
    expect(history.memoryBytes).toBe(0)
  })

  it('clears both directions and compound state', () => {
    const history = new HistoryStack()
    history.beginCompound()
    history.push({ label: 'part', bytes: 2, undo: () => undefined, redo: () => undefined })
    history.clear()
    history.endCompound('ignored')
    expect(history.canUndo).toBe(false)
    expect(history.canRedo).toBe(false)
    expect(history.memoryBytes).toBe(0)
  })
})
