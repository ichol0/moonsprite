import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { MoonSpriteApi } from '@shared/types'
import { compositeDocument, createDocument, createLayer, getActiveLayer, isLayerEffectivelyLocked, isLayerEffectivelyVisible, readLayerColor, readLayerColorAt, writeLayerColor } from '@/core/document'
import { revertPixelEdit } from '@/core/history'
import { applySelectionTransform, applySelectionTranslationPreview, captureSelectionTransform, selectionTranslationPreviewEdit } from '@/core/tools'
import { builtInPalettes } from '@/core/built-in-palettes'
import { createProceduralBrush } from '@/core/brushes'
import { registerViewPreviewFlusher } from '@/core/view-preview-lifecycle'
import { useWorkspace } from './workspace'

const transparent = { r: 0, g: 0, b: 0, a: 0 }
const red = { r: 255, g: 0, b: 0, a: 255 }
const blue = { r: 0, g: 80, b: 255, a: 255 }

function installApi(overrides: Partial<MoonSpriteApi> = {}): MoonSpriteApi {
  const api = {
    getResourceInfo: vi.fn(async () => ({ totalBytes: 8_000_000_000, freeBytes: 4_000_000_000 })),
    writeClipboardImage: vi.fn(async () => {}),
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
  localStorage.clear()
  useWorkspace.setState({ sessions: [], activeId: null, message: null, saveProgress: null, dialog: null })
})

it('stores shape ratios with at most one decimal place', () => {
  useWorkspace.getState().addSession(createDocument('shape ratio', 8, 8, 'rgba'))

  useWorkspace.getState().setShapeRatio({ width: 1.26, height: 3.94 })

  expect(useWorkspace.getState().sessions[0].shapeRatio).toEqual({ width: 1.3, height: 3.9 })
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
    expect(pasted[1]).toMatchObject({ offsetX: 5, offsetY: 6, blendMode: 'multiply', displayColor: blue })
    useWorkspace.getState().undo()
    expect(target.layers).toHaveLength(1)
  })

  it('preserves nested group structure and removes the whole paste with one undo', () => {
    const source = createDocument('group source', 3, 3, 'rgba')
    const childLayer = getActiveLayer(source)
    const parentLayer = createLayer('Parent layer', 3, 3, 'rgba')
    source.layers.push(parentLayer)
    source.groups.push(
      { id: 'parent', name: 'Parent', parentGroupId: null, visible: true, locked: false, opacity: 0.75, blendMode: 'multiply', description: 'parent note' },
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
    expect(parent).toMatchObject({ opacity: 0.75, blendMode: 'multiply', description: 'parent note' })
    expect(child).toMatchObject({ parentGroupId: parent?.id, visible: false, locked: true, opacity: 0.5, blendMode: 'screen', displayColor: red })
    expect(target.layers.find((layer) => layer.name === `${childLayer.name} 副本`)?.groupId).toBe(child?.id)
    expect(target.layers.find((layer) => layer.name === 'Parent layer 副本')?.groupId).toBe(parent?.id)

    useWorkspace.getState().undo()
    expect(target.groups).toHaveLength(0)
    expect(target.layers).toHaveLength(1)
  })
})

