import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PreferencesDialog } from './PreferencesDialog'

afterEach(() => {
  localStorage.clear()
})

describe('PreferencesDialog', () => {
  it('applies settings without closing the dialog', () => {
    const onClose = vi.fn()
    render(<PreferencesDialog onClose={onClose} onPresetChange={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: '应用' }))

    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog', { name: '首选项' })).toBeInTheDocument()
  })
})
