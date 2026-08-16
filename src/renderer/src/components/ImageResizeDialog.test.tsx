import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ImageResizeDialog } from './ImageResizeDialog'

afterEach(cleanup)

describe('ImageResizeDialog', () => {
  it('selects the first dimension when opened', () => {
    const view = render(<ImageResizeDialog open currentWidth={32} currentHeight={16} onClose={vi.fn()} onResize={vi.fn(async () => {})} onDetectScale={vi.fn(() => null)} />)

    expect(view.getAllByRole('spinbutton')[0]).toHaveFocus()
  })

  it('applies the detected scale to pixel and percentage dimensions', async () => {
    const view = render(<ImageResizeDialog open currentWidth={32} currentHeight={16} onClose={vi.fn()} onResize={vi.fn(async () => {})} onDetectScale={vi.fn(() => 4)} />)

    fireEvent.click(view.getByRole('button', { name: '识别倍率' }))

    expect(await view.findByText('识别到 4 倍，尺寸已调整为 8 × 4 px')).toBeInTheDocument()
    const inputs = view.getAllByRole('spinbutton')
    expect(inputs[0]).toHaveValue('8')
    expect(inputs[1]).toHaveValue('4')
    expect(inputs[2]).toHaveValue('25')
    expect(inputs[3]).toHaveValue('25')
  })

  it('rounds the target dimensions when the canvas is cropped between repeated blocks', async () => {
    const view = render(<ImageResizeDialog open currentWidth={890} currentHeight={352} onClose={vi.fn()} onResize={vi.fn(async () => {})} onDetectScale={vi.fn(() => 4)} />)

    fireEvent.click(view.getByRole('button', { name: '识别倍率' }))

    expect(await view.findByText('识别到 4 倍，尺寸已调整为 223 × 88 px')).toBeInTheDocument()
    const inputs = view.getAllByRole('spinbutton')
    expect(inputs[0]).toHaveValue('223')
    expect(inputs[1]).toHaveValue('88')
    expect(inputs[2]).toHaveValue('25')
    expect(inputs[3]).toHaveValue('25')
  })
})