describe('multi-layer deletion', () => {
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

describe('procedural brush settings', () => {
  it('creates a project brush from non-transparent selected pixels', () => {
    const document = createDocument('selection brush', 4, 3, 'rgba')
    const layer = getActiveLayer(document)
    writeLayerColor(document, layer, 0, red)
    writeLayerColor(document, layer, 2, { r: 10, g: 20, b: 30, a: 128 })
    useWorkspace.getState().addSession(document)
    useWorkspace.getState().setTool('selection')
    useWorkspace.getState().setSelection({ x: 0, y: 0, width: 3, height: 1 })

    useWorkspace.getState().createBrushFromSelection()

    const session = useWorkspace.getState().sessions[0]
    expect(session).toMatchObject({ tool: 'pencil', brushImageTemporary: false, brushPaintMode: 'pattern-source', selection: null })
    expect(session.brushImage).toMatchObject({ name: '自定义笔刷', width: 3, height: 1, sourceX: 0, sourceY: 0 })
    expect(session.brushImage?.coverage).toEqual(Uint8Array.from([255, 0, 128]))
    expect(session.brushImageId).toMatch(/^project-brush-/)
    expect(session.document.customBrushes).toHaveLength(1)
  })

  it('persists pattern alignment without persisting a temporary brush id', () => {
    vi.useFakeTimers()
    try {
      const document = createDocument('temporary persistence', 2, 2, 'rgba')
      writeLayerColor(document, getActiveLayer(document), 0, red)
      useWorkspace.getState().addSession(document)
      useWorkspace.getState().setSelection({ x: 0, y: 0, width: 1, height: 1 })
      useWorkspace.getState().createBrushFromSelection()
      useWorkspace.getState().setBrushPaintMode('pattern-target')
      vi.advanceTimersByTime(101)

      useWorkspace.setState({ sessions: [], activeId: null, message: null, dialog: null })
      useWorkspace.getState().addSession(createDocument('restored settings', 2, 2, 'rgba'))
      const restored = useWorkspace.getState().sessions[0]
      expect(restored.brushPaintMode).toBe('pattern-target')
      expect(restored.brushImageId).toBeTruthy()
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

  it('migrates the previous implicit antialias default to off without dropping other settings', () => {
    localStorage.setItem('moonsprite.tool-settings.v1', JSON.stringify({ brushSize: 37, proceduralAntialias: true }))
    useWorkspace.getState().addSession(createDocument('migrated antialias', 8, 8, 'rgba'))

    const session = useWorkspace.getState().sessions[0]
    expect(session.brushSize).toBe(37)
    expect(session.proceduralAntialias).toBe(false)
    expect(session.brushPaintMode).toBe('pattern-source')
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
    const firstEdit = selectionTranslationPreviewEdit(document, firstPreview)!

    useWorkspace.getState().beginFloatingSelectionTransform(source, firstEdit, before, firstTarget, false, '移动选区内容')
    expect(readLayerColorAt(document, layer, 2, 0)).toEqual(red)

    const pending = useWorkspace.getState().sessions[0].pendingPaste!
    revertPixelEdit(document, pending.previewEdit)
    const secondTarget = { x: 3, y: 0, width: 1, height: 1 }
    const secondPreview = applySelectionTranslationPreview(document, pending.source, secondTarget, pending.copy)
    const secondEdit = selectionTranslationPreviewEdit(document, secondPreview)!
    useWorkspace.getState().updateFloatingPastePreview(secondEdit, secondTarget)

    expect(readLayerColorAt(document, layer, 2, 0)).toEqual(darkBlue)
    expect(readLayerColorAt(document, layer, 3, 0)).toEqual(red)
    useWorkspace.getState().commitFloatingPaste()
    useWorkspace.getState().undo()
    expect(readLayerColorAt(document, layer, 0, 0)).toEqual(red)
    expect(readLayerColorAt(document, layer, 2, 0)).toEqual(darkBlue)
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
    expect(pending.source.selection).toMatchObject({ x: -2, y: 0, width: 6, height: 1 })
    revertPixelEdit(document, pending.previewEdit)
    const target = { ...pending.target, x: 0 }
    const moved = applySelectionTransform(document, pending.source, target, 0, true)
    if (!moved) throw new Error('missing moved paste')
    useWorkspace.getState().updateFloatingPastePreview(moved, target)

    const layer = getActiveLayer(document)
    expect(readLayerColor(document, layer, 0)).toEqual(red)
    expect(readLayerColor(document, layer, 1)).toEqual(blue)
    expect(readLayerColor(document, layer, 2)).toEqual(red)
  })
})

describe('visible palette independence', () => {
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

  it('keeps indexed pixels and internal colors when visible swatches are removed', () => {
    const document = createDocument('palette', 2, 1, 'indexed')
    const layer = getActiveLayer(document)
    if (layer.format !== 'indexed') throw new Error('wrong layer mode')
    layer.pixels[0] = 1
    useWorkspace.getState().addSession(document)
    useWorkspace.getState().selectPaletteColor(1)
    useWorkspace.getState().deletePaletteColor(1)

    expect(document.palette.some((entry) => entry.id === 1)).toBe(true)
    expect(document.paletteOrder.includes(1)).toBe(false)
    expect(layer.pixels[0]).toBe(1)
    expect(readLayerColor(document, layer, 0)).toEqual({ r: 24, g: 27, b: 33, a: 255 })
  })

  it('does not append a newly painted indexed color to visible swatches', () => {
    const document = createDocument('painted palette', 1, 1, 'indexed')
    const layer = getActiveLayer(document)
    writeLayerColor(document, layer, 0, red)

    expect(document.palette.some((entry) => entry.color.r === 255 && entry.color.g === 0 && entry.color.b === 0)).toBe(true)
    expect(document.paletteOrder).toEqual([0, 1, 2])
  })

  it('reorders and deletes multiple palette colors as one history step', () => {
    const document = createDocument('multi palette', 1, 1, 'indexed')
    useWorkspace.getState().addSession(document)
    useWorkspace.getState().selectPaletteColor(1)
    useWorkspace.getState().selectPaletteColor(2, true)

    useWorkspace.getState().reorderPaletteColors([1, 2], 0)
    expect(document.paletteOrder).toEqual([1, 2, 0])
    useWorkspace.getState().deletePaletteColors([1, 2])
    expect(document.paletteOrder).toEqual([0])

    useWorkspace.getState().undo()
    expect(document.paletteOrder).toEqual([1, 2, 0])
    useWorkspace.getState().redo()
    expect(document.paletteOrder).toEqual([0])
  })

  it('applies a built-in palette without changing indexed pixels or removing internal colors', () => {
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
    expect(layer.pixels[0]).toBe(1)
    expect(readLayerColor(document, layer, 0)).toEqual(originalColor)
    expect(document.palette.some((entry) => entry.id === 1)).toBe(true)
    useWorkspace.getState().undo()
    expect(document.paletteOrder).toEqual(originalOrder)
    useWorkspace.getState().redo()
    expect(document.paletteOrder).toHaveLength(builtInPalettes[0].colors.length + 1)
  })
})

describe('nested layer groups', () => {
  it('creates an empty group when the layer panel has no selection', () => {
    const document = createDocument('empty group', 2, 2, 'rgba')
    const layer = getActiveLayer(document)
    useWorkspace.getState().addSession(document)
    useWorkspace.getState().clearLayerSelection()

    useWorkspace.getState().createLayerGroup()

    expect(document.groups).toHaveLength(1)
    expect(layer.groupId ?? null).toBeNull()
  })

  it('creates a new layer in the selected group or selected layer container', async () => {
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
    expect(getActiveLayer(document).groupId).toBe('group')
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

    useWorkspace.getState().selectLayer(top.id)
    useWorkspace.getState().selectLayer(bottom.id, 'range')
    expect(useWorkspace.getState().sessions[0].selectedLayerIds).toEqual([top.id, middle.id, bottom.id])

    useWorkspace.getState().selectLayer(middle.id, 'toggle')
    expect(useWorkspace.getState().sessions[0].selectedLayerIds).toEqual([top.id, bottom.id])
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

  it('creates every new root layer at the visible top', async () => {
    const document = createDocument('new layers on top', 2, 2, 'rgba')
    const original = getActiveLayer(document)
    useWorkspace.getState().addSession(document)

    await useWorkspace.getState().addLayer()
    const firstCreated = getActiveLayer(document)
    useWorkspace.getState().selectLayer(original.id)
    await useWorkspace.getState().addLayer()
    const latestCreated = getActiveLayer(document)

    expect(document.layers.map((layer) => layer.id)).toEqual([original.id, firstCreated.id, latestCreated.id])
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

  it('pastes plain layers into the selected container and always places them at its top', () => {
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
    const groupedCopy = target.layers.find((layer) => layer.name === 'Source 副本' && layer.groupId === 'target-group')!
    expect(groupedCopy).toBeDefined()
    expect(target.layers.indexOf(groupedCopy)).toBeGreaterThan(target.layers.indexOf(member))

    useWorkspace.getState().selectLayer(rootBottom.id)
    expect(useWorkspace.getState().pasteLayersFromClipboard()).toBe(true)
    const rootCopies = target.layers.filter((layer) => layer.name === 'Source 副本' && !layer.groupId)
    expect(target.layers.indexOf(rootCopies.at(-1)!)).toBeGreaterThan(target.layers.indexOf(rootTop))

    useWorkspace.getState().clearLayerSelection()
    expect(useWorkspace.getState().pasteLayersFromClipboard()).toBe(true)
    const latestRootCopy = target.layers.filter((layer) => layer.name === 'Source 副本' && !layer.groupId).at(-1)!
    expect(target.layers.indexOf(latestRootCopy)).toBe(Math.max(...target.layers.filter((layer) => !layer.groupId).map((layer) => target.layers.indexOf(layer))))
  })

  it('pastes a copied group into the selected objects parent at the top of that level', () => {
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
    expect(target.layers.indexOf(copiedMember)).toBeGreaterThan(target.layers.indexOf(childBMember))
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
})

describe('multi-layer adjustments', () => {
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
    expect(useWorkspace.getState().saveProgress).toMatchObject({ title: '正在另存为' })
    useWorkspace.getState().dismissSaveProgress()
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

  it('deduplicates repeated saves for the same document', async () => {
    const deferred: { resolve?: () => void } = {}
    let writeCount = 0
    const writeBinaryAtomic = vi.fn(() => {
      writeCount += 1
      return new Promise<void>((resolve) => { deferred.resolve = resolve })
    })
    installApi({ writeBinaryAtomic })

    const document = createDocument('save once', 2, 2, 'rgba')
    document.filePath = 'D:/gallery/save-once.moonsprite'
    document.dirty = true
    useWorkspace.getState().addSession(document)

    const firstSave = useWorkspace.getState().saveActive()
    const secondSave = useWorkspace.getState().saveActive()
    await vi.waitFor(() => expect(writeBinaryAtomic).toHaveBeenCalledTimes(1))

    deferred.resolve?.()
    await expect(Promise.all([firstSave, secondSave])).resolves.toEqual([true, true])
    expect(writeBinaryAtomic).toHaveBeenCalledTimes(1)
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
