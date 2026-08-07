import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ImageResizeDialog } from './ImageResizeDialog'

describe('ImageResizeDialog', () => {
  it('selects the first dimension when opened', () => {
    render(<ImageResizeDialog open currentWidth={32} currentHeight={16} onClose={vi.fn()} onResize={vi.fn(async () => {})} />)

    expect(screen.getAllByRole('spinbutton')[0]).toHaveFocus()
  })
})
