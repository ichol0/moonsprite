import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SHORTCUTS } from '@/core/shortcuts'
import { ShortcutDialog } from './ShortcutDialog'

afterEach(cleanup)

describe('ShortcutDialog', () => {
  it('waits for an ordinary key before saving a multi-modifier shortcut', () => {
    const onSave = vi.fn()
    render(<ShortcutDialog shortcuts={{ ...DEFAULT_SHORTCUTS }} onSave={onSave} onClose={vi.fn()} />)
    const pencil = screen.getByDisplayValue('B')

    fireEvent.keyDown(pencil, { key: 'Control', code: 'ControlLeft', ctrlKey: true })
    expect(pencil).toHaveValue('Ctrl')
    fireEvent.keyDown(pencil, { key: 'Shift', code: 'ShiftLeft', ctrlKey: true, shiftKey: true })
    expect(pencil).toHaveValue('Ctrl+Shift')
    fireEvent.keyDown(pencil, { key: 'm', code: 'KeyM', ctrlKey: true, shiftKey: true })
    expect(pencil).toHaveValue('Ctrl+Shift+M')

    fireEvent.click(screen.getByRole('button', { name: '完成' }))
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ 'tool.pencil': 'Ctrl+Shift+M' }))
  })

  it('records Ctrl+Shift+V inside the dedicated recorder instead of invoking app commands', () => {
    render(<ShortcutDialog shortcuts={{ ...DEFAULT_SHORTCUTS }} onSave={vi.fn()} onClose={vi.fn()} />)
    const pencil = screen.getByDisplayValue('B')

    expect(pencil).toHaveAttribute('data-shortcut-recorder', 'true')
    fireEvent.keyDown(pencil, { key: 'v', code: 'KeyV', ctrlKey: true, shiftKey: true })

    expect(pencil).toHaveValue('Ctrl+Shift+V')
  })
})
