import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FutureRoadmapDialog } from './FutureRoadmapDialog'

afterEach(cleanup)

describe('FutureRoadmapDialog', () => {
  it('shows every planned feature and marks implemented items as completed', () => {
    render(<FutureRoadmapDialog onClose={vi.fn()} />)
    const items = screen.getAllByRole('listitem')
    expect(items).toHaveLength(21)
    expect(items.slice(0, 11).every((item) => item.classList.contains('completed'))).toBe(true)
    expect(items.slice(11).every((item) => !item.classList.contains('completed'))).toBe(true)
  })

  it('closes from the unified icon button', () => {
    const onClose = vi.fn()
    render(<FutureRoadmapDialog onClose={onClose} />)
    fireEvent.click(screen.getByRole('button', { name: '关闭' }))
    expect(onClose).toHaveBeenCalledOnce()
  })
})
