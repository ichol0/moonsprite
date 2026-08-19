import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { MoonSpriteApi } from '@shared/types'
import { animationMaskAt, compositeDocument, createDocument, createLayer, createLayerMask, ensureLayerCoversCanvas, getActiveLayer, isLayerEffectivelyLocked, isLayerEffectivelyVisible, layerContentBounds, readLayerColor, readLayerColorAt, writeLayerColor } from '@/core/document'
import { beginPixelEdit, recordPixel, revertPixelEdit } from '@/core/history'
import { packColor, relativeLuminanceColor } from '@/core/raster'
import { applySelectionTransform, applySelectionTranslationPreview, captureSelectionTransform, paintBrush, selectionTranslationPreviewEdit } from '@/core/tools'
import { builtInPalettes } from '@/core/built-in-palettes'
import { createProceduralBrush } from '@/core/brushes'
import { brushLibraryLocation } from '@/core/brush-library-location'
import { addBlankAnimationFrame, animationCelAt, animationCelHasContent, animationCelKey, ensureAnimationDocument, resolveAnimationCel, setAnimationCelOffsetsForKeys } from '@/core/animation'
import { buildLayerPanelTree } from '@/core/layer-panel-layout'
import { transformedSelectionBounds, transformSelectionMask } from '@/core/selection'
import { registerViewPreviewFlusher } from '@/core/view-preview-lifecycle'
import { registerPendingCanvasGestureHistory } from '@/core/canvas-input'
import { RECENT_EXPORT_PATHS_STORAGE_KEY } from '@/core/export-settings'
import { decodeProject, encodeProject, registerProjectSaveBaseline } from '@/core/project-format'
import { LAYER_PANEL_STATE_STORAGE_KEY } from '@/core/layer-panel-state'
import { saveProgress } from '@/core/save-progress'
import { repositionPaletteSlots } from '@/core/palette-layout'
import { decodePng } from '@/core/png'
import { createDefaultLayerStyles } from '@/core/layer-styles'
import { useWorkspace } from './workspace'

const transparent = { r: 0, g: 0, b: 0, a: 0 }
const red = { r: 255, g: 0, b: 0, a: 255 }
const blue = { r: 0, g: 80, b: 255, a: 255 }

class MockTextCanvasContext {
  font = ''
  textBaseline: CanvasTextBaseline = 'alphabetic'
  fillStyle: string | CanvasGradient | CanvasPattern = ''
  private drawX = 0
  private drawY = 0
  measureText(text: string): TextMetrics {
    return { width: text.length * 6, actualBoundingBoxAscent: 8, actualBoundingBoxDescent: 2 } as TextMetrics
  }
  fillText(_text: string, x: number, y: number): void { this.drawX = Math.round(x); this.drawY = Math.round(y) }
  getImageData(_x: number, _y: number, width: number, height: number): ImageData {
    const data = new Uint8ClampedArray(width * height * 4)
    const offset = (this.drawY * width + this.drawX) * 4
    if (offset >= 0 && offset + 3 < data.length) data.set([12, 34, 56, 255], offset)
    return { data, width, height, colorSpace: 'srgb' } as ImageData
  }
}

class MockTextCanvas {
  private readonly context = new MockTextCanvasContext()
  constructor(public width: number, public height: number) {}
  getContext(): MockTextCanvasContext { return this.context }
}

const textData = (text: string, color = { r: 12, g: 34, b: 56, a: 255 }) => ({
  text,
  fontFamily: 'Consolas',
  fontSize: 16,
  lineSpacing: 0,
  letterSpacing: 0,
  spacingMode: 'font' as const,
  antialias: 'pixel' as const,
  color
})

function installApi(overrides: Partial<MoonSpriteApi> = {}): MoonSpriteApi {
  const api = {
    getResourceInfo: vi.fn(async () => ({ totalBytes: 8_000_000_000, freeBytes: 4_000_000_000 })),
    writeClipboardImage: vi.fn(async () => {}),
    writeProjectIncremental: vi.fn(async () => {}),
    readClipboardImage: vi.fn(async () => null),
    writeRecovery: vi.fn(async () => {}),
    deleteRecovery: vi.fn(async () => {}),
    ...overrides
  } as unknown as MoonSpriteApi
  Object.defineProperty(window, 'moonSprite', { configurable: true, writable: true, value: api })
  return api
}

beforeEach(() => {
  installApi()
  vi.stubGlobal('OffscreenCanvas', MockTextCanvas)
  localStorage.clear()
  brushLibraryLocation.set(null)
  saveProgress.dismiss()
  useWorkspace.setState({ sessions: [], activeId: null, message: null, saveProgress: null, dialog: null })
})

describe('symmetry axis placement', () => {
  it('uses the canvas center only when each axis is enabled for the first time', () => {
    const document = createDocument('symmetry pointer', 16, 12, 'rgba')
    useWorkspace.getState().addSession(document)

    useWorkspace.getState().setSymmetryCenter({ x: 3.5, y: 4.5 })
    useWorkspace.getState().setSymmetryAxis('horizontal', true)
    expect(useWorkspace.getState().sessions[0].symmetryCenter).toEqual({ x: 8, y: 6 })

    useWorkspace.getState().setSymmetryCenter({ x: 9.5, y: 8.5 })
    useWorkspace.getState().setSymmetryAxis('horizontal', false)
    useWorkspace.getState().setSymmetryAxis('horizontal', true)
    expect(useWorkspace.getState().sessions[0].symmetryCenter).toEqual({ x: 9.5, y: 8.5 })

    useWorkspace.getState().setSymmetryAxis('vertical', true)
    expect(useWorkspace.getState().sessions[0].symmetryCenter).toEqual({ x: 8, y: 6 })
  })

  it('tracks first-use placement independently for each open project', () => {
    const first = createDocument('first symmetry project', 20, 16, 'rgba')
    const second = createDocument('second symmetry project', 30, 24, 'rgba')
    useWorkspace.getState().addSession(first)
    useWorkspace.getState().addSession(second)

    useWorkspace.getState().setActive(first.id)
    useWorkspace.getState().setSymmetryCenter({ x: 2.5, y: 3.5 })
    useWorkspace.getState().setSymmetryAxis('diagonalUp', true)

    useWorkspace.getState().setActive(second.id)
    useWorkspace.getState().setSymmetryCenter({ x: 12.5, y: 13.5 })
    useWorkspace.getState().setSymmetryAxis('diagonalUp', true)

    expect(useWorkspace.getState().sessions.find((session) => session.document.id === first.id)?.symmetryCenter).toEqual({ x: 10, y: 8 })
    expect(useWorkspace.getState().sessions.find((session) => session.document.id === second.id)?.symmetryCenter).toEqual({ x: 15, y: 12 })
  })
})

describe('pending canvas gesture history', () => {
  it('consumes path undo and redo before the committed document history', () => {
    const document = createDocument('pending path history', 4, 4, 'rgba')
    useWorkspace.getState().addSession(document)
    const session = useWorkspace.getState().sessions[0]
    let documentUndo = 0
    let documentRedo = 0
    let gestureUndo = 0
    let gestureRedo = 0
    session.history.push({
      label: 'committed edit',
      bytes: 0,
      undo: () => { documentUndo += 1 },
      redo: () => { documentRedo += 1 },
      documentChanged: false
    })
    const unregister = registerPendingCanvasGestureHistory(document.id, {
      undo: () => { gestureUndo += 1; return true },
      redo: () => { gestureRedo += 1; return true }
    })

    try {
      useWorkspace.getState().undo()
      useWorkspace.getState().redo()
      expect({ gestureUndo, gestureRedo }).toEqual({ gestureUndo: 1, gestureRedo: 1 })
      expect({ documentUndo, documentRedo }).toEqual({ documentUndo: 0, documentRedo: 0 })
      expect(session.history.canUndo).toBe(true)
    } finally {
      unregister()
    }

    useWorkspace.getState().undo()
    useWorkspace.getState().redo()
    expect({ documentUndo, documentRedo }).toEqual({ documentUndo: 1, documentRedo: 1 })
  })
})

describe('editable text layers', () => {
  it('shows a draft text layer immediately and records history only when committed', () => {
    const document = createDocument('text draft', 32, 24, 'rgba')
    const originalLayerId = document.activeLayerId
    useWorkspace.getState().addSession(document)

    const draft = useWorkspace.getState().beginTextLayerDraft(textData('M'), 4, 6)
    expect(draft).not.toBeNull()
    expect(document.layers.find((layer) => layer.id === draft!.layerId)).toMatchObject({ kind: 'text', name: 'M' })
    expect(useWorkspace.getState().sessions[0].history.canUndo).toBe(false)

    useWorkspace.getState().updateTextLayerDraft(draft!.layerId, draft!.frameId, textData('Moon'), 4, 6)
    expect(animationCelAt(ensureAnimationDocument(document), draft!.layerId, draft!.frameId)?.text?.text).toBe('Moon')
    useWorkspace.getState().commitTextLayerDraft(draft!.layerId)
    expect(useWorkspace.getState().sessions[0].history.canUndo).toBe(true)
    useWorkspace.getState().undo()
    expect(document.layers.some((layer) => layer.id === draft!.layerId)).toBe(false)
    expect(document.activeLayerId).toBe(originalLayerId)
  })

  it('removes a cancelled draft text layer without adding history', () => {
    const document = createDocument('cancel text draft', 32, 24, 'rgba')
    const originalLayerId = document.activeLayerId
    useWorkspace.getState().addSession(document)

    const draft = useWorkspace.getState().beginTextLayerDraft(textData('Moon'), 4, 6)!
    useWorkspace.getState().cancelTextLayerDraft(draft.layerId)

    expect(document.layers.some((layer) => layer.id === draft.layerId)).toBe(false)
    expect(document.activeLayerId).toBe(originalLayerId)
    expect(useWorkspace.getState().sessions[0].history.canUndo).toBe(false)
  })

  it('blocks raster editing tools while a text layer is selected', () => {
    const document = createDocument('text tool boundary', 32, 24, 'rgba')
    useWorkspace.getState().addSession(document)
    useWorkspace.getState().createTextLayer(textData('Moon'), 4, 6)
    useWorkspace.getState().setTool('text')

    useWorkspace.getState().setTool('selection')
    expect(useWorkspace.getState().sessions[0].tool).toBe('text')
    expect(useWorkspace.getState().message).toBeTruthy()

    useWorkspace.getState().setTool('move')
    expect(useWorkspace.getState().sessions[0].tool).toBe('move')
  })

  it('creates, edits, converts, and restores editable text through history', () => {
    const document = createDocument('text history', 32, 24, 'rgba')
    const originalLayerId = document.activeLayerId
    useWorkspace.getState().addSession(document)

    useWorkspace.getState().createTextLayer(textData('Moon'), 5, 7)
    let layer = getActiveLayer(document)
    let cel = animationCelAt(ensureAnimationDocument(document), layer.id, ensureAnimationDocument(document).activeFrameId)!
    const textLayerId = layer.id
    expect(layer).toMatchObject({ id: textLayerId, kind: 'text', offsetX: 5, offsetY: 7 })
    expect(cel.text).toEqual({ ...textData('Moon'), originX: 5, originY: 7 })

    useWorkspace.getState().setTextCel(textLayerId, cel.frameId, textData('Sprite'), 9, 11)
    cel = animationCelAt(ensureAnimationDocument(document), textLayerId, cel.frameId)!
    expect(cel.text?.text).toBe('Sprite')
    expect(cel.surface).toMatchObject({ offsetX: 9, offsetY: 11 })
    useWorkspace.getState().undo()
    expect(animationCelAt(ensureAnimationDocument(document), textLayerId, cel.frameId)?.text?.text).toBe('Moon')
    useWorkspace.getState().redo()
    expect(animationCelAt(ensureAnimationDocument(document), textLayerId, cel.frameId)?.text?.text).toBe('Sprite')

    useWorkspace.getState().rasterizeLayer(textLayerId)
    expect(document.layers.find((candidate) => candidate.id === textLayerId)?.kind).toBeUndefined()
    expect(animationCelAt(ensureAnimationDocument(document), textLayerId, cel.frameId)?.text).toBeUndefined()
    useWorkspace.getState().undo()
    expect(document.layers.find((candidate) => candidate.id === textLayerId)?.kind).toBe('text')
    expect(animationCelAt(ensureAnimationDocument(document), textLayerId, cel.frameId)?.text?.text).toBe('Sprite')
    useWorkspace.getState().undo()
    useWorkspace.getState().undo()
    expect(document.layers.some((candidate) => candidate.id === textLayerId)).toBe(false)
    expect(document.activeLayerId).toBe(originalLayerId)
    useWorkspace.getState().redo()
    expect(document.layers.find((candidate) => candidate.id === textLayerId)?.kind).toBe('text')
  })

  it('preserves text cel metadata when duplicating a text layer', () => {
    const document = createDocument('text duplicate', 32, 24, 'rgba')
    useWorkspace.getState().addSession(document)
    useWorkspace.getState().createTextLayer(textData('Copy me'), 2, 3)
    const sourceLayerId = document.activeLayerId

    useWorkspace.getState().duplicateActiveLayer()

    const duplicate = getActiveLayer(document)
    const duplicateCel = animationCelAt(ensureAnimationDocument(document), duplicate.id, ensureAnimationDocument(document).activeFrameId)!
    expect(duplicate.id).not.toBe(sourceLayerId)
    expect(duplicate.kind).toBe('text')
    expect(duplicateCel.text).toEqual({ ...textData('Copy me'), originX: 2, originY: 3 })
  })

  it('deletes a selected text layer with the normal layer deletion command and restores it on undo', () => {
    const document = createDocument('text deletion', 32, 24, 'rgba')
    useWorkspace.getState().addSession(document)
    useWorkspace.getState().createTextLayer(textData('Delete me'), 2, 3)
    const textLayerId = document.activeLayerId
    const frameId = ensureAnimationDocument(document).activeFrameId

    useWorkspace.getState().deleteSelectedLayers()

    expect(document.layers.some((layer) => layer.id === textLayerId)).toBe(false)
    expect(animationCelAt(ensureAnimationDocument(document), textLayerId, frameId)).toBeNull()

    useWorkspace.getState().undo()
    expect(document.layers.find((layer) => layer.id === textLayerId)?.kind).toBe('text')
    expect(animationCelAt(ensureAnimationDocument(document), textLayerId, frameId)?.text?.text).toBe('Delete me')
  })

  it('keeps editable text at its moved cel position when it is edited again', () => {
    const document = createDocument('text movement', 64, 48, 'rgba')
    useWorkspace.getState().addSession(document)
    useWorkspace.getState().createTextLayer(textData('Moon'), 5, 7)
    const layer = getActiveLayer(document)
    const timeline = ensureAnimationDocument(document)
    const key = animationCelKey(layer.id, timeline.activeFrameId)

    setAnimationCelOffsetsForKeys(document, { [key]: { x: 19, y: 23 } })
    const cel = animationCelAt(timeline, layer.id, timeline.activeFrameId)!
    expect(cel.text).toMatchObject({ originX: 19, originY: 23 })

    useWorkspace.getState().setTextCel(layer.id, timeline.activeFrameId, { ...cel.text!, text: 'Sprite' }, cel.surface!.offsetX, cel.surface!.offsetY)
    expect(cel.surface).toMatchObject({ offsetX: 19, offsetY: 23 })
    expect(cel.text).toMatchObject({ text: 'Sprite', originX: 19, originY: 23 })
  })

  it('starts Ctrl+T selection transforms for editable text and keeps them through edit and history', () => {
    const document = createDocument('text transform', 64, 48, 'rgba')
    useWorkspace.getState().addSession(document)
    useWorkspace.getState().createTextLayer(textData('Moon'), 5, 7)
    const layer = getActiveLayer(document)
    const timeline = ensureAnimationDocument(document)
    const cel = animationCelAt(timeline, layer.id, timeline.activeFrameId)!

    useWorkspace.getState().beginLayerTransform()
    let session = useWorkspace.getState().sessions[0]
    const before = session.selection!
    expect(session.tool).toBe('selection')
    expect(before).toEqual(layerContentBounds(document, layer))

    const target = { ...before, x: 11, y: 13, width: 2, height: 3 }
    const source = captureSelectionTransform(document, before)!
    const preview = applySelectionTransform(document, source, target, 45)
    const transformed = transformSelectionMask(source.selection, target, document.width, document.height, 45, undefined, false)!
    useWorkspace.getState().beginFloatingSelectionTransform(source, preview, before, transformed, false, 'Transform text', null, target, 45)
    useWorkspace.getState().commitFloatingPaste()

    expect(cel.text?.transforms).toEqual([{ source: before, target, angle: 45 }])
    useWorkspace.getState().setTextCel(layer.id, timeline.activeFrameId, { ...cel.text!, text: 'Sprite' })
    const renderedBounds = transformedSelectionBounds(target, 45)
    expect(cel.surface).toMatchObject({ offsetX: renderedBounds.x, offsetY: renderedBounds.y })
    expect(cel.surface!.width).toBeGreaterThanOrEqual(renderedBounds.width)
    expect(cel.surface!.height).toBeGreaterThanOrEqual(renderedBounds.height)
    useWorkspace.getState().undo()
    useWorkspace.getState().undo()
    expect(cel.text?.transforms).toBeUndefined()
    useWorkspace.getState().redo()
    expect(cel.text?.transforms).toEqual([{ source: before, target, angle: 45 }])
  })

  it('resizes selected boxed text directly without adding an editable glyph transform', () => {
    const document = createDocument('boxed text transform', 64, 48, 'rgba')
    useWorkspace.getState().addSession(document)
    useWorkspace.getState().createTextLayer({ ...textData('MoonSprite'), boxWidth: 18, boxHeight: 14 }, 5, 7)
    const layer = getActiveLayer(document)
    const timeline = ensureAnimationDocument(document)
    const cel = animationCelAt(timeline, layer.id, timeline.activeFrameId)!

    useWorkspace.getState().beginLayerTransform()
    let session = useWorkspace.getState().sessions[0]
    expect(session.selection).toBeNull()
    expect(session.textBoxTransform).toBeNull()

    useWorkspace.getState().beginSelectedTextBoxTransform()
    session = useWorkspace.getState().sessions[0]
    expect(session.textBoxTransform?.bounds).toEqual({ x: 5, y: 7, width: 18, height: 14 })
    useWorkspace.getState().previewTextBoxTransform({ x: 8, y: 9, width: 24, height: 16 })
    expect(cel.text).toMatchObject({ originX: 8, originY: 9, boxWidth: 24, boxHeight: 16 })
    expect(cel.text?.transforms).toBeUndefined()
    useWorkspace.getState().cancelTextBoxTransform()
    expect(cel.text).toMatchObject({ originX: 5, originY: 7, boxWidth: 18, boxHeight: 14 })

    useWorkspace.getState().beginSelectedTextBoxTransform()
    useWorkspace.getState().previewTextBoxTransform({ x: 10, y: 11, width: 28, height: 18 })
    useWorkspace.getState().commitTextBoxTransform({ x: 10, y: 11, width: 28, height: 18 })
    session = useWorkspace.getState().sessions[0]
    expect(session.textBoxTransform).toBeNull()
    expect(cel.text).toMatchObject({ originX: 10, originY: 11, boxWidth: 28, boxHeight: 18 })
    expect(cel.text?.transforms).toBeUndefined()
    useWorkspace.getState().undo()
    expect(cel.text).toMatchObject({ originX: 5, originY: 7, boxWidth: 18, boxHeight: 14 })
    useWorkspace.getState().redo()
    expect(cel.text).toMatchObject({ originX: 10, originY: 11, boxWidth: 28, boxHeight: 18 })
  })

  it('restores text preview pixels without adding history', () => {
    const document = createDocument('text preview', 32, 24, 'rgba')
    useWorkspace.getState().addSession(document)
    useWorkspace.getState().createTextLayer(textData('Moon'), 2, 3)
    const layer = getActiveLayer(document)
    const timeline = ensureAnimationDocument(document)
    const cel = animationCelAt(timeline, layer.id, timeline.activeFrameId)!
    const originalWidth = cel.surface!.width

    const preview = useWorkspace.getState().previewTextCel(layer.id, timeline.activeFrameId, textData('MoonSprite'), 2, 3)
    expect(preview).not.toBeNull()
    expect(cel.surface!.width).toBeGreaterThan(originalWidth)
    expect(cel.text?.text).toBe('MoonSprite')
    useWorkspace.getState().restoreTextCelPreview(layer.id, timeline.activeFrameId, preview!)
    expect(cel.surface!.width).toBe(originalWidth)
    expect(cel.text?.text).toBe('Moon')
    useWorkspace.getState().undo()
    expect(document.layers.some((candidate) => candidate.id === layer.id)).toBe(false)
  })

  it('rejects text cel paste into a raster layer and raster cel paste into a text layer', () => {
    const document = createDocument('text cel boundary', 32, 24, 'rgba')
    const rasterLayerId = document.activeLayerId
    useWorkspace.getState().addSession(document)
    useWorkspace.getState().createTextLayer(textData('Text'), 1, 1)
    const textLayerId = document.activeLayerId
    const timeline = ensureAnimationDocument(document)
    const frameId = timeline.activeFrameId

    useWorkspace.getState().selectAnimationCell(animationCelKey(textLayerId, frameId))
    useWorkspace.getState().copySelectedAnimationCels()
    useWorkspace.getState().selectAnimationCell(animationCelKey(rasterLayerId, frameId))
    useWorkspace.getState().pasteAnimationCels()
    expect(animationCelAt(timeline, rasterLayerId, frameId)?.text).toBeUndefined()

    useWorkspace.getState().selectAnimationCell(animationCelKey(rasterLayerId, frameId))
    useWorkspace.getState().copySelectedAnimationCels()
    useWorkspace.getState().selectAnimationCell(animationCelKey(textLayerId, frameId))
    useWorkspace.getState().pasteAnimationCels()
    expect(animationCelAt(timeline, textLayerId, frameId)?.text?.text).toBe('Text')
  })
})

describe('tool availability', () => {
  it('blocks the fill tool while a layer group is selected', () => {
    const document = createDocument('group fill boundary', 8, 8, 'rgba')
    const layer = getActiveLayer(document)
    document.groups.push({ id: 'group', name: '组', parentGroupId: null, visible: true, locked: false, opacity: 1, blendMode: 'normal' })
    layer.groupId = 'group'
    useWorkspace.getState().addSession(document)
    useWorkspace.getState().selectGroup('group')
    useWorkspace.getState().setTool('move')

    useWorkspace.getState().setTool('fill')
    expect(useWorkspace.getState().sessions[0].tool).toBe('move')
    expect(useWorkspace.getState().message).toBe('选择图层组时无法使用填充工具。')

    useWorkspace.getState().setTool('selection')
    expect(useWorkspace.getState().sessions[0].tool).toBe('selection')
  })
})

describe('gradient tool settings', () => {
  it('keeps gradient tolerance and contiguous mode independent from the paint bucket', () => {
    const document = createDocument('gradient settings', 2, 2, 'rgba')
    useWorkspace.getState().addSession(document)
    useWorkspace.getState().setFillTolerance(24)
    useWorkspace.getState().setFillMode('global')
    useWorkspace.getState().setGradientTolerance(86)
    useWorkspace.getState().setGradientContiguous(false)

    expect(useWorkspace.getState().sessions[0]).toMatchObject({
      fillTolerance: 24,
      fillMode: 'global',
      gradientTolerance: 86,
      gradientContiguous: false
    })
  })
})

describe('pixel content invalidation', () => {
  it('limits full-selection deletion to the active layer content bounds', () => {
    const document = createDocument('bounded full delete', 4000, 4000, 'rgba')
    useWorkspace.getState().addSession(document)
    const layer = getActiveLayer(document)
    layer.width = 2
    layer.height = 1
    layer.offsetX = 1700
    layer.offsetY = 1900
    layer.pixels = new Uint8ClampedArray([red.r, red.g, red.b, red.a, blue.r, blue.g, blue.b, blue.a])
    useWorkspace.getState().setSelection({ x: 0, y: 0, width: document.width, height: document.height })

    useWorkspace.getState().deleteSelection()

    let session = useWorkspace.getState().sessions[0]
    expect(session.contentInvalidation).toEqual(expect.objectContaining({
      kind: 'region',
      rect: { x: 1700, y: 1900, width: 2, height: 1 }
    }))
    expect(readLayerColorAt(document, layer, 1700, 1900)).toEqual(transparent)
    expect(readLayerColorAt(document, layer, 1701, 1900)).toEqual(transparent)

    useWorkspace.getState().undo()
    session = useWorkspace.getState().sessions[0]
    expect(session.contentInvalidation).toEqual(expect.objectContaining({
      kind: 'region',
      rect: { x: 1700, y: 1900, width: 2, height: 1 }
    }))
    expect(readLayerColorAt(document, layer, 1700, 1900)).toEqual(red)
    expect(readLayerColorAt(document, layer, 1701, 1900)).toEqual(blue)
  })

  it('limits live layer-style previews to the style-expanded content bounds', () => {
    const document = createDocument('bounded style preview', 200, 160, 'rgba')
    useWorkspace.getState().addSession(document)
    const layer = getActiveLayer(document)
    layer.width = 2
    layer.height = 1
    layer.offsetX = 40
    layer.offsetY = 30
    layer.pixels = new Uint8ClampedArray([red.r, red.g, red.b, red.a, blue.r, blue.g, blue.b, blue.a])
    const styles = createDefaultLayerStyles()
    styles.shadow = { ...styles.shadow, enabled: true, offsetX: 2, offsetY: 2, blur: 3 }

    useWorkspace.getState().previewLayerStyles('layer', layer.id, styles)

    expect(useWorkspace.getState().sessions[0].contentInvalidation).toEqual({
      kind: 'region',
      rect: { x: 39, y: 29, width: 8, height: 7 },
      fromRevision: 0,
      revision: 1
    })
  })

  it('tracks the edited document region for commit, undo, and redo', () => {
    const document = createDocument('dirty region', 8, 6, 'rgba')
    const layer = getActiveLayer(document)
    useWorkspace.getState().addSession(document)
    const edit = beginPixelEdit(layer.id)
    recordPixel(document, layer, edit, 2 + 1 * layer.width, 0xff0000ff)
    recordPixel(document, layer, edit, 5 + 4 * layer.width, 0xff0000ff)

    useWorkspace.getState().commitPixelEdit(edit, 'paint')
    let session = useWorkspace.getState().sessions[0]
    expect(session.contentInvalidation).toEqual({
      kind: 'region',
      frameId: document.animation!.activeFrameId,
      rect: { x: 2, y: 1, width: 4, height: 4 },
      fromRevision: 0,
      revision: 1
    })

    useWorkspace.getState().undo()
    session = useWorkspace.getState().sessions[0]
    expect(session.contentInvalidation).toMatchObject({ kind: 'region', rect: { x: 2, y: 1, width: 4, height: 4 }, fromRevision: 1, revision: 2 })

    useWorkspace.getState().redo()
    session = useWorkspace.getState().sessions[0]
    expect(session.contentInvalidation).toMatchObject({ kind: 'region', rect: { x: 2, y: 1, width: 4, height: 4 }, fromRevision: 2, revision: 3 })
  })

  it('creates, edits, deletes, and restores a mask owned by one animation cell', () => {
    const document = createDocument('mask history', 1, 1, 'rgba')
    getActiveLayer(document).pixels[3] = 255
    const cel = ensureAnimationDocument(document).cels[0]
    useWorkspace.getState().addSession(document)
    useWorkspace.getState().createLayerMask(cel.id)
    const mask = cel.mask!
    const maskKey = animationCelKey(cel.layerId, cel.frameId)
    useWorkspace.getState().selectAnimationMaskCell(maskKey)
    expect(readLayerColor(document, mask, 0)).toEqual(transparent)
    expect(useWorkspace.getState().sessions[0]).toMatchObject({ activeLayerMaskId: mask.id, layerMaskIsolatedView: false })
    const edit = beginPixelEdit(mask.id)
    recordPixel(document, mask, edit, 0, packColor({ r: 255, g: 0, b: 0, a: 255 }))

    useWorkspace.getState().commitPixelEdit(edit, 'paint mask')
    let session = useWorkspace.getState().sessions[0]
    expect(session.activeLayerMaskId).toBe(mask.id)
    expect(session.selectedAnimationMaskCellKeys).toEqual([maskKey])
    expect(readLayerColor(document, mask, 0)).toEqual({ r: 54, g: 54, b: 54, a: 255 })
    expect(session.contentInvalidation).toMatchObject({ kind: 'region', frameId: cel.frameId })

    useWorkspace.getState().undo()
    expect(readLayerColor(document, mask, 0)).toEqual(transparent)
    useWorkspace.getState().redo()
    expect(readLayerColor(document, mask, 0)).toEqual({ r: 54, g: 54, b: 54, a: 255 })

    useWorkspace.getState().deleteLayerMask(cel.id)
    expect(cel.mask).toBeUndefined()
    expect(useWorkspace.getState().sessions[0].activeLayerMaskId).toBeNull()
    useWorkspace.getState().undo()
    session = useWorkspace.getState().sessions[0]
    expect(cel.mask?.id).toBe(mask.id)
    expect(session.activeLayerMaskId).toBe(mask.id)
  })

  it('rejects layer-mask creation and paste targets whose cels have no visible content', () => {
    const document = createDocument('empty mask target', 1, 1, 'rgba')
    useWorkspace.getState().addSession(document)
    const timeline = ensureAnimationDocument(document)
    const firstCel = timeline.cels[0]

    useWorkspace.getState().createLayerMask(firstCel.id)
    expect(firstCel.mask).toBeUndefined()
    expect(useWorkspace.getState().message).toBe('图层单元格没有可见内容，无法创建或粘贴图层蒙版。')

    firstCel.surface!.pixels[3] = 255
    getActiveLayer(document).pixels[3] = 255
    useWorkspace.getState().createLayerMask(firstCel.id)
    useWorkspace.getState().copySelectedAnimationMasks()
    const emptyFrameId = addBlankAnimationFrame(document)
    const emptyCel = animationCelAt(ensureAnimationDocument(document), document.activeLayerId, emptyFrameId)!

    useWorkspace.getState().pasteAnimationMasks(document.activeLayerId, emptyFrameId)
    expect(emptyCel.mask).toBeUndefined()
  })

  it('creates masks for every populated frame in a layer and undoes them as one operation', () => {
    const document = createDocument('layer mask batch', 1, 1, 'rgba')
    getActiveLayer(document).pixels.set([20, 40, 60, 255])
    useWorkspace.getState().addSession(document)
    useWorkspace.getState().duplicateAnimationFrame()
    useWorkspace.getState().addAnimationFrame()
    const timeline = ensureAnimationDocument(document)
    const layerId = document.activeLayerId
    const cels = timeline.frames.map((frame) => animationCelAt(timeline, layerId, frame.id)!)
    cels[1].surface!.pixels.set([80, 100, 120, 255])
    const existingMask = createLayerMask(cels[0].id, 1, 1)
    cels[0].mask = existingMask

    useWorkspace.getState().createLayerMasksForLayer(layerId)

    expect(cels[0].mask).toBe(existingMask)
    expect(cels[1].mask).toBeDefined()
    expect(cels[2].mask).toBeUndefined()
    const createdMask = cels[1].mask
    useWorkspace.getState().undo()
    expect(cels[0].mask).toBe(existingMask)
    expect(cels[1].mask).toBeUndefined()
    useWorkspace.getState().redo()
    expect(cels[0].mask).toBe(existingMask)
    expect(cels[1].mask).toBe(createdMask)
  })

  it('creates, edits, and restores a frame-specific layer-group mask', () => {
    const document = createDocument('group mask history', 1, 1, 'rgba')
    const group = { id: 'group-1', name: 'Group', visible: true, locked: false, opacity: 1, blendMode: 'normal' as const }
    document.groups.push(group)
    document.layers[0].groupId = group.id
    useWorkspace.getState().addSession(document)
    const frameId = ensureAnimationDocument(document).activeFrameId

    useWorkspace.getState().createGroupMask(group.id, frameId)
    const mask = ensureAnimationDocument(document).groupMasks?.[0]?.mask
    expect(mask).toMatchObject({ ownerKind: 'group', ownerId: group.id })
    const edit = beginPixelEdit(mask!.id)
    recordPixel(document, mask!, edit, 0, packColor({ r: 0, g: 0, b: 0, a: 255 }))
    useWorkspace.getState().commitPixelEdit(edit, 'paint group mask')
    expect(useWorkspace.getState().sessions[0].activeLayerMaskId).toBe(mask!.id)
    expect(useWorkspace.getState().sessions[0].selectedAnimationMaskCellKeys).toEqual([animationCelKey(group.id, frameId)])

    useWorkspace.getState().deleteGroupMask(group.id, frameId)
    expect(ensureAnimationDocument(document).groupMasks).toEqual([])
    useWorkspace.getState().undo()
    expect(ensureAnimationDocument(document).groupMasks?.[0]?.mask.id).toBe(mask!.id)
  })

  it('copies, links, unlinks, pastes, and moves only layer-mask cells', () => {
    const document = createDocument('mask cell operations', 1, 1, 'rgba')
    const firstFrameId = ensureAnimationDocument(document).activeFrameId
    const secondFrameId = addBlankAnimationFrame(document)
    const thirdFrameId = addBlankAnimationFrame(document)
    const timeline = ensureAnimationDocument(document)
    const cels = timeline.frames.map((frame) => animationCelAt(timeline, document.activeLayerId, frame.id)!)
    cels.forEach((cel, index) => {
      cel.surface!.pixels.set([10 + index, 20 + index, 30 + index, 255])
      cel.mask = createLayerMask(cel.id, 1, 1)
      cel.mask.pixels.set([40 + index * 80, 40 + index * 80, 40 + index * 80, 255])
    })
    const celPixelsBefore = cels.map((cel) => Array.from(cel.surface!.pixels))
    useWorkspace.getState().addSession(document)
    const firstKey = animationCelKey(document.activeLayerId, firstFrameId)
    const secondKey = animationCelKey(document.activeLayerId, secondFrameId)
    const thirdKey = animationCelKey(document.activeLayerId, thirdFrameId)

    useWorkspace.getState().selectAnimationMaskCell(firstKey)
    useWorkspace.getState().selectAnimationMaskCell(secondKey, 'toggle')
    useWorkspace.getState().connectSelectedAnimationMasks()
    expect(cels[1].mask?.linkedMaskId).toBe(cels[0].mask?.id)
    expect(animationMaskAt(timeline, document.activeLayerId, secondFrameId)?.pixels[0]).toBe(40)

    useWorkspace.getState().selectAnimationMaskCell(secondKey)
    useWorkspace.getState().disconnectSelectedAnimationMasks()
    expect(cels[1].mask?.linkedMaskId).toBeNull()
    expect(cels[1].mask?.pixels[0]).toBe(40)

    useWorkspace.getState().copySelectedAnimationMasks()
    useWorkspace.getState().pasteAnimationMasks(document.activeLayerId, thirdFrameId)
    expect(cels[2].mask?.pixels[0]).toBe(40)
    expect(cels[2].mask?.linkedMaskId).toBeNull()

    useWorkspace.getState().moveSelectedAnimationMasks(document.activeLayerId, firstFrameId, thirdKey)
    expect(cels[2].mask).toBeUndefined()
    expect(cels[0].mask?.pixels[0]).toBe(40)
    expect(cels.map((cel) => Array.from(cel.surface!.pixels))).toEqual(celPixelsBefore)
  })

  it('exits mask editing when switching to another frame', () => {
    const document = createDocument('mask frame switch', 2, 1, 'rgba')
    getActiveLayer(document).pixels[3] = 255
    useWorkspace.getState().addSession(document)
    const firstCel = ensureAnimationDocument(document).cels[0]
    useWorkspace.getState().createLayerMask(firstCel.id)
    useWorkspace.getState().duplicateAnimationFrame()
    const timeline = ensureAnimationDocument(document)

    expect(useWorkspace.getState().sessions[0].activeLayerMaskId).toBeNull()
    useWorkspace.getState().selectLayerMask(firstCel.id)
    expect(useWorkspace.getState().sessions[0].activeLayerMaskId).toBe(firstCel.mask?.id)

    useWorkspace.getState().setActiveAnimationFrame(timeline.frames[1].id)
    expect(useWorkspace.getState().sessions[0].activeLayerMaskId).toBeNull()
  })

  it('pastes external colors into the active cell mask using relative luminance', async () => {
    const source = { r: 208, g: 78, b: 41, a: 255 }
    installApi({ readClipboardImage: vi.fn(async () => ({ width: 1, height: 1, data: Uint8Array.from([source.r, source.g, source.b, source.a]) })) })
    const document = createDocument('mask paste', 1, 1, 'rgba')
    getActiveLayer(document).pixels[3] = 255
    useWorkspace.getState().addSession(document)
    const cel = ensureAnimationDocument(document).cels[0]
    useWorkspace.getState().createLayerMask(cel.id)
    const mask = cel.mask!

    await useWorkspace.getState().pasteSelection()

    expect(useWorkspace.getState().sessions[0].pendingPaste?.layerId).toBe(mask.id)
    expect(readLayerColor(document, mask, 0)).toEqual(relativeLuminanceColor(source))
    useWorkspace.getState().commitFloatingPaste()
    useWorkspace.getState().undo()
    expect(readLayerColor(document, mask, 0)).toEqual(transparent)
    useWorkspace.getState().redo()
    expect(readLayerColor(document, mask, 0)).toEqual(relativeLuminanceColor(source))
  })
})

