import { beforeEach, describe, expect, it } from 'vitest'
import { createDocument, getActiveLayer, readLayerColor, writeLayerColor } from '@/core/document'
import type { AdjustmentPreviewResult } from '@/core/adjustment-preview-protocol'
import { useWorkspace } from './workspace'

beforeEach(() => useWorkspace.setState({ sessions: [], activeId: null, message: null, saveProgress: null, dialog: null }))

describe('workspace adjustment previews', () => {
  it('applies a worker result with regional invalidation without dirtying the document', () => {
    const document = createDocument('regional worker preview', 4, 1, 'rgba')
    const layer = getActiveLayer(document)
    for (let index = 0; index < 4; index += 1) writeLayerColor(document, layer, index, { r: index * 20, g: 10, b: 10, a: 255 })
    document.dirty = false
    useWorkspace.getState().addSession(document)
    const baseline = useWorkspace.getState().captureActiveLayerAdjustmentSnapshot()!
    const result: AdjustmentPreviewResult = {
      id: 1,
      region: { x: 1, y: 0, width: 2, height: 1 },
      palette: baseline.palette,
      nextColorId: baseline.nextColorId,
      layers: [{
        layerId: layer.id,
        x: 1,
        y: 0,
        width: 2,
        height: 1,
        format: 'rgba',
        localContentBounds: { x: 0, y: 0, width: 4, height: 1 },
        pixels: new Uint8ClampedArray([90, 10, 10, 255, 110, 10, 10, 255])
      }]
    }

    useWorkspace.getState().applyActiveLayerAdjustmentPreviewResult(baseline, result)

    const session = useWorkspace.getState().sessions[0]
    expect(readLayerColor(document, layer, 0).r).toBe(0)
    expect(readLayerColor(document, layer, 1).r).toBe(90)
    expect(readLayerColor(document, layer, 2).r).toBe(110)
    expect(readLayerColor(document, layer, 3).r).toBe(60)
    expect(session.contentInvalidation).toEqual({
      kind: 'region',
      frameId: document.animation?.activeFrameId,
      rect: { x: 1, y: 0, width: 2, height: 1 },
      fromRevision: 0,
      revision: 1
    })
    expect(document.dirty).toBe(false)
  })

  it('cancels only preview-touched rows and preserves pixels outside the preview region', () => {
    const document = createDocument('regional preview cancel', 4, 1, 'rgba')
    const layer = getActiveLayer(document)
    for (let index = 0; index < 4; index += 1) writeLayerColor(document, layer, index, { r: 20 + index * 20, g: 10, b: 10, a: 255 })
    document.dirty = false
    useWorkspace.getState().addSession(document)
    const baseline = useWorkspace.getState().captureActiveLayerAdjustmentSnapshot()!
    const result: AdjustmentPreviewResult = {
      id: 3,
      region: { x: 1, y: 0, width: 2, height: 1 },
      palette: baseline.palette,
      nextColorId: baseline.nextColorId,
      layers: [{
        layerId: layer.id,
        x: 1,
        y: 0,
        width: 2,
        height: 1,
        format: 'rgba',
        localContentBounds: { x: 0, y: 0, width: 4, height: 1 },
        pixels: new Uint8ClampedArray([120, 10, 10, 255, 140, 10, 10, 255])
      }]
    }
    useWorkspace.getState().applyActiveLayerAdjustmentPreviewResult(baseline, result)
    const previewStorage = layer.pixels
    writeLayerColor(document, layer, 3, { r: 240, g: 10, b: 10, a: 255 })

    useWorkspace.getState().restoreActiveDocumentSnapshot(baseline, [result.region])

    expect(layer.pixels).toBe(previewStorage)
    expect(readLayerColor(document, layer, 0).r).toBe(20)
    expect(readLayerColor(document, layer, 1).r).toBe(40)
    expect(readLayerColor(document, layer, 2).r).toBe(60)
    expect(readLayerColor(document, layer, 3).r).toBe(240)
    expect(useWorkspace.getState().sessions[0].contentInvalidation).toMatchObject({
      kind: 'region',
      rect: result.region
    })
    expect(useWorkspace.getState().sessions[0].history.canUndo).toBe(false)
    expect(document.dirty).toBe(false)
  })

  it('reuses a complete worker preview for commit and preserves undo and redo', () => {
    const document = createDocument('complete worker preview', 2, 1, 'rgba')
    const layer = getActiveLayer(document)
    writeLayerColor(document, layer, 0, { r: 20, g: 20, b: 20, a: 255 })
    writeLayerColor(document, layer, 1, { r: 40, g: 40, b: 40, a: 255 })
    useWorkspace.getState().addSession(document)
    const baseline = useWorkspace.getState().captureActiveLayerAdjustmentSnapshot()!
    const result: AdjustmentPreviewResult = {
      id: 2,
      region: { x: 0, y: 0, width: 2, height: 1 },
      palette: baseline.palette,
      nextColorId: baseline.nextColorId,
      layers: [{
        layerId: layer.id,
        x: 0,
        y: 0,
        width: 2,
        height: 1,
        format: 'rgba',
        localContentBounds: { x: 0, y: 0, width: 2, height: 1 },
        pixels: new Uint8ClampedArray([77, 20, 20, 255, 99, 40, 40, 255])
      }]
    }
    useWorkspace.getState().applyActiveLayerAdjustmentPreviewResult(baseline, result)
    const previewRevision = useWorkspace.getState().sessions[0].contentRevision

    useWorkspace.getState().applyActiveLayerAdjustmentFromSnapshot({ kind: 'brightness-contrast', brightness: 20 }, baseline, result)
    expect(readLayerColor(document, layer, 0).r).toBe(77)
    expect(readLayerColor(document, layer, 1).r).toBe(99)
    expect(document.dirty).toBe(true)
    expect(useWorkspace.getState().sessions[0].contentRevision).toBe(previewRevision)
    expect(useWorkspace.getState().sessions[0].contentInvalidation).toMatchObject({
      kind: 'region',
      rect: { x: 0, y: 0, width: 2, height: 1 }
    })

    useWorkspace.getState().undo()
    expect(readLayerColor(document, layer, 0).r).toBe(20)
    expect(readLayerColor(document, layer, 1).r).toBe(40)
    expect(useWorkspace.getState().sessions[0].contentRevision).toBe(previewRevision + 1)
    expect(useWorkspace.getState().sessions[0].contentInvalidation).toMatchObject({
      kind: 'region',
      rect: { x: 0, y: 0, width: 2, height: 1 }
    })
    useWorkspace.getState().redo()
    expect(readLayerColor(document, layer, 0).r).toBe(77)
    expect(readLayerColor(document, layer, 1).r).toBe(99)
    expect(useWorkspace.getState().sessions[0].contentRevision).toBe(previewRevision + 2)
  })
})
