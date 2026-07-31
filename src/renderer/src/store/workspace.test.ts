import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { MoonSpriteApi } from '@shared/types'
import { compositeDocument, createDocument, createLayer, getActiveLayer, isLayerEffectivelyLocked, isLayerEffectivelyVisible, readLayerColor, readLayerColorAt, writeLayerColor } from '@/core/document'
import { revertPixelEdit } from '@/core/history'
import { applySelectionTransform } from '@/core/tools'
import { builtInPalettes } from '@/core/built-in-palettes'
import { createProceduralBrush } from '@/core/brushes'
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
  useWorkspace.setState({ sessions: [], activeId: null, message: null, dialog: null })
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
})

describe('foreground fill command', () => {
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

  it('keeps pasted pixels floating until confirmation and preserves transparent destinations', async () => {
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
    expect(readLayerColor(document, pasted, 1)).toEqual(red)
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
    expect(readLayerColor(document, getActiveLayer(document), 1)).toEqual(red)
    expect(readLayerColor(document, source, 0)).toEqual(red)
    expect(readLayerColor(document, source, 2)).toEqual(blue)
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
