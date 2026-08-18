import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MoonSpriteApi } from '@shared/types'
import { I18nProvider } from '@/components/I18nProvider'
import { clearTilesetTilePreview, publishTilesetTilePreview } from '@/components/tileset-preview-events'
import { createDocument } from '@/core/document'
import { TILESET_DELETE_COMMAND_EVENT } from '@/core/command-context'
import { useWorkspace } from '@/store/workspace'
import { TilesetPanel } from './TilesetPanel'

beforeEach(() => {
  localStorage.clear()
  const api = {
    getResourceInfo: vi.fn(async () => ({ totalBytes: 8_000_000_000, freeBytes: 4_000_000_000 }))
  } as unknown as MoonSpriteApi
  Object.defineProperty(window, 'moonSprite', { configurable: true, writable: true, value: api })
  useWorkspace.setState({ sessions: [], activeId: null, message: null, saveProgress: null, dialog: null })
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('TilesetPanel tile previews', () => {
  it('shows and clears transient canvas edits in the matching tile thumbnail', async () => {
    const context = {
      createImageData: vi.fn((width: number, height: number) => ({ data: new Uint8ClampedArray(width * height * 4), width, height })),
      putImageData: vi.fn()
    }
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => context as never)

    const document = createDocument('tile preview', 2, 1, 'rgba')
    useWorkspace.getState().addSession(document)
    await useWorkspace.getState().createTilemapLayer({ name: 'Preview Tiles', tileWidth: 1, tileHeight: 1 })
    const session = useWorkspace.getState().sessions[0]
    const tileset = document.tilesets![0]
    const tileId = tileset.tileIds[0]

    render(<I18nProvider><TilesetPanel session={session} docked /></I18nProvider>)
    expect(Array.from(context.putImageData.mock.calls.at(-1)![0].data)).toEqual([0, 0, 0, 0])

    const previewPixels = new Uint8ClampedArray([24, 80, 220, 255])
    act(() => publishTilesetTilePreview({ documentId: document.id, tilesetId: tileset.id, tiles: new Map([[tileId, previewPixels]]) }))
    expect(Array.from(context.putImageData.mock.calls.at(-1)![0].data)).toEqual(Array.from(previewPixels))

    const continuedStrokePixels = new Uint8ClampedArray([60, 140, 230, 255])
    act(() => publishTilesetTilePreview({ documentId: document.id, tilesetId: tileset.id, tiles: new Map([[tileId, continuedStrokePixels]]) }))
    expect(Array.from(context.putImageData.mock.calls.at(-1)![0].data)).toEqual(Array.from(continuedStrokePixels))

    act(() => clearTilesetTilePreview(document.id, tileset.id))
    expect(Array.from(context.putImageData.mock.calls.at(-1)![0].data)).toEqual([0, 0, 0, 0])
  })
})

describe('TilesetPanel tile selection and reordering', () => {
  it('switches to tile painting when a tile is clicked', async () => {
    const context = {
      createImageData: vi.fn((width: number, height: number) => ({ data: new Uint8ClampedArray(width * height * 4), width, height })),
      putImageData: vi.fn()
    }
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => context as never)

    const document = createDocument('tile paint selection', 2, 1, 'rgba')
    useWorkspace.getState().addSession(document)
    await useWorkspace.getState().createTilemapLayer({ name: 'Paint Tiles', tileWidth: 1, tileHeight: 1 })
    useWorkspace.getState().setTilemapMode('edit')
    const session = useWorkspace.getState().sessions[0]
    const { container } = render(<I18nProvider><TilesetPanel session={session} docked /></I18nProvider>)

    fireEvent.pointerDown(container.querySelector<HTMLButtonElement>('.tileset-tile')!, { button: 0, pointerId: 1 })

    expect(session.tilemapMode).toBe('paint')
  })

  it('moves a multi-selection only when the pointer starts on its outline', async () => {
    const context = {
      createImageData: vi.fn((width: number, height: number) => ({ data: new Uint8ClampedArray(width * height * 4), width, height })),
      putImageData: vi.fn()
    }
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => context as never)

    const document = createDocument('tile reorder', 4, 1, 'rgba')
    useWorkspace.getState().addSession(document)
    await useWorkspace.getState().createTilemapLayer({ name: 'Reorder Tiles', tileWidth: 1, tileHeight: 1 })
    const tilesetId = document.tilesets![0].id
    useWorkspace.getState().addTilesetTile(tilesetId)
    useWorkspace.getState().addTilesetTile(tilesetId)
    useWorkspace.getState().addTilesetTile(tilesetId)
    const originalTileIds = [...document.tilesets![0].tileIds]
    const session = useWorkspace.getState().sessions[0]
    const reposition = vi.spyOn(useWorkspace.getState(), 'setTilesetTileSlots')
    const { container } = render(<I18nProvider><TilesetPanel session={session} docked /></I18nProvider>)
    const grid = container.querySelector<HTMLDivElement>('.tileset-tile-grid')!
    const buttons = Array.from(container.querySelectorAll<HTMLButtonElement>('.tileset-tile'))
    const wraps = Array.from(container.querySelectorAll<HTMLElement>('.tileset-tile-wrap'))
    const setPointerCapture = vi.fn()
    Object.assign(grid, { setPointerCapture, hasPointerCapture: vi.fn(() => false), releasePointerCapture: vi.fn() })
    const tileRect = (index: number): DOMRect => ({ left: index * 40, right: index * 40 + 40, top: 0, bottom: 40, width: 40, height: 40, x: index * 40, y: 0, toJSON: () => ({}) } as DOMRect)
    wraps.forEach((wrap, index) => vi.spyOn(wrap, 'getBoundingClientRect').mockReturnValue(tileRect(index)))
    buttons.forEach((button, index) => vi.spyOn(button, 'getBoundingClientRect').mockReturnValue(tileRect(index)))

    fireEvent.pointerDown(buttons[0], { button: 0, pointerId: 1, clientX: 20, clientY: 20 })
    const outline = container.querySelector<HTMLElement>('[data-tileset-selection-outline]')!
    const outlineBounds = vi.spyOn(outline, 'getBoundingClientRect').mockReturnValue(tileRect(0))
    fireEvent.pointerDown(buttons[0], { button: 0, pointerId: 2, clientX: 20, clientY: 20 })
    fireEvent.pointerMove(grid, { pointerId: 2, clientX: 140, clientY: 20 })
    fireEvent.pointerUp(grid, { pointerId: 2, clientX: 140, clientY: 20 })
    expect(setPointerCapture).toHaveBeenLastCalledWith(2)
    expect(reposition).not.toHaveBeenCalled()
    setPointerCapture.mockClear()

    fireEvent.pointerDown(buttons[1], { button: 0, pointerId: 3, ctrlKey: true, clientX: 60, clientY: 20 })
    expect(buttons[0]).toHaveAttribute('aria-selected', 'true')
    expect(buttons[1]).toHaveAttribute('aria-selected', 'true')
    outlineBounds.mockReturnValue({ left: 0, right: 80, top: 0, bottom: 40, width: 80, height: 40, x: 0, y: 0, toJSON: () => ({}) } as DOMRect)

    fireEvent.pointerDown(buttons[1], { button: 0, pointerId: 4, clientX: 79, clientY: 20 })
    fireEvent.pointerMove(grid, { pointerId: 4, clientX: 140, clientY: 20 })
    fireEvent.pointerUp(grid, { pointerId: 4, clientX: 140, clientY: 20 })

    const expectedOrder = [originalTileIds[2], originalTileIds[3], originalTileIds[0], originalTileIds[1]]
    expect(setPointerCapture).toHaveBeenCalledWith(4)
    expect(reposition).toHaveBeenCalledTimes(1)
    expect(reposition).toHaveBeenCalledWith(tilesetId, expectedOrder)
    expect(document.tilesets![0].tileIds).toEqual(originalTileIds)
    expect(document.tilesets![0].tileSlots).toEqual(expectedOrder)
  })

  it('moves the only tile into an empty visible slot and leaves its source empty', async () => {
    const context = {
      createImageData: vi.fn((width: number, height: number) => ({ data: new Uint8ClampedArray(width * height * 4), width, height })),
      putImageData: vi.fn()
    }
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => context as never)

    const document = createDocument('single tile layout', 4, 1, 'rgba')
    useWorkspace.getState().addSession(document)
    await useWorkspace.getState().createTilemapLayer({ name: 'Single Tile', tileWidth: 1, tileHeight: 1 })
    const tileset = document.tilesets![0]
    const tileId = tileset.tileIds[0]
    tileset.tileSlots = [tileId, null, null, null]
    const session = useWorkspace.getState().sessions[0]
    const reposition = vi.spyOn(useWorkspace.getState(), 'setTilesetTileSlots')
    const { container } = render(<I18nProvider><TilesetPanel session={session} docked /></I18nProvider>)
    const grid = container.querySelector<HTMLDivElement>('.tileset-tile-grid')!
    const buttons = Array.from(container.querySelectorAll<HTMLButtonElement>('.tileset-tile'))
    const wraps = Array.from(container.querySelectorAll<HTMLElement>('.tileset-tile-wrap'))
    Object.assign(grid, { setPointerCapture: vi.fn(), hasPointerCapture: vi.fn(() => false), releasePointerCapture: vi.fn() })
    const tileRect = (index: number): DOMRect => ({ left: index * 40, right: index * 40 + 40, top: 0, bottom: 40, width: 40, height: 40, x: index * 40, y: 0, toJSON: () => ({}) } as DOMRect)
    wraps.forEach((wrap, index) => vi.spyOn(wrap, 'getBoundingClientRect').mockReturnValue(tileRect(index)))
    buttons.forEach((button, index) => vi.spyOn(button, 'getBoundingClientRect').mockReturnValue(tileRect(index)))

    fireEvent.pointerDown(buttons[0], { button: 0, pointerId: 21, clientX: 20, clientY: 20 })
    const outline = container.querySelector<HTMLElement>('[data-tileset-selection-outline]')!
    vi.spyOn(outline, 'getBoundingClientRect').mockReturnValue(tileRect(0))
    fireEvent.pointerDown(buttons[0], { button: 0, pointerId: 22, clientX: 39, clientY: 20 })
    fireEvent.pointerMove(grid, { pointerId: 22, clientX: 140, clientY: 20 })
    fireEvent.pointerUp(grid, { pointerId: 22, clientX: 140, clientY: 20 })

    expect(reposition).toHaveBeenCalledWith(tileset.id, [null, null, null, tileId])
    expect(tileset.tileSlots).toEqual([null, null, null, tileId])
    expect(tileset.tileIds).toEqual([tileId])
  })

  it('supports range selection and modifier toggling without changing tile roles', async () => {
    const context = {
      createImageData: vi.fn((width: number, height: number) => ({ data: new Uint8ClampedArray(width * height * 4), width, height })),
      putImageData: vi.fn()
    }
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => context as never)

    const document = createDocument('tile selection', 4, 1, 'rgba')
    useWorkspace.getState().addSession(document)
    await useWorkspace.getState().createTilemapLayer({ name: 'Select Tiles', tileWidth: 1, tileHeight: 1 })
    const tilesetId = document.tilesets![0].id
    useWorkspace.getState().addTilesetTile(tilesetId)
    useWorkspace.getState().addTilesetTile(tilesetId)
    useWorkspace.getState().addTilesetTile(tilesetId)
    const session = useWorkspace.getState().sessions[0]
    const { container } = render(<I18nProvider><TilesetPanel session={session} docked /></I18nProvider>)
    const buttons = Array.from(container.querySelectorAll<HTMLButtonElement>('.tileset-tile'))

    fireEvent.pointerDown(buttons[0], { button: 0, pointerId: 11 })
    fireEvent.pointerDown(buttons[2], { button: 0, pointerId: 12, shiftKey: true })
    expect(buttons.slice(0, 3).every((button) => button.getAttribute('aria-selected') === 'true')).toBe(true)
    expect(buttons[3]).toHaveAttribute('aria-selected', 'false')

    fireEvent.pointerDown(buttons[1], { button: 0, pointerId: 13, ctrlKey: true })
    expect(buttons[0]).toHaveAttribute('aria-selected', 'true')
    expect(buttons[1]).toHaveAttribute('aria-selected', 'false')
    expect(buttons[2]).toHaveAttribute('aria-selected', 'true')
    expect(session.selectedTileId).toBe(document.tilesets![0].tileIds[1])
  })

  it('deletes the current tile selection as one undoable command', async () => {
    const context = {
      createImageData: vi.fn((width: number, height: number) => ({ data: new Uint8ClampedArray(width * height * 4), width, height })),
      putImageData: vi.fn()
    }
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => context as never)

    const document = createDocument('tile keyboard delete', 4, 1, 'rgba')
    useWorkspace.getState().addSession(document)
    await useWorkspace.getState().createTilemapLayer({ name: 'Delete Tiles', tileWidth: 1, tileHeight: 1 })
    const tilesetId = document.tilesets![0].id
    useWorkspace.getState().addTilesetTile(tilesetId)
    useWorkspace.getState().addTilesetTile(tilesetId)
    useWorkspace.getState().addTilesetTile(tilesetId)
    const originalTileIds = [...document.tilesets![0].tileIds]
    const session = useWorkspace.getState().sessions[0]
    const { container } = render(<I18nProvider><TilesetPanel session={session} docked /></I18nProvider>)
    const buttons = Array.from(container.querySelectorAll<HTMLButtonElement>('.tileset-tile'))

    fireEvent.pointerDown(buttons[1], { button: 0, pointerId: 41 })
    fireEvent.pointerDown(buttons[2], { button: 0, pointerId: 42, ctrlKey: true })
    act(() => container.querySelector<HTMLElement>('.tileset-panel')!.dispatchEvent(new Event(TILESET_DELETE_COMMAND_EVENT)))

    expect(document.tilesets![0].tileIds).toEqual([originalTileIds[0], originalTileIds[3]])
    useWorkspace.getState().undo()
    expect(document.tilesets![0].tileIds).toEqual(originalTileIds)
  })

  it('selects multiple tiles by long-pressing and dragging across the grid', async () => {
    vi.useFakeTimers()
    const context = {
      createImageData: vi.fn((width: number, height: number) => ({ data: new Uint8ClampedArray(width * height * 4), width, height })),
      putImageData: vi.fn()
    }
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => context as never)

    const document = createDocument('tile box selection', 4, 1, 'rgba')
    useWorkspace.getState().addSession(document)
    await useWorkspace.getState().createTilemapLayer({ name: 'Select Tiles', tileWidth: 1, tileHeight: 1 })
    const tilesetId = document.tilesets![0].id
    useWorkspace.getState().addTilesetTile(tilesetId)
    useWorkspace.getState().addTilesetTile(tilesetId)
    useWorkspace.getState().addTilesetTile(tilesetId)
    const session = useWorkspace.getState().sessions[0]
    const { container } = render(<I18nProvider><TilesetPanel session={session} docked /></I18nProvider>)
    const grid = container.querySelector<HTMLDivElement>('.tileset-tile-grid')!
    const buttons = Array.from(container.querySelectorAll<HTMLButtonElement>('.tileset-tile'))
    const wraps = Array.from(container.querySelectorAll<HTMLElement>('.tileset-tile-wrap'))
    Object.assign(grid, { setPointerCapture: vi.fn(), hasPointerCapture: vi.fn(() => false), releasePointerCapture: vi.fn() })
    const tileRect = (index: number): DOMRect => ({ left: index * 40, right: index * 40 + 40, top: 0, bottom: 40, width: 40, height: 40, x: index * 40, y: 0, toJSON: () => ({}) } as DOMRect)
    wraps.forEach((wrap, index) => vi.spyOn(wrap, 'getBoundingClientRect').mockReturnValue(tileRect(index)))

    fireEvent.pointerDown(buttons[0], { button: 0, pointerId: 31, clientX: 20, clientY: 20 })
    fireEvent.pointerMove(grid, { pointerId: 31, clientX: 100, clientY: 20 })
    act(() => vi.advanceTimersByTime(360))

    expect(buttons.slice(0, 3).every((button) => button.getAttribute('aria-selected') === 'true')).toBe(true)
    expect(buttons[3]).toHaveAttribute('aria-selected', 'false')
    fireEvent.pointerUp(grid, { pointerId: 31, clientX: 100, clientY: 20 })
    expect(buttons.slice(0, 3).every((button) => button.getAttribute('aria-selected') === 'true')).toBe(true)
  })
})
