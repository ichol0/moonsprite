import { describe, expect, it } from 'vitest'
import { createDocument, createLayer, expandLayerToRect, getActiveLayer, readLayerPacked } from './document'
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
    expect(committed.affectedLayerIds).toEqual([layer.id])
    expect(committed.invalidation).toEqual({ kind: 'region', frameId: document.animation?.activeFrameId, rect: { x: 0, y: 0, width: 2, height: 1 } })

    committed.undo()
    expect(readLayerPacked(document, layer, 0)).toBe(0)
    expect(readLayerPacked(document, layer, 1)).toBe(0)
    committed.redo()
    expect(readLayerPacked(document, layer, 0)).toBe(0)
    expect(readLayerPacked(document, layer, 1)).toBe(blue)
  })

  it('stores dense RGBA edits as contiguous row patches across later layer expansion', () => {
    const document = createDocument('dense rgba history', 64, 64, 'rgba')
    const layer = getActiveLayer(document)
    const edit = beginPixelEdit(layer.id)
    const blue = 0xfff07929

    for (let y = 12; y < 36; y += 1) for (let x = 10; x < 42; x += 1) {
      recordPixel(document, layer, edit, y * layer.width + x, blue)
    }
    const committed = commitPixelEdit(document, edit, 'dense paint')!
    expect(committed.bytes).toBe(32 * 24 * 8)

    expect(expandLayerToRect(layer, -8, -6, 64, 64)).toBe(true)
    committed.undo()
    expect(readLayerPacked(document, layer, (12 - layer.offsetY) * layer.width + 10 - layer.offsetX)).toBe(0)
    committed.redo()
    expect(readLayerPacked(document, layer, (35 - layer.offsetY) * layer.width + 41 - layer.offsetX)).toBe(blue)
  })

  it('stores dense indexed edits in native row patches', () => {
    const document = createDocument('dense indexed history', 48, 48, 'indexed')
    const layer = getActiveLayer(document)
    const edit = beginPixelEdit(layer.id)

    for (let y = 8; y < 28; y += 1) for (let x = 6; x < 34; x += 1) {
      recordPixel(document, layer, edit, y * layer.width + x, 1)
    }
    const committed = commitPixelEdit(document, edit, 'dense indexed paint')!
    expect(committed.bytes).toBe(28 * 20 * 8)

    committed.undo()
    expect(readLayerPacked(document, layer, 8 * layer.width + 6)).toBe(0)
    committed.redo()
    expect(readLayerPacked(document, layer, 27 * layer.width + 33)).toBe(1)
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

  it('combines affected layers for compound pixel history', () => {
    const document = createDocument('compound layers', 1, 1, 'rgba')
    const firstLayer = getActiveLayer(document)
    const secondLayer = createLayer('Second', 1, 1, 'rgba')
    document.layers.push(secondLayer)
    const first = beginPixelEdit(firstLayer.id)
    const second = beginPixelEdit(secondLayer.id)
    recordPixel(document, firstLayer, first, 0, 0xff0000ff)
    recordPixel(document, secondLayer, second, 0, 0xffff0000)
    const history = new HistoryStack()

    history.beginCompound()
    history.push(commitPixelEdit(document, first, 'first')!)
    history.push(commitPixelEdit(document, second, 'second')!)
    history.endCompound('both')

    const committed = history.undo()!
    expect(committed.affectedLayerIds).toEqual([firstLayer.id, secondLayer.id])
  })

  it('merges an anchor stroke and its connected line into one undo step', () => {
    const state = { value: 2 }
    const history = new HistoryStack()
    const anchor = entry(state, 1, 'anchor')
    const line = entry(state, 2, 'line')
    history.push(anchor)
    history.push(line)

    expect(history.latestUndoEntry).toBe(line)
    expect(history.mergeLastTwo('connected line')).toMatchObject({ label: 'connected line', bytes: 20 })
    expect(history.latestUndoEntry).not.toBe(line)

    history.undo()
    expect(state.value).toBe(0)
    history.redo()
    expect(state.value).toBe(2)
  })

  it('keeps compound metadata-only history outside content and animation refreshes', () => {
    const history = new HistoryStack()
    history.beginCompound()
    history.push({ label: 'lock', bytes: 8, undo: () => undefined, redo: () => undefined, contentChanged: false, requiresAnimationSync: false })
    history.push({ label: 'rename', bytes: 8, undo: () => undefined, redo: () => undefined, contentChanged: false, requiresAnimationSync: false })
    history.endCompound('metadata')

    expect(history.undo()).toMatchObject({ contentChanged: false, requiresAnimationSync: false })
  })

  it('keeps session-only entries out of compound document metadata', () => {
    const history = new HistoryStack()
    history.beginCompound()
    history.push({ label: 'selection', bytes: 8, undo: () => undefined, redo: () => undefined, documentChanged: false })
    history.push({ label: 'rename', bytes: 8, undo: () => undefined, redo: () => undefined, contentChanged: false, requiresAnimationSync: false })
    history.endCompound('mixed')

    expect(history.undo()).toMatchObject({ documentChanged: true, contentChanged: false, requiresAnimationSync: false })
  })
})
