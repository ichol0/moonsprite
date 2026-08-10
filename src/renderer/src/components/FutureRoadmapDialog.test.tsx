import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FutureRoadmapDialog } from './FutureRoadmapDialog'

afterEach(cleanup)

describe('FutureRoadmapDialog', () => {
  it('shows every planned feature and marks implemented items as completed', () => {
    render(<FutureRoadmapDialog onClose={vi.fn()} />)
    const items = screen.getAllByRole('listitem')
    expect(items).toHaveLength(16)
    expect(items[0]).toHaveClass('completed')
    expect(items[1]).toHaveClass('completed')
    expect(items[2]).toHaveClass('completed')
    expect(items[3]).toHaveClass('completed')
    expect(items[4]).not.toHaveClass('completed')
    expect(items[15]).not.toHaveClass('completed')
  })

  it('closes from the unified icon button', () => {
    const onClose = vi.fn()
    render(<FutureRoadmapDialog onClose={onClose} />)
    fireEvent.click(screen.getByRole('button', { name: '关闭' }))
    expect(onClose).toHaveBeenCalledOnce()
  })
})
