import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { AdjustmentDialog } from './AdjustmentDialog'

describe('AdjustmentDialog', () => {
  it('keeps the curve plot styling separate from toolbar icon buttons', () => {
    render(<AdjustmentDialog kind="curves" onClose={vi.fn()} />)

    const plot = screen.getByRole('application', { name: /曲线编辑器/ })
    const removeButton = screen.getByRole('button', { name: '删除选中的控制点' })
    expect(plot).toHaveClass('curve-editor-plot')
    expect(removeButton.querySelector('svg')).not.toHaveClass('curve-editor-plot')
    expect(screen.getByRole('tablist', { name: '曲线通道' }).children).toHaveLength(4)
  })
})
