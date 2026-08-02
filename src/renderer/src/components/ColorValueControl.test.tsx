import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ColorValueControl } from './ColorValueControl'

afterEach(() => cleanup())

describe('ColorValueControl', () => {
  it('opens the shared editor with RGB as the default mode', () => {
    render(<ColorValueControl color={{ r: 41, g: 121, b: 255, a: 255 }} onChange={vi.fn()} label="背景颜色" roleLabel="浅色" />)

    fireEvent.click(screen.getByRole('button', { name: '背景颜色 浅色' }))

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
})
