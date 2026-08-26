import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { MoonSpriteApi } from '@shared/types'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SHORTCUT_BINDINGS, cloneShortcutBindings } from '@/core/shortcuts'
import { ShortcutDialog } from './ShortcutDialog'

afterEach(cleanup)

const renderDialog = (onSave = vi.fn(), onClose = vi.fn()) => {
  render(<ShortcutDialog shortcuts={cloneShortcutBindings(DEFAULT_SHORTCUT_BINDINGS)} onSave={onSave} onClose={onClose} />)
  return { onSave, onClose }
}

describe('ShortcutDialog', () => {
  it('places a quick-select row after every tool and shows the default held tools', () => {
    const { container } = render(<ShortcutDialog shortcuts={cloneShortcutBindings(DEFAULT_SHORTCUT_BINDINGS)} onSave={vi.fn()} onClose={vi.fn()} />)
    const rows = [...container.querySelectorAll<HTMLElement>('.shortcut-command-row')]
    const labels = rows.map((row) => row.querySelector('.shortcut-command-name strong')?.textContent)

    expect(labels[labels.indexOf('画笔') + 1]).toBe('画笔（快速选择）')
    expect(labels[labels.indexOf('椭圆选区') + 1]).toBe('椭圆选区（快速选择）')
    expect(within(rows[labels.indexOf('移动工具（快速选择）')]).getByText('Ctrl')).toBeInTheDocument()
    expect(within(rows[labels.indexOf('吸管（快速选择）')]).getByText('Alt')).toBeInTheDocument()
    expect(within(rows[labels.indexOf('抓手（快速选择）')]).getByText('Space')).toBeInTheDocument()
  })

  it('adds a second multi-modifier shortcut without replacing the first binding', () => {
    const { onSave } = renderDialog()
    fireEvent.click(screen.getByRole('button', { name: '为“画笔”添加快捷键' }))
    const recorder = screen.getByRole('dialog', { name: '添加快捷键' })
    const input = within(recorder).getByRole('textbox')

    fireEvent.keyDown(input, { key: 'Control', code: 'ControlLeft', ctrlKey: true })
    expect(input).toHaveValue('Ctrl')
    fireEvent.keyDown(input, { key: 'Shift', code: 'ShiftLeft', ctrlKey: true, shiftKey: true })
    expect(input).toHaveValue('Ctrl+Shift')
    fireEvent.keyDown(input, { key: 'm', code: 'KeyM', ctrlKey: true, shiftKey: true })
    expect(input).toHaveValue('Ctrl+Shift+M')
    fireEvent.click(within(recorder).getByRole('button', { name: '添加' }))
    fireEvent.click(screen.getByRole('button', { name: '完成' }))

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ 'tool.pencil': ['B', 'Ctrl+Shift+M'] }))
  }, 15000)

  it('records Ctrl+Shift+V inside the dedicated recorder instead of invoking app commands', () => {
    renderDialog()
    fireEvent.click(screen.getByRole('button', { name: '为“画笔”添加快捷键' }))
    const input = within(screen.getByRole('dialog', { name: '添加快捷键' })).getByRole('textbox')

    expect(input).toHaveAttribute('data-shortcut-recorder', 'true')
    fireEvent.keyDown(input, { key: 'v', code: 'KeyV', ctrlKey: true, shiftKey: true })

    expect(input).toHaveValue('Ctrl+Shift+V')
  })

  it('records one stable wheel chord while modifiers and wheel events repeat', () => {
    const { onSave } = renderDialog()
    fireEvent.click(screen.getByRole('button', { name: '为“画笔”添加快捷键' }))
    const recorder = screen.getByRole('dialog', { name: '添加快捷键' })
    const input = within(recorder).getByRole('textbox')

    fireEvent.wheel(input, { deltaY: -120, ctrlKey: true, altKey: true, shiftKey: true })
    fireEvent.keyDown(input, { key: 'Shift', code: 'ShiftLeft', ctrlKey: true, altKey: true, shiftKey: true, repeat: true })
    fireEvent.wheel(input, { deltaY: 1, ctrlKey: true, altKey: true, shiftKey: true })

    expect(input).toHaveValue('Ctrl+Alt+Shift+滚轮向上')
    fireEvent.click(within(recorder).getByRole('button', { name: '添加' }))
    fireEvent.click(screen.getByRole('button', { name: '完成' }))
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ 'tool.pencil': ['B', 'Ctrl+Alt+Shift+WheelUp'] }))
  })

  it('shows the current owner and transfers a conflicting command binding on apply', () => {
    const { onSave } = renderDialog()
    fireEvent.change(screen.getByRole('textbox', { name: '搜索所有命令、分类或按键' }), { target: { value: '导出' } })
    fireEvent.click(screen.getByRole('button', { name: '修改“导出”的快捷键“Ctrl+E”' }))
    const recorder = screen.getByRole('dialog', { name: '修改快捷键' })
    const input = within(recorder).getByRole('textbox')

    fireEvent.keyDown(input, { key: 's', code: 'KeyS', ctrlKey: true })
    expect(within(recorder).getByText('已分配给：保存')).toBeInTheDocument()
    fireEvent.click(within(recorder).getByRole('button', { name: '修改' }))
    fireEvent.click(screen.getByRole('button', { name: '完成' }))

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ save: [], exportDocument: ['Ctrl+S'] }))
  })

  it('discards the draft when the whole dialog is closed', () => {
    const { onSave, onClose } = renderDialog()
    fireEvent.click(screen.getByRole('button', { name: '为“画笔”添加快捷键' }))
    const recorder = screen.getByRole('dialog', { name: '添加快捷键' })
    fireEvent.keyDown(within(recorder).getByRole('textbox'), { key: 'p', code: 'KeyP' })
    fireEvent.click(within(recorder).getByRole('button', { name: '添加' }))
    fireEvent.click(screen.getByRole('button', { name: '关闭' }))

    expect(onClose).toHaveBeenCalledOnce()
    expect(onSave).not.toHaveBeenCalled()
  })

  it('uses a fixed-height resizable shell so the shortcut list can fill added height', () => {
    renderDialog()

    const dialog = screen.getByRole('dialog', { name: '快捷键设置' })
    expect(dialog).toHaveStyle({ height: '508px' })
    expect(dialog.querySelector(':scope > .settings-layout')).toBeInTheDocument()
  })

  it('exports v2 shortcut differences through the native save dialog', async () => {
    const saveShortcutFile = vi.fn(async () => ({ canceled: false, filePath: 'D:/shortcuts.json' }))
    const writeBinaryAtomic = vi.fn(async (_filePath: string, _data: Uint8Array) => {})
    window.moonSprite = { saveShortcutFile, writeBinaryAtomic } as unknown as MoonSpriteApi
    renderDialog()

    fireEvent.click(screen.getByRole('button', { name: '导出' }))

    await waitFor(() => expect(writeBinaryAtomic).toHaveBeenCalledOnce())
    expect(saveShortcutFile).toHaveBeenCalledWith('moonsprite-shortcuts.json')
    expect(JSON.parse(new TextDecoder().decode(writeBinaryAtomic.mock.calls[0][1]))).toEqual({
      format: 'moonsprite-shortcuts',
      version: 2,
      bindings: {}
    })
  })

  it('imports legacy shortcut files into the draft', async () => {
    const { container } = render(<ShortcutDialog shortcuts={cloneShortcutBindings(DEFAULT_SHORTCUT_BINDINGS)} onSave={vi.fn()} onClose={vi.fn()} />)
    const file = new File(['{}'], 'shortcuts.json', { type: 'application/json' })
    Object.defineProperty(file, 'text', { value: async () => JSON.stringify({ 'tool.pencil': 'P' }) })

    fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files: [file] } })

    expect(await screen.findByRole('status')).toHaveTextContent('快捷键配置导入成功')
    expect(screen.getByRole('button', { name: '修改“画笔”的快捷键“P”' })).toBeInTheDocument()
  })
})