describe('project-owned display and activity metadata', () => {
  it('restores grid visibility and settings when a project session is opened', () => {
    const document = createDocument('grid memory', 8, 8, 'rgba')
    document.displaySettings = { showPixelGrid: true, showGrid: true, grid: { x: 2, y: 3, width: 12, height: 14 } }

    useWorkspace.getState().addSession(document)

    const session = useWorkspace.getState().sessions[0]
    expect(session.view).toMatchObject({ showPixelGrid: true, showGrid: true, grid: { x: 2, y: 3, width: 12, height: 14 } })
    useWorkspace.getState().toggleGrid()
    expect(document.displaySettings?.showGrid).toBe(false)
    expect(document.dirty).toBe(true)
  })

  it('counts committed strokes and records timelapse frames while enabled', async () => {
    const document = createDocument('activity', 2, 1, 'rgba')
    const layer = getActiveLayer(document)
    useWorkspace.getState().addSession(document)
    useWorkspace.getState().setTimelapseSettings({ enabled: true, quality: 'low', fps: 12, speed: 8 })
    const initialFrames = document.timelapse?.snapshots.length ?? 0
    const first = beginPixelEdit(layer.id)
    recordPixel(document, layer, first, 0, 0xff0000ff)
    useWorkspace.getState().commitPixelEdit(first, 'paint', { stroke: true, durationMs: 250 })
    const second = beginPixelEdit(layer.id)
    recordPixel(document, layer, second, 1, 0xffff0000)
    useWorkspace.getState().commitPixelEdit(second, 'paint again', { stroke: true, durationMs: 150 })

    expect(document.statistics).toEqual({ strokeCount: 2, operationCount: 2, drawingTimeMs: 400 })
    await vi.waitFor(() => expect(document.timelapse?.snapshots).toHaveLength(initialFrames + 2))

    const third = beginPixelEdit(layer.id)
    recordPixel(document, layer, third, 0, 0x00ff00ff)
    useWorkspace.getState().commitPixelEdit(third, 'paint third', { stroke: true, durationMs: 80 })
    await vi.waitFor(() => expect(document.timelapse?.snapshots).toHaveLength(initialFrames + 3))
  })

  it('discards queued frames when the timelapse is cleared', async () => {
    const document = createDocument('clear queued timelapse', 2, 1, 'rgba')
    const layer = getActiveLayer(document)
    useWorkspace.getState().addSession(document)
    useWorkspace.getState().setTimelapseSettings({ enabled: true, quality: 'low' })
    const edit = beginPixelEdit(layer.id)
    recordPixel(document, layer, edit, 0, 0xff0000ff)
    useWorkspace.getState().commitPixelEdit(edit, 'paint')

    useWorkspace.getState().clearTimelapse()
    await Promise.resolve()
    await Promise.resolve()

    expect(document.timelapse?.snapshots).toHaveLength(0)
  })
})

it('stores shape ratios with at most one decimal place', () => {
  useWorkspace.getState().addSession(createDocument('shape ratio', 8, 8, 'rgba'))

  useWorkspace.getState().setShapeRatio({ width: 1.26, height: 3.94 })

  expect(useWorkspace.getState().sessions[0].shapeRatio).toEqual({ width: 1.3, height: 3.9 })
})

describe('keyboard layer navigation', () => {
  it('steps through layers in visual top-to-bottom order without creating history', () => {
    const document = createDocument('layer arrows', 1, 1, 'rgba')
    const bottom = getActiveLayer(document)
    const top = createLayer('Top', 1, 1, 'rgba')
    document.layers.push(top)
    useWorkspace.getState().addSession(document)

    useWorkspace.getState().stepLayerSelection(-1)
    expect(document.activeLayerId).toBe(top.id)
    useWorkspace.getState().stepLayerSelection(1)
    expect(document.activeLayerId).toBe(bottom.id)
    expect(useWorkspace.getState().sessions[0].history.canUndo).toBe(false)
  })
})

describe('animation workspace', () => {
  it('opens a dirty single-layer sprite sheet document containing every frame', async () => {
    const document = createDocument('animated', 2, 1, 'rgba')
    const layer = getActiveLayer(document)
    writeLayerColor(document, layer, 0, red)
    const secondFrameId = addBlankAnimationFrame(document)
    animationCelAt(ensureAnimationDocument(document), layer.id, secondFrameId)!.surface = {
      format: 'rgba',
      width: 2,
      height: 1,
      offsetX: 0,
      offsetY: 0,
      pixels: Uint8ClampedArray.from([
        0, 0, 0, 0,
        blue.r, blue.g, blue.b, blue.a
      ])
    }
    useWorkspace.getState().addSession(document)

    await expect(useWorkspace.getState().createSpriteSheetFromActive()).resolves.toBe(true)

    const state = useWorkspace.getState()
    expect(state.sessions).toHaveLength(2)
    expect(state.activeId).not.toBe(document.id)
    const sheet = state.sessions.find((session) => session.document.id === state.activeId)!.document
    expect(sheet).toMatchObject({ width: 4, height: 1, colorMode: 'rgba', dirty: true })
    expect(sheet.layers).toHaveLength(1)
    expect(ensureAnimationDocument(sheet).frames).toHaveLength(1)
    expect(Array.from(getActiveLayer(sheet).pixels)).toEqual([
      255, 0, 0, 255,
      0, 0, 0, 0,
      0, 0, 0, 0,
      0, 80, 255, 255
    ])
  })

  it('selects cel content and adds another cel content with undo support', () => {
    const document = createDocument('animation content selection', 3, 1, 'rgba')
    getActiveLayer(document).pixels[3] = 255
    useWorkspace.getState().addSession(document)
    useWorkspace.getState().addAnimationFrame()
    ensureLayerCoversCanvas(document, getActiveLayer(document))
    getActiveLayer(document).pixels[11] = 255
    const timeline = ensureAnimationDocument(document)
    const [firstFrame, secondFrame] = timeline.frames
    const firstKey = animationCelKey(document.activeLayerId, firstFrame.id)
    const secondKey = animationCelKey(document.activeLayerId, secondFrame.id)

    useWorkspace.getState().selectAnimationCelContent(firstKey)
    expect(useWorkspace.getState().sessions[0].selection).toMatchObject({ x: 0, y: 0, width: 1, height: 1 })
    expect(useWorkspace.getState().sessions[0].selectedAnimationCellKeys).toEqual([firstKey])

    useWorkspace.getState().selectAnimationCelContent(secondKey, true)
    expect(Array.from(useWorkspace.getState().sessions[0].selection?.mask ?? [])).toEqual([1, 0, 1])
    expect(useWorkspace.getState().sessions[0].selectedAnimationCellKeys).toEqual([secondKey])
    useWorkspace.getState().undo()
    expect(useWorkspace.getState().sessions[0].selection).toMatchObject({ x: 0, y: 0, width: 1, height: 1 })
  })

  it('keeps every sparse cel-content pixel when rotating an Alt-selected cell', () => {
    const document = createDocument('rotate cel content selection', 8, 8, 'rgba')
    const layer = getActiveLayer(document)
    writeLayerColor(document, layer, 2 * document.width + 2, red)
    writeLayerColor(document, layer, 3 * document.width + 3, blue)
    useWorkspace.getState().addSession(document)
    const key = animationCelKey(document.activeLayerId, ensureAnimationDocument(document).activeFrameId)

    useWorkspace.getState().selectAnimationCelContent(key)
    const selection = useWorkspace.getState().sessions[0].selection!
    const source = captureSelectionTransform(document, selection)!
    applySelectionTransform(document, source, selection, 45)

    expect(readLayerColorAt(document, layer, 3, 2)).toEqual(red)
    expect([readLayerColorAt(document, layer, 2, 3), readLayerColorAt(document, layer, 3, 3)]).toContainEqual(blue)
    let opaqueCount = 0
    for (let y = 0; y < document.height; y += 1) {
      for (let x = 0; x < document.width; x += 1) {
        if (readLayerColorAt(document, layer, x, y).a > 0) opaqueCount += 1
      }
    }
    expect(opaqueCount).toBe(2)
  })

  it('keeps frame and cel multi-selection mutually exclusive', () => {
    const document = createDocument('animation selection', 2, 1, 'rgba')
    useWorkspace.getState().addSession(document)
    useWorkspace.getState().duplicateAnimationFrame()
    const session = useWorkspace.getState().sessions[0]
    const [first, second] = document.animation!.frames
    useWorkspace.getState().selectAnimationFrame(first.id)
    useWorkspace.getState().selectAnimationFrame(second.id, 'range')
    expect(session.selectedAnimationFrameIds).toEqual([first.id, second.id])
    const layerId = document.activeLayerId
    useWorkspace.getState().selectAnimationCell(`${layerId}:${first.id}`)
    useWorkspace.getState().selectAnimationCell(`${layerId}:${second.id}`, 'toggle')
    expect(session.selectedAnimationCellKeys).toHaveLength(2)
    expect(session.selectedAnimationFrameIds).toEqual([])
    useWorkspace.getState().copySelectedAnimationCels()
    expect(session.animationCellClipboard).toHaveLength(2)
    useWorkspace.getState().selectAnimationFrame(first.id)
    expect(session.selectedAnimationCellKeys).toEqual([])
    expect(session.selectedAnimationFrameIds).toEqual([first.id])
  })

  it('creates a new frame linked only to the selected cel', () => {
    const document = createDocument('linked selected cel', 1, 1, 'rgba')
    const firstLayer = getActiveLayer(document)
    writeLayerColor(document, firstLayer, 0, red)
    const secondLayer = createLayer('Second', 1, 1, 'rgba')
    writeLayerColor(document, secondLayer, 0, blue)
    document.layers.push(secondLayer)
    const sourceFrameId = ensureAnimationDocument(document).activeFrameId
    useWorkspace.getState().addSession(document)
    useWorkspace.getState().selectAnimationCell(animationCelKey(firstLayer.id, sourceFrameId))

    useWorkspace.getState().addLinkedAnimationFrame()

    const timeline = ensureAnimationDocument(document)
    const targetFrameId = timeline.activeFrameId
    const sourceFirst = animationCelAt(timeline, firstLayer.id, sourceFrameId)!
    const targetFirst = animationCelAt(timeline, firstLayer.id, targetFrameId)!
    const targetSecond = animationCelAt(timeline, secondLayer.id, targetFrameId)!
    expect(targetFirst.linkedCelId).toBe(sourceFirst.id)
    expect(resolveAnimationCel(timeline, targetFirst)).toBe(sourceFirst)
    expect(targetSecond.linkedCelId).toBeUndefined()
  })

  it('links non-empty cels from a selected frame while leaving empty cels blank through undo and redo', () => {
    const document = createDocument('linked selected frame', 1, 1, 'rgba')
    const firstLayer = getActiveLayer(document)
    writeLayerColor(document, firstLayer, 0, red)
    const secondLayer = createLayer('Second', 1, 1, 'rgba')
    document.layers.push(secondLayer)
    const sourceFrameId = ensureAnimationDocument(document).activeFrameId
    useWorkspace.getState().addSession(document)
    useWorkspace.getState().selectAnimationFrame(sourceFrameId)

    useWorkspace.getState().addLinkedAnimationFrame()

    let timeline = ensureAnimationDocument(document)
    const targetFrameId = timeline.activeFrameId
    expect(animationCelAt(timeline, firstLayer.id, targetFrameId)?.linkedCelId).toBe(animationCelAt(timeline, firstLayer.id, sourceFrameId)?.id)
    expect(animationCelAt(timeline, secondLayer.id, targetFrameId)?.linkedCelId).toBeUndefined()
    expect(animationCelHasContent(animationCelAt(timeline, secondLayer.id, targetFrameId) ?? null, document.palette)).toBe(false)

    useWorkspace.getState().undo()
    expect(ensureAnimationDocument(document).frames).toHaveLength(1)
    useWorkspace.getState().redo()
    timeline = ensureAnimationDocument(document)
    expect(timeline.activeFrameId).toBe(targetFrameId)
    expect(animationCelAt(timeline, firstLayer.id, targetFrameId)?.linkedCelId).toBe(animationCelAt(timeline, firstLayer.id, sourceFrameId)?.id)
    expect(animationCelAt(timeline, secondLayer.id, targetFrameId)?.linkedCelId).toBeUndefined()
    expect(animationCelHasContent(animationCelAt(timeline, secondLayer.id, targetFrameId) ?? null, document.palette)).toBe(false)
  })

  it('uses Ctrl for cel toggles and Shift for a rectangular cel range', () => {
    const document = createDocument('animation cel range', 1, 1, 'rgba')
    const firstLayer = getActiveLayer(document)
    const secondLayer = createLayer('Second', 1, 1, 'rgba')
    document.layers.push(secondLayer)
    useWorkspace.getState().addSession(document)
    useWorkspace.getState().duplicateAnimationFrame()
    useWorkspace.getState().duplicateAnimationFrame()
    const timeline = ensureAnimationDocument(document)
    const [firstFrame, secondFrame, thirdFrame] = timeline.frames
    const firstKey = animationCelKey(firstLayer.id, firstFrame.id)
    const secondKey = animationCelKey(secondLayer.id, firstFrame.id)
    const rangeEndKey = animationCelKey(firstLayer.id, thirdFrame.id)

    useWorkspace.getState().selectAnimationCell(firstKey)
    useWorkspace.getState().selectAnimationCell(secondKey, 'toggle')
    expect(useWorkspace.getState().sessions[0].selectedAnimationCellKeys).toEqual([firstKey, secondKey])
    expect(useWorkspace.getState().sessions[0].selectedLayerIds).toEqual([secondLayer.id])
    useWorkspace.getState().selectAnimationCell(rangeEndKey, 'range')

    expect(useWorkspace.getState().sessions[0].selectedAnimationCellKeys).toEqual([
      firstKey,
      secondKey,
      animationCelKey(firstLayer.id, secondFrame.id),
      animationCelKey(firstLayer.id, thirdFrame.id),
      animationCelKey(secondLayer.id, secondFrame.id),
      animationCelKey(secondLayer.id, thirdFrame.id)
    ])
    expect(useWorkspace.getState().sessions[0].selectedLayerIds).toEqual([firstLayer.id])
  })

  it('includes the implicit active cel when Ctrl starts a cel multi-selection', () => {
    const document = createDocument('implicit active cel selection', 1, 1, 'rgba')
    const layer = getActiveLayer(document)
    useWorkspace.getState().addSession(document)
    useWorkspace.getState().duplicateAnimationFrame()
    const timeline = ensureAnimationDocument(document)
    const [firstFrame, secondFrame] = timeline.frames

    useWorkspace.getState().setActiveAnimationFrame(firstFrame.id)
    useWorkspace.getState().selectAnimationCell(animationCelKey(layer.id, secondFrame.id), 'toggle')

    expect(useWorkspace.getState().sessions[0].selectedAnimationCellKeys).toEqual([
      animationCelKey(layer.id, firstFrame.id),
      animationCelKey(layer.id, secondFrame.id)
    ])
  })

  it('maps move-tool Shift selection to current-frame animation cells', () => {
    const document = createDocument('move tool cel selection', 2, 1, 'rgba')
    const firstLayer = getActiveLayer(document)
    const secondLayer = createLayer('Second', 2, 1, 'rgba')
    document.layers.push(secondLayer)
    useWorkspace.getState().addSession(document)
    const frameId = ensureAnimationDocument(document).activeFrameId

    useWorkspace.getState().selectMoveToolLayer(firstLayer.id)
    useWorkspace.getState().selectMoveToolLayer(secondLayer.id, true)

    const session = useWorkspace.getState().sessions[0]
    expect(session.selectedLayerIds).toEqual([firstLayer.id, secondLayer.id])
    expect(session.selectedAnimationCellKeys).toEqual([
      animationCelKey(firstLayer.id, frameId),
      animationCelKey(secondLayer.id, frameId)
    ])
    expect(session.selectedAnimationFrameIds).toEqual([])
    expect(session.selectedAnimationMaskCellKeys).toEqual([])
  })

  it('toggles an already selected move-tool cell out of the multi-selection', () => {
    const document = createDocument('move tool cel toggle', 2, 1, 'rgba')
    const firstLayer = getActiveLayer(document)
    const secondLayer = createLayer('Second', 2, 1, 'rgba')
    document.layers.push(secondLayer)
    useWorkspace.getState().addSession(document)
    const frameId = ensureAnimationDocument(document).activeFrameId

    useWorkspace.getState().selectMoveToolLayer(firstLayer.id)
    useWorkspace.getState().selectMoveToolLayer(secondLayer.id, true)
    useWorkspace.getState().selectMoveToolLayer(firstLayer.id, true)

    const session = useWorkspace.getState().sessions[0]
    expect(session.selectedLayerIds).toEqual([secondLayer.id])
    expect(session.selectedAnimationCellKeys).toEqual([animationCelKey(secondLayer.id, frameId)])

    useWorkspace.getState().selectMoveToolLayer(secondLayer.id, true)
    expect(session.selectedLayerIds).toEqual([secondLayer.id])
    expect(session.selectedAnimationCellKeys).toEqual([animationCelKey(secondLayer.id, frameId)])
    expect(session.animationCellSelectionAnchorKey).toBe(animationCelKey(secondLayer.id, frameId))
  })

  it('maps move-tool layer selection only to cells in the current frame', () => {
    const document = createDocument('move tool cross-frame selection', 2, 1, 'rgba')
    const firstLayer = getActiveLayer(document)
    const secondLayer = createLayer('Second', 2, 1, 'rgba')
    document.layers.push(secondLayer)
    useWorkspace.getState().addSession(document)
    const timeline = ensureAnimationDocument(document)
    const firstFrameId = timeline.activeFrameId
    const secondFrameId = addBlankAnimationFrame(document)
    const firstKey = animationCelKey(firstLayer.id, firstFrameId)

    useWorkspace.getState().selectAnimationCell(firstKey)
    useWorkspace.getState().setActiveAnimationFrame(secondFrameId)
    useWorkspace.getState().selectMoveToolLayer(secondLayer.id, true)

    const session = useWorkspace.getState().sessions[0]
    expect(session.selectedAnimationCellKeys).toEqual([
      animationCelKey(firstLayer.id, secondFrameId),
      animationCelKey(secondLayer.id, secondFrameId)
    ])
    expect(session.selectedLayerIds).toEqual([firstLayer.id, secondLayer.id])
    expect(session.selectedAnimationCellKeys).not.toContain(firstKey)
  })

  it('pastes a multi-cel block across layers and frames without collapsing it into one column', () => {
    const document = createDocument('animation cel paste', 1, 1, 'rgba')
    const firstLayer = getActiveLayer(document)
    const secondLayer = createLayer('Second', 1, 1, 'rgba')
    document.layers.push(secondLayer)
    useWorkspace.getState().addSession(document)
    useWorkspace.getState().duplicateAnimationFrame()
    useWorkspace.getState().addAnimationFrame()
    const timeline = ensureAnimationDocument(document)
    const [firstFrame, secondFrame, thirdFrame] = timeline.frames
    const firstSourceCel = animationCelAt(timeline, firstLayer.id, firstFrame.id)!
    const secondSourceCel = animationCelAt(timeline, secondLayer.id, secondFrame.id)!
    firstSourceCel.surface!.pixels.set([255, 0, 0, 255])
    secondSourceCel.surface!.pixels.set([0, 0, 255, 255])
    firstSourceCel.mask = createLayerMask(firstSourceCel.id, 1, 1)
    secondSourceCel.mask = createLayerMask(secondSourceCel.id, 1, 1)
    writeLayerColor(document, firstSourceCel.mask, 0, { r: 64, g: 64, b: 64, a: 255 })
    writeLayerColor(document, secondSourceCel.mask, 0, { r: 128, g: 128, b: 128, a: 255 })

    useWorkspace.getState().selectAnimationCell(animationCelKey(firstLayer.id, firstFrame.id))
    useWorkspace.getState().selectAnimationCell(animationCelKey(secondLayer.id, secondFrame.id), 'toggle')
    useWorkspace.getState().copySelectedAnimationCels()
    useWorkspace.getState().selectAnimationCell(animationCelKey(firstLayer.id, secondFrame.id))
    useWorkspace.getState().pasteAnimationCels()

    const firstDestination = animationCelAt(timeline, firstLayer.id, secondFrame.id)!
    const secondDestination = animationCelAt(timeline, secondLayer.id, thirdFrame.id)!
    expect(firstDestination.surface!.pixels).toEqual(new Uint8ClampedArray([255, 0, 0, 255]))
    expect(secondDestination.surface!.pixels).toEqual(new Uint8ClampedArray([0, 0, 255, 255]))
    expect(firstDestination.mask).toMatchObject({ ownerKind: 'cel', ownerId: firstDestination.id })
    expect(secondDestination.mask).toMatchObject({ ownerKind: 'cel', ownerId: secondDestination.id })
    expect(firstDestination.mask?.pixels).toEqual(firstSourceCel.mask.pixels)
    expect(secondDestination.mask?.pixels).toEqual(secondSourceCel.mask.pixels)
    expect(firstDestination.mask?.id).not.toBe(firstSourceCel.mask.id)
    expect(secondDestination.mask?.id).not.toBe(secondSourceCel.mask.id)
  })

  it('extends the timeline when a copied cel block crosses the last frame', () => {
    const document = createDocument('animation cel paste edge', 1, 1, 'rgba')
    const layer = getActiveLayer(document)
    useWorkspace.getState().addSession(document)
    useWorkspace.getState().duplicateAnimationFrame()
    const timeline = ensureAnimationDocument(document)
    const [firstFrame, secondFrame] = timeline.frames
    animationCelAt(timeline, layer.id, firstFrame.id)!.surface!.pixels.set([255, 0, 0, 255])
    animationCelAt(timeline, layer.id, secondFrame.id)!.surface!.pixels.set([0, 0, 255, 255])

    useWorkspace.getState().selectAnimationCell(animationCelKey(layer.id, secondFrame.id))
    useWorkspace.getState().selectAnimationCell(animationCelKey(layer.id, firstFrame.id), 'toggle')
    useWorkspace.getState().copySelectedAnimationCels()
    useWorkspace.getState().selectAnimationCell(animationCelKey(layer.id, secondFrame.id))
    useWorkspace.getState().pasteAnimationCels()

    expect(timeline.frames).toHaveLength(3)
    expect(animationCelAt(timeline, layer.id, secondFrame.id)!.surface!.pixels).toEqual(new Uint8ClampedArray([255, 0, 0, 255]))
    expect(animationCelAt(timeline, layer.id, timeline.frames[2].id)!.surface!.pixels).toEqual(new Uint8ClampedArray([0, 0, 255, 255]))
    useWorkspace.getState().undo()
    expect(timeline.frames).toHaveLength(2)
  })

  it('moves a multi-cel block across layers and frames using the dragged cel as its anchor', () => {
    const document = createDocument('animation cel move', 1, 1, 'rgba')
    const firstLayer = getActiveLayer(document)
    const secondLayer = createLayer('Second', 1, 1, 'rgba')
    document.layers.push(secondLayer)
    useWorkspace.getState().addSession(document)
    useWorkspace.getState().duplicateAnimationFrame()
    useWorkspace.getState().addAnimationFrame()
    const timeline = ensureAnimationDocument(document)
    const [firstFrame, secondFrame, thirdFrame] = timeline.frames
    const firstKey = animationCelKey(firstLayer.id, firstFrame.id)
    const anchorKey = animationCelKey(secondLayer.id, secondFrame.id)
    animationCelAt(timeline, firstLayer.id, firstFrame.id)!.surface!.pixels.set([255, 0, 0, 255])
    animationCelAt(timeline, secondLayer.id, secondFrame.id)!.surface!.pixels.set([0, 0, 255, 255])

    useWorkspace.getState().selectAnimationCell(firstKey)
    useWorkspace.getState().selectAnimationCell(anchorKey, 'toggle')
    useWorkspace.getState().moveSelectedAnimationCels(secondLayer.id, thirdFrame.id, anchorKey)

    expect(animationCelAt(timeline, firstLayer.id, secondFrame.id)!.surface!.pixels).toEqual(new Uint8ClampedArray([255, 0, 0, 255]))
    expect(animationCelAt(timeline, secondLayer.id, thirdFrame.id)!.surface!.pixels).toEqual(new Uint8ClampedArray([0, 0, 255, 255]))
    expect(animationCelAt(timeline, firstLayer.id, firstFrame.id)!.surface!.pixels).toEqual(new Uint8ClampedArray(4))
    expect(animationCelAt(timeline, secondLayer.id, secondFrame.id)!.surface!.pixels).toEqual(new Uint8ClampedArray(4))

    useWorkspace.getState().undo()
    expect(animationCelAt(timeline, firstLayer.id, firstFrame.id)!.surface!.pixels).toEqual(new Uint8ClampedArray([255, 0, 0, 255]))
    expect(animationCelAt(timeline, secondLayer.id, secondFrame.id)!.surface!.pixels).toEqual(new Uint8ClampedArray([0, 0, 255, 255]))
    expect(animationCelAt(timeline, firstLayer.id, secondFrame.id)!.surface!.pixels).toEqual(new Uint8ClampedArray(4))
    expect(animationCelAt(timeline, secondLayer.id, thirdFrame.id)!.surface!.pixels).toEqual(new Uint8ClampedArray(4))
  })

  it('moves selected frames as one ordered block and restores their order with undo', () => {
    const document = createDocument('animation frame move', 1, 1, 'rgba')
    useWorkspace.getState().addSession(document)
    useWorkspace.getState().duplicateAnimationFrame()
    useWorkspace.getState().duplicateAnimationFrame()
    const timeline = ensureAnimationDocument(document)
    const [firstFrame, secondFrame, thirdFrame] = timeline.frames

    useWorkspace.getState().selectAnimationFrame(firstFrame.id)
    useWorkspace.getState().selectAnimationFrame(secondFrame.id, 'range')
    useWorkspace.getState().moveSelectedAnimationFrames(thirdFrame.id, true)

    expect(timeline.frames.map((frame) => frame.id)).toEqual([thirdFrame.id, firstFrame.id, secondFrame.id])
    expect(useWorkspace.getState().sessions[0].selectedAnimationFrameIds).toEqual([firstFrame.id, secondFrame.id])
    useWorkspace.getState().undo()
    expect(timeline.frames.map((frame) => frame.id)).toEqual([firstFrame.id, secondFrame.id, thirdFrame.id])
  })

  it('copies selected frames with their cels and pastes independent frames after the selection', () => {
    const document = createDocument('animation frame clipboard', 1, 1, 'rgba')
    useWorkspace.getState().addSession(document)
    useWorkspace.getState().duplicateAnimationFrame()
    useWorkspace.getState().addAnimationFrame()
    const timeline = ensureAnimationDocument(document)
    const [firstFrame, secondFrame, thirdFrame] = timeline.frames
    firstFrame.duration = 80
    secondFrame.duration = 140
    animationCelAt(timeline, document.activeLayerId, firstFrame.id)!.surface!.pixels.set([255, 0, 0, 255])
    animationCelAt(timeline, document.activeLayerId, secondFrame.id)!.surface!.pixels.set([0, 0, 255, 255])

    useWorkspace.getState().selectAnimationFrame(firstFrame.id)
    useWorkspace.getState().selectAnimationFrame(secondFrame.id, 'range')
    useWorkspace.getState().copySelectedAnimationFrames()
    useWorkspace.getState().selectAnimationFrame(thirdFrame.id)
    useWorkspace.getState().pasteAnimationFrames()

    expect(timeline.frames).toHaveLength(5)
    const pastedFrames = timeline.frames.slice(3)
    expect(pastedFrames.map((frame) => frame.duration)).toEqual([80, 140])
    expect(animationCelAt(timeline, document.activeLayerId, pastedFrames[0].id)!.surface!.pixels).toEqual(new Uint8ClampedArray([255, 0, 0, 255]))
    expect(animationCelAt(timeline, document.activeLayerId, pastedFrames[1].id)!.surface!.pixels).toEqual(new Uint8ClampedArray([0, 0, 255, 255]))
    animationCelAt(timeline, document.activeLayerId, pastedFrames[0].id)!.surface!.pixels[0] = 20
    expect(animationCelAt(timeline, document.activeLayerId, firstFrame.id)!.surface!.pixels[0]).toBe(255)
    expect(useWorkspace.getState().sessions[0].selectedAnimationFrameIds).toEqual(pastedFrames.map((frame) => frame.id))
    useWorkspace.getState().undo()
    expect(timeline.frames.map((frame) => frame.id)).toEqual([firstFrame.id, secondFrame.id, thirdFrame.id])
  })

  it('persists a cel opacity edit through undo', () => {
    const document = createDocument('animation cel opacity', 1, 1, 'rgba')
    useWorkspace.getState().addSession(document)
    const session = useWorkspace.getState().sessions[0]
    const frameId = document.animation!.activeFrameId
    useWorkspace.getState().setAnimationCelOpacity(document.activeLayerId, frameId, 0.4)
    expect(document.layers[0].opacity).toBeCloseTo(0.4)
    useWorkspace.getState().undo()
    expect(document.layers[0].opacity).toBeCloseTo(1)
  })

  it('switches frames without dirtying the project and undoes frame creation', () => {
    const document = createDocument('animation', 2, 1, 'rgba')
    writeLayerColor(document, getActiveLayer(document), 0, red)
    useWorkspace.getState().addSession(document)

    useWorkspace.getState().addAnimationFrame()
    const session = useWorkspace.getState().sessions[0]
    const secondFrame = session.document.animation!.activeFrameId
    expect(readLayerColor(document, getActiveLayer(document), 0)).toEqual(transparent)
    ensureLayerCoversCanvas(document, getActiveLayer(document))
    writeLayerColor(document, getActiveLayer(document), 1, blue)
    document.dirty = false
    useWorkspace.getState().setActiveAnimationFrame('frame-1')
    expect(document.dirty).toBe(false)
    expect(readLayerColor(document, getActiveLayer(document), 0)).toEqual(red)
    useWorkspace.getState().setActiveAnimationFrame(secondFrame)
    expect(readLayerColor(document, getActiveLayer(document), 1)).toEqual(blue)

    useWorkspace.getState().undo()
    expect(document.animation?.frames).toHaveLength(1)
    expect(document.animation?.activeFrameId).toBe('frame-1')
  })

  it('clears timeline cell and frame selections after creating a new frame', () => {
    const document = createDocument('clear animation selection after frame creation', 2, 1, 'rgba')
    useWorkspace.getState().addSession(document)
    const session = useWorkspace.getState().sessions[0]
    const firstFrameId = ensureAnimationDocument(document).activeFrameId
    const firstCellKey = animationCelKey(document.activeLayerId, firstFrameId)
    session.selectedAnimationCellKeys = [firstCellKey]
    session.animationCellSelectionAnchorKey = firstCellKey
    session.selectedAnimationFrameIds = [firstFrameId]
    session.animationFrameSelectionAnchorId = firstFrameId

    useWorkspace.getState().addAnimationFrame()

    expect(session.selectedAnimationCellKeys).toEqual([])
    expect(session.animationCellSelectionAnchorKey).toBeNull()
    expect(session.selectedAnimationFrameIds).toEqual([])
    expect(session.animationFrameSelectionAnchorId).toBeNull()

    const activeFrameId = ensureAnimationDocument(document).activeFrameId
    const activeCellKey = animationCelKey(document.activeLayerId, activeFrameId)
    session.selectedAnimationCellKeys = [activeCellKey]
    session.animationCellSelectionAnchorKey = activeCellKey
    useWorkspace.getState().duplicateAnimationFrame()

    expect(session.selectedAnimationCellKeys).toEqual([])
    expect(session.animationCellSelectionAnchorKey).toBeNull()
  })

  it('duplicates every cel when duplicating a layer', () => {
    const document = createDocument('animation layers', 1, 1, 'rgba')
    writeLayerColor(document, getActiveLayer(document), 0, red)
    useWorkspace.getState().addSession(document)
    useWorkspace.getState().duplicateAnimationFrame()
    writeLayerColor(document, getActiveLayer(document), 0, blue)
    useWorkspace.getState().setActiveAnimationFrame('frame-1')

    useWorkspace.getState().duplicateActiveLayer()
    const copiedLayerId = document.activeLayerId
    expect(readLayerColor(document, getActiveLayer(document), 0)).toEqual(red)
    useWorkspace.getState().setActiveAnimationFrame(document.animation!.frames[1].id)
    expect(document.layers.find((layer) => layer.id === copiedLayerId)).toBeDefined()
    expect(readLayerColor(document, getActiveLayer(document), 0)).toEqual(blue)
  })

  it('plays once from the first frame and returns to the frame selected before playback', () => {
    const document = createDocument('animation playback settings', 1, 1, 'rgba')
    useWorkspace.getState().addSession(document)
    useWorkspace.getState().duplicateAnimationFrame()
    useWorkspace.getState().duplicateAnimationFrame()
    const session = useWorkspace.getState().sessions[0]
    const [firstFrame, secondFrame, thirdFrame] = document.animation!.frames
    useWorkspace.getState().setActiveAnimationFrame(thirdFrame.id)
    useWorkspace.getState().setAnimationPlaybackRate(2)
    useWorkspace.getState().setAnimationLoop(false)
    useWorkspace.getState().setAnimationReturnToStart(true)
    document.dirty = false
    useWorkspace.getState().setAnimationPlaying(true)
    expect(document.animation?.activeFrameId).toBe(firstFrame.id)
    useWorkspace.getState().advanceAnimationFrame()
    expect(document.animation?.activeFrameId).toBe(secondFrame.id)
    useWorkspace.getState().advanceAnimationFrame()
    expect(document.animation?.activeFrameId).toBe(thirdFrame.id)
    useWorkspace.getState().setAnimationPlaying(false)

    expect(document.animation?.activeFrameId).toBe(thirdFrame.id)
    expect(session.animationPlaybackRate).toBe(2)
    expect(document.dirty).toBe(false)
  })

  it('returns a completed one-shot playback to the first frame when return-to-start is disabled', () => {
    const document = createDocument('animation playback completion', 1, 1, 'rgba')
    useWorkspace.getState().addSession(document)
    useWorkspace.getState().duplicateAnimationFrame()
    useWorkspace.getState().duplicateAnimationFrame()
    const [firstFrame, , thirdFrame] = document.animation!.frames
    useWorkspace.getState().setActiveAnimationFrame(thirdFrame.id)
    useWorkspace.getState().setAnimationLoop(false)
    useWorkspace.getState().setAnimationReturnToStart(false)

    useWorkspace.getState().setAnimationPlaying(true)
    useWorkspace.getState().setActiveAnimationFrame(thirdFrame.id)
    useWorkspace.getState().setAnimationPlaying(false, true)

    expect(document.animation?.activeFrameId).toBe(firstFrame.id)
  })
})

