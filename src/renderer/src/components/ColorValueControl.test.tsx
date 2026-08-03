import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ColorValueControl } from './ColorValueControl'

afterEach(() => cleanup())

describe('ColorValueControl', () => {
  it('opens the shared editor with RGB as the default mode', () => {
    render(<ColorValueControl color={{ r: 41, g: 121, b: 255, a: 255 }} onChange={vi.fn()} label="背景颜色" roleLabel="浅色" />)

    fireEvent.click(screen.getByRole('button', { name: '背景颜色 浅色' }))

    expect(screen.getByRole('dialog', { name: '颜色编辑 浅色' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'RGB', selected: true })).toBeInTheDocument()
    expect(screen.getByLabelText('当前颜色')).toBeInTheDocument()
    expect(screen.getByRole('spinbutton', { name: '背景颜色 R' })).toHaveValue('41')
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

  it('keeps each channel in one row with its colored slider and numeric input', () => {
    const { container } = render(<ColorValueControl color={{ r: 41, g: 121, b: 255, a: 128 }} onChange={vi.fn()} label="颜色值" />)
    fireEvent.click(screen.getByRole('button', { name: '颜色值' }))

    expect(document.querySelectorAll('.color-editor-field')).toHaveLength(4)
    expect(document.querySelector('.color-editor-preview')).not.toBeInTheDocument()
    expect(container.querySelector('.color-value-trigger')).toBeInTheDocument()
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
})
