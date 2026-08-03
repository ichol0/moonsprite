import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { COMPONENT_LIBRARY_ENTRIES } from './ComponentLibrary'
import { DeleteIconButton } from './DeleteIconButton'

describe('DeleteIconButton', () => {
  it('provides unified compact, regular and disabled deletion states', () => {
    const onClick = vi.fn()
    const { rerender } = render(<DeleteIconButton aria-label="删除预设" onClick={onClick} />)
    expect(screen.getByRole('button', { name: '删除预设' })).toHaveClass('delete-icon-button', 'compact')

    rerender(<DeleteIconButton aria-label="删除预设" size="regular" disabled onClick={onClick} />)
    expect(screen.getByRole('button', { name: '删除预设' })).toHaveClass('delete-icon-button', 'regular')
    expect(screen.getByRole('button', { name: '删除预设' })).toBeDisabled()
  })

  it('is registered in the reusable component library', () => {
    expect(COMPONENT_LIBRARY_ENTRIES.some((entry) => entry.id === 'delete-icon-button')).toBe(true)
  })
})
