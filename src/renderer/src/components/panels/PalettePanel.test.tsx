import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MoonSpriteApi, RgbaColor, StoredPalette } from '@shared/types'
import { createDocument } from '@/core/document'
import { useWorkspace } from '@/store/workspace'
import { PalettePanel } from './PalettePanel'
import { beginPaletteSamplingShortcut, endPaletteSamplingShortcut } from '@/core/palette-sampling-shortcut'

beforeEach(() => {
  localStorage.clear()
  useWorkspace.setState({ sessions: [], activeId: null, message: null, dialog: null })
})

afterEach(() => {
  endPaletteSamplingShortcut()
  cleanup()
  vi.useRealTimers()
})

describe('PalettePanel editing lock', () => {
  it('uses small swatches by default', () => {
    const project = createDocument('small palette swatches', 2, 2, 'rgba')
    useWorkspace.getState().addSession(project)
    const { container } = render(<PalettePanel session={useWorkspace.getState().sessions[0]} docked />)

    expect(container.querySelector<HTMLElement>('.swatch-grid')?.style.getPropertyValue('--swatch-size')).toBe('30px')
  })

  it('samples palette colors with the eyedropper and adds them only while Alt+S is held', () => {
    const project = createDocument('palette sampling', 2, 2, 'rgba')
    useWorkspace.getState().addSession(project)
    const session = useWorkspace.getState().sessions[0]
    session.tool = 'eyedropper'
    const sampled = project.palette.find((entry) => entry.id === 2)!
    const add = vi.spyOn(useWorkspace.getState(), 'addPaletteColor')
    add.mockClear()
    const { container } = render(<PalettePanel session={session} docked />)
    const swatch = container.querySelector<HTMLButtonElement>('[data-palette-id="2"]')!

    fireEvent.pointerDown(swatch, { button: 0, pointerId: 71 })
    expect(session.primaryColor).toEqual(sampled.color)
    expect(add).not.toHaveBeenCalled()

    beginPaletteSamplingShortcut()
    fireEvent.pointerDown(swatch, { button: 0, pointerId: 72 })
    expect(add).toHaveBeenCalledWith(sampled.color)
  })

  it('temporarily samples palette colors with Alt and keeps the eyedropper cursor visible', () => {
    const project = createDocument('temporary palette sampling', 2, 2, 'rgba')
    useWorkspace.getState().addSession(project)
    const session = useWorkspace.getState().sessions[0]
    session.tool = 'pencil'
    const sampled = project.palette.find((entry) => entry.id === 2)!
    const add = vi.spyOn(useWorkspace.getState(), 'addPaletteColor')
    add.mockClear()
    const { container } = render(<PalettePanel session={session} docked />)
    const panel = container.querySelector<HTMLElement>('.palette-panel')!
    const swatch = container.querySelector<HTMLButtonElement>('[data-palette-id="2"]')!

    fireEvent.keyDown(window, { key: 'Alt', altKey: true })
    expect(panel).toHaveClass('panel-color-sampling')
    fireEvent.pointerDown(swatch, { button: 0, pointerId: 73, altKey: true })
    expect(session.primaryColor).toEqual(sampled.color)
    expect(add).not.toHaveBeenCalled()

    fireEvent.keyUp(window, { key: 'Alt', altKey: false })
    expect(panel).not.toHaveClass('panel-color-sampling')
  })

  it('uses the standard menu pattern with expanded swatch-size choices', () => {
    const project = createDocument('palette actions', 2, 2, 'rgba')
    useWorkspace.getState().addSession(project)
    const session = useWorkspace.getState().sessions[0]
    const { container } = render(<PalettePanel session={session} docked />)

    fireEvent.click(container.querySelector<HTMLButtonElement>('.palette-actions-control > button')!)

    const menu = document.querySelector('.palette-actions-popover')
    expect(menu).toHaveClass('context-menu')
    expect(menu?.querySelector('.menu-submenu-trigger')).toHaveTextContent('排序与渐变')
    expect(menu?.querySelectorAll('[role="menuitemradio"]')).toHaveLength(7)
    expect(menu?.querySelectorAll('.palette-sort-popover [role="menuitem"]')).toHaveLength(11)
    expect(menu?.querySelectorAll('.palette-sort-popover [role="menuitem"]:disabled')).toHaveLength(2)
    expect(menu).toHaveTextContent('反向颜色渐变色调渐变色调排序饱和度排序明度排序亮度排序Red 排序Green 排序Blue 排序Alpha 排序升序降序')
    expect(menu).toHaveTextContent('较小尺寸小尺寸中尺寸大尺寸较大尺寸')
  })

  it('keeps color synchronization off by default and explains the persisted toggle', async () => {
    const project = createDocument('palette color synchronization', 2, 2, 'rgba')
    useWorkspace.getState().addSession(project)
    const session = useWorkspace.getState().sessions[0]
    const { container } = render(<PalettePanel session={session} docked />)

    fireEvent.click(container.querySelector<HTMLButtonElement>('.palette-actions-control > button')!)
    const toggle = screen.getByRole('menuitemcheckbox', { name: '同步颜色' })
    expect(toggle).toHaveAttribute('aria-checked', 'false')

    fireEvent.pointerEnter(toggle.closest('.moon-tooltip-anchor')!)
    expect(await screen.findByRole('tooltip')).toHaveTextContent('修改色板颜色时，会同时替换项目中所有未锁定图层和动画帧里使用该颜色的像素')

    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-checked', 'true')
    expect(localStorage.getItem('moonsprite.palette-sync-colors')).toBe('true')
  })

  it('keeps the swatch grid unchanged when unlocking and selecting a swatch', () => {
    localStorage.setItem('moonsprite.palette-edit-locked', 'false')
    const document = createDocument('palette panel', 2, 2, 'rgba')
    useWorkspace.getState().addSession(document)
    const session = useWorkspace.getState().sessions[0]
    const { container } = render(<PalettePanel session={session} docked />)
    const swatchCount = container.querySelectorAll('.palette-swatch-wrap').length

    const swatch = container.querySelector<HTMLElement>('[data-palette-id]')
    expect(swatch).not.toBeNull()
    fireEvent.pointerDown(swatch!, { button: 0, pointerId: 1, clientX: 0, clientY: 0 })

    expect(container.querySelectorAll('.palette-swatch-wrap')).toHaveLength(swatchCount)
    expect(container.querySelector('.palette-inline-editor')).not.toBeInTheDocument()
  })

  it('keeps an unlocked palette color selected while editing it from the color panel', () => {
    localStorage.setItem('moonsprite.palette-edit-locked', 'false')
    const project = createDocument('palette color editing focus', 2, 2, 'rgba')
    useWorkspace.getState().addSession(project)
    const session = useWorkspace.getState().sessions[0]
    const entry = project.palette.find((candidate) => candidate.id === 1)!
    const { container } = render(<PalettePanel session={session} docked />)
    const swatch = container.querySelector<HTMLButtonElement>('[data-palette-id="1"]')!
    const colorPanel = document.createElement('section')
    colorPanel.className = 'color-panel'
    const colorControl = document.createElement('button')
    colorPanel.append(colorControl)
    document.body.append(colorPanel)

    fireEvent.pointerDown(swatch, { button: 0, pointerId: 31 })
    fireEvent.pointerUp(swatch, { button: 0, pointerId: 31 })
    fireEvent.blur(swatch, { relatedTarget: colorControl })
    fireEvent.pointerDown(colorControl)
    expect(session.paletteSelectionId).toBe(1)

    useWorkspace.getState().setPrimaryColor({ r: 12, g: 34, b: 56, a: 255 })
    expect(entry.color).toEqual({ r: 12, g: 34, b: 56, a: 255 })
    colorPanel.remove()
  })

  it('renders an adaptive clickable row including empty destinations', () => {
    const project = createDocument('fixed palette slots', 2, 2, 'rgba')
    useWorkspace.getState().addSession(project)
    const session = useWorkspace.getState().sessions[0]
    const { container } = render(<PalettePanel session={session} docked />)

    const slots = container.querySelectorAll<HTMLButtonElement>('[data-palette-slot]')
    expect(slots).toHaveLength(8)
    expect(slots[6]).toHaveClass('empty')

    fireEvent.pointerDown(slots[6], { button: 0, pointerId: 2 })
    fireEvent.pointerUp(slots[6], { button: 0, pointerId: 2 })
    expect(slots[6]).toHaveClass('focused')
    expect(session.selectedPaletteIds).toEqual([])
    expect(container.querySelector<HTMLElement>('[data-palette-selection-outline]')?.style.getPropertyValue('--palette-selection-left')).toBe('6')

    fireEvent.blur(slots[6], { relatedTarget: document.body })
    expect(container.querySelector('[data-palette-selection-outline]')).not.toBeInTheDocument()
  })

  it('uses cell-style modifier selection before moving selected colors together', () => {
    const project = createDocument('palette multi-select', 2, 2, 'rgba')
    useWorkspace.getState().addSession(project)
    const session = useWorkspace.getState().sessions[0]
    const { container } = render(<PalettePanel session={session} docked />)
    const colors = container.querySelectorAll<HTMLButtonElement>('[data-palette-id]')

    fireEvent.pointerDown(colors[0], { button: 0, pointerId: 3 })
    fireEvent.pointerUp(colors[0], { button: 0, pointerId: 3 })
    const updatedColors = container.querySelectorAll<HTMLButtonElement>('[data-palette-id]')
    fireEvent(updatedColors[1], new MouseEvent('pointerdown', { bubbles: true, button: 0, ctrlKey: true }))

    expect(session.selectedPaletteIds).toEqual([1, 2])

    fireEvent.blur(updatedColors[1], { relatedTarget: document.body })
    expect(session.selectedPaletteIds).toEqual([])
  })

  it('keeps a palette box selection while using panel buttons and clears it after clicking outside', () => {
    const project = createDocument('palette retained selection', 2, 2, 'rgba')
    useWorkspace.getState().addSession(project)
    useWorkspace.getState().selectPaletteColors([1, 2], 2)
    const session = useWorkspace.getState().sessions[0]
    const { container } = render(<PalettePanel session={session} docked />)
    const swatch = container.querySelector<HTMLButtonElement>('[data-palette-id="2"]')!
    const actions = container.querySelector<HTMLButtonElement>('.palette-actions-control > button')!

    fireEvent.blur(swatch, { relatedTarget: actions })
    fireEvent.click(actions)
    expect(session.selectedPaletteIds).toEqual([1, 2])

    fireEvent.pointerDown(document.body)
    expect(session.selectedPaletteIds).toEqual([])
  })

  it('fills empty slots between selected endpoint colors when applying a gradient from the menu', () => {
    const project = createDocument('palette endpoint gradient', 2, 2, 'rgba')
    project.palette.find((entry) => entry.id === 1)!.color = { r: 0, g: 120, b: 255, a: 255 }
    project.palette.find((entry) => entry.id === 2)!.color = { r: 255, g: 255, b: 255, a: 255 }
    project.paletteColumns = 8
    project.paletteSlots = [1, null, null, null, 2, null, null, null]
    project.paletteOrder = [1, 2]
    useWorkspace.getState().addSession(project)
    useWorkspace.getState().selectPaletteColors([1, 2], 2)
    const session = useWorkspace.getState().sessions[0]
    const { container } = render(<PalettePanel session={session} docked />)

    fireEvent.click(container.querySelector<HTMLButtonElement>('.palette-actions-control > button')!)
    const gradientButton = document.querySelector<HTMLElement>('[data-sort-mode="gradient"]')?.closest<HTMLButtonElement>('button')
    expect(gradientButton).not.toBeDisabled()
    fireEvent.click(gradientButton!)

    expect(project.paletteSlots?.slice(0, 5).every((id) => id !== null)).toBe(true)
    expect(project.paletteOrder).toHaveLength(5)
  })

  it('starts moving only from the selected selection outline', () => {
    const project = createDocument('palette border drag', 2, 2, 'rgba')
    useWorkspace.getState().addSession(project)
    useWorkspace.getState().selectPaletteColor(1)
    const session = useWorkspace.getState().sessions[0]
    const { container } = render(<PalettePanel session={session} docked />)
    const grid = container.querySelector<HTMLDivElement>('.swatch-grid')!
    const color = container.querySelector<HTMLButtonElement>('[data-palette-id="1"]')!
    const slots = container.querySelectorAll<HTMLButtonElement>('[data-palette-slot]')
    const outline = container.querySelector<HTMLElement>('[data-palette-selection-outline]')!
    Object.defineProperty(outline, 'getBoundingClientRect', { value: () => ({ left: 0, top: 0, right: 22, bottom: 22, width: 22, height: 22, x: 0, y: 0, toJSON: () => ({}) }) })
    Object.defineProperty(grid, 'getBoundingClientRect', { value: () => ({ left: 0, top: 0, right: 120, bottom: 60, width: 120, height: 60, x: 0, y: 0, toJSON: () => ({}) }) })
    Object.defineProperty(slots[0], 'getBoundingClientRect', { value: () => ({ left: 0, top: 0, right: 30, bottom: 30, width: 30, height: 30, x: 0, y: 0, toJSON: () => ({}) }) })
    Object.defineProperty(slots[1], 'getBoundingClientRect', { value: () => ({ left: 30, top: 0, right: 60, bottom: 30, width: 30, height: 30, x: 30, y: 0, toJSON: () => ({}) }) })

    fireEvent.pointerDown(color, { button: 0, pointerId: 5, clientX: 11, clientY: 11 })
    fireEvent.pointerMove(color, { pointerId: 5, clientX: 12, clientY: 11 })
    expect(container.querySelector('.swatch.dragging')).not.toBeInTheDocument()
    fireEvent.pointerUp(color, { pointerId: 5 })

    fireEvent.pointerDown(color, { button: 0, pointerId: 6, clientX: 1, clientY: 11 })
    fireEvent.pointerMove(color, { pointerId: 6, clientX: 45, clientY: 11 })
    expect(container.querySelector('.swatch.dragging')).toBeInTheDocument()
    expect(container.querySelector<HTMLElement>('[data-palette-selection-outline]')?.style.getPropertyValue('--palette-selection-left')).toBe('1')
  })

  it('enters rectangular selection after a long press even when the pointer moved during the delay', () => {
    vi.useFakeTimers()
    const project = createDocument('palette long press', 2, 2, 'rgba')
    useWorkspace.getState().addSession(project)
    const session = useWorkspace.getState().sessions[0]
    const { container } = render(<PalettePanel session={session} docked />)
    const grid = container.querySelector<HTMLElement>('.swatch-grid')!
    const colors = container.querySelectorAll<HTMLButtonElement>('[data-palette-id]')
    Object.defineProperty(grid, 'getBoundingClientRect', { value: () => ({ left: 0, top: 0, right: 100, bottom: 50, width: 100, height: 50, x: 0, y: 0, toJSON: () => ({}) }) })
    Object.defineProperty(colors[0], 'getBoundingClientRect', { value: () => ({ left: 0, top: 0, right: 22, bottom: 22, width: 22, height: 22, x: 0, y: 0, toJSON: () => ({}) }) })
    Object.defineProperty(colors[1], 'getBoundingClientRect', { value: () => ({ left: 25, top: 0, right: 47, bottom: 22, width: 22, height: 22, x: 25, y: 0, toJSON: () => ({}) }) })

    fireEvent.pointerDown(colors[0], { button: 0, pointerId: 7, clientX: 11, clientY: 11 })
    fireEvent.pointerMove(colors[1], { pointerId: 7, clientX: 36, clientY: 11 })
    act(() => vi.advanceTimersByTime(360))

    const selection = container.querySelector<HTMLElement>('[data-palette-selection-outline]')
    expect(selection).toBeInTheDocument()
    expect(selection?.style.getPropertyValue('--palette-selection-width')).toBe('2')
    fireEvent.pointerUp(colors[1], { pointerId: 7 })
    expect(session.selectedPaletteIds).toEqual([1, 2])
  })

  it('adds the current foreground color to a double-clicked slot', () => {
    const project = createDocument('palette double click', 2, 2, 'rgba')
    useWorkspace.getState().addSession(project)
    useWorkspace.getState().setPrimaryColor({ r: 210, g: 40, b: 90, a: 255 })
    const session = useWorkspace.getState().sessions[0]
    const { container } = render(<PalettePanel session={session} docked />)
    const target = container.querySelectorAll<HTMLButtonElement>('[data-palette-slot]')[6]

    fireEvent.doubleClick(target)

    const added = project.palette.find((entry) => entry.color.r === 210 && entry.color.g === 40 && entry.color.b === 90)
    expect(added).toBeDefined()
    expect(project.paletteSlots?.[6]).toBe(added?.id)
  })

  it('clears an empty-slot focus after adding a color while unlocked', () => {
    localStorage.setItem('moonsprite.palette-edit-locked', 'false')
    const project = createDocument('palette unlocked add', 2, 2, 'rgba')
    useWorkspace.getState().addSession(project)
    useWorkspace.getState().setPrimaryColor({ r: 211, g: 41, b: 91, a: 255 })
    const session = useWorkspace.getState().sessions[0]
    const { container } = render(<PalettePanel session={session} docked />)
    const target = container.querySelectorAll<HTMLButtonElement>('[data-palette-slot]')[6]
    fireEvent.pointerDown(target, { button: 0, pointerId: 41 })
    fireEvent.pointerUp(target, { button: 0, pointerId: 41 })
    expect(target).toHaveClass('focused')

    fireEvent.doubleClick(target)

    expect(session.paletteSelectionId).toBeNull()
    expect(session.selectedPaletteIds).toEqual([])
    expect(container.querySelector('[data-palette-selection-outline]')).not.toBeInTheDocument()
  })

  it('uses the shared scrollbar and maps Alt wheel input to horizontal scrolling', () => {
    const project = createDocument('palette horizontal scroll', 2, 2, 'rgba')
    useWorkspace.getState().addSession(project)
    const session = useWorkspace.getState().sessions[0]
    const { container } = render(<PalettePanel session={session} docked />)
    const grid = container.querySelector<HTMLDivElement>('.swatch-grid')!

    expect(grid).toHaveClass('component-scrollbar')
    fireEvent.wheel(grid, { altKey: true, deltaY: 48 })

    expect(grid.scrollLeft).toBe(48)
  })

  it('changes the swatch size in fixed steps with Ctrl wheel input', () => {
    const project = createDocument('palette wheel size', 2, 2, 'rgba')
    useWorkspace.getState().addSession(project)
    const session = useWorkspace.getState().sessions[0]
    const { container } = render(<PalettePanel session={session} docked />)
    const grid = container.querySelector<HTMLDivElement>('.swatch-grid')!

    expect(grid.style.getPropertyValue('--swatch-size')).toBe('30px')
    fireEvent.wheel(grid, { ctrlKey: true, deltaY: -48 })
    expect(grid.style.getPropertyValue('--swatch-size')).toBe('40px')
    fireEvent.wheel(grid, { ctrlKey: true, deltaY: -48 })
    expect(grid.style.getPropertyValue('--swatch-size')).toBe('52px')
    fireEvent.wheel(grid, { ctrlKey: true, deltaY: 48 })
    expect(grid.style.getPropertyValue('--swatch-size')).toBe('40px')
  })

  it('saves the persistent columns and empty slot positions', async () => {
    const project = createDocument('positioned palette', 2, 2, 'rgba')
    project.paletteColumns = 4
    project.paletteSlots = [null, 1, null, 2]
    useWorkspace.getState().addSession(project)
    const session = useWorkspace.getState().sessions[0]
    const savePalette = vi.fn(async (_id: string | null, name: string, colors: RgbaColor[], columns: number, slots: Array<number | null>): Promise<StoredPalette> => ({
      id: 'positioned-palette',
      name,
      filePath: 'palettes/positioned-palette.palette.json',
      builtIn: false,
      colors,
      columns,
      slots
    }))
    const previousApi = window.moonSprite
    window.moonSprite = {
      listPalettes: async () => ({ directoryPath: 'palettes', palettes: [] }),
      savePalette
    } as unknown as MoonSpriteApi

    try {
      const { container } = render(<PalettePanel session={session} docked />)
      fireEvent.click(container.querySelector<HTMLButtonElement>('.palette-actions-control > button')!)
      fireEvent.click(screen.getByRole('menuitem', { name: '保存色板' }))
      fireEvent.click(screen.getByRole('button', { name: '保存为新色板' }))

      await waitFor(() => expect(savePalette).toHaveBeenCalled())
      expect(savePalette.mock.calls[0]?.[0]).toBeNull()
      expect(savePalette.mock.calls[0]?.[3]).toBe(4)
      expect(savePalette.mock.calls[0]?.[4]).toEqual([null, 0, null, 1])
    } finally {
      window.moonSprite = previousApi
    }
  })

  it('offers saving back to the selected user palette', async () => {
    const project = createDocument('selected palette', 2, 2, 'rgba')
    useWorkspace.getState().addSession(project)
    const session = useWorkspace.getState().sessions[0]
    const colors = project.paletteOrder.map((id) => ({ ...project.palette.find((entry) => entry.id === id)!.color }))
    const existing: StoredPalette = {
      id: 'selected-palette',
      name: '已有色板',
      filePath: 'palettes/selected-palette.palette.json',
      builtIn: false,
      colors,
      columns: 4,
      slots: colors.map((_, index) => index)
    }
    const savePalette = vi.fn(async (id: string | null, name: string, savedColors: RgbaColor[], columns: number, slots: Array<number | null>): Promise<StoredPalette> => ({ ...existing, id: id ?? 'new-palette', name, colors: savedColors, columns, slots }))
    const listPalettes = vi.fn(async () => ({ directoryPath: 'palettes', palettes: [existing] }))
    const previousApi = window.moonSprite
    window.moonSprite = {
      listPalettes,
      savePalette
    } as unknown as MoonSpriteApi

    try {
      const { container } = render(<PalettePanel session={session} docked />)
      await waitFor(() => expect(listPalettes).toHaveBeenCalled())
      fireEvent.click(container.querySelector<HTMLButtonElement>('.palette-actions-control > button')!)
      fireEvent.click(screen.getByRole('menuitem', { name: '保存色板' }))
      await waitFor(() => expect(screen.getByRole('button', { name: '保存到“已有色板”' })).toBeInTheDocument())
      fireEvent.click(screen.getByRole('button', { name: '保存到“已有色板”' }))

      await waitFor(() => expect(savePalette).toHaveBeenCalled())
      expect(savePalette.mock.calls[0]?.[0]).toBe('selected-palette')
    } finally {
      window.moonSprite = previousApi
    }
  })
})
