import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { MoonSpriteApi } from '@shared/types'
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

  it('uses a fixed-height resizable shell so the shortcut list can fill added height', () => {
    render(<ShortcutDialog shortcuts={{ ...DEFAULT_SHORTCUTS }} onSave={vi.fn()} onClose={vi.fn()} />)

    const dialog = screen.getByRole('dialog', { name: '快捷键设置' })
    expect(dialog).toHaveStyle({ height: '620px' })
    expect(dialog.querySelector(':scope > .settings-layout')).toBeInTheDocument()
  })

  it('exports shortcut settings through the native save dialog', async () => {
    const saveShortcutFile = vi.fn(async () => ({ canceled: false, filePath: 'D:/shortcuts.json' }))
    const writeBinaryAtomic = vi.fn(async (_filePath: string, _data: Uint8Array) => {})
    window.moonSprite = { saveShortcutFile, writeBinaryAtomic } as unknown as MoonSpriteApi
    render(<ShortcutDialog shortcuts={{ ...DEFAULT_SHORTCUTS }} onSave={vi.fn()} onClose={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: '导出' }))

    await waitFor(() => expect(writeBinaryAtomic).toHaveBeenCalledOnce())
    expect(saveShortcutFile).toHaveBeenCalledWith('moonsprite-shortcuts.json')
    expect(new TextDecoder().decode(writeBinaryAtomic.mock.calls[0][1])).toContain('"tool.pencil": "B"')
  })

  it('reports a successful shortcut import', async () => {
    const { container } = render(<ShortcutDialog shortcuts={{ ...DEFAULT_SHORTCUTS }} onSave={vi.fn()} onClose={vi.fn()} />)
    const file = new File(['{}'], 'shortcuts.json', { type: 'application/json' })
    Object.defineProperty(file, 'text', { value: async () => JSON.stringify({ 'tool.pencil': 'P' }) })

    fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files: [file] } })

    expect(await screen.findByRole('status')).toHaveTextContent('快捷键配置导入成功')
    const pencil = screen.getByDisplayValue('P')
    fireEvent.keyDown(pencil, { key: 'b', code: 'KeyB' })
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })
})