describe('layer properties', () => {
  it('clears an optional display color and restores it with one undo', () => {
    const document = createDocument('layer marker', 2, 2, 'rgba')
    const layer = getActiveLayer(document)
    layer.displayColor = { ...red }
    useWorkspace.getState().addSession(document)

    useWorkspace.getState().setLayerPropertiesWithBlend(layer.id, layer.name, layer.opacity, layer.blendMode, layer.locked, null, '说明')

    expect(layer.displayColor).toBeUndefined()
    expect(layer.description).toBe('说明')
    useWorkspace.getState().undo()
    expect(layer.displayColor).toEqual(red)
  })
})

describe('cross-document layer clipboard', () => {
  it('pastes every animation cel belonging to a copied layer', () => {
    const source = createDocument('animated layer clipboard', 1, 1, 'rgba')
    const sourceLayer = getActiveLayer(source)
    writeLayerColor(source, sourceLayer, 0, red)
    useWorkspace.getState().addSession(source)
    useWorkspace.getState().duplicateAnimationFrame()
    writeLayerColor(source, sourceLayer, 0, blue)

    useWorkspace.getState().copySelectedLayersToClipboard()
    const target = createDocument('animated layer target', 1, 1, 'rgba')
    useWorkspace.getState().addSession(target)
    expect(useWorkspace.getState().pasteLayersFromClipboard()).toBe(true)

    const timeline = ensureAnimationDocument(target)
    const pastedLayer = target.layers.find((layer) => layer.id !== target.layers[0].id)!
    expect(timeline.frames).toHaveLength(2)
    expect(animationCelAt(timeline, pastedLayer.id, timeline.frames[0].id)!.surface!.pixels).toEqual(new Uint8ClampedArray([255, 0, 0, 255]))
    expect(animationCelAt(timeline, pastedLayer.id, timeline.frames[1].id)!.surface!.pixels).toEqual(new Uint8ClampedArray([0, 80, 255, 255]))

    useWorkspace.getState().undo()
    expect(target.layers).toHaveLength(1)
    expect(timeline.frames).toHaveLength(1)
    useWorkspace.getState().redo()
    expect(target.layers.some((layer) => layer.id === pastedLayer.id)).toBe(true)
    expect(timeline.frames).toHaveLength(2)
    expect(animationCelAt(timeline, pastedLayer.id, timeline.frames[1].id)!.surface!.pixels).toEqual(new Uint8ClampedArray([0, 80, 255, 255]))
  })

  it('pastes multiple selected layers with their properties as one undo step', () => {
    const source = createDocument('source', 4, 4, 'rgba')
    const bottom = getActiveLayer(source)
    bottom.name = 'Bottom'
    bottom.offsetX = -2
    bottom.opacity = 0.5
    bottom.description = 'base note'
    const top = createLayer('Top', 2, 3, 'rgba')
    top.offsetX = 5
    top.offsetY = 6
    top.blendMode = 'multiply'
    top.clippingMask = true
    top.displayColor = { ...blue }
    source.layers.push(top)
    source.activeLayerId = top.id
    useWorkspace.getState().addSession(source)
    useWorkspace.getState().selectLayer(bottom.id)
    useWorkspace.getState().selectLayer(top.id, true)

    useWorkspace.getState().copySelectedLayersToClipboard()
    const target = createDocument('target', 4, 4, 'indexed')
    useWorkspace.getState().addSession(target)
    useWorkspace.getState().pasteLayersFromClipboard()

    const pasted = target.layers.slice(1)
    expect(pasted.map((layer) => layer.name)).toEqual(['Bottom 副本', 'Top 副本'])
    expect(pasted[0]).toMatchObject({ offsetX: -2, opacity: 0.5, description: 'base note' })
    expect(pasted[1]).toMatchObject({ offsetX: 5, offsetY: 6, blendMode: 'multiply', clippingMask: true, displayColor: blue })
    useWorkspace.getState().undo()
    expect(target.layers).toHaveLength(1)
  })

  it('preserves nested group structure and removes the whole paste with one undo', () => {
    const source = createDocument('group source', 3, 3, 'rgba')
    const childLayer = getActiveLayer(source)
    const parentLayer = createLayer('Parent layer', 3, 3, 'rgba')
    source.layers.push(parentLayer)
    source.groups.push(
      { id: 'parent', name: 'Parent', parentGroupId: null, visible: true, locked: false, opacity: 0.75, blendMode: 'multiply', clippingMask: true, cumulativeBlend: true, description: 'parent note' },
      { id: 'child', name: 'Child', parentGroupId: 'parent', visible: false, locked: true, opacity: 0.5, blendMode: 'screen', displayColor: { ...red } }
    )
    childLayer.groupId = 'child'
    parentLayer.groupId = 'parent'
    useWorkspace.getState().addSession(source)
    useWorkspace.getState().selectGroup('parent')
    useWorkspace.getState().copySelectedLayersToClipboard()

    const target = createDocument('group target', 3, 3, 'rgba')
    useWorkspace.getState().addSession(target)
    expect(useWorkspace.getState().pasteLayersFromClipboard()).toBe(true)

    const parent = target.groups.find((group) => group.name === 'Parent 副本')
    const child = target.groups.find((group) => group.name === 'Child 副本')
    expect(parent).toMatchObject({ opacity: 0.75, blendMode: 'multiply', clippingMask: true, cumulativeBlend: true, description: 'parent note' })
    expect(child).toMatchObject({ parentGroupId: parent?.id, visible: false, locked: true, opacity: 0.5, blendMode: 'screen', displayColor: red })
    expect(target.layers.find((layer) => layer.name === `${childLayer.name} 副本`)?.groupId).toBe(child?.id)
    expect(target.layers.find((layer) => layer.name === 'Parent layer 副本')?.groupId).toBe(parent?.id)

    useWorkspace.getState().undo()
    expect(target.groups).toHaveLength(0)
    expect(target.layers).toHaveLength(1)
  })

  it('copies each animation cell mask with independent pixel storage', () => {
    const source = createDocument('masked cel source', 2, 1, 'rgba')
    const sourceLayer = getActiveLayer(source)
    const sourceTimeline = ensureAnimationDocument(source)
    const firstSourceCel = sourceTimeline.cels[0]
    firstSourceCel.mask = createLayerMask(firstSourceCel.id, 2, 1)
    writeLayerColor(source, firstSourceCel.mask, 0, { r: 64, g: 64, b: 64, a: 255 })
    useWorkspace.getState().addSession(source)
    useWorkspace.getState().duplicateAnimationFrame()
    const secondSourceCel = ensureAnimationDocument(source).cels.find((cel) => cel.frameId === ensureAnimationDocument(source).activeFrameId)!
    writeLayerColor(source, secondSourceCel.mask!, 1, { r: 128, g: 128, b: 128, a: 255 })
    useWorkspace.getState().selectLayer(sourceLayer.id)
    useWorkspace.getState().copySelectedLayersToClipboard()

    const target = createDocument('masked cel target', 2, 1, 'rgba')
    useWorkspace.getState().addSession(target)
    useWorkspace.getState().duplicateAnimationFrame()
    expect(useWorkspace.getState().pasteLayersFromClipboard()).toBe(true)

    const pastedLayer = target.layers.find((layer) => layer.name.includes(sourceLayer.name) && layer.id !== target.layers[0].id)!
    const pastedCels = ensureAnimationDocument(target).cels.filter((cel) => cel.layerId === pastedLayer.id)
    expect(pastedCels).toHaveLength(2)
    expect(pastedCels[0].mask).toMatchObject({ ownerKind: 'cel', ownerId: pastedCels[0].id })
    expect(pastedCels[1].mask).toMatchObject({ ownerKind: 'cel', ownerId: pastedCels[1].id })
    expect(pastedCels[0].mask?.id).not.toBe(firstSourceCel.mask.id)
    expect(pastedCels[1].mask?.id).not.toBe(secondSourceCel.mask?.id)
    expect(pastedCels[0].mask?.pixels).toEqual(firstSourceCel.mask.pixels)
    expect(pastedCels[1].mask?.pixels).toEqual(secondSourceCel.mask?.pixels)

    pastedCels[0].mask!.pixels[0] = 255
    expect(firstSourceCel.mask.pixels[0]).toBe(64)
    expect(pastedCels[1].mask!.pixels[0]).toBe(secondSourceCel.mask!.pixels[0])
  })
})

describe('multi-layer deletion', () => {
  it('keeps a valid layer selected through deletion, undo, and redo', () => {
    const document = createDocument('persistent layer selection', 2, 2, 'rgba')
    const bottom = getActiveLayer(document)
    const middle = createLayer('Middle', 2, 2, 'rgba')
    const top = createLayer('Top', 2, 2, 'rgba')
    document.layers.push(middle, top)
    useWorkspace.getState().addSession(document)
    useWorkspace.getState().selectLayer(middle.id)

    useWorkspace.getState().deleteSelectedLayers()
    let session = useWorkspace.getState().sessions[0]
    expect(session.selectedLayerIds).toEqual([bottom.id])
    expect(document.layers.some((layer) => layer.id === session.document.activeLayerId)).toBe(true)

    useWorkspace.getState().undo()
    session = useWorkspace.getState().sessions[0]
    expect(session.selectedLayerIds).toEqual([middle.id])
    expect(document.layers.some((layer) => layer.id === session.document.activeLayerId)).toBe(true)

    useWorkspace.getState().redo()
    session = useWorkspace.getState().sessions[0]
    expect(session.selectedLayerIds).toEqual([bottom.id])
    expect(document.layers.some((layer) => layer.id === session.document.activeLayerId)).toBe(true)
  })

  it('deletes a selected nested group as one structural history entry', () => {
    const document = createDocument('delete nested group', 2, 2, 'rgba')
    const childLayer = getActiveLayer(document)
    childLayer.groupId = 'child'
    const rootLayer = createLayer('Root', 2, 2, 'rgba')
    document.layers.push(rootLayer)
    document.groups.push(
      { id: 'parent', name: 'Parent', parentGroupId: null, visible: true, locked: false, opacity: 1, blendMode: 'normal' },
      { id: 'child', name: 'Child', parentGroupId: 'parent', visible: true, locked: false, opacity: 1, blendMode: 'normal' }
    )
    useWorkspace.getState().addSession(document)
    useWorkspace.getState().selectGroup('parent')

    useWorkspace.getState().deleteSelectedLayers()

    expect(document.layers).toEqual([rootLayer])
    expect(document.groups).toEqual([])
    useWorkspace.getState().undo()
    expect(document.layers).toContain(childLayer)
    expect(document.groups.map((group) => group.id)).toEqual(['parent', 'child'])
    expect(useWorkspace.getState().sessions[0].selectedGroupId).toBe('parent')
  })

  it('does not dirty the document when deletion would remove every layer', () => {
    const document = createDocument('keep one layer', 2, 2, 'rgba')
    useWorkspace.getState().addSession(document)

    useWorkspace.getState().deleteSelectedLayers()

    expect(document.dirty).toBe(false)
    expect(useWorkspace.getState().sessions[0].history.canUndo).toBe(false)
  })
})

