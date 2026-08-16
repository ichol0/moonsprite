import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MoonSpriteApi } from '@shared/types'
import { ColorValueControl } from './ColorValueControl'
import { COLOR_EDITOR_MODES_PREFERENCE_KEY } from '@/core/file-preferences'
import { createDocument } from '@/core/document'
import { useWorkspace } from '@/store/workspace'
import { publishCanvasColorSample, publishCanvasColorSamplingCompleted } from './color-sampling-events'

beforeEach(() => {
  localStorage.clear()
  useWorkspace.setState({ sessions: [], activeId: null, message: null, dialog: null })
})
afterEach(() => cleanup())

describe('ColorValueControl', () => {
  it('keeps a disabled color trigger closed', () => {
    render(<ColorValueControl color={{ r: 41, g: 121, b: 255, a: 255 }} disabled onChange={vi.fn()} label="Color" fillWithColor />)
    const trigger = screen.getByRole('button', { name: 'Color' })

    expect(trigger).toBeDisabled()
    fireEvent.click(trigger)
    expect(document.querySelector('.color-editor-popover')).not.toBeInTheDocument()
  })

  it('renders a mixed selection without showing a misleading hex value', () => {
    render(<ColorValueControl color={{ r: 41, g: 121, b: 255, a: 255 }} mixed onChange={vi.fn()} label="Color" fillWithColor />)
    const trigger = screen.getByRole('button', { name: 'Color' })
    expect(trigger).toHaveClass('mixed-color-trigger')
    expect(trigger).not.toHaveTextContent('#2979FF')
  })
  it('uses transparent color values and readable text over the filled control checkerboard', () => {
    const { rerender } = render(<ColorValueControl color={{ r: 0, g: 63, b: 168, a: 0 }} onChange={vi.fn()} label="Foreground" fillWithColor />)
    const trigger = screen.getByRole('button', { name: 'Foreground' })

    expect(trigger.style.getPropertyValue('--color-value-fill')).toBe('rgb(0 63 168 / 0)')
    expect(trigger.style.getPropertyValue('--color-value-contrast')).toBe('#090a0d')

    rerender(<ColorValueControl color={{ r: 0, g: 63, b: 168, a: 255 }} onChange={vi.fn()} label="Foreground" fillWithColor />)
    expect(trigger.style.getPropertyValue('--color-value-fill')).toBe('rgb(0 63 168 / 1)')
    expect(trigger.style.getPropertyValue('--color-value-contrast')).toBe('#fff')
  })

  it('opens the shared editor with the five default modes led by HSV', () => {
    render(<ColorValueControl color={{ r: 41, g: 121, b: 255, a: 255 }} onChange={vi.fn()} label="背景颜色" roleLabel="浅色" />)

    fireEvent.click(screen.getByRole('button', { name: '背景颜色 浅色' }))

    expect(screen.getByRole('dialog', { name: '颜色编辑 浅色' })).toBeInTheDocument()
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual(['HSV', 'RGB', 'LAB', 'GRAY', 'PLT'])
    expect(screen.getByRole('tab', { name: 'HSV', selected: true })).toBeInTheDocument()
    expect(screen.getByLabelText('当前颜色')).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: '背景颜色 HEX' })).toHaveValue('2979FF')
    expect(screen.getByRole('spinbutton', { name: '背景颜色 H' })).toBeInTheDocument()
    expect(screen.getByRole('slider', { name: '背景颜色 A滑块' })).toHaveValue('255')
  })

  it('switches modes and sends slider changes through the color callback', () => {
    const onChange = vi.fn()
    render(<ColorValueControl color={{ r: 255, g: 0, b: 0, a: 255 }} onChange={onChange} label="颜色值" />)
    fireEvent.click(screen.getByRole('button', { name: '颜色值' }))
    fireEvent.click(screen.getByRole('tab', { name: 'HSV' }))
    fireEvent.change(screen.getByRole('slider', { name: '颜色值 H滑块' }), { target: { value: '180' } })

    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ r: 0, g: 255, b: 255, a: 255 }))
  })

  it('keeps the other values stable while editing one value in a color mode', () => {
    function ControlledColorValue() {
      const [color, setColor] = useState({ r: 41, g: 121, b: 255, a: 255 })
      return <ColorValueControl color={color} onChange={setColor} label="Color" />
    }

    render(<ControlledColorValue />)
    fireEvent.click(screen.getByRole('button', { name: 'Color' }))
    fireEvent.click(screen.getByRole('tab', { name: 'HSV' }))

    const sliders = Array.from(document.querySelectorAll<HTMLInputElement>('.color-editor-range'))
    const saturationBefore = sliders[1].value
    const valueBefore = sliders[2].value
    fireEvent.change(sliders[0], { target: { value: '180' } })

    expect(sliders[1]).toHaveValue(saturationBefore)
    expect(sliders[2]).toHaveValue(valueBefore)
    expect(document.querySelector('.color-editor-previous-swatch')).toBeInTheDocument()
    expect(document.querySelector('.color-editor-current-swatch')).toBeInTheDocument()
  })

  it('records the new color preview after a slider edit is confirmed', () => {
    render(<ColorValueControl color={{ r: 41, g: 121, b: 255, a: 255 }} onChange={vi.fn()} label="Color" />)
    fireEvent.click(screen.getByRole('button', { name: 'Color' }))
    fireEvent.click(screen.getByRole('tab', { name: 'RGB' }))
    const slider = screen.getByRole('slider', { name: /Color R/ })
    const currentSwatch = document.querySelector('.color-editor-current-swatch i') as HTMLElement
    const previousStyle = currentSwatch.style.background

    fireEvent.change(slider, { target: { value: '200' } })
    expect(currentSwatch.style.background).toBe(previousStyle)

    fireEvent.pointerUp(slider)
    expect(currentSwatch.style.background).not.toBe(previousStyle)
  })

  it('copies the confirmed color HEX and shows feedback on the clicked swatch', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText }
    })
    render(<ColorValueControl color={{ r: 41, g: 121, b: 255, a: 255 }} onChange={vi.fn()} label="Color" />)
    fireEvent.click(screen.getByRole('button', { name: 'Color' }))

    fireEvent.click(screen.getByRole('button', { name: '当前颜色' }))

    expect(writeText).toHaveBeenCalledWith('#2979FF')
    expect(await screen.findByRole('status')).toHaveTextContent('#2979FF')
    expect(document.querySelector('.color-editor-current-swatch')).toHaveClass('copied')
    expect(document.querySelector('.color-editor-copy-toast')).toBeInTheDocument()
    expect(document.querySelector('.color-editor-copy-mark')).not.toBeInTheDocument()
  })

  it('commits a HEX edit when the field loses focus', () => {
    const onChange = vi.fn()
    render(<ColorValueControl color={{ r: 255, g: 0, b: 0, a: 255 }} onChange={onChange} label="颜色值" />)
    fireEvent.click(screen.getByRole('button', { name: '颜色值' }))
    const hexInput = document.querySelector<HTMLInputElement>('.color-editor-hex input')
    expect(hexInput).not.toBeNull()

    fireEvent.change(hexInput!, { target: { value: '00ff00' } })
    fireEvent.blur(hexInput!)

    expect(onChange).toHaveBeenLastCalledWith({ r: 0, g: 255, b: 0, a: 255 })
  })

  it('pastes a valid clipboard HEX when the field is right-clicked', async () => {
    const onChange = vi.fn()
    const readClipboardText = vi.fn().mockResolvedValue(' #12AB34CC ')
    window.moonSprite = { readClipboardText } as unknown as MoonSpriteApi
    render(<ColorValueControl color={{ r: 255, g: 0, b: 0, a: 255 }} onChange={onChange} label="Color" />)
    fireEvent.click(screen.getByRole('button', { name: 'Color' }))
    const hexInput = document.querySelector<HTMLInputElement>('.color-editor-hex input')!

    fireEvent.contextMenu(hexInput)

    expect(readClipboardText).toHaveBeenCalledOnce()
    await waitFor(() => expect(onChange).toHaveBeenLastCalledWith({ r: 18, g: 171, b: 52, a: 204 }))
    expect(hexInput).toHaveValue('12AB34CC')
  })

  it('commits a HEX edit before an unmoved editor closes from an outside click', () => {
    const onChange = vi.fn()
    render(<ColorValueControl color={{ r: 255, g: 0, b: 0, a: 255 }} onChange={onChange} label="Color" storageKey="outside-commit" />)
    fireEvent.click(screen.getByRole('button', { name: 'Color' }))
    const hexInput = document.querySelector<HTMLInputElement>('.color-editor-hex input')!

    fireEvent.change(hexInput, { target: { value: '00ff00' } })
    fireEvent.pointerDown(document.body)

    expect(onChange).toHaveBeenLastCalledWith({ r: 0, g: 255, b: 0, a: 255 })
    expect(document.querySelector('.color-editor-popover')).not.toBeInTheDocument()
  })

  it('keeps each channel in one row with its colored slider and numeric input', () => {
    const { container } = render(<ColorValueControl color={{ r: 41, g: 121, b: 255, a: 128 }} onChange={vi.fn()} label="颜色值" />)
    fireEvent.click(screen.getByRole('button', { name: '颜色值' }))

    expect(document.querySelectorAll('.color-editor-field')).toHaveLength(4)
    expect(document.querySelector('.color-editor-preview')).not.toBeInTheDocument()
    expect(container.querySelector('.color-value-trigger')).toBeInTheDocument()
  })

  it('expands a compact editor when switching to CMYK', async () => {
    localStorage.setItem(COLOR_EDITOR_MODES_PREFERENCE_KEY, JSON.stringify([{ mode: 'hsv', enabled: true }, { mode: 'cmyk', enabled: true }, { mode: 'rgb', enabled: false }, { mode: 'lab', enabled: false }, { mode: 'gray', enabled: false }, { mode: 'palette', enabled: false }, { mode: 'hsl', enabled: false }]))
    localStorage.setItem('moonsprite.color-editor-size.cmyk-fit', JSON.stringify({ width: 560, height: 240 }))
    render(<ColorValueControl color={{ r: 41, g: 121, b: 255, a: 255 }} onChange={vi.fn()} label="Color" storageKey="cmyk-fit" />)
    fireEvent.click(screen.getByRole('button', { name: 'Color' }))
    const editor = screen.getByRole('dialog')

    fireEvent.click(screen.getByRole('tab', { name: 'CMYK' }))

    await waitFor(() => expect(editor.style.height).toBe('298px'))
    expect(document.querySelectorAll('.color-editor-field')).toHaveLength(5)
  })

  it('closes the draggable editor from its title bar', () => {
    render(<ColorValueControl color={{ r: 41, g: 121, b: 255, a: 255 }} onChange={vi.fn()} label="颜色值" />)
    fireEvent.click(screen.getByRole('button', { name: '颜色值' }))
    expect(screen.getByRole('dialog', { name: '颜色编辑' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '关闭颜色编辑' }))
    expect(screen.queryByRole('dialog', { name: '颜色编辑' })).not.toBeInTheDocument()
  })

  it('closes an unmoved transient editor after clicking outside', () => {
    render(<ColorValueControl color={{ r: 255, g: 0, b: 0, a: 255 }} onChange={vi.fn()} label="颜色" roleLabel="前景" storageKey="foreground" />)
    fireEvent.click(screen.getByRole('button', { name: '颜色 前景' }))
    fireEvent.pointerDown(document.body)

    expect(screen.queryByRole('dialog', { name: '颜色编辑 前景色' })).not.toBeInTheDocument()
  })

  it('keeps a moved foreground editor resident while opening the background editor', () => {
    render(<><ColorValueControl color={{ r: 255, g: 0, b: 0, a: 255 }} onChange={vi.fn()} label="颜色" roleLabel="前景" storageKey="foreground" /><ColorValueControl color={{ r: 0, g: 0, b: 255, a: 255 }} onChange={vi.fn()} label="颜色" roleLabel="背景" storageKey="background" /></>)

    fireEvent.click(screen.getByRole('button', { name: '颜色 前景' }))
    const foreground = screen.getByRole('dialog', { name: '颜色编辑 前景色' })
    fireEvent.pointerDown(foreground.querySelector('header')!, { button: 0, clientX: 20, clientY: 20 })
    fireEvent.pointerMove(window, { clientX: 40, clientY: 40 })
    fireEvent.pointerUp(window)
    fireEvent.click(screen.getByRole('button', { name: '颜色 背景' }))

    expect(screen.getByRole('dialog', { name: '颜色编辑 前景色' })).toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: '颜色编辑 背景色' })).toBeInTheDocument()
    expect(foreground.querySelectorAll('.floating-resize-handle')).toHaveLength(8)
  })

  it('closes a moved editor on focus loss when requested by its host dialog', () => {
    render(<ColorValueControl color={{ r: 255, g: 0, b: 0, a: 255 }} onChange={vi.fn()} label="Color" storageKey="dialog-color" dismissOnFocusLoss />)
    fireEvent.click(screen.getByRole('button', { name: 'Color' }))
    const editor = screen.getByRole('dialog')
    fireEvent.pointerDown(editor.querySelector('header')!, { button: 0, clientX: 20, clientY: 20 })
    fireEvent.pointerMove(window, { clientX: 60, clientY: 60 })
    fireEvent.pointerUp(window)

    fireEvent.pointerDown(document.body)

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('returns to its default position after closing and reopening', () => {
    render(<ColorValueControl color={{ r: 255, g: 0, b: 0, a: 255 }} onChange={vi.fn()} label="颜色" roleLabel="前景" storageKey="foreground" />)
    const trigger = screen.getByRole('button', { name: '颜色 前景' })
    fireEvent.click(trigger)
    const first = screen.getByRole('dialog', { name: '颜色编辑 前景色' })
    const defaultLeft = first.style.left
    fireEvent.pointerDown(first.querySelector('header')!, { button: 0, clientX: 20, clientY: 20 })
    fireEvent.pointerMove(window, { clientX: 180, clientY: 100 })
    fireEvent.pointerUp(window)
    expect(first.style.left).not.toBe(defaultLeft)

    fireEvent.click(screen.getByRole('button', { name: '关闭颜色编辑' }))
    fireEvent.click(trigger)

    expect(screen.getByRole('dialog', { name: '颜色编辑 前景色' }).style.left).toBe(defaultLeft)
  })

  it('uses the enabled color mode order from preferences', () => {
    localStorage.setItem(COLOR_EDITOR_MODES_PREFERENCE_KEY, JSON.stringify([{ mode: 'lab', enabled: true }, { mode: 'rgb', enabled: true }, { mode: 'hsv', enabled: false }]))
    render(<ColorValueControl color={{ r: 41, g: 121, b: 255, a: 255 }} onChange={vi.fn()} label="颜色" />)
    fireEvent.click(screen.getByRole('button', { name: '颜色' }))

    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual(['LAB', 'RGB', 'GRAY', 'PLT'])
    expect(screen.getByRole('tab', { name: 'LAB', selected: true })).toBeInTheDocument()
  })

  it('shows the active project palette in PLT order and applies a selected color', () => {
    const document = createDocument('palette editor', 2, 2, 'rgba')
    document.palette = [
      { id: 1, name: 'Red', color: { r: 255, g: 0, b: 0, a: 255 } },
      { id: 2, name: 'Transparent blue', color: { r: 0, g: 0, b: 255, a: 0 } }
    ]
    document.paletteOrder = [2, 1]
    useWorkspace.getState().addSession(document)
    const onChange = vi.fn()
    render(<ColorValueControl color={{ r: 41, g: 121, b: 255, a: 255 }} onChange={onChange} label="Color" />)
    fireEvent.click(screen.getByRole('button', { name: 'Color' }))
    fireEvent.click(screen.getByRole('tab', { name: 'PLT' }))

    const options = screen.getAllByRole('option')
    expect(options.map((option) => option.getAttribute('aria-label'))).toEqual(['Transparent blue #0000FF00', 'Red #FF0000'])
    fireEvent.click(screen.getByRole('option', { name: 'Red #FF0000' }))

    expect(onChange).toHaveBeenLastCalledWith({ r: 255, g: 0, b: 0, a: 255 })
    expect(screen.getByRole('option', { name: 'Red #FF0000' })).toHaveAttribute('aria-selected', 'true')
  })

  it('samples a canvas color from the editor and restores the previous tool', () => {
    useWorkspace.getState().addSession(createDocument('color editor sampling', 2, 2, 'rgba'))
    const onChange = vi.fn()
    render(<ColorValueControl color={{ r: 41, g: 121, b: 255, a: 255 }} onChange={onChange} label="Color" dismissOnFocusLoss />)
    fireEvent.click(screen.getByRole('button', { name: 'Color' }))
    const eyedropper = screen.getByRole('button', { name: '从画布吸色' })

    fireEvent.click(eyedropper)
    expect(eyedropper).toHaveAttribute('aria-pressed', 'true')
    expect(useWorkspace.getState().sessions[0].tool).toBe('eyedropper')
    fireEvent.pointerDown(document.body)
    expect(screen.getByRole('dialog')).toBeInTheDocument()

    act(() => publishCanvasColorSample({ r: 18, g: 171, b: 52, a: 128 }, false))
    expect(onChange).toHaveBeenLastCalledWith({ r: 18, g: 171, b: 52, a: 128 })
    expect(screen.getByRole('textbox', { name: 'Color HEX' })).toHaveValue('12AB3480')

    act(() => publishCanvasColorSamplingCompleted())
    expect(eyedropper).toHaveAttribute('aria-pressed', 'false')
    expect(useWorkspace.getState().sessions[0].tool).toBe('pencil')
  })

  it('only shows the add-to-palette action for a missing color', () => {
    const add = vi.fn()
    const { container, rerender } = render(<ColorValueControl color={{ r: 41, g: 121, b: 255, a: 255 }} onChange={vi.fn()} label="颜色" inPalette={false} onAddToPalette={add} addToPaletteShortcut="Alt+S" />)
    const button = container.querySelector<HTMLButtonElement>('.color-value-add-button')!
    const actionRow = container.querySelector('.color-value-action-row')
    expect(actionRow).toHaveClass('supports-palette-action', 'has-add-action')
    expect(button).not.toBeNull()
    expect(button).toHaveAttribute('title', '手动加入当前颜色；快捷操作：按住 Alt+S 后点击颜色')
    fireEvent.click(button)
    expect(add).toHaveBeenCalledOnce()

    rerender(<ColorValueControl color={{ r: 41, g: 121, b: 255, a: 255 }} onChange={vi.fn()} label="颜色" inPalette onAddToPalette={add} />)
    expect(container.querySelector('.color-value-add-button')).not.toBeInTheDocument()
    expect(actionRow).toHaveClass('supports-palette-action')
    expect(actionRow).not.toHaveClass('has-add-action')
  })

  it('fills foreground and background triggers with their colors and readable text', () => {
    const { container, rerender } = render(<ColorValueControl color={{ r: 240, g: 240, b: 240, a: 255 }} onChange={vi.fn()} label="Color" roleLabel="Foreground" fillWithColor />)
    const trigger = container.querySelector<HTMLButtonElement>('.filled-color-trigger')!
    expect(trigger.style.getPropertyValue('--color-value-fill')).toBe('rgb(240 240 240 / 1)')
    expect(trigger.style.getPropertyValue('--color-value-contrast')).toBe('#090a0d')
    expect(trigger.querySelector('.color-value-swatch')).not.toBeInTheDocument()

    rerender(<ColorValueControl color={{ r: 10, g: 20, b: 30, a: 255 }} onChange={vi.fn()} label="Color" roleLabel="Background" fillWithColor />)
    expect(trigger.style.getPropertyValue('--color-value-fill')).toBe('rgb(10 20 30 / 1)')
    expect(trigger.style.getPropertyValue('--color-value-contrast')).toBe('#fff')
  })
})