describe('brush settings', () => {
  it('stores a selection brush in the local library without dirtying the project', async () => {
    const saveBrush = vi.fn(async (name: string, _data: Uint8Array, intrinsicSize?: boolean, sourceX?: number, sourceY?: number) => ({
      id: 'selection-brush.png', name, filePath: 'brushes/selection-brush.png', intrinsicSize, sourceX, sourceY
    }))
    installApi({ saveBrush })
    const document = createDocument('selection brush', 4, 3, 'rgba')
    const layer = getActiveLayer(document)
    writeLayerColor(document, layer, 0, red)
    writeLayerColor(document, layer, 2, { r: 10, g: 20, b: 30, a: 128 })
    useWorkspace.getState().addSession(document)
    useWorkspace.getState().setTool('selection')
    useWorkspace.getState().setSelection({ x: 0, y: 0, width: 3, height: 1 })

    await useWorkspace.getState().createBrushFromSelection()

    const session = useWorkspace.getState().sessions[0]
    expect(session).toMatchObject({ tool: 'pencil', brushImageTemporary: false, brushPaintMode: 'paint', selection: null })
    expect(session.brushImage).toMatchObject({ id: 'selection-brush.png', name: '选区笔刷', width: 3, height: 1, sourceX: 0, sourceY: 0 })
    expect(session.brushImage?.coverage).toEqual(Uint8Array.from([255, 0, 128]))
    expect(session.brushImageId).toBe('selection-brush.png')
    expect(session.document.customBrushes ?? []).toEqual([])
    expect(document.dirty).toBe(false)
    expect(saveBrush).toHaveBeenCalledWith('选区笔刷', expect.any(Uint8Array), true, 0, 0, null)
  })

  it('stores a selection brush in the active brush-library folder', async () => {
    const saveBrush = vi.fn(async (name: string, _data: Uint8Array, intrinsicSize?: boolean, sourceX?: number, sourceY?: number, folderId?: string | null) => ({
      id: 'folder-brush.png', name, filePath: `brushes/${folderId}/folder-brush.png`, intrinsicSize, sourceX, sourceY, folderId
    }))
    installApi({ saveBrush })
    const document = createDocument('folder brush', 2, 2, 'rgba')
    writeLayerColor(document, getActiveLayer(document), 0, red)
    useWorkspace.getState().addSession(document)
    useWorkspace.getState().setSelection({ x: 0, y: 0, width: 1, height: 1 })
    brushLibraryLocation.set('Characters/Heroes')

    await useWorkspace.getState().createBrushFromSelection()

    expect(saveBrush).toHaveBeenCalledWith('选区笔刷', expect.any(Uint8Array), true, 0, 0, 'Characters/Heroes')
    expect(useWorkspace.getState().sessions[0].brushImageId).toBe('folder-brush.png')
  })

  it('persists pattern alignment and the stored local brush id', async () => {
    vi.useFakeTimers()
    try {
      installApi({
        saveBrush: vi.fn(async (name: string, _data: Uint8Array, intrinsicSize?: boolean, sourceX?: number, sourceY?: number) => ({
          id: 'persistent-selection.png', name, filePath: 'brushes/persistent-selection.png', intrinsicSize, sourceX, sourceY
        }))
      })
      const document = createDocument('temporary persistence', 2, 2, 'rgba')
      writeLayerColor(document, getActiveLayer(document), 0, red)
      useWorkspace.getState().addSession(document)
      useWorkspace.getState().setSelection({ x: 0, y: 0, width: 1, height: 1 })
      await useWorkspace.getState().createBrushFromSelection()
      useWorkspace.getState().setBrushPaintMode('pattern-target')
      vi.advanceTimersByTime(101)

      useWorkspace.setState({ sessions: [], activeId: null, message: null, dialog: null })
      useWorkspace.getState().addSession(createDocument('restored settings', 2, 2, 'rgba'))
      const restored = useWorkspace.getState().sessions[0]
      expect(restored.brushPaintMode).toBe('pattern-target')
      expect(restored.brushImageId).toBe('persistent-selection.png')
      expect(restored.brushImage).toBeNull()
      expect(restored.brushImageTemporary).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps brush settings independent across tools and restores every profile', () => {
    vi.useFakeTimers()
    try {
      useWorkspace.getState().addSession(createDocument('brush mode', 8, 8, 'rgba'))
      useWorkspace.getState().setBrushSize(73)

      useWorkspace.getState().setTool('shape')
      useWorkspace.getState().setTool('fill')
      expect(useWorkspace.getState().sessions[0]).toMatchObject({ tool: 'fill', brushSize: 1 })
      useWorkspace.getState().setBrushSize(29)
      useWorkspace.getState().setBrushShape('line')
      useWorkspace.getState().setTool('pencil')
      expect(useWorkspace.getState().sessions[0]).toMatchObject({ tool: 'pencil', brushSize: 73 })

      vi.advanceTimersByTime(101)
      useWorkspace.setState({ sessions: [], activeId: null, message: null, dialog: null })
      useWorkspace.getState().addSession(createDocument('restored brush mode', 8, 8, 'rgba'))
      expect(useWorkspace.getState().sessions[0]).toMatchObject({ brushSize: 73 })
      useWorkspace.getState().setTool('fill')
      expect(useWorkspace.getState().sessions[0]).toMatchObject({ brushSize: 29, brushShape: 'line' })
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps pencil and eraser dynamics independent and outside document history', () => {
    vi.useFakeTimers()
    try {
      const document = createDocument('dynamics profiles', 8, 8, 'rgba')
      useWorkspace.getState().addSession(document)
      useWorkspace.getState().setBrushDynamicsMapping('size', { sensor: 'pressure', outputMin: 32, curve: 'soft' })
      useWorkspace.getState().setBrushDynamicsMapping('gradient', { sensor: 'pressure', outputMin: 0, inputMax: 70, curve: 'hard' })
      useWorkspace.getState().setBrushDynamicsGradientDither('bayer-4')

      let session = useWorkspace.getState().sessions[0]
      expect(session.brushDynamics.effects.size).toMatchObject({ sensor: 'pressure', outputMin: 32, curve: 'soft' })
      expect(session.brushDynamics.effects.gradient).toMatchObject({ sensor: 'pressure', outputMin: 0, inputMax: 70, curve: 'hard' })
      expect(session.brushDynamics.gradientDither).toBe('bayer-4')
      expect(document.dirty).toBe(false)
      expect(session.history.canUndo).toBe(false)

      useWorkspace.getState().setTool('eraser')
      expect(useWorkspace.getState().sessions[0].brushDynamics.effects.size.sensor).toBeNull()
      useWorkspace.getState().setBrushDynamicsMapping('strength', { sensor: 'speed', outputMin: 7, inputMax: 900, curve: 'hard' })
      useWorkspace.getState().setBrushDynamicsGradientDither('vertical')
      useWorkspace.getState().setTool('fill')
      const fillDither = useWorkspace.getState().sessions[0].brushDynamics.gradientDither
      useWorkspace.getState().setBrushDynamicsGradientDither('bayer-8')
      expect(useWorkspace.getState().sessions[0].brushDynamics.gradientDither).toBe(fillDither)
      useWorkspace.getState().setTool('pencil')
      expect(useWorkspace.getState().sessions[0].brushDynamics.effects.size).toMatchObject({ sensor: 'pressure', outputMin: 32, curve: 'soft' })
      expect(useWorkspace.getState().sessions[0].brushDynamics.effects.gradient).toMatchObject({ sensor: 'pressure', outputMin: 0, inputMax: 70, curve: 'hard' })
      expect(useWorkspace.getState().sessions[0].brushDynamics.gradientDither).toBe('bayer-4')

      vi.advanceTimersByTime(101)
      useWorkspace.setState({ sessions: [], activeId: null, message: null, dialog: null })
      useWorkspace.getState().addSession(createDocument('restored dynamics profiles', 8, 8, 'rgba'))
      session = useWorkspace.getState().sessions[0]
      expect(session.brushDynamics.effects.size).toMatchObject({ sensor: 'pressure', outputMin: 32, curve: 'soft' })
      expect(session.brushDynamics.effects.gradient).toMatchObject({ sensor: 'pressure', outputMin: 0, inputMax: 70, curve: 'hard' })
      expect(session.brushDynamics.gradientDither).toBe('bayer-4')
      useWorkspace.getState().setTool('eraser')
      expect(useWorkspace.getState().sessions[0].brushDynamics.effects.strength).toMatchObject({ sensor: 'speed', outputMin: 7, inputMax: 900, curve: 'hard' })
      expect(useWorkspace.getState().sessions[0].brushDynamics.gradientDither).toBe('vertical')
    } finally {
      vi.useRealTimers()
    }
  })

  it('migrates the previous implicit antialias default to off without dropping other settings', () => {
    localStorage.setItem('moonsprite.tool-settings.v1', JSON.stringify({ brushSize: 37, proceduralAntialias: true }))
    useWorkspace.getState().addSession(createDocument('migrated antialias', 8, 8, 'rgba'))

    const session = useWorkspace.getState().sessions[0]
    expect(session.brushSize).toBe(37)
    expect(session.proceduralAntialias).toBe(false)
    expect(session.brushPaintMode).toBe('paint')
  })

  it('disables procedural texture antialiasing by default and persists an explicit choice', () => {
    vi.useFakeTimers()
    try {
      useWorkspace.getState().addSession(createDocument('default antialias', 8, 8, 'rgba'))
      expect(useWorkspace.getState().sessions[0].proceduralAntialias).toBe(false)

      useWorkspace.getState().setProceduralAntialias(true)
      vi.advanceTimersByTime(101)
      useWorkspace.setState({ sessions: [], activeId: null, message: null, dialog: null })
      useWorkspace.getState().addSession(createDocument('persisted antialias', 8, 8, 'rgba'))
      expect(useWorkspace.getState().sessions[0].proceduralAntialias).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it('remembers separate settings for each texture and persists them for new sessions', () => {
    vi.useFakeTimers()
    try {
      useWorkspace.getState().addSession(createDocument('procedural settings', 8, 8, 'rgba'))
      useWorkspace.getState().setBrushImage(createProceduralBrush('procedural:noise'))
      useWorkspace.getState().setProceduralBrushSettings({ scale: 7, detail: 76, seed: 412 })
      useWorkspace.getState().setBrushImage(createProceduralBrush('procedural:clouds'))
      useWorkspace.getState().setProceduralBrushSettings({ scale: 43, detail: 2, seed: 913 })
      useWorkspace.getState().setBrushImage(createProceduralBrush('procedural:noise'))

      let session = useWorkspace.getState().sessions[0]
      expect(session.brushImage?.proceduralSettings).toMatchObject({ scale: 7, detail: 76, seed: 412 })
      expect(session.proceduralBrushSettings['procedural:clouds']).toMatchObject({ scale: 43, detail: 2, seed: 913 })

      vi.advanceTimersByTime(101)
      useWorkspace.setState({ sessions: [], activeId: null, message: null, dialog: null })
      useWorkspace.getState().addSession(createDocument('restored settings', 8, 8, 'rgba'))
      session = useWorkspace.getState().sessions[0]
      expect(session.proceduralBrushSettings['procedural:noise']).toMatchObject({ scale: 7, detail: 76, seed: 412 })
      expect(session.proceduralBrushSettings['procedural:clouds']).toMatchObject({ scale: 43, detail: 2, seed: 913 })
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('workspace history', () => {
  it('undoes and redoes slice creation, adjustment, and deletion', () => {
    const document = createDocument('slice history', 16, 12, 'rgba')
    useWorkspace.getState().addSession(document)

    const sliceId = useWorkspace.getState().createSlice({ x: 2, y: 3, width: 5, height: 4 })
    expect(sliceId).not.toBeNull()
    expect(document.slices).toHaveLength(1)
    expect(document.slices?.[0]).toMatchObject({ id: sliceId, x: 2, y: 3, width: 5, height: 4 })
    expect(useWorkspace.getState().sessions[0].selectedSliceId).toBe(sliceId)

    useWorkspace.getState().undo()
    expect(document.slices).toEqual([])
    expect(useWorkspace.getState().sessions[0].selectedSliceId).toBeNull()
    useWorkspace.getState().redo()
    expect(document.slices?.[0]).toMatchObject({ id: sliceId, x: 2, y: 3, width: 5, height: 4 })
    expect(useWorkspace.getState().sessions[0].selectedSliceId).toBe(sliceId)

    useWorkspace.getState().updateSlice(sliceId!, { x: 6, y: 1, width: 7, height: 8 })
    expect(document.slices?.[0]).toMatchObject({ x: 6, y: 1, width: 7, height: 8 })
    useWorkspace.getState().undo()
    expect(document.slices?.[0]).toMatchObject({ x: 2, y: 3, width: 5, height: 4 })
    useWorkspace.getState().redo()
    expect(document.slices?.[0]).toMatchObject({ x: 6, y: 1, width: 7, height: 8 })

    useWorkspace.getState().deleteSlice(sliceId!)
    expect(document.slices).toEqual([])
    expect(useWorkspace.getState().sessions[0].selectedSliceId).toBeNull()
    useWorkspace.getState().undo()
    expect(document.slices?.[0]).toMatchObject({ id: sliceId, x: 6, y: 1, width: 7, height: 8 })
    expect(useWorkspace.getState().sessions[0].selectedSliceId).toBe(sliceId)
    useWorkspace.getState().redo()
    expect(document.slices).toEqual([])
    expect(useWorkspace.getState().sessions[0].selectedSliceId).toBeNull()
  })

  it('creates an automatic slice batch as one undoable operation', () => {
    const document = createDocument('automatic slices', 24, 16, 'rgba')
    useWorkspace.getState().addSession(document)

    const ids = useWorkspace.getState().createSlices([
      { x: 0, y: 0, width: 8, height: 8 },
      { x: 8, y: 0, width: 8, height: 8 },
      { x: 16, y: 0, width: 8, height: 8 }
    ])
    expect(ids).toHaveLength(3)
    expect(document.slices).toHaveLength(3)
    expect(useWorkspace.getState().sessions[0].selectedSliceIds).toEqual(ids)

    useWorkspace.getState().undo()
    expect(document.slices).toEqual([])
    expect(useWorkspace.getState().sessions[0].selectedSliceIds).toEqual([])

    useWorkspace.getState().redo()
    expect(document.slices).toHaveLength(3)
    expect(useWorkspace.getState().sessions[0].selectedSliceIds).toEqual(ids)
  })

  it('selects, duplicates, moves, and deletes multiple slices as one operation', () => {
    const document = createDocument('multi slice history', 20, 16, 'rgba')
    useWorkspace.getState().addSession(document)
    const first = useWorkspace.getState().createSlice({ x: 1, y: 2, width: 3, height: 4 })!
    const second = useWorkspace.getState().createSlice({ x: 8, y: 5, width: 2, height: 3 })!

    useWorkspace.getState().selectAllSlices()
    expect(useWorkspace.getState().sessions[0].selectedSliceIds).toEqual([first, second])
    useWorkspace.getState().selectSlice(first, true)
    expect(useWorkspace.getState().sessions[0].selectedSliceIds).toEqual([second])
    useWorkspace.getState().selectSlice(first, true)
    expect(useWorkspace.getState().sessions[0].selectedSliceIds).toEqual([second, first])

    useWorkspace.getState().updateSlices({
      [first]: { x: 3, y: 4, width: 3, height: 4 },
      [second]: { x: 10, y: 7, width: 2, height: 3 }
    })
    expect(document.slices).toMatchObject([{ x: 3, y: 4 }, { x: 10, y: 7 }])
    useWorkspace.getState().undo()
    expect(document.slices).toMatchObject([{ x: 1, y: 2 }, { x: 8, y: 5 }])
    useWorkspace.getState().redo()

    const copies = useWorkspace.getState().duplicateSlices([first, second], {
      [first]: { x: 4, y: 5, width: 3, height: 4 },
      [second]: { x: 11, y: 8, width: 2, height: 3 }
    })
    expect(copies).toHaveLength(2)
    expect(document.slices).toHaveLength(4)
    expect(useWorkspace.getState().sessions[0].selectedSliceIds).toEqual(copies)
    useWorkspace.getState().undo()
    expect(document.slices).toHaveLength(2)
    useWorkspace.getState().redo()
    expect(document.slices).toHaveLength(4)

    useWorkspace.getState().deleteSlices(copies)
    expect(document.slices).toHaveLength(2)
    useWorkspace.getState().undo()
    expect(document.slices).toHaveLength(4)
    expect(useWorkspace.getState().sessions[0].selectedSliceIds).toEqual(copies)
  })

  it('does not dirty a clean document when undo or redo history is empty', () => {
    const document = createDocument('empty history', 3, 2, 'rgba')
    document.dirty = false
    useWorkspace.getState().addSession(document)

    useWorkspace.getState().undo()
    expect(document.dirty).toBe(false)

    useWorkspace.getState().redo()
    expect(document.dirty).toBe(false)
  })

  it('never lets project undo or redo change the current view', () => {
    const document = createDocument('view history isolation', 3, 2, 'rgba')
    useWorkspace.getState().addSession(document)
    const session = useWorkspace.getState().sessions[0]
    useWorkspace.getState().setView({ zoom: 9, panX: 34, panY: -18, rotation: 45 })
    useWorkspace.getState().pushHistory({
      label: 'malformed view history',
      bytes: 8,
      undo: () => Object.assign(session.view, { zoom: 1, panX: 0, panY: 0, rotation: 0 }),
      redo: () => Object.assign(session.view, { zoom: 2, panX: 4, panY: 6, rotation: 90 })
    })

    useWorkspace.getState().undo()
    expect(session.view).toMatchObject({ zoom: 9, panX: 34, panY: -18, rotation: 45 })
    useWorkspace.getState().redo()
    expect(session.view).toMatchObject({ zoom: 9, panX: 34, panY: -18, rotation: 45 })
  })

  it('publishes a history entry region without forcing full content invalidation', () => {
    const document = createDocument('history region', 8, 8, 'rgba')
    useWorkspace.getState().addSession(document)
    const session = useWorkspace.getState().sessions[0]

    useWorkspace.getState().pushHistory({
      label: 'move layer',
      bytes: 32,
      undo: () => {},
      redo: () => {},
      invalidation: { kind: 'region', rect: { x: 1, y: 2, width: 3, height: 4 } },
      affectedLayerIds: [document.activeLayerId],
      requiresAnimationSync: false
    })

    expect(session.contentInvalidation).toEqual({
      kind: 'region',
      rect: { x: 1, y: 2, width: 3, height: 4 },
      fromRevision: 0,
      revision: 1
    })
  })

  it('flushes a pending zoom preview before preserving the view for undo', () => {
    const document = createDocument('pending zoom history isolation', 3, 2, 'rgba')
    useWorkspace.getState().addSession(document)
    const session = useWorkspace.getState().sessions[0]
    useWorkspace.getState().setView({ zoom: 9, panX: 12, panY: -6 })
    useWorkspace.getState().pushHistory({ label: 'pixel operation', bytes: 1, undo: () => {}, redo: () => {} })
    const unregister = registerViewPreviewFlusher(document.id, () => {
      useWorkspace.getState().setView({ zoom: 14, panX: 28, panY: -10 })
    })

    try {
      useWorkspace.getState().undo()
      expect(session.view).toMatchObject({ zoom: 14, panX: 28, panY: -10 })
    } finally {
      unregister()
    }
  })
})

describe('foreground fill command', () => {
  it('shares foreground and background colors across open documents', () => {
    const first = createDocument('first colors', 1, 1, 'rgba')
    const second = createDocument('second colors', 1, 1, 'rgba')
    useWorkspace.getState().addSession(first)
    useWorkspace.getState().addSession(second)

    useWorkspace.getState().setPrimaryColor(red)
    useWorkspace.getState().setSecondaryColor(blue)
    useWorkspace.getState().setActive(first.id)

    for (const session of useWorkspace.getState().sessions) {
      expect(session.primaryColor).toEqual(red)
      expect(session.secondaryColor).toEqual(blue)
    }
  })

  it('shares a palette swatch selection with every open document', () => {
    const first = createDocument('first palette', 1, 1, 'rgba')
    const second = createDocument('second palette', 1, 1, 'rgba')
    useWorkspace.getState().addSession(first)
    useWorkspace.getState().addSession(second)
    useWorkspace.getState().setActive(first.id)
    let redId = first.palette.find((entry) => entry.color.r === red.r && entry.color.g === red.g && entry.color.b === red.b)?.id
    if (redId === undefined) {
      redId = 9001
      first.palette.push({ id: redId, name: 'Red', color: red })
    }
    if (!first.paletteOrder.includes(redId)) first.paletteOrder.push(redId)

    useWorkspace.getState().selectPaletteColor(redId)

    expect(useWorkspace.getState().sessions.every((session) => session.primaryColor.r === red.r && session.primaryColor.g === red.g && session.primaryColor.b === red.b)).toBe(true)
  })

  it('swaps foreground and background colors as one state update', () => {
    const document = createDocument('swap colors', 1, 1, 'rgba')
    useWorkspace.getState().addSession(document)
    useWorkspace.getState().setPrimaryColor(red)
    useWorkspace.getState().setSecondaryColor(blue)

    useWorkspace.getState().swapPrimarySecondaryColors()

    const session = useWorkspace.getState().sessions[0]
    expect(session.primaryColor).toEqual(blue)
    expect(session.secondaryColor).toEqual(red)
  })

  it('fills the active selection and supports undo and redo', () => {
    const document = createDocument('fill command', 3, 1, 'rgba')
    useWorkspace.getState().addSession(document)
    useWorkspace.getState().setPrimaryColor(blue)
    useWorkspace.getState().setSelection({ x: 1, y: 0, width: 1, height: 1 })

    useWorkspace.getState().fillForeground()
    const layer = getActiveLayer(document)
    expect(readLayerColor(document, layer, 0).a).toBe(0)
    expect(readLayerColor(document, layer, 1)).toEqual(blue)

    useWorkspace.getState().undo()
    expect(readLayerColor(document, layer, 1).a).toBe(0)
    useWorkspace.getState().redo()
    expect(readLayerColor(document, layer, 1)).toEqual(blue)
  })

  it('ignores the foreground fill command while a layer group is selected', () => {
    const document = createDocument('group fill command', 2, 1, 'rgba')
    const layer = getActiveLayer(document)
    document.groups.push({ id: 'group', name: '组', parentGroupId: null, visible: true, locked: false, opacity: 1, blendMode: 'normal' })
    layer.groupId = 'group'
    useWorkspace.getState().addSession(document)
    useWorkspace.getState().setPrimaryColor(blue)
    useWorkspace.getState().selectGroup('group')

    useWorkspace.getState().fillForeground()

    expect(readLayerColorAt(document, layer, 0, 0).a).toBe(0)
    expect(readLayerColorAt(document, layer, 1, 0).a).toBe(0)
    expect(useWorkspace.getState().sessions[0].history.canUndo).toBe(false)
    expect(useWorkspace.getState().message).toBeNull()
  })

  it('fills an uncovered canvas area on a cropped layer and remains undoable', () => {
    const document = createDocument('cropped fill command', 4, 3, 'rgba')
    const layer = getActiveLayer(document)
    if (layer.format !== 'rgba') throw new Error('wrong layer mode')
    layer.width = 1
    layer.height = 1
    layer.offsetX = 1
    layer.offsetY = 1
    layer.pixels = new Uint8ClampedArray(4)
    useWorkspace.getState().addSession(document)
    useWorkspace.getState().setPrimaryColor(blue)

    useWorkspace.getState().fillForeground()
    expect(readLayerColorAt(document, layer, 3, 2)).toEqual(blue)

    useWorkspace.getState().undo()
    expect(readLayerColorAt(document, layer, 3, 2).a).toBe(0)
    useWorkspace.getState().redo()
    expect(readLayerColorAt(document, layer, 3, 2)).toEqual(blue)
  })
})

describe('layer duplication', () => {
  it('duplicates all requested layers and removes them together on undo', () => {
    const document = createDocument('duplicate layers', 2, 2, 'rgba')
    document.layers.push(createLayer('second', 2, 2, 'rgba'))
    useWorkspace.getState().addSession(document)
    const originals = document.layers.map((layer) => layer.id)

    const copies = useWorkspace.getState().duplicateLayers(originals)

    expect(copies).toHaveLength(2)
    expect(document.layers.filter((layer) => copies.includes(layer.id))).toHaveLength(2)
    useWorkspace.getState().undo()
    expect(document.layers.map((layer) => layer.id)).toEqual(originals)
    useWorkspace.getState().redo()
    expect(document.layers.filter((layer) => copies.includes(layer.id))).toHaveLength(2)
  })
})

describe('selection clipboard', () => {
  it('moves a transformed selection boundary without moving the committed pixels again', () => {
    const document = createDocument('transformed selection boundary move', 10, 10, 'rgba')
    const layer = getActiveLayer(document)
    writeLayerColor(document, layer, 1 + layer.width, red)
    writeLayerColor(document, layer, 2 + layer.width, blue)
    useWorkspace.getState().addSession(document)
    const original = { x: 1, y: 1, width: 2, height: 1 }
    const target = { x: 4, y: 3, width: 4, height: 2 }
    const angle = 45
    const source = captureSelectionTransform(document, original, layer)!
    const preview = applySelectionTransform(document, source, target, angle)!
    const transformed = transformSelectionMask(source.selection, target, document.width, document.height, angle, undefined, false)!

    useWorkspace.getState().beginFloatingSelectionTransform(source, preview, original, transformed, false, 'transform', null, target, angle)
    useWorkspace.getState().commitFloatingPaste()
    const committedPixels = layer.pixels.slice()
    const committedSelection = useWorkspace.getState().sessions[0].selection!
    const movedSelection = { ...committedSelection, x: committedSelection.x + 1 }

    useWorkspace.getState().commitSelectionChange(committedSelection, movedSelection, 'move selection box')

    const session = useWorkspace.getState().sessions[0]
    expect(session.pendingPaste).toBeNull()
    expect(session.selection).toEqual(movedSelection)
    expect(layer.pixels).toEqual(committedPixels)
    useWorkspace.getState().undo()
    expect(session.selection).toEqual(committedSelection)
    expect(layer.pixels).toEqual(committedPixels)
    useWorkspace.getState().undo()
    expect(session.selection).toEqual(original)
    expect(readLayerColorAt(document, layer, 1, 1)).toEqual(red)
    expect(readLayerColorAt(document, layer, 2, 1)).toEqual(blue)
  })

  it('nudges selection content by one pixel and restores both pixels and bounds on undo', () => {
    const document = createDocument('selection nudge', 4, 2, 'rgba')
    const layer = getActiveLayer(document)
    writeLayerColor(document, layer, 1, red)
    useWorkspace.getState().addSession(document)
    useWorkspace.getState().setSelection({ x: 1, y: 0, width: 1, height: 1 })

    useWorkspace.getState().moveActiveSelectionWithSelectionHistory(1, 0)

    const session = useWorkspace.getState().sessions[0]
    expect(session.selection).toEqual({ x: 2, y: 0, width: 1, height: 1 })
    expect(readLayerColorAt(document, layer, 1, 0).a).toBe(0)
    expect(readLayerColorAt(document, layer, 2, 0)).toEqual(red)
    expect(session.pendingPaste).not.toBeNull()
    useWorkspace.getState().commitFloatingPaste()
    useWorkspace.getState().undo()
    expect(session.selection).toEqual({ x: 1, y: 0, width: 1, height: 1 })
    expect(readLayerColorAt(document, layer, 1, 0)).toEqual(red)
    expect(readLayerColorAt(document, layer, 2, 0).a).toBe(0)
  })

  it('wraps a deferred tiled selection move on commit and preserves it through undo and redo', () => {
    const document = createDocument('tiled selection commit', 4, 1, 'rgba')
    const layer = getActiveLayer(document)
    writeLayerColor(document, layer, 3, blue)
    useWorkspace.getState().addSession(document)
    useWorkspace.getState().setTileRepeatMode('x')
    const selection = { x: 3, y: 0, width: 1, height: 1 }
    const target = { ...selection, x: 4 }
    const source = captureSelectionTransform(document, selection, layer, { cacheOpaqueOffsets: false })!

    useWorkspace.getState().beginFloatingSelectionTransform(source, null, selection, target, false, 'repeat move', null, target, 0, undefined, true)
    useWorkspace.getState().commitFloatingPaste()

    const session = useWorkspace.getState().sessions[0]
    expect(session.selection).toEqual({ x: 0, y: 0, width: 1, height: 1 })
    expect(readLayerColorAt(document, layer, 3, 0).a).toBe(0)
    expect(readLayerColorAt(document, layer, 0, 0)).toEqual(blue)
    useWorkspace.getState().undo()
    expect(session.selection).toEqual(selection)
    expect(readLayerColorAt(document, layer, 3, 0)).toEqual(blue)
    expect(readLayerColorAt(document, layer, 0, 0).a).toBe(0)
    useWorkspace.getState().redo()
    expect(session.selection).toEqual({ x: 0, y: 0, width: 1, height: 1 })
    expect(readLayerColorAt(document, layer, 0, 0)).toEqual(blue)
  })

  it('restores unselected destination pixels while repeatedly nudging a floating selection', () => {
    const document = createDocument('selection nudge preserves backdrop', 5, 1, 'rgba')
    const layer = getActiveLayer(document)
    const green = { r: 0, g: 200, b: 80, a: 255 }
    writeLayerColor(document, layer, 1, red)
    writeLayerColor(document, layer, 2, blue)
    writeLayerColor(document, layer, 3, green)
    useWorkspace.getState().addSession(document)
    useWorkspace.getState().setSelection({ x: 1, y: 0, width: 1, height: 1 })

    useWorkspace.getState().moveActiveSelectionWithSelectionHistory(1, 0)
    useWorkspace.getState().moveActiveSelectionWithSelectionHistory(1, 0)

    const session = useWorkspace.getState().sessions[0]
    expect(session.selection).toEqual({ x: 3, y: 0, width: 1, height: 1 })
    expect(readLayerColorAt(document, layer, 1, 0).a).toBe(0)
    expect(readLayerColorAt(document, layer, 2, 0)).toEqual(blue)
    expect(readLayerColorAt(document, layer, 3, 0)).toEqual(red)

    useWorkspace.getState().commitFloatingPaste()
    useWorkspace.getState().undo()
    expect(session.selection).toEqual({ x: 1, y: 0, width: 1, height: 1 })
    expect(readLayerColorAt(document, layer, 1, 0)).toEqual(red)
    expect(readLayerColorAt(document, layer, 2, 0)).toEqual(blue)
    expect(readLayerColorAt(document, layer, 3, 0)).toEqual(green)
    useWorkspace.getState().redo()
    expect(readLayerColorAt(document, layer, 2, 0)).toEqual(blue)
    expect(readLayerColorAt(document, layer, 3, 0)).toEqual(red)
  })

  it('starts layer transform around the selected layer content', () => {
    const document = createDocument('layer transform', 8, 6, 'rgba')
    const layer = getActiveLayer(document)
    writeLayerColor(document, layer, 1 + 2 * layer.width, red)
    writeLayerColor(document, layer, 5 + 4 * layer.width, blue)
    useWorkspace.getState().addSession(document)
    useWorkspace.getState().setTool('pencil')

    useWorkspace.getState().beginLayerTransform()

    const session = useWorkspace.getState().sessions[0]
    expect(session.tool).toBe('selection')
    expect(session.selectionKind).toBe('rectangle')
    expect(session.selectionMode).toBe('replace')
    expect(session.selection).toEqual({ x: 1, y: 2, width: 5, height: 3 })
    expect(document.dirty).toBe(false)
  })

  it('starts one transform around the combined bounds of multiple selected pixel layers', () => {
    const document = createDocument('multi-layer transform bounds', 8, 6, 'rgba')
    const bottom = getActiveLayer(document)
    const top = createLayer('Top', 8, 6, 'rgba')
    document.layers.push(top)
    writeLayerColor(document, bottom, 1 + 2 * bottom.width, red)
    writeLayerColor(document, top, 6 + 4 * top.width, blue)
    useWorkspace.getState().addSession(document)
    useWorkspace.getState().selectLayerRows([bottom.id, top.id], [])

    useWorkspace.getState().beginLayerTransform()

    const session = useWorkspace.getState().sessions[0]
    expect(session.tool).toBe('selection')
    expect(session.selection).toEqual({ x: 1, y: 2, width: 6, height: 3 })
    expect(session.selectedLayerIds).toEqual([bottom.id, top.id])
    expect(session.selectedGroupIds).toEqual([])
    expect(document.activeLayerId).toBe(top.id)
  })

  it('moves and mirrors multiple selected layers as one undoable floating transform', () => {
    const document = createDocument('multi-layer floating transform', 8, 2, 'rgba')
    const bottom = getActiveLayer(document)
    const top = createLayer('Top', 8, 2, 'rgba')
    document.layers.push(top)
    writeLayerColor(document, bottom, 1, red)
    writeLayerColor(document, top, 2, blue)
    useWorkspace.getState().addSession(document)
    useWorkspace.getState().selectLayerRows([bottom.id, top.id], [])
    useWorkspace.getState().setSelection({ x: 1, y: 0, width: 2, height: 1 })

    useWorkspace.getState().moveActiveSelectionWithSelectionHistory(2, 0)
    let session = useWorkspace.getState().sessions[0]
    expect(session.pendingPaste?.layers?.map((layer) => layer.layerId)).toEqual([bottom.id, top.id])
    expect(readLayerColorAt(document, bottom, 3, 0)).toEqual(red)
    expect(readLayerColorAt(document, top, 4, 0)).toEqual(blue)

    useWorkspace.getState().flipActiveSelection('horizontal')
    expect(readLayerColorAt(document, bottom, 4, 0)).toEqual(red)
    expect(readLayerColorAt(document, top, 3, 0)).toEqual(blue)
    useWorkspace.getState().commitFloatingPaste()

    session = useWorkspace.getState().sessions[0]
    expect(session.pendingPaste).toBeNull()
    expect(session.selection).toEqual({ x: 3, y: 0, width: 2, height: 1 })
    useWorkspace.getState().undo()
    expect(session.selection).toEqual({ x: 1, y: 0, width: 2, height: 1 })
    expect(readLayerColorAt(document, bottom, 1, 0)).toEqual(red)
    expect(readLayerColorAt(document, top, 2, 0)).toEqual(blue)
    expect(readLayerColorAt(document, bottom, 4, 0)).toEqual(transparent)
    expect(readLayerColorAt(document, top, 3, 0)).toEqual(transparent)

    useWorkspace.getState().redo()
    expect(session.selection).toEqual({ x: 3, y: 0, width: 2, height: 1 })
    expect(readLayerColorAt(document, bottom, 4, 0)).toEqual(red)
    expect(readLayerColorAt(document, top, 3, 0)).toEqual(blue)
  })

  it('blocks mixed special layers instead of partially starting a multi-layer transform', () => {
    const document = createDocument('mixed transform targets', 4, 4, 'rgba')
    const pixelLayer = getActiveLayer(document)
    const textLayer = createLayer('Text', 4, 4, 'rgba')
    textLayer.kind = 'text'
    document.layers.push(textLayer)
    writeLayerColor(document, pixelLayer, 0, red)
    writeLayerColor(document, textLayer, 1, blue)
    useWorkspace.getState().addSession(document)
    useWorkspace.getState().selectLayerRows([pixelLayer.id, textLayer.id], [])

    useWorkspace.getState().beginLayerTransform()

    const session = useWorkspace.getState().sessions[0]
    expect(session.selection).toBeNull()
    expect(useWorkspace.getState().message).toContain('仅支持普通像素图层')
    expect(readLayerColorAt(document, pixelLayer, 0, 0)).toEqual(red)
    expect(readLayerColorAt(document, textLayer, 1, 0)).toEqual(blue)
  })

  it('does not start layer transform for an empty layer', () => {
    const document = createDocument('empty transform', 4, 4, 'rgba')
    useWorkspace.getState().addSession(document)

    useWorkspace.getState().beginLayerTransform()

    expect(useWorkspace.getState().sessions[0].selection).toBeNull()
    expect(useWorkspace.getState().message).toContain('没有可变换的内容')
  })

  it('keeps irregular selection masks interactive without dirtying an empty document', () => {
    const document = createDocument('masked selection', 4, 4, 'rgba')
    document.dirty = false
    useWorkspace.getState().addSession(document)
    const before = { x: 0, y: 0, width: 2, height: 2, mask: Uint8Array.from([0, 1, 1, 1]) }
    const after = { x: 1, y: 1, width: 2, height: 2, mask: Uint8Array.from([1, 1, 1, 0]) }
    useWorkspace.getState().setSelection(before)

    useWorkspace.getState().commitSelectionTransform(null, before, after, 'move masked selection')

    const session = useWorkspace.getState().sessions[0]
    expect(session.selection).toEqual(after)
    expect(document.dirty).toBe(false)
    session.history.undo()
    expect(session.selection).toEqual(before)
    session.history.redo()
    expect(session.selection).toEqual(after)
  })

  it('keeps the original destination background across repeated floating moves', () => {
    const document = createDocument('floating selection background', 4, 1, 'rgba')
    const layer = getActiveLayer(document)
    const darkBlue = { r: 12, g: 38, b: 86, a: 255 }
    writeLayerColor(document, layer, 0, red)
    writeLayerColor(document, layer, 2, darkBlue)
    useWorkspace.getState().addSession(document)
    const before = { x: 0, y: 0, width: 1, height: 1 }
    const firstTarget = { x: 2, y: 0, width: 1, height: 1 }
    const source = captureSelectionTransform(document, before)!
    const firstPreview = applySelectionTranslationPreview(document, source, firstTarget, false)

    useWorkspace.getState().beginFloatingSelectionTransform(source, null, before, firstTarget, false, '移动选区内容', firstPreview)
    expect(readLayerColorAt(document, layer, 2, 0)).toEqual(red)

    const pending = useWorkspace.getState().sessions[0].pendingPaste!
    expect(pending.previewEdit).toBeNull()
    expect(pending.translationPreview).toBe(firstPreview)
    const secondTarget = { x: 3, y: 0, width: 1, height: 1 }
    const secondPreview = applySelectionTranslationPreview(document, pending.source, secondTarget, pending.copy, pending.translationPreview)
    expect(secondPreview).toBe(firstPreview)
    useWorkspace.getState().updateFloatingPastePreview(null, secondTarget, secondPreview)

    expect(readLayerColorAt(document, layer, 2, 0)).toEqual(darkBlue)
    expect(readLayerColorAt(document, layer, 3, 0)).toEqual(red)
    useWorkspace.getState().commitFloatingPaste()
    useWorkspace.getState().undo()
    expect(readLayerColorAt(document, layer, 0, 0)).toEqual(red)
    expect(readLayerColorAt(document, layer, 2, 0)).toEqual(darkBlue)
  })

  it('commits and deselects a floating move in one store update without changing undo order', () => {
    const document = createDocument('floating deselect', 4, 1, 'rgba')
    const layer = getActiveLayer(document)
    writeLayerColor(document, layer, 0, red)
    useWorkspace.getState().addSession(document)
    const before = { x: 0, y: 0, width: 1, height: 1 }
    const target = { x: 2, y: 0, width: 1, height: 1 }
    const source = captureSelectionTransform(document, before, layer, { cacheOpaqueOffsets: false })!
    useWorkspace.getState().beginFloatingSelectionTransform(source, null, before, target, false, 'move', null, target, 0, undefined, true)

    expect(readLayerColorAt(document, layer, 0, 0)).toEqual(red)
    expect(readLayerColorAt(document, layer, 2, 0).a).toBe(0)

    useWorkspace.getState().commitFloatingPaste('deselect')

    let session = useWorkspace.getState().sessions[0]
    expect(session.pendingPaste).toBeNull()
    expect(session.selection).toBeNull()
    expect(session.contentInvalidation).toEqual(expect.objectContaining({ kind: 'region', rect: { x: 0, y: 0, width: 3, height: 1 } }))
    expect(readLayerColorAt(document, layer, 0, 0).a).toBe(0)
    expect(readLayerColorAt(document, layer, 2, 0)).toEqual(red)

    useWorkspace.getState().undo()
    session = useWorkspace.getState().sessions[0]
    expect(session.selection).toEqual(target)
    expect(readLayerColorAt(document, layer, 2, 0)).toEqual(red)

    useWorkspace.getState().undo()
    session = useWorkspace.getState().sessions[0]
    expect(session.selection).toEqual(before)
    expect(readLayerColorAt(document, layer, 0, 0)).toEqual(red)
    expect(readLayerColorAt(document, layer, 2, 0).a).toBe(0)
  })

  it('commits and deselects a fully selected compact cel without expanding its raster', () => {
    const document = createDocument('compact floating deselect', 1000, 800, 'rgba')
    useWorkspace.getState().addSession(document)
    const layer = getActiveLayer(document)
    layer.width = 2
    layer.height = 1
    layer.offsetX = 400
    layer.offsetY = 300
    layer.pixels = new Uint8ClampedArray([red.r, red.g, red.b, red.a, blue.r, blue.g, blue.b, blue.a])
    const pixels = layer.pixels
    const before = { x: 0, y: 0, width: document.width, height: document.height }
    const target = { ...before, x: 7, y: -3 }
    const source = captureSelectionTransform(document, before, layer, { cacheOpaqueOffsets: false })!
    useWorkspace.getState().beginFloatingSelectionTransform(source, null, before, target, false, 'move', null, target, 0, undefined, true)

    useWorkspace.getState().commitFloatingPaste('deselect')

    expect(layer.pixels).toBe(pixels)
    expect(layer).toMatchObject({ width: 2, height: 1, offsetX: 407, offsetY: 297 })
    useWorkspace.getState().undo()
    expect(useWorkspace.getState().sessions[0].selection).toEqual(target)
    expect(layer).toMatchObject({ offsetX: 407, offsetY: 297 })
    useWorkspace.getState().undo()
    expect(useWorkspace.getState().sessions[0].selection).toEqual(before)
    expect(layer.pixels).toBe(pixels)
    expect(layer).toMatchObject({ width: 2, height: 1, offsetX: 400, offsetY: 300 })
  })

  it('cancels a deferred floating move on undo without creating history or touching pixels', () => {
    const document = createDocument('cancel deferred move', 4, 1, 'rgba')
    const layer = getActiveLayer(document)
    writeLayerColor(document, layer, 0, red)
    useWorkspace.getState().addSession(document)
    const before = { x: 0, y: 0, width: 1, height: 1 }
    const target = { x: 2, y: 0, width: 1, height: 1 }
    const source = captureSelectionTransform(document, before, layer, { cacheOpaqueOffsets: false })!
    useWorkspace.getState().beginFloatingSelectionTransform(source, null, before, target, false, 'move', null, target, 0, undefined, true)

    useWorkspace.getState().undo()

    const session = useWorkspace.getState().sessions[0]
    expect(session.pendingPaste).toBeNull()
    expect(session.selection).toEqual(before)
    expect(session.history.canUndo).toBe(false)
    expect(readLayerColorAt(document, layer, 0, 0)).toEqual(red)
    expect(readLayerColorAt(document, layer, 2, 0).a).toBe(0)
  })

  it('commits each repeated Ctrl copy from the current floating selection position', () => {
    const document = createDocument('repeated floating copies', 4, 1, 'rgba')
    const layer = getActiveLayer(document)
    writeLayerColor(document, layer, 0, red)
    useWorkspace.getState().addSession(document)

    const copySelectionTo = (before: { x: number; y: number; width: number; height: number }, targetX: number): void => {
      const target = { ...before, x: targetX }
      const source = captureSelectionTransform(document, before)!
      const preview = applySelectionTranslationPreview(document, source, target, true)
      const edit = selectionTranslationPreviewEdit(document, preview)!
      useWorkspace.getState().beginFloatingSelectionTransform(source, edit, before, target, true, '复制选区内容')
      useWorkspace.getState().commitFloatingPaste()
    }

    copySelectionTo({ x: 0, y: 0, width: 1, height: 1 }, 1)
    copySelectionTo({ x: 1, y: 0, width: 1, height: 1 }, 2)

    expect([0, 1, 2].map((x) => readLayerColorAt(document, layer, x, 0))).toEqual([red, red, red])
    useWorkspace.getState().undo()
    expect(readLayerColorAt(document, layer, 0, 0)).toEqual(red)
    expect(readLayerColorAt(document, layer, 1, 0)).toEqual(red)
    expect(readLayerColorAt(document, layer, 2, 0)).toEqual(transparent)
  })

  it('retains one source rectangle across rotate, move, and rotate again', () => {
    const document = createDocument('repeated floating rotation', 9, 9, 'rgba')
    const layer = getActiveLayer(document)
    writeLayerColor(document, layer, 4 * document.width + 3, red)
    writeLayerColor(document, layer, 4 * document.width + 4, red)
    writeLayerColor(document, layer, 4 * document.width + 5, red)
    useWorkspace.getState().addSession(document)
    const selection = { x: 3, y: 4, width: 3, height: 1 }
    const source = captureSelectionTransform(document, selection)!
    const firstEdit = applySelectionTransform(document, source, selection, 45, true)!
    const rotated = transformSelectionMask(source.selection, selection, document.width, document.height, 45, undefined, false)!

    useWorkspace.getState().beginFloatingSelectionTransform(source, firstEdit, selection, rotated, true, 'copy', null, selection, 45)
    let pending = useWorkspace.getState().sessions[0].pendingPaste!

    expect(pending.transformTarget).toEqual(selection)
    expect(pending.transformAngle).toBe(45)
    expect(transformSelectionMask(pending.source.selection, pending.transformTarget!, document.width, document.height, pending.transformAngle, undefined, false)).toEqual(rotated)

    const movedTarget = { ...selection, x: selection.x + 1, y: selection.y - 1 }
    const moved = transformSelectionMask(source.selection, movedTarget, document.width, document.height, 45, undefined, false)!
    useWorkspace.getState().updateFloatingPastePreview(firstEdit, moved, null, movedTarget, 45)
    pending = useWorkspace.getState().sessions[0].pendingPaste!
    expect(pending.transformTarget).toEqual(movedTarget)
    expect(pending.transformAngle).toBe(45)

    const rotatedAgain = transformSelectionMask(source.selection, movedTarget, document.width, document.height, 90, undefined, false)!
    useWorkspace.getState().updateFloatingPastePreview(firstEdit, rotatedAgain, null, movedTarget, 90)
    pending = useWorkspace.getState().sessions[0].pendingPaste!
    expect(pending.source).toBe(source)
    expect(pending.transformTarget).toEqual(movedTarget)
    expect(pending.transformTarget?.width).toBe(selection.width)
    expect(pending.transformTarget?.height).toBe(selection.height)
    expect(pending.transformAngle).toBe(90)
    expect(pending.target).toEqual(rotatedAgain)
  })

  it('commits an empty floating selection rotation without creating a pixel edit', () => {
    const document = createDocument('empty floating selection rotation', 12, 12, 'rgba')
    useWorkspace.getState().addSession(document)
    const selection = { x: 3, y: 4, width: 6, height: 3 }
    const source = captureSelectionTransform(document, selection)!
    const rotated = transformSelectionMask(source.selection, selection, document.width, document.height, 45, undefined, false)!

    expect(applySelectionTransform(document, source, selection, 45)).toBeNull()
    useWorkspace.getState().beginFloatingSelectionTransform(source, null, selection, rotated, false, '变换选区', null, selection, 45)
    expect(useWorkspace.getState().sessions[0].pendingPaste?.transformAngle).toBe(45)

    useWorkspace.getState().commitFloatingPaste()
    expect(useWorkspace.getState().sessions[0].pendingPaste).toBeNull()
    expect(useWorkspace.getState().sessions[0].selection).toEqual(rotated)
    expect(document.dirty).toBe(false)

    useWorkspace.getState().undo()
    expect(useWorkspace.getState().sessions[0].selection).toEqual(selection)
    useWorkspace.getState().redo()
    expect(useWorkspace.getState().sessions[0].selection).toEqual(rotated)
  })

  it('preserves rotation and shear while moving a floating transform', () => {
    const document = createDocument('floating rotated shear', 12, 12, 'rgba')
    const layer = getActiveLayer(document)
    writeLayerColor(document, layer, 4 * document.width + 4, red)
    useWorkspace.getState().addSession(document)
    const selection = { x: 4, y: 4, width: 2, height: 2 }
    const source = captureSelectionTransform(document, selection)!
    const shear = { axis: 'x' as const, edge: 's' as const, amount: 2 }
    const transformed = transformSelectionMask(source.selection, selection, document.width, document.height, 30, shear, false)!
    const edit = applySelectionTransform(document, source, selection, 30, true, shear)!

    useWorkspace.getState().beginFloatingSelectionTransform(source, edit, selection, transformed, true, 'copy', null, selection, 30, shear)
    const movedTarget = { ...selection, x: 6, y: 3 }
    const moved = transformSelectionMask(source.selection, movedTarget, document.width, document.height, 30, shear, false)!
    useWorkspace.getState().updateFloatingPastePreview(edit, moved, null, movedTarget, 30, shear)

    const pending = useWorkspace.getState().sessions[0].pendingPaste!
    expect(pending.source).toBe(source)
    expect(pending.transformTarget).toEqual(movedTarget)
    expect(pending.transformAngle).toBe(30)
    expect(pending.transformShear).toEqual(shear)
    expect(pending.target).toEqual(moved)
  })

  it('keeps transformed geometry when flipping a rotated floating selection', () => {
    const document = createDocument('floating rotated flip', 10, 10, 'rgba')
    const layer = getActiveLayer(document)
    writeLayerColor(document, layer, 3 * document.width + 3, red)
    writeLayerColor(document, layer, 3 * document.width + 4, blue)
    useWorkspace.getState().addSession(document)
    const selection = { x: 3, y: 3, width: 2, height: 1 }
    const source = captureSelectionTransform(document, selection)!
    const rotated = transformSelectionMask(source.selection, selection, document.width, document.height, 45, undefined, false)!
    const edit = applySelectionTransform(document, source, selection, 45, true)!
    useWorkspace.getState().beginFloatingSelectionTransform(source, edit, selection, rotated, true, 'copy', null, selection, 45)

    useWorkspace.getState().flipActiveSelection('horizontal')

    const pending = useWorkspace.getState().sessions[0].pendingPaste!
    expect(pending.transformTarget).toEqual(selection)
    expect(pending.transformAngle).toBe(45)
    expect(pending.target).toEqual(transformSelectionMask(pending.source.selection, selection, document.width, document.height, 45, undefined, false))
  })

  it('keeps an original visible paste position floating until confirmation', async () => {
    const document = createDocument('clipboard', 4, 2, 'rgba')
    const source = getActiveLayer(document)
    if (source.format !== 'rgba') throw new Error('wrong layer mode')
    source.pixels.set([red.r, red.g, red.b, red.a], 0)
    source.pixels.set([0, 0, 0, 0], 4)
    writeLayerColor(document, source, 2, blue)
    useWorkspace.getState().addSession(document)
    useWorkspace.getState().setSelection({ x: 0, y: 0, width: 2, height: 1 })

    useWorkspace.getState().copySelection()
    useWorkspace.getState().setSelection({ x: 1, y: 0, width: 2, height: 1 })
    await useWorkspace.getState().pasteSelection()

    expect(document.layers).toHaveLength(1)
    const pasted = getActiveLayer(document)
    expect(pasted.id).toBe(source.id)
    expect(readLayerColor(document, pasted, 0)).toEqual(red)
    expect(readLayerColor(document, pasted, 1)).toEqual(transparent)
    expect(readLayerColor(document, pasted, 2)).toEqual(blue)
    expect(readLayerColor(document, source, 0)).toEqual(red)
    expect(useWorkspace.getState().sessions[0].selection?.mask).toEqual(Uint8Array.from([1, 0]))
    expect(useWorkspace.getState().sessions[0].pendingPaste).not.toBeNull()
    expect(useWorkspace.getState().sessions[0].tool).toBe('selection')

    useWorkspace.getState().commitFloatingPaste()
    expect(useWorkspace.getState().sessions[0].pendingPaste).toBeNull()

    useWorkspace.getState().undo()
    expect(document.layers).toHaveLength(1)
    expect(readLayerColor(document, source, 0)).toEqual(red)
    expect(readLayerColor(document, source, 1)).toEqual(transparent)
    expect(readLayerColor(document, source, 2)).toEqual(blue)

    useWorkspace.getState().redo()
    expect(document.layers).toHaveLength(1)
    expect(readLayerColor(document, getActiveLayer(document), 1)).toEqual(transparent)
    expect(readLayerColor(document, source, 0)).toEqual(red)
    expect(readLayerColor(document, source, 2)).toEqual(blue)
  })

  it('keeps the active layer selected when the layer selection is cleared', async () => {
    const readClipboardImage = vi.fn(async () => ({ width: 1, height: 1, data: Uint8Array.from([red.r, red.g, red.b, red.a]) }))
    installApi({ readClipboardImage })
    const document = createDocument('paste with retained target', 2, 2, 'rgba')
    const layer = getActiveLayer(document)
    useWorkspace.getState().addSession(document)
    useWorkspace.getState().clearLayerSelection()

    const session = useWorkspace.getState().sessions[0]
    expect(session.selectedLayerIds).toEqual([layer.id])
    expect(session.selectedGroupIds).toEqual([])
    expect(session.activeLayerMaskId).toBeNull()

    await useWorkspace.getState().pasteSelection()

    expect(readClipboardImage).toHaveBeenCalledOnce()
    expect(session.pendingPaste?.layerId).toBe(layer.id)
  })

  it('cancels an external floating paste without pixels or undo history remaining', async () => {
    installApi({ readClipboardImage: vi.fn(async () => ({ width: 1, height: 1, data: Uint8Array.from([red.r, red.g, red.b, red.a]) })) })
    const document = createDocument('cancel external paste', 2, 2, 'rgba')
    const layer = getActiveLayer(document)
    useWorkspace.getState().addSession(document)

    await useWorkspace.getState().pasteSelection()
    expect(readLayerColor(document, layer, 0)).toEqual(red)
    expect(useWorkspace.getState().sessions[0].history.canUndo).toBe(false)

    useWorkspace.getState().cancelFloatingPaste()

    expect(readLayerColor(document, layer, 0)).toEqual(transparent)
    expect(useWorkspace.getState().sessions[0].pendingPaste).toBeNull()
    expect(useWorkspace.getState().sessions[0].history.canUndo).toBe(false)
  })

  it('pastes a copied selection as an undoable new layer at its visible origin', async () => {
    const document = createDocument('paste layer', 8, 8, 'rgba')
    const source = getActiveLayer(document)
    writeLayerColor(document, source, 3 * document.width + 2, red)
    useWorkspace.getState().addSession(document)
    useWorkspace.getState().setSelection({ x: 2, y: 3, width: 1, height: 1 })
    useWorkspace.getState().copySelection()

    expect(await useWorkspace.getState().pasteAsNewLayer()).toBe(true)

    const pasted = getActiveLayer(document)
    expect(document.layers).toHaveLength(2)
    expect(pasted).toMatchObject({ offsetX: 2, offsetY: 3, width: 1, height: 1 })
    expect(readLayerColor(document, pasted, 0)).toEqual(red)
    useWorkspace.getState().undo()
    expect(document.layers).toHaveLength(1)
  })

  it('moves a floating paste without clearing its old destination and cancels cleanly', async () => {
    const document = createDocument('floating paste', 4, 1, 'rgba')
    const layer = getActiveLayer(document)
    writeLayerColor(document, layer, 0, red)
    writeLayerColor(document, layer, 1, blue)
    useWorkspace.getState().addSession(document)
    useWorkspace.getState().setSelection({ x: 0, y: 0, width: 1, height: 1 })
    useWorkspace.getState().copySelection()
    useWorkspace.getState().setSelection({ x: 1, y: 0, width: 1, height: 1 })
    await useWorkspace.getState().pasteSelection()

    const pending = useWorkspace.getState().sessions[0].pendingPaste
    if (!pending) throw new Error('missing floating paste')
    revertPixelEdit(document, pending.previewEdit)
    const target = { ...pending.target, x: 2 }
    const moved = applySelectionTransform(document, pending.source, target, 0, true)
    if (!moved) throw new Error('missing floating move')
    useWorkspace.getState().updateFloatingPastePreview(moved, target)

    expect(readLayerColor(document, layer, 1)).toEqual(blue)
    expect(readLayerColor(document, layer, 2)).toEqual(red)
    useWorkspace.getState().cancelFloatingPaste()
    expect(readLayerColor(document, layer, 1)).toEqual(blue)
    expect(readLayerColor(document, layer, 2)).toEqual(transparent)
    expect(useWorkspace.getState().sessions[0].selection).toEqual({ x: 1, y: 0, width: 1, height: 1 })
  })

  it('prefers an image currently copied by another application', async () => {
    installApi({ readClipboardImage: vi.fn(async () => ({
      width: 2,
      height: 1,
      data: Uint8Array.from([0, 0, 0, 0, blue.r, blue.g, blue.b, blue.a])
    })) })
    const document = createDocument('system clipboard', 4, 1, 'rgba')
    useWorkspace.getState().addSession(document)

    await useWorkspace.getState().pasteSelection()

    const layer = getActiveLayer(document)
    expect(useWorkspace.getState().sessions[0].tool).toBe('selection')
    expect(useWorkspace.getState().sessions[0].selection?.mask).toEqual(Uint8Array.from([0, 1]))
    expect(readLayerColor(document, layer, 1).a).toBe(0)
    expect(readLayerColor(document, layer, 2)).toEqual(blue)
  })

  it('keeps a large pasted image deferred until confirmation', async () => {
    const width = 257
    const height = 257
    const data = new Uint8Array(width * height * 4)
    for (let index = 0; index < width * height; index += 1) {
      const offset = index * 4
      data[offset] = red.r
      data[offset + 1] = red.g
      data[offset + 2] = red.b
      data[offset + 3] = red.a
    }
    installApi({ readClipboardImage: vi.fn(async () => ({ width, height, data })) })
    const document = createDocument('large deferred paste', 512, 512, 'rgba')
    const layer = getActiveLayer(document)
    useWorkspace.getState().addSession(document)
    const beforeContentRevision = useWorkspace.getState().sessions[0].contentRevision

    await useWorkspace.getState().pasteSelection()

    const session = useWorkspace.getState().sessions[0]
    const pending = session.pendingPaste
    if (!pending) throw new Error('missing floating paste')
    expect(pending.previewDeferred).toBe(true)
    expect(pending.previewEdit).toBeNull()
    expect(pending.source.selection.mask).toBeUndefined()
    expect(session.contentRevision).toBe(beforeContentRevision)
    expect(readLayerColorAt(document, layer, pending.target.x, pending.target.y)).toEqual(transparent)

    useWorkspace.getState().commitFloatingPaste()

    expect(readLayerColorAt(document, layer, pending.target.x, pending.target.y)).toEqual(red)
    useWorkspace.getState().undo()
    expect(readLayerColorAt(document, layer, pending.target.x, pending.target.y)).toEqual(transparent)
  })

  it('retains an oversized pasted image so hidden pixels can be moved into view', async () => {
    const colors = [red, blue, red, blue, red, blue]
    const data = new Uint8Array(colors.length * 4)
    for (let index = 0; index < colors.length; index += 1) {
      const offset = index * 4
      data[offset] = colors[index].r
      data[offset + 1] = colors[index].g
      data[offset + 2] = colors[index].b
      data[offset + 3] = colors[index].a
    }
    installApi({ readClipboardImage: vi.fn(async () => ({ width: 6, height: 1, data })) })
    const document = createDocument('oversized system clipboard', 3, 1, 'rgba')
    useWorkspace.getState().addSession(document)

    await useWorkspace.getState().pasteSelection()

    const pending = useWorkspace.getState().sessions[0].pendingPaste
    if (!pending) throw new Error('missing floating paste')
    expect(pending.source.selection).toMatchObject({ x: 0, y: 0, width: 6, height: 1 })
    revertPixelEdit(document, pending.previewEdit)
    const target = { ...pending.target, x: -3 }
    const moved = applySelectionTransform(document, pending.source, target, 0, true)
    if (!moved) throw new Error('missing moved paste')
    useWorkspace.getState().updateFloatingPastePreview(moved, target)

    const layer = getActiveLayer(document)
    expect(readLayerColor(document, layer, 0)).toEqual(blue)
    expect(readLayerColor(document, layer, 1)).toEqual(red)
    expect(readLayerColor(document, layer, 2)).toEqual(blue)
  })
})

describe('visible palette independence', () => {
  it('synchronizes unlocked foreground and background palette entries from color edits', () => {
    localStorage.setItem('moonsprite.palette-edit-locked', 'false')
    const document = createDocument('palette edit sync', 1, 1, 'rgba')
    useWorkspace.getState().addSession(document)
    const entry = document.palette.find((candidate) => candidate.id !== 0)!
    const foreground = { r: 17, g: 33, b: 49, a: 255 }
    const background = { r: 201, g: 203, b: 205, a: 255 }

    useWorkspace.getState().setPrimaryColor(entry.color)
    useWorkspace.getState().setPrimaryColor(foreground)
    expect(document.palette.find((candidate) => candidate.id === entry.id)?.color).toEqual(foreground)

    useWorkspace.getState().selectSecondaryPaletteColor(entry.id)
    useWorkspace.getState().setSecondaryColor(background)
    expect(document.palette.find((candidate) => candidate.id === entry.id)?.color).toEqual(background)
  })

  it('keeps palette editing attached to the selected swatch when colors are duplicated', () => {
    localStorage.setItem('moonsprite.palette-edit-locked', 'false')
    const document = createDocument('duplicate palette edit sync', 1, 1, 'rgba')
    useWorkspace.getState().addSession(document)
    const [duplicate, selected] = document.palette.filter((candidate) => candidate.id !== 0).slice(0, 2)
    duplicate.color = { ...selected.color }
    const replacement = { r: 13, g: 57, b: 91, a: 255 }

    useWorkspace.getState().selectPaletteColor(selected.id)
    useWorkspace.getState().setPrimaryColor(replacement)

    expect(document.palette.find((candidate) => candidate.id === selected.id)?.color).toEqual(replacement)
    expect(document.palette.find((candidate) => candidate.id === duplicate.id)?.color).not.toEqual(replacement)
    expect(useWorkspace.getState().sessions[0].paletteSelectionId).toBe(selected.id)
  })

  it('does not jump to another swatch when an unlocked selected color matches it', () => {
    localStorage.setItem('moonsprite.palette-edit-locked', 'false')
    const document = createDocument('palette edit no jump', 1, 1, 'rgba')
    useWorkspace.getState().addSession(document)
    const [target, selected] = document.palette.filter((candidate) => candidate.id !== 0).slice(0, 2)

    useWorkspace.getState().selectPaletteColor(selected.id)
    useWorkspace.getState().setPrimaryColor({ ...target.color })

    const session = useWorkspace.getState().sessions[0]
    expect(document.palette.find((candidate) => candidate.id === selected.id)?.color).toEqual(target.color)
    expect(session.paletteSelectionId).toBe(selected.id)
    expect(session.selectedPaletteIds).toEqual([selected.id])
  })

  it('does not select an existing swatch from an unlocked empty-slot color choice', () => {
    localStorage.setItem('moonsprite.palette-edit-locked', 'false')
    const document = createDocument('palette empty slot no jump', 1, 1, 'rgba')
    useWorkspace.getState().addSession(document)
    const existing = document.palette.find((candidate) => candidate.id !== 0)!
    useWorkspace.getState().selectPaletteColors([], -1)

    useWorkspace.getState().setPrimaryColor({ ...existing.color })

    const session = useWorkspace.getState().sessions[0]
    expect(session.paletteSelectionId).toBeNull()
    expect(session.selectedPaletteIds).toEqual([])
  })

  it('re-adds a deleted visible color and clears selection while unlocked', () => {
    localStorage.setItem('moonsprite.palette-edit-locked', 'false')
    const document = createDocument('palette restore deleted', 1, 1, 'rgba')
    useWorkspace.getState().addSession(document)
    const entry = document.palette.find((candidate) => candidate.id !== 0)!
    useWorkspace.getState().selectPaletteColor(entry.id)
    useWorkspace.getState().deletePaletteColor(entry.id)

    const restoredId = useWorkspace.getState().addPaletteColor({ ...entry.color })

    const session = useWorkspace.getState().sessions[0]
    expect(restoredId).toBe(entry.id)
    expect(document.paletteOrder).toContain(entry.id)
    expect(document.paletteSlots).toContain(entry.id)
    expect(session.paletteSelectionId).toBeNull()
    expect(session.selectedPaletteIds).toEqual([])
  })

  it('keeps the current color and visible palette selection synchronized', () => {
    const document = createDocument('palette selection', 1, 1, 'rgba')
    useWorkspace.getState().addSession(document)

    useWorkspace.getState().setPrimaryColor({ ...document.palette[1].color })
    expect(useWorkspace.getState().sessions[0].paletteSelectionId).toBe(document.palette[1].id)
    expect(useWorkspace.getState().sessions[0].selectedPaletteIds).toEqual([document.palette[1].id])

    useWorkspace.getState().setPrimaryColor(red)
    expect(useWorkspace.getState().sessions[0].paletteSelectionId).toBeNull()
    expect(useWorkspace.getState().sessions[0].selectedPaletteIds).toEqual([])

    useWorkspace.getState().selectPaletteColor(document.palette[0].id)
    expect(useWorkspace.getState().sessions[0].primaryColor).toEqual(document.palette[0].color)
  })

  it('remaps indexed pixels while retaining an internal color entry when its swatch is removed', () => {
    const document = createDocument('palette', 2, 1, 'indexed')
    const layer = getActiveLayer(document)
    if (layer.format !== 'indexed') throw new Error('wrong layer mode')
    layer.pixels[0] = 1
    useWorkspace.getState().addSession(document)
    useWorkspace.getState().selectPaletteColor(1)
    useWorkspace.getState().deletePaletteColor(1)

    expect(document.palette.some((entry) => entry.id === 1)).toBe(true)
    expect(document.paletteOrder.includes(1)).toBe(false)
    expect(layer.pixels[0]).toBe(2)
    expect(readLayerColor(document, layer, 0)).toEqual({ r: 41, g: 121, b: 255, a: 255 })

    useWorkspace.getState().undo()
    expect(layer.pixels[0]).toBe(1)
    expect(readLayerColor(document, layer, 0)).toEqual({ r: 24, g: 27, b: 33, a: 255 })
  })

  it('maps a newly painted indexed color without adding a hidden or visible swatch', () => {
    const document = createDocument('painted palette', 1, 1, 'indexed')
    const layer = getActiveLayer(document)
    writeLayerColor(document, layer, 0, red)

    expect(layer.pixels[0]).toBe(1)
    expect(document.palette.some((entry) => entry.color.r === 255 && entry.color.g === 0 && entry.color.b === 0)).toBe(false)
    expect(document.paletteOrder).toEqual([0, 1, 2])
  })

  it('reorders and deletes multiple palette colors as one history step', () => {
    const document = createDocument('multi palette', 1, 1, 'indexed')
    useWorkspace.getState().addSession(document)
    useWorkspace.getState().selectPaletteColor(1)
    useWorkspace.getState().selectPaletteColor(2, true)
    expect(document.paletteOrder).toEqual([0, 1, 2])
    expect(useWorkspace.getState().sessions[0].selectedPaletteIds).toEqual([1, 2])

    const reordered = repositionPaletteSlots(document.paletteSlots ?? [], [1, 2], 0, 1, document.paletteColumns)
    useWorkspace.getState().reorderPaletteColors([1, 2], reordered, document.paletteColumns ?? 8)
    expect(document.paletteOrder).toEqual([1, 2, 0])
    useWorkspace.getState().deletePaletteColors([1, 2])
    expect(document.paletteOrder).toEqual([0])

    useWorkspace.getState().undo()
    expect(document.paletteOrder).toEqual([1, 2, 0])
    useWorkspace.getState().redo()
    expect(document.paletteOrder).toEqual([0])
  })

  it('sorts palette colors compactly, keeps indexed transparency first, and restores the layout through undo', () => {
    const document = createDocument('sorted palette', 1, 1, 'indexed')
    document.palette.find((entry) => entry.id === 1)!.color = { r: 255, g: 0, b: 0, a: 255 }
    document.palette.find((entry) => entry.id === 2)!.color = { r: 20, g: 20, b: 20, a: 255 }
    document.paletteSlots = [0, null, 1, null, 2, null, null, null]
    document.paletteOrder = [0, 1, 2]
    useWorkspace.getState().addSession(document)

    useWorkspace.getState().sortPaletteColors('hue', 'ascending')
    expect(document.paletteOrder).toEqual([0, 2, 1])
    expect(document.paletteSlots).toEqual([0, 2, 1, null, null, null, null, null])

    useWorkspace.getState().undo()
    expect(document.paletteOrder).toEqual([0, 1, 2])
    expect(document.paletteSlots).toEqual([0, null, 1, null, 2, null, null, null])
  })

  it('reverses and gradients selected palette colors without changing indexed transparency', () => {
    const document = createDocument('palette color operations', 1, 1, 'indexed')
    const first = document.palette.find((entry) => entry.id === 1)!
    const second = document.palette.find((entry) => entry.id === 2)!
    first.color = { r: 255, g: 0, b: 0, a: 255 }
    second.color = { r: 0, g: 0, b: 255, a: 255 }
    const thirdId = document.nextColorId++
    document.palette.push({ id: thirdId, name: 'Middle', color: { r: 10, g: 20, b: 30, a: 255 } })
    document.paletteOrder = [0, 1, thirdId, 2]
    document.paletteSlots = [0, 1, thirdId, 2, null, null, null, null]
    useWorkspace.getState().addSession(document)
    const transparentBefore = { ...document.palette.find((entry) => entry.id === 0)!.color }

    useWorkspace.getState().selectPaletteColors([1, thirdId, 2], 1)
    useWorkspace.getState().reversePaletteColors()
    expect(first.color).toEqual({ r: 0, g: 0, b: 255, a: 255 })
    expect(second.color).toEqual({ r: 255, g: 0, b: 0, a: 255 })

    useWorkspace.getState().gradientPaletteColors(false)
    expect(document.palette.find((entry) => entry.id === thirdId)!.color).toEqual({ r: 128, g: 0, b: 128, a: 255 })
    expect(document.palette.find((entry) => entry.id === 0)!.color).toEqual(transparentBefore)

    useWorkspace.getState().undo()
    useWorkspace.getState().undo()
    expect(first.color).toEqual({ r: 255, g: 0, b: 0, a: 255 })
    expect(second.color).toEqual({ r: 0, g: 0, b: 255, a: 255 })
  })

  it('does not create a palette gradient without at least two selected colors', () => {
    const document = createDocument('palette gradient selection guard', 1, 1, 'rgba')
    useWorkspace.getState().addSession(document)
    const before = document.palette.map((entry) => ({ ...entry.color }))

    useWorkspace.getState().gradientPaletteColors(false)
    useWorkspace.getState().selectPaletteColor(document.paletteOrder[0])
    useWorkspace.getState().gradientPaletteColors(true)

    expect(document.palette.map((entry) => entry.color)).toEqual(before)
    expect(useWorkspace.getState().sessions[0].history.canUndo).toBe(false)
  })

  it('fills selected empty palette slots with a foreground-to-background gradient and supports undo', () => {
    const document = createDocument('empty palette gradient', 1, 1, 'rgba')
    useWorkspace.getState().addSession(document)
    useWorkspace.getState().setPrimaryColor({ r: 255, g: 0, b: 0, a: 255 })
    useWorkspace.getState().setSecondaryColor({ r: 0, g: 0, b: 255, a: 255 })
    const beforePaletteLength = document.palette.length
    const slots = [...(document.paletteSlots ?? []), null, null, null]

    useWorkspace.getState().gradientPaletteSlots([5, 6, 7], slots, document.paletteColumns ?? 8, false)

    const generatedIds = document.paletteSlots?.slice(5, 8) ?? []
    expect(generatedIds.every((id) => id !== null)).toBe(true)
    expect(generatedIds.map((id) => document.palette.find((entry) => entry.id === id)?.color)).toEqual([
      { r: 255, g: 0, b: 0, a: 255 },
      { r: 128, g: 0, b: 128, a: 255 },
      { r: 0, g: 0, b: 255, a: 255 }
    ])

    useWorkspace.getState().undo()
    expect(document.palette).toHaveLength(beforePaletteLength)
    expect(document.paletteSlots?.slice(5, 8)).toEqual([null, null, null])
  })

  it('moves a palette color into an empty fixed slot and restores the layout through undo', () => {
    const document = createDocument('palette empty slot', 1, 1, 'rgba')
    useWorkspace.getState().addSession(document)

    const reordered = repositionPaletteSlots(document.paletteSlots ?? [], [1], 12, 1, document.paletteColumns)
    useWorkspace.getState().reorderPaletteColors([1], reordered, document.paletteColumns ?? 8)

    expect(document.paletteSlots?.[0]).toBeNull()
    expect(document.paletteSlots?.[12]).toBe(1)
    expect(document.paletteOrder).toEqual([2, 1])

    useWorkspace.getState().undo()
    expect(document.paletteSlots?.slice(0, 3)).toEqual([1, 2, null])
    expect(document.paletteOrder).toEqual([1, 2])
  })

  it('applies a built-in palette and remaps indexed pixels to its visible colors', () => {
    const document = createDocument('built in palette', 1, 1, 'indexed')
    const layer = getActiveLayer(document)
    if (layer.format !== 'indexed') throw new Error('wrong layer mode')
    layer.pixels[0] = 1
    const originalOrder = [...document.paletteOrder]
    const originalColor = readLayerColor(document, layer, 0)
    useWorkspace.getState().addSession(document)

    useWorkspace.getState().applyPalette(builtInPalettes[0].colors)

    expect(document.paletteOrder[0]).toBe(0)
    expect(document.paletteOrder).toHaveLength(builtInPalettes[0].colors.length + 1)
    const remappedId = layer.pixels[0]
    expect(document.paletteOrder).toContain(remappedId)
    expect(readLayerColor(document, layer, 0)).toEqual(document.palette.find((entry) => entry.id === remappedId)?.color)
    expect(document.palette.some((entry) => entry.id === 1)).toBe(true)
    useWorkspace.getState().undo()
    expect(document.paletteOrder).toEqual(originalOrder)
    expect(layer.pixels[0]).toBe(1)
    expect(readLayerColor(document, layer, 0)).toEqual(originalColor)
    useWorkspace.getState().redo()
    expect(document.paletteOrder).toHaveLength(builtInPalettes[0].colors.length + 1)
    expect(layer.pixels[0]).toBe(remappedId)
  })

  it('applies and restores a saved two-dimensional palette layout', () => {
    const document = createDocument('positioned saved palette', 1, 1, 'rgba')
    const colors = document.paletteOrder.map((id) => ({ ...document.palette.find((entry) => entry.id === id)!.color }))
    const originalColumns = document.paletteColumns
    const originalSlots = [...(document.paletteSlots ?? [])]
    useWorkspace.getState().addSession(document)

    useWorkspace.getState().applyPalette(colors, { columns: 4, slots: [null, 0, null, 1] })

    expect(document.paletteColumns).toBe(4)
    expect(document.paletteSlots).toEqual([null, 1, null, 2])
    expect(document.paletteOrder).toEqual([1, 2])

    useWorkspace.getState().undo()
    expect(document.paletteColumns).toBe(originalColumns)
    expect(document.paletteSlots).toEqual(originalSlots)

    useWorkspace.getState().redo()
    expect(document.paletteColumns).toBe(4)
    expect(document.paletteSlots).toEqual([null, 1, null, 2])
  })
})

describe('nested layer groups', () => {
  it('duplicates a mixed selection of nested groups and direct layers with one undo step', () => {
    const document = createDocument('duplicate selected rows', 2, 2, 'rgba')
    const nestedMember = getActiveLayer(document)
    nestedMember.name = 'Nested member'
    nestedMember.groupId = 'child'
    const directLayer = createLayer('Direct layer', 2, 2, 'rgba')
    document.layers.push(directLayer)
    document.groups.push(
      { id: 'parent', name: 'Parent', parentGroupId: null, visible: true, locked: false, opacity: 1, blendMode: 'normal' },
      { id: 'child', name: 'Child', parentGroupId: 'parent', visible: true, locked: false, opacity: 1, blendMode: 'normal' },
      { id: 'empty-child', name: 'Empty child', parentGroupId: 'parent', visible: true, locked: false, opacity: 1, blendMode: 'normal' }
    )
    useWorkspace.getState().addSession(document)
    useWorkspace.getState().selectLayerRows([directLayer.id], ['parent'])

    const copies = useWorkspace.getState().duplicateSelectedLayerRows()

    expect(copies.groupIds).toHaveLength(1)
    expect(copies.layerIds).toHaveLength(1)
    const parentCopy = document.groups.find((group) => group.id === copies.groupIds[0])!
    const childCopy = document.groups.find((group) => group.parentGroupId === parentCopy.id && group.name.startsWith('Child '))!
    const emptyChildCopy = document.groups.find((group) => group.parentGroupId === parentCopy.id && group.name.startsWith('Empty child '))!
    expect(childCopy).toBeDefined()
    expect(emptyChildCopy).toBeDefined()
    expect(document.layers.some((layer) => layer.groupId === childCopy.id && layer.name.startsWith('Nested member '))).toBe(true)
    expect(document.layers.find((layer) => layer.id === copies.layerIds[0])?.groupId ?? null).toBeNull()
    expect(useWorkspace.getState().sessions[0].selectedGroupIds).toEqual(copies.groupIds)
    const copiedRows = new Set([...copies.groupIds, ...copies.layerIds])
    expect(buildLayerPanelTree(document).filter((node) => node.depth === 0).slice(0, 2).every((node) => copiedRows.has(node.id))).toBe(true)

    useWorkspace.getState().undo()
    expect(document.groups.map((group) => group.id)).toEqual(['parent', 'child', 'empty-child'])
    expect(document.layers.map((layer) => layer.id)).toEqual([nestedMember.id, directLayer.id])
    expect(useWorkspace.getState().sessions[0].selectedGroupIds).toEqual(['parent'])

    useWorkspace.getState().redo()
    expect(document.groups.some((group) => group.id === parentCopy.id)).toBe(true)
    expect(document.layers.some((layer) => layer.id === copies.layerIds[0])).toBe(true)
  })

  it('creates a group from the retained active layer after clearing the layer panel', () => {
    const document = createDocument('retained layer selection', 2, 2, 'rgba')
    const layer = getActiveLayer(document)
    useWorkspace.getState().addSession(document)
    useWorkspace.getState().clearLayerSelection()

    expect(useWorkspace.getState().sessions[0].selectedLayerIds).toEqual([layer.id])
    useWorkspace.getState().createLayerGroup()
    expect(document.groups).toHaveLength(1)
    expect(layer.groupId).toBe(document.groups[0].id)
  })

  it('creates an empty sibling group immediately above a directly selected group', () => {
    const document = createDocument('group above group', 2, 2, 'rgba')
    document.groups.push({ id: 'selected-group', name: 'Selected', parentGroupId: null, panelOrder: 1, visible: true, locked: false, opacity: 1, blendMode: 'normal' })
    useWorkspace.getState().addSession(document)
    useWorkspace.getState().selectGroup('selected-group')

    useWorkspace.getState().createLayerGroup()

    const created = document.groups.find((group) => group.id !== 'selected-group')!
    const tree = buildLayerPanelTree(document)
    expect(created.parentGroupId ?? null).toBeNull()
    expect(tree.findIndex((node) => node.id === created.id)).toBeLessThan(tree.findIndex((node) => node.id === 'selected-group'))
  })

  it('creates a new layer inside a selected member group but outside a directly selected group', async () => {
    const document = createDocument('grouped new layer', 2, 2, 'rgba')
    const member = getActiveLayer(document)
    document.groups.push({ id: 'group', name: '组', parentGroupId: null, visible: true, locked: false, opacity: 1, blendMode: 'normal' })
    member.groupId = 'group'
    useWorkspace.getState().addSession(document)

    useWorkspace.getState().selectLayer(member.id)
    await useWorkspace.getState().addLayer()
    expect(getActiveLayer(document).groupId).toBe('group')

    useWorkspace.getState().selectGroup('group')
    await useWorkspace.getState().addLayer()
    expect(getActiveLayer(document).groupId ?? null).toBeNull()
  })

  it('creates a sparse blank layer in a large document without consulting the full-document memory budget', async () => {
    const api = installApi({ getResourceInfo: vi.fn(async () => ({ totalBytes: 2 * 1024 ** 3, freeBytes: 256 * 1024 ** 2 })) })
    const document = createDocument('large sparse layer', 4596, 1767, 'rgba')
    useWorkspace.getState().addSession(document)

    await useWorkspace.getState().addLayer()

    const layer = getActiveLayer(document)
    expect(api.getResourceInfo).not.toHaveBeenCalled()
    expect(layer).toMatchObject({ width: 1, height: 1, offsetX: 0, offsetY: 0, format: 'rgba' })
    expect(layer.pixels.byteLength).toBe(4)
    expect(document.animation?.cels.find((cel) => cel.layerId === layer.id)?.surface?.pixels).toBe(layer.pixels)

    const edit = beginPixelEdit(layer.id)
    paintBrush(document, layer, edit, 4000, 1500, 32, blue, 'square')
    expect(layer.width).toBeLessThanOrEqual(160)
    expect(layer.height).toBeLessThanOrEqual(160)
    expect(readLayerColorAt(document, layer, 4000, 1500)).toEqual(blue)
  })

  it('blocks deleting a parent group when any descendant is explicitly locked', () => {
    const document = createDocument('descendant lock deletion', 2, 2, 'rgba')
    const layer = getActiveLayer(document)
    document.groups.push(
      { id: 'parent', name: '父组', parentGroupId: null, visible: true, locked: false, opacity: 1, blendMode: 'normal' },
      { id: 'child', name: '子组', parentGroupId: 'parent', visible: true, locked: true, opacity: 1, blendMode: 'normal' }
    )
    layer.groupId = 'child'
    useWorkspace.getState().addSession(document)
    useWorkspace.getState().selectGroup('parent')

    useWorkspace.getState().deleteSelectedLayers()

    expect(document.groups.map((group) => group.id)).toEqual(['parent', 'child'])
  })

  it('does not allow a child layer to unlock while an ancestor group is locked', () => {
    const document = createDocument('ancestor lock editing', 2, 2, 'rgba')
    const layer = getActiveLayer(document)
    layer.locked = true
    document.groups.push({ id: 'parent', name: '父组', parentGroupId: null, visible: true, locked: true, opacity: 1, blendMode: 'normal' })
    layer.groupId = 'parent'
    useWorkspace.getState().addSession(document)

    useWorkspace.getState().setLayerPropertiesWithBlend(layer.id, layer.name, layer.opacity, layer.blendMode, false)

    expect(layer.locked).toBe(true)
  })
  it('deletes an empty selected group and restores it with one undo', () => {
    const document = createDocument('empty group deletion', 2, 2, 'rgba')
    document.groups.push({ id: 'empty', name: '空组', parentGroupId: null, visible: true, locked: false, opacity: 1, blendMode: 'normal' })
    useWorkspace.getState().addSession(document)
    useWorkspace.getState().selectGroup('empty')

    useWorkspace.getState().deleteSelectedLayers()
    expect(document.groups).toHaveLength(0)
    useWorkspace.getState().undo()
    expect(document.groups.map((group) => group.id)).toEqual(['empty'])
  })

  it('rejects deleting or moving locked layers and groups', () => {
    const document = createDocument('locked structure', 2, 2, 'rgba')
    const layer = getActiveLayer(document)
    document.groups.push({ id: 'locked-group', name: '锁定组', parentGroupId: null, visible: true, locked: true, opacity: 1, blendMode: 'normal' })
    layer.groupId = 'locked-group'
    useWorkspace.getState().addSession(document)
    useWorkspace.getState().selectGroup('locked-group')

    useWorkspace.getState().deleteSelectedLayers()
    expect(document.groups.map((group) => group.id)).toEqual(['locked-group'])
    expect(document.layers.map((candidate) => candidate.id)).toEqual([layer.id])
    useWorkspace.getState().moveGroupToRootEdge('locked-group', 'bottom')
    expect(useWorkspace.getState().sessions[0].history.canUndo).toBe(false)
  })

  it('uses Ctrl for discrete selection and Shift for the visible layer range', () => {
    const document = createDocument('layer range selection', 2, 2, 'rgba')
    const bottom = getActiveLayer(document)
    const middle = createLayer('Middle', 2, 2, 'rgba')
    const top = createLayer('Top', 2, 2, 'rgba')
    document.layers.push(middle, top)
    useWorkspace.getState().addSession(document)
    const frameId = ensureAnimationDocument(document).activeFrameId

    useWorkspace.getState().selectLayer(top.id)
    useWorkspace.getState().selectLayer(bottom.id, 'range')
    expect(useWorkspace.getState().sessions[0].selectedLayerIds).toEqual([top.id, middle.id, bottom.id])
    expect(useWorkspace.getState().sessions[0].selectedAnimationCellKeys).toEqual([
      animationCelKey(top.id, frameId),
      animationCelKey(middle.id, frameId),
      animationCelKey(bottom.id, frameId)
    ])

    useWorkspace.getState().selectLayer(middle.id, 'toggle')
    expect(useWorkspace.getState().sessions[0].selectedLayerIds).toEqual([top.id, bottom.id])
    expect(useWorkspace.getState().sessions[0].selectedAnimationCellKeys).toEqual([
      animationCelKey(top.id, frameId),
      animationCelKey(bottom.id, frameId)
    ])

    useWorkspace.getState().selectLayer(top.id)
    useWorkspace.getState().selectLayer(top.id, 'toggle')
    expect(useWorkspace.getState().sessions[0].selectedLayerIds).toEqual([top.id])
  })

  it('includes groups in a Shift range and deletes the mixed selection in one step', () => {
    const document = createDocument('mixed layer range', 2, 2, 'rgba')
    const bottom = getActiveLayer(document)
    bottom.name = 'Bottom'
    const member = createLayer('Member', 2, 2, 'rgba')
    member.groupId = 'group'
    const outside = createLayer('Outside', 2, 2, 'rgba')
    document.layers.push(member, outside)
    document.groups.push({ id: 'group', name: 'Group', parentGroupId: null, visible: true, locked: false, opacity: 1, blendMode: 'normal' })
    useWorkspace.getState().addSession(document)

    useWorkspace.getState().selectGroup('group')
    useWorkspace.getState().selectLayer(bottom.id, 'range')
    const selected = useWorkspace.getState().sessions[0]
    expect(selected.selectedGroupIds).toEqual(['group'])
    expect(selected.selectedLayerIds).toEqual([member.id, bottom.id])

    useWorkspace.getState().deleteSelectedLayers()
    expect(document.groups).toHaveLength(0)
    expect(document.layers.map((layer) => layer.id)).toEqual([outside.id])

    useWorkspace.getState().undo()
    expect(document.groups.map((group) => group.id)).toEqual(['group'])
    expect(document.layers.map((layer) => layer.id)).toEqual([bottom.id, member.id, outside.id])
    expect(useWorkspace.getState().sessions[0].selectedGroupIds).toEqual(['group'])
  })

  it('selects descendant layers and prevents moving a parent into its child', () => {
    const document = createDocument('nested groups', 2, 2, 'rgba')
    const layer = getActiveLayer(document)
    document.groups.push(
      { id: 'parent', name: '父组', parentGroupId: null, visible: true, locked: true, opacity: 1, blendMode: 'normal' },
      { id: 'child', name: '子组', parentGroupId: 'parent', visible: true, locked: false, opacity: 1, blendMode: 'normal' }
    )
    layer.groupId = 'child'
    useWorkspace.getState().addSession(document)

    useWorkspace.getState().selectGroup('parent')
    expect(useWorkspace.getState().sessions[0].selectedLayerIds).toEqual([layer.id])
    expect(isLayerEffectivelyLocked(document, layer)).toBe(true)
    expect(isLayerEffectivelyVisible(document, layer)).toBe(true)
    document.groups.find((group) => group.id === 'parent')!.visible = false
    expect(isLayerEffectivelyVisible(document, layer)).toBe(false)

    useWorkspace.getState().assignGroupToGroup('parent', 'child')
    expect(document.groups.find((group) => group.id === 'parent')?.parentGroupId).toBeNull()
  })

  it('ungroups only the selected level and promotes its child groups', () => {
    const document = createDocument('ungroup nested', 2, 2, 'rgba')
    const layer = getActiveLayer(document)
    document.groups.push(
      { id: 'parent', name: '父组', parentGroupId: null, visible: true, locked: false, opacity: 1, blendMode: 'normal' },
      { id: 'child', name: '子组', parentGroupId: 'parent', visible: true, locked: false, opacity: 1, blendMode: 'normal' }
    )
    layer.groupId = 'child'
    useWorkspace.getState().addSession(document)
    useWorkspace.getState().selectGroup('parent')

    useWorkspace.getState().ungroupSelected()

    expect(document.groups.map((group) => group.id)).toEqual(['child'])
    expect(document.groups[0].parentGroupId).toBeNull()
    expect(layer.groupId).toBe('child')
  })

  it('moves grouped layers back to the root and restores their group on undo', () => {
    const document = createDocument('move to root', 2, 2, 'rgba')
    const layer = getActiveLayer(document)
    document.groups.push({ id: 'group', name: '组', parentGroupId: null, visible: true, locked: false, opacity: 1, blendMode: 'normal' })
    layer.groupId = 'group'
    useWorkspace.getState().addSession(document)

    useWorkspace.getState().assignLayersToRoot([layer.id])
    expect(layer.groupId).toBeNull()

    useWorkspace.getState().undo()
    expect(layer.groupId).toBe('group')
    useWorkspace.getState().redo()
    expect(layer.groupId).toBeNull()
  })

  it('moves root layers between group members and can place a member above its group', async () => {
    const document = createDocument('group drop positions', 2, 2, 'rgba')
    const first = getActiveLayer(document)
    document.groups.push({ id: 'group', name: 'Group', parentGroupId: null, visible: true, locked: false, opacity: 1, blendMode: 'normal' })
    first.groupId = 'group'
    useWorkspace.getState().addSession(document)
    await useWorkspace.getState().addLayer()
    const second = getActiveLayer(document)

    useWorkspace.getState().assignLayersToGroup([second.id], 'group', first.id, true)
    expect(second.groupId).toBe('group')
    expect(document.layers.map((layer) => layer.id)).toEqual([first.id, second.id])

    useWorkspace.getState().assignLayersAboveGroup([second.id], 'group')
    expect(second.groupId).toBeNull()
    expect(document.layers.map((layer) => layer.id)).toEqual([first.id, second.id])
    useWorkspace.getState().undo()
    expect(second.groupId).toBe('group')
  })

  it('creates new layers above the selected row after the selection is cleared', async () => {
    const document = createDocument('new layers on top', 2, 2, 'rgba')
    const original = getActiveLayer(document)
    useWorkspace.getState().addSession(document)

    await useWorkspace.getState().addLayer()
    const firstCreated = getActiveLayer(document)
    useWorkspace.getState().selectLayer(original.id)
    await useWorkspace.getState().addLayer()
    const latestCreated = getActiveLayer(document)

    expect(document.layers.map((layer) => layer.id)).toEqual([original.id, latestCreated.id, firstCreated.id])

    useWorkspace.getState().clearLayerSelection()
    await useWorkspace.getState().addLayer()
    const afterClearingSelection = getActiveLayer(document)
    expect(document.layers.indexOf(afterClearingSelection)).toBe(document.layers.indexOf(latestCreated) + 1)
  })

  it('reorders a complete group relative to another group and restores it on undo', async () => {
    const document = createDocument('reorder groups', 2, 2, 'rgba')
    const first = getActiveLayer(document)
    document.groups.push(
      { id: 'group-a', name: 'Group A', parentGroupId: null, visible: true, locked: false, opacity: 1, blendMode: 'normal' },
      { id: 'group-b', name: 'Group B', parentGroupId: null, visible: true, locked: false, opacity: 1, blendMode: 'normal' }
    )
    first.groupId = 'group-a'
    useWorkspace.getState().addSession(document)
    await useWorkspace.getState().addLayer()
    const second = getActiveLayer(document)
    second.groupId = 'group-b'

    useWorkspace.getState().reorderGroup('group-a', 'group-b', true)

    expect(document.layers.map((layer) => layer.id)).toEqual([second.id, first.id])
    expect(document.groups.map((group) => group.id)).toEqual(['group-b', 'group-a'])
    useWorkspace.getState().undo()
    expect(document.layers.map((layer) => layer.id)).toEqual([first.id, second.id])
    expect(document.groups.map((group) => group.id)).toEqual(['group-a', 'group-b'])
  })

  it('pastes a copied group beside the currently selected object', () => {
    const document = createDocument('nested group paste', 2, 2, 'rgba')
    const layer = getActiveLayer(document)
    layer.groupId = 'child'
    document.groups.push(
      { id: 'parent', name: 'Parent', parentGroupId: null, visible: true, locked: false, opacity: 1, blendMode: 'normal' },
      { id: 'child', name: 'Child', parentGroupId: 'parent', visible: true, locked: false, opacity: 1, blendMode: 'normal' },
      { id: 'sibling', name: 'Sibling', parentGroupId: 'parent', visible: true, locked: false, opacity: 1, blendMode: 'normal' }
    )
    useWorkspace.getState().addSession(document)
    useWorkspace.getState().selectGroup('child')

    useWorkspace.getState().copySelectedLayersToClipboard()
    useWorkspace.getState().selectGroup('sibling')
    expect(useWorkspace.getState().pasteLayersFromClipboard()).toBe(true)

    const copy = document.groups.find((group) => group.name === 'Child 副本')
    expect(copy?.parentGroupId).toBe('parent')
  })

  it('pastes plain layers immediately above the selected row or at root top', () => {
    const source = createDocument('plain layer source', 2, 2, 'rgba')
    getActiveLayer(source).name = 'Source'
    useWorkspace.getState().addSession(source)
    useWorkspace.getState().copySelectedLayersToClipboard()

    const target = createDocument('plain layer target', 2, 2, 'rgba')
    const member = getActiveLayer(target)
    member.name = 'Member'
    member.groupId = 'target-group'
    const rootBottom = createLayer('Root Bottom', 2, 2, 'rgba')
    const rootTop = createLayer('Root Top', 2, 2, 'rgba')
    target.layers.push(rootBottom, rootTop)
    target.groups.push({ id: 'target-group', name: 'Target Group', parentGroupId: null, visible: true, locked: false, opacity: 1, blendMode: 'normal' })
    useWorkspace.getState().addSession(target)
    useWorkspace.getState().setActive(target.id)

    useWorkspace.getState().selectGroup('target-group')
    expect(useWorkspace.getState().pasteLayersFromClipboard()).toBe(true)
    const copyAboveGroup = target.layers.find((layer) => layer.name === 'Source 副本' && !layer.groupId)!
    const treeAfterGroupPaste = buildLayerPanelTree(target)
    expect(treeAfterGroupPaste.findIndex((node) => node.id === copyAboveGroup.id)).toBeLessThan(treeAfterGroupPaste.findIndex((node) => node.id === 'target-group'))

    useWorkspace.getState().selectLayer(rootBottom.id)
    expect(useWorkspace.getState().pasteLayersFromClipboard()).toBe(true)
    const rootCopies = target.layers.filter((layer) => layer.name === 'Source 副本' && !layer.groupId)
    const copyAboveLayer = rootCopies.at(-1)!
    expect(target.layers.indexOf(copyAboveLayer)).toBe(target.layers.indexOf(rootBottom) + 1)

    useWorkspace.getState().clearLayerSelection()
    expect(useWorkspace.getState().pasteLayersFromClipboard()).toBe(true)
    const latestRootCopy = target.layers.filter((layer) => layer.name === 'Source 副本' && !layer.groupId).at(-1)!
    expect(target.layers.indexOf(latestRootCopy)).toBe(target.layers.indexOf(copyAboveLayer) + 1)
  })

  it('pastes a copied group immediately above the selected object in its parent', () => {
    const source = createDocument('group source', 2, 2, 'rgba')
    getActiveLayer(source).groupId = 'source-group'
    source.groups.push({ id: 'source-group', name: 'Source Group', parentGroupId: null, visible: true, locked: false, opacity: 1, blendMode: 'normal' })
    useWorkspace.getState().addSession(source)
    useWorkspace.getState().selectGroup('source-group')
    useWorkspace.getState().copySelectedLayersToClipboard()

    const target = createDocument('group target', 2, 2, 'rgba')
    const childAMember = getActiveLayer(target)
    childAMember.groupId = 'child-a'
    const childBMember = createLayer('Child B member', 2, 2, 'rgba')
    childBMember.groupId = 'child-b'
    target.layers.push(childBMember)
    target.groups.push(
      { id: 'parent', name: 'Parent', parentGroupId: null, visible: true, locked: false, opacity: 1, blendMode: 'normal' },
      { id: 'child-a', name: 'Child A', parentGroupId: 'parent', visible: true, locked: false, opacity: 1, blendMode: 'normal' },
      { id: 'child-b', name: 'Child B', parentGroupId: 'parent', visible: true, locked: false, opacity: 1, blendMode: 'normal' }
    )
    useWorkspace.getState().addSession(target)
    useWorkspace.getState().setActive(target.id)
    useWorkspace.getState().selectGroup('child-a')

    expect(useWorkspace.getState().pasteLayersFromClipboard()).toBe(true)
    const copiedGroup = target.groups.find((group) => group.name === 'Source Group 副本')!
    const copiedMember = target.layers.find((layer) => layer.groupId === copiedGroup.id)!
    expect(copiedGroup.parentGroupId).toBe('parent')
    const tree = buildLayerPanelTree(target)
    expect(tree.findIndex((node) => node.id === copiedGroup.id)).toBeLessThan(tree.findIndex((node) => node.id === 'child-a'))
    expect(copiedMember).toBeDefined()
    expect(useWorkspace.getState().sessions.at(-1)?.selectedGroupId).toBeNull()
    expect(useWorkspace.getState().sessions.at(-1)?.selectedGroupIds).toEqual([copiedGroup.id])
    expect(useWorkspace.getState().sessions.at(-1)?.selectedLayerIds).toEqual([copiedMember.id])

    useWorkspace.getState().undo()
    expect(useWorkspace.getState().sessions.at(-1)?.selectedGroupId).toBe('child-a')
    useWorkspace.getState().redo()
    expect(useWorkspace.getState().sessions.at(-1)?.selectedGroupIds).toEqual([copiedGroup.id])
    expect(useWorkspace.getState().sessions.at(-1)?.selectedLayerIds).toEqual([copiedMember.id])
  })

  it('allows locked layer metadata edits but preserves opacity and blend mode', () => {
    const document = createDocument('locked metadata', 1, 1, 'rgba')
    const layer = getActiveLayer(document)
    layer.locked = true
    layer.opacity = 0.5
    layer.blendMode = 'multiply'
    useWorkspace.getState().addSession(document)

    useWorkspace.getState().setLayerPropertiesWithBlend(layer.id, '已重命名', 0.9, 'screen', true, red, '可编辑描述')

    expect(layer).toMatchObject({ name: '已重命名', opacity: 0.5, blendMode: 'multiply', description: '可编辑描述' })
    expect(layer.displayColor).toEqual(red)
  })

  it('commits cumulative group blending with undo and redo', () => {
    const document = createDocument('cumulative group property', 1, 1, 'rgba')
    document.groups.push({ id: 'group', name: 'Group', parentGroupId: null, visible: true, locked: false, opacity: 1, blendMode: 'multiply' })
    useWorkspace.getState().addSession(document)

    useWorkspace.getState().setGroupProperties('group', 'Group', 1, 'multiply', false, undefined, undefined, true)
    expect(document.groups[0].cumulativeBlend).toBe(true)

    useWorkspace.getState().undo()
    expect(document.groups[0].cumulativeBlend).toBe(false)

    useWorkspace.getState().redo()
    expect(document.groups[0].cumulativeBlend).toBe(true)
  })

  it('commits clipping masks for layers and groups with undo and redo', () => {
    const document = createDocument('clipping mask property', 1, 1, 'rgba')
    const layer = getActiveLayer(document)
    document.groups.push({ id: 'group', name: 'Group', parentGroupId: null, visible: true, locked: false, opacity: 1, blendMode: 'normal' })
    useWorkspace.getState().addSession(document)

    useWorkspace.getState().setClippingMask('layer', layer.id, true)
    expect(layer.clippingMask).toBe(true)
    useWorkspace.getState().undo()
    expect(layer.clippingMask).toBeUndefined()
    useWorkspace.getState().redo()
    expect(layer.clippingMask).toBe(true)

    useWorkspace.getState().setClippingMask('group', 'group', true)
    expect(document.groups[0].clippingMask).toBe(true)
    useWorkspace.getState().undo()
    expect(document.groups[0].clippingMask).toBeUndefined()
  })

  it('toggles clipping masks on the selected group or active layer', () => {
    const document = createDocument('active clipping mask target', 1, 1, 'rgba')
    const layer = getActiveLayer(document)
    document.groups.push({ id: 'group', name: 'Group', parentGroupId: null, visible: true, locked: false, opacity: 1, blendMode: 'normal' })
    useWorkspace.getState().addSession(document)

    useWorkspace.getState().toggleActiveClippingMask()
    expect(layer.clippingMask).toBe(true)

    useWorkspace.getState().selectGroup('group')
    useWorkspace.getState().toggleActiveClippingMask()
    expect(document.groups[0].clippingMask).toBe(true)
    expect(layer.clippingMask).toBe(true)
  })

  it('preserves locked opacity through compatibility property setters', () => {
    const document = createDocument('locked compatibility setters', 1, 1, 'rgba')
    const layer = getActiveLayer(document)
    layer.locked = true
    layer.opacity = 0.5
    useWorkspace.getState().addSession(document)

    useWorkspace.getState().setLayerOpacity(layer.id, 0.9)
    expect(document.dirty).toBe(false)
    expect(useWorkspace.getState().sessions[0].history.canUndo).toBe(false)

    useWorkspace.getState().setLayerProperties(layer.id, '已重命名', 0.8)

    expect(layer.name).toBe('已重命名')
    expect(layer.opacity).toBe(0.5)
  })
})

describe('selection view commands', () => {
  it('inverts the active mask with undo while outline visibility stays view-only', () => {
    const document = createDocument('selection commands', 3, 2, 'rgba')
    useWorkspace.getState().addSession(document)
    useWorkspace.getState().setSelection({ x: 0, y: 0, width: 1, height: 1 })

    useWorkspace.getState().invertSelection()
    const session = useWorkspace.getState().sessions[0]
    expect(session.selection?.mask?.reduce((total, value) => total + value, 0)).toBe(5)
    expect(document.dirty).toBe(false)

    const undoBeforeToggle = session.history.canUndo
    useWorkspace.getState().toggleSelectionOutline()
    expect(session.view.showSelectionOutline).toBe(false)
    expect(session.history.canUndo).toBe(undoBeforeToggle)

    useWorkspace.getState().undo()
    expect(session.selection).toEqual({ x: 0, y: 0, width: 1, height: 1 })
  })

  it('keeps Ctrl+H view-only while a pasted selection remains cancelable', async () => {
    installApi({ readClipboardImage: vi.fn(async () => ({ width: 1, height: 1, data: Uint8Array.from([red.r, red.g, red.b, red.a]) })) })
    const document = createDocument('floating paste outline', 3, 1, 'rgba')
    useWorkspace.getState().addSession(document)
    useWorkspace.getState().setSelection({ x: 0, y: 0, width: 1, height: 1 })

    await useWorkspace.getState().pasteSelection()
    const session = useWorkspace.getState().sessions[0]
    const pastedX = session.pendingPaste?.target.x
    expect(pastedX).toBeTypeOf('number')
    expect(readLayerColorAt(document, getActiveLayer(document), pastedX!, 0)).toEqual(red)

    const revisionBeforeToggle = session.revision
    useWorkspace.getState().toggleSelectionOutline()
    expect(session.pendingPaste).not.toBeNull()
    expect(session.revision).toBeGreaterThan(revisionBeforeToggle)

    useWorkspace.getState().undo()
    expect(session.pendingPaste).toBeNull()
    expect(readLayerColorAt(document, getActiveLayer(document), pastedX!, 0)).toEqual(transparent)
  })

  it('restores the exact floating paste background after outline and mirror operations', async () => {
    installApi({ readClipboardImage: vi.fn(async () => ({ width: 1, height: 1, data: Uint8Array.from([red.r, red.g, red.b, red.a]) })) })
    const document = createDocument('floating mirror cleanup', 4, 1, 'rgba')
    const layer = getActiveLayer(document)
    writeLayerColor(document, layer, 1, blue)
    writeLayerColor(document, layer, 3, { r: 12, g: 38, b: 86, a: 255 })
    useWorkspace.getState().addSession(document)
    useWorkspace.getState().setSelection({ x: 0, y: 0, width: 1, height: 1 })
    useWorkspace.getState().copySelection()
    useWorkspace.getState().setSelection({ x: 1, y: 0, width: 1, height: 1 })
    await useWorkspace.getState().pasteSelection()
    useWorkspace.getState().toggleSelectionOutline()
    useWorkspace.getState().flipActiveSelection('horizontal')
    const pending = useWorkspace.getState().sessions[0].pendingPaste!
    revertPixelEdit(document, pending.previewEdit)
    const movedTarget = { ...pending.target, x: 2 }
    const moved = applySelectionTransform(document, pending.source, movedTarget, 0, true)!
    useWorkspace.getState().updateFloatingPastePreview(moved, movedTarget)
    useWorkspace.getState().cancelFloatingPaste()

    expect(readLayerColorAt(document, layer, 0, 0)).toEqual(transparent)
    expect(readLayerColorAt(document, layer, 1, 0)).toEqual(blue)
    expect(readLayerColorAt(document, layer, 2, 0)).toEqual(transparent)
    expect(readLayerColorAt(document, layer, 3, 0)).toEqual({ r: 12, g: 38, b: 86, a: 255 })
  })

  it('keeps the current floating pixels after mirroring, moving, and mirroring again', async () => {
    const document = createDocument('floating mirror after move', 6, 1, 'rgba')
    const layer = getActiveLayer(document)
    writeLayerColor(document, layer, 0, red)
    writeLayerColor(document, layer, 1, blue)
    useWorkspace.getState().addSession(document)
    useWorkspace.getState().setSelection({ x: 0, y: 0, width: 2, height: 1 })
    useWorkspace.getState().copySelection()
    useWorkspace.getState().setSelection({ x: 2, y: 0, width: 2, height: 1 })
    await useWorkspace.getState().pasteSelection()

    useWorkspace.getState().flipActiveSelection('horizontal')
    const pending = useWorkspace.getState().sessions[0].pendingPaste!
    revertPixelEdit(document, pending.previewEdit)
    const movedTarget = { ...pending.target, x: Math.min(document.width - pending.target.width, pending.target.x + 1) }
    const moved = applySelectionTransform(document, pending.source, movedTarget, 0, true)!
    useWorkspace.getState().updateFloatingPastePreview(moved, movedTarget)
    useWorkspace.getState().flipActiveSelection('horizontal')

    expect(readLayerColorAt(document, layer, movedTarget.x, 0)).toEqual(red)
    expect(readLayerColorAt(document, layer, movedTarget.x + 1, 0)).toEqual(blue)
  })

  it('moves a pasted floating selection after every repeated mirror without corrupting its background', async () => {
    const document = createDocument('pasted repeated mirror moves', 10, 1, 'rgba')
    const layer = getActiveLayer(document)
    const background = Array.from({ length: 10 }, (_, index) => ({ r: 8 + index, g: 20 + index, b: 40 + index, a: 255 }))
    background.forEach((color, index) => writeLayerColor(document, layer, index, color))
    installApi({ readClipboardImage: vi.fn(async () => ({ width: 2, height: 1, data: Uint8Array.from([red.r, red.g, red.b, red.a, blue.r, blue.g, blue.b, blue.a]) })) })
    useWorkspace.getState().addSession(document)
    background.forEach((color, index) => expect(readLayerColorAt(document, layer, index, 0)).toEqual(color))
    await useWorkspace.getState().pasteSelection()

    const moveFloating = (x: number): void => {
      const pending = useWorkspace.getState().sessions[0].pendingPaste!
      revertPixelEdit(document, pending.previewEdit)
      const target = { ...pending.target, x }
      const preview = applySelectionTranslationPreview(document, pending.source, target, false)
      useWorkspace.getState().updateFloatingPastePreview(selectionTranslationPreviewEdit(document, preview)!, target)
    }
    useWorkspace.getState().flipActiveSelection('horizontal')
    moveFloating(4)
    useWorkspace.getState().flipActiveSelection('horizontal')
    moveFloating(7)
    useWorkspace.getState().flipActiveSelection('horizontal')

    expect(readLayerColorAt(document, layer, 7, 0)).toEqual(blue)
    expect(readLayerColorAt(document, layer, 8, 0)).toEqual(red)
    background.forEach((color, index) => {
      if (index !== 7 && index !== 8) expect(readLayerColorAt(document, layer, index, 0)).toEqual(color)
    })
    useWorkspace.getState().cancelFloatingPaste()
    background.forEach((color, index) => expect(readLayerColorAt(document, layer, index, 0)).toEqual(color))
  })

  it('keeps a moved selection mirrored through repeated mirrors and later moves', () => {
    const document = createDocument('repeated floating mirror moves', 8, 1, 'rgba')
    const layer = getActiveLayer(document)
    writeLayerColor(document, layer, 0, red)
    writeLayerColor(document, layer, 1, blue)
    useWorkspace.getState().addSession(document)
    const original = { x: 0, y: 0, width: 2, height: 1 }
    const source = captureSelectionTransform(document, original)!
    const firstTarget = { ...original, x: 2 }
    const firstEdit = applySelectionTransform(document, source, firstTarget)!
    useWorkspace.getState().beginFloatingSelectionTransform(source, firstEdit, original, firstTarget, false, 'move')

    useWorkspace.getState().flipActiveSelection('horizontal')
    let pending = useWorkspace.getState().sessions[0].pendingPaste!
    revertPixelEdit(document, pending.previewEdit)
    const secondTarget = { ...pending.target, x: 4 }
    const secondPreview = applySelectionTranslationPreview(document, pending.source, secondTarget)
    useWorkspace.getState().updateFloatingPastePreview(selectionTranslationPreviewEdit(document, secondPreview)!, secondTarget)

    expect(readLayerColorAt(document, layer, 4, 0)).toEqual(blue)
    expect(readLayerColorAt(document, layer, 5, 0)).toEqual(red)

    useWorkspace.getState().flipActiveSelection('horizontal')
    pending = useWorkspace.getState().sessions[0].pendingPaste!
    revertPixelEdit(document, pending.previewEdit)
    const thirdTarget = { ...pending.target, x: 6 }
    const thirdPreview = applySelectionTranslationPreview(document, pending.source, thirdTarget)
    useWorkspace.getState().updateFloatingPastePreview(selectionTranslationPreviewEdit(document, thirdPreview)!, thirdTarget)

    expect(readLayerColorAt(document, layer, 4, 0)).toEqual(transparent)
    expect(readLayerColorAt(document, layer, 5, 0)).toEqual(transparent)
    expect(readLayerColorAt(document, layer, 6, 0)).toEqual(red)
    expect(readLayerColorAt(document, layer, 7, 0)).toEqual(blue)
  })

  it.each([
    ['horizontal', { red: [7, 3], blue: [6, 4] }],
    ['vertical', { red: [6, 4], blue: [7, 3] }]
  ] as const)('does not leave the first deferred move behind after a %s mirror and another move', (axis, expected) => {
    const document = createDocument(`deferred ${axis} mirror move`, 8, 6, 'rgba')
    const layer = getActiveLayer(document)
    writeLayerColor(document, layer, 0, red)
    writeLayerColor(document, layer, 1 + layer.width, blue)
    useWorkspace.getState().addSession(document)
    const original = { x: 0, y: 0, width: 2, height: 2 }
    const firstTarget = { ...original, x: 3 }
    const finalTarget = { ...original, x: 6, y: 3 }
    const source = captureSelectionTransform(document, original, layer)!

    useWorkspace.getState().beginFloatingSelectionTransform(
      source,
      null,
      original,
      firstTarget,
      false,
      'move',
      null,
      firstTarget,
      0,
      undefined,
      true
    )
    useWorkspace.getState().flipActiveSelection(axis)

    const pending = useWorkspace.getState().sessions[0].pendingPaste!
    expect(pending.previewDeferred).toBe(true)
    expect(pending.previewEdit).toBeNull()
    expect(readLayerColorAt(document, layer, 0, 0)).toEqual(red)
    expect(readLayerColorAt(document, layer, 1, 1)).toEqual(blue)

    useWorkspace.getState().updateFloatingPastePreview(null, finalTarget, null, finalTarget, 0, undefined, true)
    useWorkspace.getState().commitFloatingPaste()

    expect(useWorkspace.getState().sessions[0].pendingPaste).toBeNull()
    for (let y = 0; y < 2; y += 1) for (let x = 0; x < 2; x += 1) {
      expect(readLayerColorAt(document, layer, x, y)).toEqual(transparent)
      expect(readLayerColorAt(document, layer, firstTarget.x + x, firstTarget.y + y)).toEqual(transparent)
    }
    expect(readLayerColorAt(document, layer, expected.red[0], expected.red[1])).toEqual(red)
    expect(readLayerColorAt(document, layer, expected.blue[0], expected.blue[1])).toEqual(blue)
  })

  it('keeps sparse drawn pixels mirrored after move, repeated mirror, and another move', () => {
    const document = createDocument('drawn repeated mirror moves', 10, 1, 'rgba')
    const layer = getActiveLayer(document)
    writeLayerColor(document, layer, 0, red)
    writeLayerColor(document, layer, 2, blue)
    useWorkspace.getState().addSession(document)
    const original = { x: 0, y: 0, width: 4, height: 1 }
    useWorkspace.getState().setSelection(original)

    useWorkspace.getState().flipActiveSelection('horizontal')
    const mirroredSelection = useWorkspace.getState().sessions[0].selection!
    const source = captureSelectionTransform(document, mirroredSelection)!
    const firstTarget = { ...mirroredSelection, x: 3 }
    const firstEdit = applySelectionTransform(document, source, firstTarget)!
    useWorkspace.getState().beginFloatingSelectionTransform(source, firstEdit, mirroredSelection, firstTarget, false, 'move')

    useWorkspace.getState().flipActiveSelection('horizontal')
    const pending = useWorkspace.getState().sessions[0].pendingPaste!
    revertPixelEdit(document, pending.previewEdit)
    const secondTarget = { ...pending.target, x: 6 }
    const secondPreview = applySelectionTranslationPreview(document, pending.source, secondTarget)
    useWorkspace.getState().updateFloatingPastePreview(selectionTranslationPreviewEdit(document, secondPreview)!, secondTarget)

    expect(readLayerColorAt(document, layer, 6, 0)).toEqual(red)
    expect(readLayerColorAt(document, layer, 7, 0)).toEqual(transparent)
    expect(readLayerColorAt(document, layer, 8, 0)).toEqual(blue)
    expect(readLayerColorAt(document, layer, 9, 0)).toEqual(transparent)
  })
})

describe('animation keyboard navigation', () => {
  it('steps left and right through animation frames without entering document history', () => {
    const document = createDocument('frame navigation', 1, 1, 'rgba')
    useWorkspace.getState().addSession(document)
    useWorkspace.getState().duplicateAnimationFrame()
    const session = useWorkspace.getState().sessions[0]
    useWorkspace.getState().setSelection({ x: 0, y: 0, width: 1, height: 1 })
    const first = document.animation!.frames[0].id
    const second = document.animation!.frames[1].id
    expect(document.animation!.activeFrameId).toBe(second)

    useWorkspace.getState().stepAnimationFrame(-1)
    expect(document.animation!.activeFrameId).toBe(first)
    expect(session.selection).toMatchObject({ x: 0, y: 0, width: 1, height: 1 })
    useWorkspace.getState().stepAnimationFrame(1)
    expect(document.animation!.activeFrameId).toBe(second)
    expect(session.selection).toMatchObject({ x: 0, y: 0, width: 1, height: 1 })
    expect(session.history.canUndo).toBe(true)
  })
})

describe('linked animation cel history', () => {
  it('syncs a committed pixel edit without rebuilding untouched layer surfaces', () => {
    const document = createDocument('targeted animation sync', 1, 1, 'rgba')
    const editedLayer = getActiveLayer(document)
    const untouchedLayer = createLayer('Untouched', 1, 1, 'rgba')
    document.layers.push(untouchedLayer)
    writeLayerColor(document, editedLayer, 0, red)
    writeLayerColor(document, untouchedLayer, 0, blue)
    useWorkspace.getState().addSession(document)
    useWorkspace.getState().duplicateAnimationFrame()
    const timeline = ensureAnimationDocument(document)
    const editedKeys = timeline.frames.map((frame) => animationCelKey(editedLayer.id, frame.id))
    useWorkspace.getState().selectAnimationCell(editedKeys[0])
    useWorkspace.getState().selectAnimationCell(editedKeys[1], 'toggle')
    useWorkspace.getState().connectSelectedAnimationCels()
    const untouchedCel = animationCelAt(timeline, untouchedLayer.id, timeline.activeFrameId)!
    const untouchedSurface = untouchedCel.surface

    const edit = beginPixelEdit(editedLayer.id)
    recordPixel(document, editedLayer, edit, 0, packColor(blue))
    useWorkspace.getState().commitPixelEdit(edit, 'paint linked cel')

    const editedCels = timeline.frames.map((frame) => animationCelAt(timeline, editedLayer.id, frame.id)!)
    expect(editedCels[1].surface).toBe(editedCels[0].surface)
    expect(Array.from(resolveAnimationCel(timeline, editedCels[1])!.surface!.pixels)).toEqual([blue.r, blue.g, blue.b, blue.a])
    expect(untouchedCel.surface).toBe(untouchedSurface)
  })

  it('connects selected cels and restores links with undo and redo', () => {
    const document = createDocument('linked cel history', 1, 1, 'rgba')
    getActiveLayer(document).pixels[3] = 255
    useWorkspace.getState().addSession(document)
    useWorkspace.getState().duplicateAnimationFrame()
    const timeline = ensureAnimationDocument(document)
    const layerId = document.activeLayerId
    const keys = timeline.frames.map((frame) => animationCelKey(layerId, frame.id))
    useWorkspace.getState().selectAnimationCell(keys[0])
    useWorkspace.getState().selectAnimationCell(keys[1], 'toggle')
    useWorkspace.getState().connectSelectedAnimationCels()

    const linked = ensureAnimationDocument(document).cels.filter((cel) => keys.includes(animationCelKey(cel.layerId, cel.frameId)))
    expect(linked[1].linkedCelId).toBe(linked[0].id)
    useWorkspace.getState().undo()
    expect(ensureAnimationDocument(document).cels.find((cel) => cel.id === linked[1].id)?.linkedCelId).toBeUndefined()
    useWorkspace.getState().redo()
    expect(ensureAnimationDocument(document).cels.find((cel) => cel.id === linked[1].id)?.linkedCelId).toBe(linked[0].id)
  })

  it('disconnects selected linked cels and supports undo and redo', () => {
    const document = createDocument('unlink linked cel history', 1, 1, 'rgba')
    getActiveLayer(document).pixels[3] = 255
    useWorkspace.getState().addSession(document)
    useWorkspace.getState().duplicateAnimationFrame()
    const timeline = ensureAnimationDocument(document)
    const keys = timeline.frames.map((frame) => animationCelKey(document.activeLayerId, frame.id))
    useWorkspace.getState().selectAnimationCell(keys[0])
    useWorkspace.getState().selectAnimationCell(keys[1], 'toggle')
    useWorkspace.getState().connectSelectedAnimationCels()
    const linked = ensureAnimationDocument(document).cels.filter((cel) => keys.includes(animationCelKey(cel.layerId, cel.frameId)))

    useWorkspace.getState().selectAnimationCell(keys[1])
    useWorkspace.getState().disconnectSelectedAnimationCels()
    expect(ensureAnimationDocument(document).cels.find((cel) => cel.id === linked[1].id)?.linkedCelId).toBeNull()
    useWorkspace.getState().undo()
    expect(ensureAnimationDocument(document).cels.find((cel) => cel.id === linked[1].id)?.linkedCelId).toBe(linked[0].id)
    useWorkspace.getState().redo()
    expect(ensureAnimationDocument(document).cels.find((cel) => cel.id === linked[1].id)?.linkedCelId).toBeNull()
  })

  it('pastes into the shared source of a linked cel without breaking the link', () => {
    const document = createDocument('paste into linked cel', 1, 1, 'rgba')
    const layer = getActiveLayer(document)
    writeLayerColor(document, layer, 0, red)
    useWorkspace.getState().addSession(document)
    useWorkspace.getState().duplicateAnimationFrame()
    useWorkspace.getState().duplicateAnimationFrame()
    const timeline = ensureAnimationDocument(document)
    const keys = timeline.frames.map((frame) => animationCelKey(layer.id, frame.id))
    useWorkspace.getState().selectAnimationCell(keys[0])
    useWorkspace.getState().selectAnimationCell(keys[1], 'toggle')
    useWorkspace.getState().connectSelectedAnimationCels()
    const linkedSource = resolveAnimationCel(timeline, animationCelAt(timeline, layer.id, timeline.frames[1].id))!
    const linkedTarget = animationCelAt(timeline, layer.id, timeline.frames[1].id)!
    const originalLinkId = linkedTarget.linkedCelId
    const clipboardCel = animationCelAt(timeline, layer.id, timeline.frames[2].id)!
    if (!clipboardCel.surface || clipboardCel.surface.format !== 'rgba') throw new Error('missing rgba cel')
    clipboardCel.surface.pixels.set([blue.r, blue.g, blue.b, blue.a])
    useWorkspace.getState().selectAnimationCell(keys[2])
    useWorkspace.getState().copySelectedAnimationCels()
    useWorkspace.getState().selectAnimationCell(keys[1])

    useWorkspace.getState().pasteAnimationCels()

    expect(linkedTarget.linkedCelId).toBe(originalLinkId)
    expect(Array.from(linkedSource.surface!.pixels)).toEqual([blue.r, blue.g, blue.b, blue.a])
    expect(resolveAnimationCel(timeline, linkedTarget)).toBe(linkedSource)
    useWorkspace.getState().undo()
    let restoredTarget = animationCelAt(timeline, layer.id, timeline.frames[1].id)!
    expect(restoredTarget.linkedCelId).toBe(originalLinkId)
    expect(Array.from(resolveAnimationCel(timeline, restoredTarget)!.surface!.pixels)).toEqual([red.r, red.g, red.b, red.a])
    useWorkspace.getState().redo()
    restoredTarget = animationCelAt(timeline, layer.id, timeline.frames[1].id)!
    expect(restoredTarget.linkedCelId).toBe(originalLinkId)
    expect(Array.from(resolveAnimationCel(timeline, restoredTarget)!.surface!.pixels)).toEqual([blue.r, blue.g, blue.b, blue.a])
  })

  it('breaks a cel link before clearing content and restores the whole link group with undo', () => {
    const document = createDocument('clear linked cel', 1, 1, 'rgba')
    getActiveLayer(document).pixels.set([20, 40, 60, 255])
    useWorkspace.getState().addSession(document)
    useWorkspace.getState().duplicateAnimationFrame()
    useWorkspace.getState().duplicateAnimationFrame()
    const timeline = ensureAnimationDocument(document)
    const keys = timeline.frames.map((frame) => animationCelKey(document.activeLayerId, frame.id))
    for (const [index, key] of keys.entries()) useWorkspace.getState().selectAnimationCell(key, index === 0 ? 'replace' : 'toggle')
    useWorkspace.getState().connectSelectedAnimationCels()

    const linked = ensureAnimationDocument(document).cels.filter((cel) => keys.includes(animationCelKey(cel.layerId, cel.frameId)))
    const sourceId = linked[0].id
    useWorkspace.getState().selectAnimationCell(keys[1])
    useWorkspace.getState().deleteSelectedAnimationItems()

    const cleared = ensureAnimationDocument(document).cels.filter((cel) => keys.includes(animationCelKey(cel.layerId, cel.frameId)))
    expect(cleared.every((cel) => cel.linkedCelId == null)).toBe(true)
    expect(cleared[1].surface?.pixels[3]).toBe(0)
    expect(cleared[2].surface?.pixels[3]).toBe(255)

    useWorkspace.getState().undo()
    const restored = ensureAnimationDocument(document).cels.filter((cel) => keys.includes(animationCelKey(cel.layerId, cel.frameId)))
    expect(restored[1].linkedCelId).toBe(sourceId)
    expect(restored[2].linkedCelId).toBe(sourceId)
    expect(restored[1].surface).toBe(restored[0].surface)
  })
})

describe('multi-layer adjustments', () => {
  it('undoes a later pixel operation before undoing the earlier adjustment', () => {
    const document = createDocument('ordered adjustment history', 2, 1, 'rgba')
    const layer = getActiveLayer(document)
    writeLayerColor(document, layer, 0, { r: 20, g: 20, b: 20, a: 255 })
    writeLayerColor(document, layer, 1, { r: 40, g: 40, b: 40, a: 255 })
    useWorkspace.getState().addSession(document)
    useWorkspace.getState().setSelection({ x: 0, y: 0, width: 1, height: 1 })
    const baseline = useWorkspace.getState().captureActiveLayerAdjustmentSnapshot()!
    useWorkspace.getState().applyActiveLayerAdjustmentFromSnapshot({ kind: 'brightness-contrast', brightness: 40, contrast: 0 }, baseline)
    const adjusted = readLayerColor(document, layer, 0)

    const edit = beginPixelEdit(layer.id)
    recordPixel(document, layer, edit, 1, 0xff0000ff)
    useWorkspace.getState().commitPixelEdit(edit, 'later paint')
    expect(readLayerColor(document, layer, 1)).toEqual(red)

    useWorkspace.getState().undo()
    expect(readLayerColor(document, layer, 0)).toEqual(adjusted)
    expect(readLayerColor(document, layer, 1).r).toBe(40)
    useWorkspace.getState().undo()
    expect(readLayerColor(document, layer, 0).r).toBe(20)
  })

  it('undoes a committed adjustment in both the active layer and its animation cel', () => {
    const document = createDocument('animation adjustment undo', 1, 1, 'rgba')
    const layer = getActiveLayer(document)
    writeLayerColor(document, layer, 0, red)
    useWorkspace.getState().addSession(document)
    useWorkspace.getState().duplicateAnimationFrame()
    writeLayerColor(document, layer, 0, blue)
    const timeline = ensureAnimationDocument(document)
    const activeFrameId = timeline.activeFrameId
    const baseline = useWorkspace.getState().captureActiveLayerAdjustmentSnapshot()!

    useWorkspace.getState().applyActiveLayerAdjustmentFromSnapshot({ kind: 'brightness-contrast', brightness: 40, contrast: 0 }, baseline)
    expect(readLayerColor(document, layer, 0).r).toBeGreaterThan(blue.r)
    useWorkspace.getState().undo()

    expect(readLayerColor(document, layer, 0)).toEqual(blue)
    expect(animationCelAt(timeline, layer.id, activeFrameId)!.surface!.pixels).toEqual(new Uint8ClampedArray([0, 80, 255, 255]))
  })

  it('adjusts every selected layer without a selection and undoes them together', () => {
    const document = createDocument('multi adjustment', 1, 1, 'rgba')
    const first = getActiveLayer(document)
    const second = createLayer('Second', 1, 1, 'rgba')
    writeLayerColor(document, first, 0, { r: 20, g: 20, b: 20, a: 255 })
    writeLayerColor(document, second, 0, { r: 40, g: 40, b: 40, a: 255 })
    document.layers.push(second)
    document.activeLayerId = second.id
    useWorkspace.getState().addSession(document)
    useWorkspace.getState().selectLayer(first.id)
    useWorkspace.getState().selectLayer(second.id, true)

    useWorkspace.getState().applyActiveLayerAdjustment({ kind: 'brightness-contrast', brightness: 20, contrast: 0 })

    expect(readLayerColor(document, first, 0).r).toBeGreaterThan(20)
    expect(readLayerColor(document, second, 0).r).toBeGreaterThan(40)
    useWorkspace.getState().undo()
    expect(readLayerColor(document, first, 0).r).toBe(20)
    expect(readLayerColor(document, second, 0).r).toBe(40)
  })
})

describe('resize history', () => {
  it('keeps canvas resize guide previews outside document history', () => {
    const document = createDocument('resize preview history', 2, 2, 'rgba')
    useWorkspace.getState().addSession(document)
    const session = useWorkspace.getState().sessions[0]

    useWorkspace.getState().setCanvasResizePreview({ width: 4, height: 4, offsetX: 1, offsetY: 1 })
    useWorkspace.getState().setCanvasResizePreview({ width: 5, height: 4, offsetX: 2, offsetY: 1 })
    useWorkspace.getState().setCanvasResizePreview(null)

    expect(session.history.canUndo).toBe(false)
    expect(document.dirty).toBe(false)
  })

  it('undoes and redoes canvas and image size adjustments with their selection', async () => {
    const document = createDocument('resize history', 2, 2, 'rgba')
    const layer = getActiveLayer(document)
    writeLayerColor(document, layer, 0, red)
    useWorkspace.getState().addSession(document)
    useWorkspace.getState().setSelection({ x: 0, y: 0, width: 1, height: 1, mask: new Uint8Array([1]) })

    await useWorkspace.getState().resizeActiveCanvas(3, 3, 'center')
    expect(document.width).toBe(3)
    expect(useWorkspace.getState().sessions[0].selection).toMatchObject({ x: 0, y: 0, width: 1, height: 1 })
    useWorkspace.getState().undo()
    expect(document.width).toBe(2)
    expect(useWorkspace.getState().sessions[0].selection).toMatchObject({ x: 0, y: 0, width: 1, height: 1 })
    useWorkspace.getState().redo()
    expect(document.width).toBe(3)

    await useWorkspace.getState().resizeActiveImage(4, 4, 'nearest')
    expect(document.width).toBe(4)
    useWorkspace.getState().undo()
    expect(document.width).toBe(3)
    useWorkspace.getState().redo()
    expect(document.width).toBe(4)
  })

  it('crops the canvas to the selection and restores the prior selection through undo and redo', async () => {
    const document = createDocument('crop selection', 4, 3, 'rgba')
    const layer = getActiveLayer(document)
    writeLayerColor(document, layer, 1 * document.width + 2, red)
    writeLayerColor(document, layer, 2 * document.width + 1, blue)
    useWorkspace.getState().addSession(document)
    useWorkspace.getState().setSelection({ x: 1, y: 1, width: 2, height: 2 })

    await useWorkspace.getState().cropActiveCanvas()

    expect(document).toMatchObject({ width: 2, height: 2 })
    expect(readLayerColorAt(document, layer, 1, 0)).toEqual(red)
    expect(readLayerColorAt(document, layer, 0, 1)).toEqual(blue)
    expect(useWorkspace.getState().sessions[0].selection).toMatchObject({ x: 0, y: 0, width: 2, height: 2 })

    useWorkspace.getState().undo()
    expect(document).toMatchObject({ width: 4, height: 3 })
    expect(useWorkspace.getState().sessions[0].selection).toMatchObject({ x: 1, y: 1, width: 2, height: 2 })

    useWorkspace.getState().redo()
    expect(document).toMatchObject({ width: 2, height: 2 })
    expect(useWorkspace.getState().sessions[0].selection).toMatchObject({ x: 0, y: 0, width: 2, height: 2 })
  })

  it('trims to the final visible composite and ignores hidden layer content', async () => {
    const document = createDocument('trim visible', 4, 3, 'rgba')
    const visible = getActiveLayer(document)
    writeLayerColor(document, visible, 1 * document.width + 2, red)
    const hidden = createLayer('Hidden', 4, 3, 'rgba')
    hidden.visible = false
    writeLayerColor(document, hidden, 0, blue)
    document.layers.push(hidden)
    useWorkspace.getState().addSession(document)

    await useWorkspace.getState().trimActiveCanvas()

    expect(document).toMatchObject({ width: 1, height: 1 })
    expect(readLayerColorAt(document, visible, 0, 0)).toEqual(red)
    useWorkspace.getState().undo()
    expect(document).toMatchObject({ width: 4, height: 3 })
  })

  it('leaves an empty canvas unchanged when trim has no visible bounds', async () => {
    const document = createDocument('trim empty', 3, 2, 'rgba')
    useWorkspace.getState().addSession(document)

    await useWorkspace.getState().trimActiveCanvas()

    expect(document).toMatchObject({ width: 3, height: 2 })
    expect(useWorkspace.getState().sessions[0].history.canUndo).toBe(false)
    expect(useWorkspace.getState().message).toBe('画布内没有可用于修剪的可见内容。')
  })

  it('keeps every animation cel aligned through canvas resize undo and redo', async () => {
    const document = createDocument('animated canvas resize', 2, 1, 'rgba')
    const layer = getActiveLayer(document)
    writeLayerColor(document, layer, 0, red)
    useWorkspace.getState().addSession(document)
    useWorkspace.getState().duplicateAnimationFrame()
    const [firstFrame, secondFrame] = ensureAnimationDocument(document).frames
    writeLayerColor(document, layer, 0, transparent)
    writeLayerColor(document, layer, 1, blue)
    useWorkspace.getState().setActiveAnimationFrame(firstFrame.id)

    await useWorkspace.getState().resizeActiveCanvas(4, 3, 'center')
    let timeline = ensureAnimationDocument(document)
    expect(animationCelAt(timeline, layer.id, firstFrame.id)!.surface).toMatchObject({ offsetX: 1, offsetY: 1 })
    expect(animationCelAt(timeline, layer.id, secondFrame.id)!.surface).toMatchObject({ offsetX: 1, offsetY: 1 })

    useWorkspace.getState().undo()
    timeline = ensureAnimationDocument(document)
    expect(document).toMatchObject({ width: 2, height: 1 })
    expect(animationCelAt(timeline, layer.id, firstFrame.id)!.surface).toMatchObject({ offsetX: 0, offsetY: 0 })
    expect(animationCelAt(timeline, layer.id, secondFrame.id)!.surface).toMatchObject({ offsetX: 0, offsetY: 0 })

    useWorkspace.getState().redo()
    timeline = ensureAnimationDocument(document)
    expect(document).toMatchObject({ width: 4, height: 3 })
    expect(animationCelAt(timeline, layer.id, firstFrame.id)!.surface).toMatchObject({ offsetX: 1, offsetY: 1 })
    expect(animationCelAt(timeline, layer.id, secondFrame.id)!.surface).toMatchObject({ offsetX: 1, offsetY: 1 })
  })
})

describe('layer merge history', () => {
  it('merges selected layers as one undoable structural operation', () => {
    const document = createDocument('merge history', 1, 1, 'rgba')
    const bottom = getActiveLayer(document)
    writeLayerColor(document, bottom, 0, blue)
    const top = createLayer('Top', 1, 1, 'rgba')
    writeLayerColor(document, top, 0, red)
    document.layers.push(top)
    document.activeLayerId = top.id
    useWorkspace.getState().addSession(document)
    useWorkspace.getState().selectLayer(bottom.id)
    useWorkspace.getState().selectLayer(top.id, true)

    useWorkspace.getState().mergeSelectedLayers()
    expect(document.layers).toHaveLength(1)
    expect(useWorkspace.getState().sessions[0].selectedLayerIds).toEqual([document.layers[0].id])

    useWorkspace.getState().undo()
    expect(document.layers).toHaveLength(2)
    expect(document.layers.map((layer) => layer.id)).toEqual([bottom.id, top.id])
    expect(useWorkspace.getState().sessions[0].selectedLayerIds).toEqual([bottom.id, top.id])

    useWorkspace.getState().redo()
    expect(document.layers).toHaveLength(1)
  })

  it('does not dirty the document when a locked merge is rejected', () => {
    const document = createDocument('locked merge', 1, 1, 'rgba')
    const bottom = getActiveLayer(document)
    const top = createLayer('Top', 1, 1, 'rgba')
    top.locked = true
    document.layers.push(top)
    useWorkspace.getState().addSession(document)
    useWorkspace.getState().selectLayer(bottom.id)
    useWorkspace.getState().selectLayer(top.id, true)

    useWorkspace.getState().mergeSelectedLayers()

    expect(document.layers).toHaveLength(2)
    expect(document.dirty).toBe(false)
    expect(useWorkspace.getState().message).toContain('锁定')
  })

  it('merges selected layers with blend modes', () => {
    const document = createDocument('blend merge command', 1, 1, 'rgba')
    const bottom = getActiveLayer(document)
    writeLayerColor(document, bottom, 0, blue)
    const top = createLayer('Multiply', 1, 1, 'rgba')
    writeLayerColor(document, top, 0, red)
    top.blendMode = 'multiply'
    document.layers.push(top)
    document.activeLayerId = top.id
    const before = compositeDocument(document)
    useWorkspace.getState().addSession(document)
    useWorkspace.getState().selectLayer(bottom.id)
    useWorkspace.getState().selectLayer(top.id, true)

    useWorkspace.getState().mergeSelectedLayers()

    expect(document.layers).toHaveLength(1)
    expect(Array.from(compositeDocument(document))).toEqual(Array.from(before))
  })
})

describe('recovery cleanup', () => {
  it('waits for an in-flight autosave before deleting a discarded recovery and suppresses recreation', async () => {
    const deferred: { resolve?: () => void } = {}
    let writeCount = 0
    const writeRecovery = vi.fn(() => {
      writeCount += 1
      return writeCount === 1 ? new Promise<void>((resolve) => { deferred.resolve = resolve }) : Promise.resolve()
    })
    const deleteRecovery = vi.fn(async () => {})
    installApi({ writeRecovery, deleteRecovery })
    const document = createDocument('draft', 2, 2, 'rgba')
    document.dirty = true
    useWorkspace.getState().addSession(document)

    const autosave = useWorkspace.getState().autosaveDirty()
    await vi.waitFor(() => expect(writeRecovery).toHaveBeenCalledTimes(1))
    const discard = useWorkspace.getState().discardRecovery(document.id)
    expect(deleteRecovery).not.toHaveBeenCalled()
    deferred.resolve?.()
    await Promise.all([autosave, discard])

    expect(writeRecovery).toHaveBeenCalledTimes(1)
    expect(deleteRecovery).toHaveBeenCalledWith(document.id)
    await useWorkspace.getState().autosaveDirty()
    expect(writeRecovery).toHaveBeenCalledTimes(1)

    useWorkspace.getState().mutateActive(() => {})
    await useWorkspace.getState().autosaveDirty()
    expect(writeRecovery).toHaveBeenCalledTimes(2)
  })
})

describe('save concurrency', () => {
  it('prepares the editor before publishing the opened session without touching save progress', async () => {
    const document = createDocument('fast loading', 2, 2, 'rgba')
    installApi({ readBinary: vi.fn(async () => encodeProject(document)) })
    const onBeforeSession = vi.fn(() => {
      expect(useWorkspace.getState().sessions).toHaveLength(0)
    })

    await expect(useWorkspace.getState().openPath('D:/gallery/fast-loading.moonsprite', { onBeforeSession })).resolves.toBe(true)

    expect(onBeforeSession).toHaveBeenCalledTimes(1)
    expect(useWorkspace.getState().sessions).toHaveLength(1)
    expect(useWorkspace.getState().saveProgress).toBeNull()
  })

  it('skips encoding, writing, and progress for an unchanged saved document', async () => {
    const writeBinaryAtomic = vi.fn(async (_filePath: string, _data: Uint8Array) => {})
    const deleteRecovery = vi.fn(async () => {})
    installApi({ writeBinaryAtomic, deleteRecovery })
    const document = createDocument('unchanged save', 2, 2, 'rgba')
    document.filePath = 'D:/gallery/unchanged-save.moonsprite'
    document.dirty = false
    useWorkspace.getState().addSession(document)

    await expect(useWorkspace.getState().saveActive()).resolves.toBe(true)

    expect(writeBinaryAtomic).not.toHaveBeenCalled()
    expect(deleteRecovery).not.toHaveBeenCalled()
    expect(useWorkspace.getState().saveProgress).toBeNull()
    expect(useWorkspace.getState().message).toBe('工程已保存。')
  })

  it('keeps ordinary save progress outside the workspace store', async () => {
    const write: { resolve?: () => void } = {}
    const writeBinaryAtomic = vi.fn(() => new Promise<void>((resolve) => { write.resolve = resolve }))
    installApi({ writeBinaryAtomic })
    const document = createDocument('ordinary save progress', 2, 2, 'rgba')
    document.filePath = 'D:/gallery/ordinary-save-progress.moonsprite'
    document.dirty = true
    useWorkspace.getState().addSession(document)

    const saving = useWorkspace.getState().saveActive()
    await vi.waitFor(() => expect(writeBinaryAtomic).toHaveBeenCalledTimes(1))
    expect(useWorkspace.getState().saveProgress).toBeNull()

    write.resolve?.()
    await expect(saving).resolves.toBe(true)
    expect(useWorkspace.getState().saveProgress).toBeNull()
  })

  it('shows Save As progress only after the native file dialog confirms a path', async () => {
    const dialog: { resolve?: (result: { canceled: boolean; filePath?: string }) => void } = {}
    const write: { resolve?: () => void } = {}
    const saveProject = vi.fn(() => new Promise<{ canceled: boolean; filePath?: string }>((resolve) => { dialog.resolve = resolve }))
    const writeBinaryAtomic = vi.fn(() => new Promise<void>((resolve) => { write.resolve = resolve }))
    installApi({ saveProject, writeBinaryAtomic })
    useWorkspace.getState().addSession(createDocument('save progress', 2, 2, 'rgba'))

    const saving = useWorkspace.getState().saveActive(true, { name: 'save progress', format: 'moonsprite', scalePercent: 100 })
    await vi.waitFor(() => expect(saveProject).toHaveBeenCalledTimes(1))
    expect(useWorkspace.getState().saveProgress).toBeNull()

    dialog.resolve?.({ canceled: false, filePath: 'D:/gallery/save-progress.moonsprite' })
    await vi.waitFor(() => expect(writeBinaryAtomic).toHaveBeenCalledTimes(1))
    expect(useWorkspace.getState().saveProgress).toBeNull()
    saveProgress.dismiss()
    write.resolve?.()
    await expect(saving).resolves.toBe(true)
    expect(useWorkspace.getState().saveProgress).toBeNull()
  })

  it('shows export progress only after the native export dialog confirms a path', async () => {
    const dialog: { resolve?: (result: { canceled: boolean; filePath?: string }) => void } = {}
    const write: { resolve?: () => void } = {}
    const exportImage = vi.fn(() => new Promise<{ canceled: boolean; filePath?: string }>((resolve) => { dialog.resolve = resolve }))
    const writeBinaryAtomic = vi.fn(() => new Promise<void>((resolve) => { write.resolve = resolve }))
    installApi({ exportImage, writeBinaryAtomic })
    useWorkspace.getState().addSession(createDocument('export progress', 2, 2, 'rgba'))

    const exporting = useWorkspace.getState().exportActive({ name: 'export progress', format: 'png-rgba', scalePercent: 100 })
    await vi.waitFor(() => expect(exportImage).toHaveBeenCalledTimes(1))
    expect(useWorkspace.getState().saveProgress).toBeNull()

    dialog.resolve?.({ canceled: false, filePath: 'D:/gallery/export-progress.png' })
    await vi.waitFor(() => expect(writeBinaryAtomic).toHaveBeenCalledTimes(1))
    expect(useWorkspace.getState().saveProgress).toMatchObject({ title: '正在导出' })
    useWorkspace.getState().dismissSaveProgress()
    write.resolve?.()
    await expect(exporting).resolves.toBe(true)
    expect(useWorkspace.getState().saveProgress).toBeNull()
  })

  it('exports every slice as an animated GIF with slice-specific dimensions', async () => {
    const chooseDirectory = vi.fn(async () => ({ canceled: false, directoryPath: 'D:/exports' }))
    const writes: Array<{ filePath: string; data: Uint8Array }> = []
    const writeBinaryAtomic = vi.fn(async (filePath: string, data: Uint8Array) => { writes.push({ filePath, data }) })
    const exportImage = vi.fn()
    installApi({ chooseDirectory, writeBinaryAtomic, exportImage })
    const document = createDocument('gif slices', 3, 2, 'rgba')
    addBlankAnimationFrame(document)
    document.slices = [
      { id: 'left', name: 'Left', x: 0, y: 0, width: 1, height: 2 },
      { id: 'right', name: 'Right', x: 1, y: 1, width: 2, height: 1 }
    ]
    useWorkspace.getState().addSession(document)

    await expect(useWorkspace.getState().exportActive({ name: 'ignored.gif', format: 'gif', scalePercent: 200, target: 'slices', directory: 'D:/exports', gifDirection: 'forward' })).resolves.toBe(true)

    expect(chooseDirectory).toHaveBeenCalledWith('D:/exports')
    expect(exportImage).not.toHaveBeenCalled()
    expect(writes.map((entry) => entry.filePath)).toEqual(['D:/exports/Left.gif', 'D:/exports/Right.gif'])
    expect(writes.map(({ data }) => ({ signature: new TextDecoder().decode(data.subarray(0, 6)), width: data[6] | data[7] << 8, height: data[8] | data[9] << 8 }))).toEqual([
      { signature: 'GIF89a', width: 2, height: 4 },
      { signature: 'GIF89a', width: 4, height: 2 }
    ])
  })

  it('exports only the selected slice when a slice id is provided', async () => {
    const chooseDirectory = vi.fn(async () => ({ canceled: false, directoryPath: 'D:/exports' }))
    const writeBinaryAtomic = vi.fn(async (_filePath: string, _data: Uint8Array) => {})
    installApi({ chooseDirectory, writeBinaryAtomic })
    const document = createDocument('selected slice', 3, 2, 'rgba')
    document.slices = [
      { id: 'left', name: 'Left', x: 0, y: 0, width: 1, height: 2 },
      { id: 'right', name: 'Right', x: 1, y: 1, width: 2, height: 1 }
    ]
    useWorkspace.getState().addSession(document)

    await expect(useWorkspace.getState().exportActive({ name: 'ignored.png', format: 'png-rgba', scalePercent: 100, target: 'slices', sliceId: 'right', directory: 'D:/exports' })).resolves.toBe(true)

    expect(chooseDirectory).toHaveBeenCalledWith('D:/exports')
    expect(writeBinaryAtomic.mock.calls.map(([filePath]) => filePath)).toEqual(['D:/exports/Right.png'])
  })

  it('uses the preferred image format when saving an unsaved document', async () => {
    localStorage.setItem('moonsprite.preference.save-format', 'png')
    const saveProject = vi.fn(async () => ({ canceled: false, filePath: 'D:/gallery/preferred.png' }))
    const exportImage = vi.fn()
    const writeBinaryAtomic = vi.fn(async () => {})
    installApi({ saveProject, exportImage, writeBinaryAtomic })
    useWorkspace.getState().addSession(createDocument('preferred', 2, 2, 'rgba'))

    await expect(useWorkspace.getState().saveActive()).resolves.toBe(true)
    expect(saveProject).toHaveBeenCalledWith('preferred.png', 'png')
    expect(exportImage).not.toHaveBeenCalled()
    expect(writeBinaryAtomic).toHaveBeenCalledTimes(1)
  })

  it('writes a flat imported image back to its original path without creating a project', async () => {
    const saveProject = vi.fn()
    const writeBinaryAtomic = vi.fn(async (_filePath: string, _data: Uint8Array) => {})
    installApi({ saveProject, writeBinaryAtomic })
    const document = createDocument('source.png', 2, 2, 'rgba')
    document.sourceFilePath = 'D:/imports/source.png'
    useWorkspace.getState().addSession(document)
    useWorkspace.getState().mutateActive((session) => {
      writeLayerColor(session.document, getActiveLayer(session.document), 0, red)
    })

    await expect(useWorkspace.getState().saveActive()).resolves.toBe(true)

    expect(saveProject).not.toHaveBeenCalled()
    expect(writeBinaryAtomic).toHaveBeenCalledTimes(1)
    expect(writeBinaryAtomic.mock.calls[0][0]).toBe('D:/imports/source.png')
    const savedImage = decodePng(writeBinaryAtomic.mock.calls[0][1])
    expect(readLayerColor(savedImage, getActiveLayer(savedImage), 0)).toEqual(red)
    expect(document.filePath).toBeNull()
    expect(document.sourceFilePath).toBe('D:/imports/source.png')
    expect(document.dirty).toBe(false)
  })

  it('forces an imported image with project structure to save as MoonSprite', async () => {
    localStorage.setItem('moonsprite.preference.save-format', 'png')
    const saveProject = vi.fn(async () => ({ canceled: false, filePath: 'D:/gallery/source.moonsprite' }))
    const writeBinaryAtomic = vi.fn(async (_filePath: string, _data: Uint8Array) => {})
    installApi({ saveProject, writeBinaryAtomic })
    const document = createDocument('source.png', 2, 2, 'rgba')
    document.sourceFilePath = 'D:/imports/source.png'
    useWorkspace.getState().addSession(document)
    await useWorkspace.getState().addLayer()

    await expect(useWorkspace.getState().saveActive()).resolves.toBe(true)

    expect(saveProject).toHaveBeenCalledWith('source.moonsprite')
    expect(document.filePath).toBe('D:/gallery/source.moonsprite')
    expect(decodeProject(writeBinaryAtomic.mock.calls[0][1]).layers).toHaveLength(2)
  })

  it('uses custom save and export directories for new file dialogs', async () => {
    localStorage.setItem('moonsprite.preference.save-directory', 'D:\\MoonSprite\\gallery')
    localStorage.setItem('moonsprite.preference.export-directory', 'D:/MoonSprite/exports')
    const saveProject = vi.fn(async () => ({ canceled: false, filePath: 'D:/MoonSprite/gallery/custom.moonsprite' }))
    const exportImage = vi.fn(async () => ({ canceled: false, filePath: 'D:/MoonSprite/exports/custom.png' }))
    const writeBinaryAtomic = vi.fn(async () => {})
    installApi({ saveProject, exportImage, writeBinaryAtomic })
    useWorkspace.getState().addSession(createDocument('custom', 2, 2, 'rgba'))

    await expect(useWorkspace.getState().saveActive()).resolves.toBe(true)
    expect(saveProject).toHaveBeenCalledWith('D:\\MoonSprite\\gallery\\custom.moonsprite')
    await expect(useWorkspace.getState().exportActive({ name: 'custom', format: 'png-rgba', scalePercent: 100 })).resolves.toBe(true)
    expect(exportImage).toHaveBeenCalledWith('D:/MoonSprite/exports/custom.png', 'png')
  })

  it('lets the Save As dialog directory override the default save directory', async () => {
    localStorage.setItem('moonsprite.preference.save-directory', 'D:/MoonSprite/gallery')
    const saveProject = vi.fn(async () => ({ canceled: false, filePath: 'E:/delivery/custom.moonsprite' }))
    const writeBinaryAtomic = vi.fn(async () => {})
    installApi({ saveProject, writeBinaryAtomic })
    useWorkspace.getState().addSession(createDocument('custom', 2, 2, 'rgba'))

    await expect(useWorkspace.getState().saveActive(true, { name: 'custom', format: 'moonsprite', scalePercent: 100, directory: 'E:/delivery' })).resolves.toBe(true)

    expect(saveProject).toHaveBeenCalledWith('E:/delivery/custom.moonsprite')
  })

  it('lets the export dialog directory override the default export directory', async () => {
    localStorage.setItem('moonsprite.preference.export-directory', 'D:/MoonSprite/exports')
    const exportImage = vi.fn(async () => ({ canceled: false, filePath: 'E:/delivery/custom.png' }))
    const writeBinaryAtomic = vi.fn(async () => {})
    installApi({ exportImage, writeBinaryAtomic })
    useWorkspace.getState().addSession(createDocument('custom', 2, 2, 'rgba'))

    await expect(useWorkspace.getState().exportActive({ name: 'custom.png', format: 'png-rgba', scalePercent: 100, directory: 'E:/delivery' })).resolves.toBe(true)
    expect(exportImage).toHaveBeenCalledWith('E:/delivery/custom.png', 'png')
    expect(localStorage.getItem(RECENT_EXPORT_PATHS_STORAGE_KEY)).toContain('E:/delivery/custom.png')
  })

  it('exports every animation frame as a numbered image without changing the active frame', async () => {
    const chooseDirectory = vi.fn(async () => ({ canceled: false, directoryPath: 'E:/frames' }))
    const writeBinaryAtomic = vi.fn(async (_filePath: string, _data: Uint8Array) => {})
    installApi({ chooseDirectory, writeBinaryAtomic })
    const document = createDocument('walk', 1, 1, 'rgba')
    const layer = getActiveLayer(document)
    writeLayerColor(document, layer, 0, red)
    const secondFrameId = addBlankAnimationFrame(document)
    animationCelAt(ensureAnimationDocument(document), layer.id, secondFrameId)!.surface = {
      format: 'rgba',
      width: 1,
      height: 1,
      offsetX: 0,
      offsetY: 0,
      pixels: Uint8ClampedArray.from([blue.r, blue.g, blue.b, blue.a])
    }
    useWorkspace.getState().addSession(document)
    const activeFrameId = document.animation!.activeFrameId

    await expect(useWorkspace.getState().exportActive({ name: 'walk.png', format: 'png-rgba', scalePercent: 100, target: 'frames', directory: 'E:/frames' })).resolves.toBe(true)

    expect(chooseDirectory).toHaveBeenCalledWith('E:/frames')
    expect(writeBinaryAtomic.mock.calls.map(([filePath]) => filePath)).toEqual(['E:/frames/walk-001.png', 'E:/frames/walk-002.png'])
    const first = decodePng(writeBinaryAtomic.mock.calls[0][1])
    const second = decodePng(writeBinaryAtomic.mock.calls[1][1])
    expect(readLayerColor(first, getActiveLayer(first), 0)).toEqual(red)
    expect(readLayerColor(second, getActiveLayer(second), 0)).toEqual(blue)
    expect(document.animation!.activeFrameId).toBe(activeFrameId)
  })

  it('uses Aseprite as the preferred save format without exposing it as image export', async () => {
    localStorage.setItem('moonsprite.preference.save-format', 'aseprite')
    const saveProject = vi.fn(async () => ({ canceled: false, filePath: 'D:/gallery/preferred.aseprite' }))
    const exportImage = vi.fn()
    const writeBinaryAtomic = vi.fn(async () => {})
    installApi({ saveProject, exportImage, writeBinaryAtomic })
    const document = createDocument('preferred', 2, 2, 'rgba')
    useWorkspace.getState().addSession(document)

    await expect(useWorkspace.getState().saveActive()).resolves.toBe(true)
    expect(saveProject).toHaveBeenCalledWith('preferred.aseprite', 'aseprite')
    expect(exportImage).not.toHaveBeenCalled()
    expect(writeBinaryAtomic).toHaveBeenCalledTimes(1)
    expect(document.filePath).toBe('D:/gallery/preferred.aseprite')
  })

  it('keeps the selected .ase extension in Save As', async () => {
    const saveProject = vi.fn(async () => ({ canceled: false, filePath: 'D:/gallery/copy.ase' }))
    const exportImage = vi.fn()
    const writeBinaryAtomic = vi.fn(async () => {})
    installApi({ saveProject, exportImage, writeBinaryAtomic })
    const document = createDocument('copy', 2, 2, 'rgba')
    useWorkspace.getState().addSession(document)

    await expect(useWorkspace.getState().saveActive(true, { name: 'copy', format: 'ase', scalePercent: 100 })).resolves.toBe(true)
    expect(saveProject).toHaveBeenCalledWith('copy.ase', 'ase')
    expect(exportImage).not.toHaveBeenCalled()
    expect(document.filePath).toBe('D:/gallery/copy.ase')
  })

  it('normalizes a mismatched native dialog extension to the selected Aseprite format', async () => {
    const saveProject = vi.fn(async () => ({ canceled: false, filePath: 'D:/gallery/copy.png' }))
    const exportImage = vi.fn()
    const writeBinaryAtomic = vi.fn(async () => {})
    installApi({ saveProject, exportImage, writeBinaryAtomic })
    const document = createDocument('copy', 2, 2, 'rgba')
    useWorkspace.getState().addSession(document)

    await expect(useWorkspace.getState().saveActive(true, { name: 'copy', format: 'ase', scalePercent: 100 })).resolves.toBe(true)
    expect(saveProject).toHaveBeenCalledWith('copy.ase', 'ase')
    expect(writeBinaryAtomic).toHaveBeenCalledWith('D:/gallery/copy.ase', expect.any(Uint8Array))
    expect(document.filePath).toBe('D:/gallery/copy.ase')
  })

  it('serializes repeated saves and writes the newest revision last', async () => {
    const writes: Array<{ data: Uint8Array; resolve: () => void }> = []
    const writeBinaryAtomic = vi.fn((_filePath: string, data: Uint8Array) => new Promise<void>((resolve) => {
      writes.push({ data, resolve })
    }))
    installApi({ writeBinaryAtomic })

    const document = createDocument('save latest', 2, 2, 'rgba')
    document.filePath = 'D:/gallery/save-latest.moonsprite'
    document.dirty = true
    useWorkspace.getState().addSession(document)

    const firstSave = useWorkspace.getState().saveActive()
    await vi.waitFor(() => expect(writeBinaryAtomic).toHaveBeenCalledTimes(1))
    useWorkspace.getState().mutateActive((session) => {
      writeLayerColor(session.document, getActiveLayer(session.document), 0, red)
    })
    const secondSave = useWorkspace.getState().saveActive()
    expect(writeBinaryAtomic).toHaveBeenCalledTimes(1)

    writes[0].resolve()
    await vi.waitFor(() => expect(writeBinaryAtomic).toHaveBeenCalledTimes(2))
    const oldest = decodeProject(writes[0].data)
    expect(readLayerColor(oldest, getActiveLayer(oldest), 0)).toEqual(transparent)
    const newest = decodeProject(writes[1].data)
    expect(readLayerColor(newest, getActiveLayer(newest), 0)).toEqual(red)
    writes[1].resolve()
    await expect(Promise.all([firstSave, secondSave])).resolves.toEqual([true, true])
    expect(document.dirty).toBe(false)
  })

  it('falls back to a complete project write when incremental merge is rejected', async () => {
    const writeProjectIncremental = vi.fn(async () => { throw new Error('source changed') })
    const writeBinaryAtomic = vi.fn(async (_filePath: string, _data: Uint8Array) => {})
    installApi({ writeProjectIncremental, writeBinaryAtomic })
    const document = createDocument('incremental fallback', 2, 2, 'rgba')
    document.filePath = 'D:/gallery/incremental-fallback.moonsprite'
    registerProjectSaveBaseline(document, document.filePath, encodeProject(document))
    document.dirty = true
    useWorkspace.getState().addSession(document)

    await expect(useWorkspace.getState().saveActive()).resolves.toBe(true)

    expect(writeProjectIncremental).toHaveBeenCalledTimes(1)
    expect(writeBinaryAtomic).toHaveBeenCalledTimes(1)
    expect(decodeProject(writeBinaryAtomic.mock.calls[0][1])).toMatchObject({ name: 'incremental fallback' })
  })

  it('keeps newer edits dirty and preserves recovery data when an older save finishes', async () => {
    const deferred: { resolve?: () => void } = {}
    const writeBinaryAtomic = vi.fn(() => new Promise<void>((resolve) => { deferred.resolve = resolve }))
    const writeRecovery = vi.fn(async () => {})
    const deleteRecovery = vi.fn(async () => {})
    installApi({ writeBinaryAtomic, writeRecovery, deleteRecovery })

    const document = createDocument('save revision', 2, 2, 'rgba')
    document.filePath = 'D:/gallery/save-revision.moonsprite'
    document.dirty = true
    useWorkspace.getState().addSession(document)

    const saving = useWorkspace.getState().saveActive()
    await vi.waitFor(() => expect(writeBinaryAtomic).toHaveBeenCalledTimes(1))
    useWorkspace.getState().mutateActive((session) => {
      writeLayerColor(session.document, getActiveLayer(session.document), 0, blue)
    })
    deferred.resolve?.()

    await expect(saving).resolves.toBe(true)
    expect(document.dirty).toBe(true)
    await vi.waitFor(() => expect(writeRecovery).toHaveBeenCalledTimes(1))
    expect(deleteRecovery).not.toHaveBeenCalled()
    expect(useWorkspace.getState().message).toBe('工程已写入磁盘，但保存期间产生的新修改仍未保存。')
  })

  it('does not write after the document is closed while Save As is open', async () => {
    const deferred: { resolve?: (result: { canceled: boolean; filePath?: string }) => void } = {}
    const saveProject = vi.fn(() => new Promise<{ canceled: boolean; filePath?: string }>((resolve) => { deferred.resolve = resolve }))
    const writeBinaryAtomic = vi.fn(async () => {})
    installApi({ saveProject, writeBinaryAtomic })

    const document = createDocument('close while saving', 2, 2, 'rgba')
    document.dirty = false
    useWorkspace.getState().addSession(document)

    const save = useWorkspace.getState().saveActive(true)
    await vi.waitFor(() => expect(saveProject).toHaveBeenCalledTimes(1))
    await useWorkspace.getState().closeDocument(document.id)
    deferred.resolve?.({ canceled: false, filePath: 'D:/gallery/closed.moonsprite' })

    await expect(save).resolves.toBe(false)
    expect(writeBinaryAtomic).not.toHaveBeenCalled()
    expect(useWorkspace.getState().sessions).toHaveLength(0)
  })

  it('updates only the document that started the save when the active document changes', async () => {
    const deferred: { resolve?: () => void } = {}
    const writeBinaryAtomic = vi.fn(() => new Promise<void>((resolve) => { deferred.resolve = resolve }))
    installApi({ writeBinaryAtomic })

    const first = createDocument('first', 2, 2, 'rgba')
    first.filePath = 'D:/gallery/first.moonsprite'
    first.dirty = true
    const second = createDocument('second', 2, 2, 'rgba')
    second.filePath = 'D:/gallery/second.moonsprite'
    second.dirty = true
    useWorkspace.getState().addSession(first)
    useWorkspace.getState().addSession(second)
    useWorkspace.getState().setActive(first.id)

    const save = useWorkspace.getState().saveActive()
    await vi.waitFor(() => expect(writeBinaryAtomic).toHaveBeenCalledTimes(1))
    useWorkspace.getState().setActive(second.id)
    deferred.resolve?.()

    await expect(save).resolves.toBe(true)
    expect(first.dirty).toBe(false)
    expect(second.dirty).toBe(true)
  })
})

describe('layer group clipboard ui state', () => {
  it('selects every pasted descendant and preserves collapsed groups through undo and redo', () => {
    const source = createDocument('collapsed source', 2, 2, 'rgba')
    const member = getActiveLayer(source)
    member.groupId = 'child'
    source.groups.push(
      { id: 'root', name: 'Root', parentGroupId: null, visible: true, locked: false, opacity: 1, blendMode: 'normal' },
      { id: 'child', name: 'Child', parentGroupId: 'root', visible: true, locked: false, opacity: 1, blendMode: 'normal' }
    )
    useWorkspace.getState().addSession(source)
    useWorkspace.getState().selectLayerRows([], ['root'])
    useWorkspace.getState().toggleGroupCollapsed('root')
    useWorkspace.getState().copySelectedLayersToClipboard()

    const target = createDocument('paste target', 2, 2, 'rgba')
    useWorkspace.getState().addSession(target)
    expect(useWorkspace.getState().pasteLayersFromClipboard()).toBe(true)

    let session = useWorkspace.getState().sessions.at(-1)!
    const pastedGroups = target.groups.filter((group) => group.id !== 'root' && group.id !== 'child')
    const pastedLayers = target.layers.filter((layer) => layer.id !== target.layers[0].id)
    expect(session.selectedGroupIds).toEqual(expect.arrayContaining(pastedGroups.map((group) => group.id)))
    expect(session.selectedLayerIds).toEqual(expect.arrayContaining(pastedLayers.map((layer) => layer.id)))
    const pastedRoot = pastedGroups.find((group) => group.parentGroupId === null)!
    expect(session.collapsedGroupIds).toContain(pastedRoot.id)

    useWorkspace.getState().undo()
    expect(useWorkspace.getState().sessions.at(-1)!.collapsedGroupIds).not.toContain(pastedRoot.id)
    useWorkspace.getState().redo()
    session = useWorkspace.getState().sessions.at(-1)!
    expect(session.collapsedGroupIds).toContain(pastedRoot.id)
    expect(session.selectedLayerIds).toEqual(expect.arrayContaining(pastedLayers.map((layer) => layer.id)))
  })

  it('selects every descendant created by duplicating a selected group', () => {
    const document = createDocument('duplicate descendants', 2, 2, 'rgba')
    const member = getActiveLayer(document)
    member.groupId = 'group'
    document.groups.push({ id: 'group', name: 'Group', parentGroupId: null, visible: true, locked: false, opacity: 1, blendMode: 'normal' })
    useWorkspace.getState().addSession(document)
    useWorkspace.getState().selectLayerRows([], ['group'])

    useWorkspace.getState().duplicateSelectedLayerRows()

    const session = useWorkspace.getState().sessions[0]
    const copiedGroup = document.groups.find((group) => group.id !== 'group')!
    const copiedLayer = document.layers.find((layer) => layer.id !== member.id)!
    expect(session.selectedGroupIds).toContain(copiedGroup.id)
    expect(session.selectedLayerIds).toContain(copiedLayer.id)
  })
})

describe('layer panel state persistence', () => {
  it('restores the latest path-specific selection and collapsed groups without dirtying the project', () => {
    const document = createDocument('remember layers', 2, 2, 'rgba')
    document.filePath = 'D:/gallery/remember-layers.moonsprite'
    const layer = getActiveLayer(document)
    layer.groupId = 'root'
    document.groups.push({ id: 'root', name: 'Root', parentGroupId: null, visible: true, locked: false, opacity: 1, blendMode: 'normal' })
    document.layerPanelState = {
      activeLayerId: layer.id,
      selectedLayerIds: [layer.id],
      selectedGroupIds: [],
      selectedGroupId: null,
      layerSelectionAnchorId: layer.id,
      collapsedGroupIds: []
    }
    useWorkspace.getState().addSession(document)

    useWorkspace.getState().selectLayerRows([], ['root'])
    useWorkspace.getState().toggleGroupCollapsed('root')

    let session = useWorkspace.getState().sessions[0]
    expect(session.document.dirty).toBe(false)
    expect(session.selectedGroupIds).toEqual(['root'])
    expect(session.collapsedGroupIds).toEqual(['root'])
    expect(localStorage.getItem(LAYER_PANEL_STATE_STORAGE_KEY)).toContain('remember-layers.moonsprite')

    document.layerPanelState = {
      activeLayerId: layer.id,
      selectedLayerIds: [layer.id],
      selectedGroupIds: [],
      selectedGroupId: null,
      layerSelectionAnchorId: layer.id,
      collapsedGroupIds: []
    }
    useWorkspace.setState({ sessions: [], activeId: null })
    useWorkspace.getState().addSession(document)

    session = useWorkspace.getState().sessions[0]
    expect(session.selectedGroupIds).toEqual(['root'])
    expect(session.selectedGroupId).toBe('root')
    expect(session.collapsedGroupIds).toEqual(['root'])
    expect(session.document.activeLayerId).toBe(layer.id)
    expect(session.document.dirty).toBe(false)
  })

  it('falls back to the active layer when persisted rows no longer exist', () => {
    const document = createDocument('stale remembered layers', 2, 2, 'rgba')
    document.filePath = 'D:/gallery/stale-remembered-layers.moonsprite'
    localStorage.setItem(LAYER_PANEL_STATE_STORAGE_KEY, JSON.stringify({
      entries: [{
        filePath: 'd:\\gallery\\stale-remembered-layers.moonsprite',
        updatedAt: 1,
        state: {
          activeLayerId: 'missing-layer',
          selectedLayerIds: ['missing-layer'],
          selectedGroupIds: ['missing-group'],
          selectedGroupId: 'missing-group',
          layerSelectionAnchorId: 'missing-group',
          collapsedGroupIds: ['missing-group']
        }
      }]
    }))

    useWorkspace.getState().addSession(document)

    const session = useWorkspace.getState().sessions[0]
    expect(session.selectedLayerIds).toEqual([document.activeLayerId])
    expect(session.selectedGroupIds).toEqual([])
    expect(session.selectedGroupId).toBeNull()
    expect(session.layerSelectionAnchorId).toBe(document.activeLayerId)
    expect(session.collapsedGroupIds).toEqual([])
  })
})

describe('eyedropper color replacement', () => {
  const source = { r: 145, g: 34, b: 68, a: 255 }
  const replacement = { r: 48, g: 154, b: 210, a: 255 }

  it('replaces only the active layer and supports undo', () => {
    const document = createDocument('replace current layer', 1, 1, 'rgba')
    const active = getActiveLayer(document)
    const other = createLayer('Other', 1, 1, 'rgba')
    document.layers.push(other)
    writeLayerColor(document, active, 0, source)
    writeLayerColor(document, other, 0, source)
    useWorkspace.getState().addSession(document)
    useWorkspace.getState().setPrimaryColor({ r: 1, g: 2, b: 3, a: 255 })
    useWorkspace.getState().setSecondaryColor({ r: 4, g: 5, b: 6, a: 255 })

    useWorkspace.getState().replaceColor('layer', source, replacement)

    expect(readLayerColor(document, active, 0)).toEqual(replacement)
    expect(readLayerColor(document, other, 0)).toEqual(source)
    useWorkspace.getState().undo()
    expect(readLayerColor(document, active, 0)).toEqual(source)
  })

  it('replaces matching pixels across animation frames as one undoable operation', () => {
    const document = createDocument('replace all frames', 1, 1, 'rgba')
    writeLayerColor(document, getActiveLayer(document), 0, source)
    useWorkspace.getState().addSession(document)
    useWorkspace.getState().duplicateAnimationFrame()
    const timeline = ensureAnimationDocument(document)
    useWorkspace.getState().setPrimaryColor({ r: 1, g: 2, b: 3, a: 255 })
    useWorkspace.getState().setSecondaryColor({ r: 4, g: 5, b: 6, a: 255 })

    useWorkspace.getState().replaceColor('document', source, replacement)

    for (const frame of timeline.frames) {
      useWorkspace.getState().setActiveAnimationFrame(frame.id)
      expect(readLayerColor(document, getActiveLayer(document), 0)).toEqual(replacement)
    }
    useWorkspace.getState().undo()
    for (const frame of timeline.frames) {
      useWorkspace.getState().setActiveAnimationFrame(frame.id)
      expect(readLayerColor(document, getActiveLayer(document), 0)).toEqual(source)
    }
  })

  it('limits replacement to selected layers', () => {
    const document = createDocument('replace selected layers', 1, 1, 'rgba')
    const selected = getActiveLayer(document)
    const untouched = createLayer('Untouched', 1, 1, 'rgba')
    document.layers.push(untouched)
    ensureAnimationDocument(document)
    writeLayerColor(document, selected, 0, source)
    writeLayerColor(document, untouched, 0, source)
    useWorkspace.getState().addSession(document)
    useWorkspace.getState().selectLayerRows([selected.id], [])

    useWorkspace.getState().replaceColor('layers', source, replacement)

    expect(readLayerColor(document, selected, 0)).toEqual(replacement)
    expect(readLayerColor(document, untouched, 0)).toEqual(source)
  })

  it('limits replacement to the active selection and supports undo', () => {
    const document = createDocument('replace selection target', 3, 1, 'rgba')
    const layer = getActiveLayer(document)
    writeLayerColor(document, layer, 0, source)
    writeLayerColor(document, layer, 1, source)
    writeLayerColor(document, layer, 2, source)
    useWorkspace.getState().addSession(document)
    useWorkspace.getState().setSelection({ x: 0, y: 0, width: 3, height: 1, mask: new Uint8Array([1, 0, 1]) })

    useWorkspace.getState().replaceColor('selection', source, replacement)

    expect(readLayerColor(document, layer, 0)).toEqual(replacement)
    expect(readLayerColor(document, layer, 1)).toEqual(source)
    expect(readLayerColor(document, layer, 2)).toEqual(replacement)
    useWorkspace.getState().undo()
    expect(readLayerColor(document, layer, 0)).toEqual(source)
    expect(readLayerColor(document, layer, 2)).toEqual(source)
  })

  it('does not replace the whole layer when the selection target has no selection', () => {
    const document = createDocument('replace missing selection', 1, 1, 'rgba')
    const layer = getActiveLayer(document)
    writeLayerColor(document, layer, 0, source)
    useWorkspace.getState().addSession(document)

    useWorkspace.getState().replaceColor('selection', source, replacement)

    expect(readLayerColor(document, layer, 0)).toEqual(source)
    expect(useWorkspace.getState().sessions[0].history.canUndo).toBe(false)
  })

  it('limits replacement to selected frames and selected cels', () => {
    const document = createDocument('replace timeline targets', 1, 1, 'rgba')
    writeLayerColor(document, getActiveLayer(document), 0, source)
    useWorkspace.getState().addSession(document)
    useWorkspace.getState().duplicateAnimationFrame()
    const timeline = ensureAnimationDocument(document)
    const [firstFrame, secondFrame] = timeline.frames

    useWorkspace.getState().selectAnimationFrame(firstFrame.id)
    useWorkspace.getState().replaceColor('frames', source, replacement)
    useWorkspace.getState().setActiveAnimationFrame(firstFrame.id)
    expect(readLayerColor(document, getActiveLayer(document), 0)).toEqual(replacement)
    useWorkspace.getState().setActiveAnimationFrame(secondFrame.id)
    expect(readLayerColor(document, getActiveLayer(document), 0)).toEqual(source)

    useWorkspace.getState().selectAnimationCell(animationCelKey(document.activeLayerId, secondFrame.id))
    useWorkspace.getState().replaceColor('cells', source, replacement)
    expect(readLayerColor(document, getActiveLayer(document), 0)).toEqual(replacement)
  })

  it('previews without history and restores the original pixels', () => {
    const document = createDocument('preview replacement', 1, 1, 'rgba')
    const layer = getActiveLayer(document)
    writeLayerColor(document, layer, 0, source)
    useWorkspace.getState().addSession(document)

    const preview = useWorkspace.getState().previewColorReplacement('document', source, replacement)

    expect(preview).not.toBeNull()
    expect(readLayerColor(document, layer, 0)).toEqual(replacement)
    expect(useWorkspace.getState().sessions[0].history.canUndo).toBe(false)
    useWorkspace.getState().restoreColorReplacementPreview(preview)
    expect(readLayerColor(document, layer, 0)).toEqual(source)
  })

  it('replaces matching palette entries and supports undo', () => {
    const document = createDocument('replace palette', 1, 1, 'rgba')
    useWorkspace.getState().addSession(document)
    useWorkspace.getState().addPaletteColor(source)
    useWorkspace.getState().setPrimaryColor(source)
    const entry = document.palette.find((candidate) => candidate.id !== 0 && candidate.color.r === source.r && candidate.color.g === source.g && candidate.color.b === source.b)!

    useWorkspace.getState().replaceColor('palette', source, replacement)

    expect(entry.color).toEqual(replacement)
    expect(useWorkspace.getState().sessions[0].primaryColor).toEqual(replacement)
    useWorkspace.getState().undo()
    expect(document.palette.find((candidate) => candidate.id === entry.id)?.color).toEqual(source)
    expect(useWorkspace.getState().sessions[0].primaryColor).toEqual(source)
  })
})
