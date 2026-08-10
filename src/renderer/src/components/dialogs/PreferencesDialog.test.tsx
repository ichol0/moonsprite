import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PreferencesDialog } from './PreferencesDialog'
import { useWorkspace } from '@/store/workspace'
import { THEME_PREFERENCE_KEY } from '@/core/file-preferences'
import type { MoonSpriteApi } from '@shared/types'

afterEach(() => {
  cleanup()
  localStorage.clear()
  useWorkspace.setState({ dialog: null })
})

describe('PreferencesDialog', () => {
  it('applies settings without closing the dialog', () => {
    const onClose = vi.fn()
    render(<PreferencesDialog onClose={onClose} onPresetChange={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: '应用' }))

    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog', { name: '首选项' })).toBeInTheDocument()
  })

  it('asks for confirmation before clearing local settings', async () => {
    localStorage.setItem('test-setting', 'kept-until-confirmed')
    render(<PreferencesDialog onClose={vi.fn()} onPresetChange={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: '重置' }))
    fireEvent.click(screen.getByRole('button', { name: '恢复所有初始设置' }))

    await waitFor(() => expect(useWorkspace.getState().dialog?.title).toBe('恢复所有初始设置'))
    expect(localStorage.getItem('test-setting')).toBe('kept-until-confirmed')
    expect(useWorkspace.getState().dialog?.detail).toContain('不会删除')
  })

  it('shows selection and eyedropper preferences disabled by default', () => {
    render(<PreferencesDialog onClose={vi.fn()} onPresetChange={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: '编辑' }))

    expect(screen.getByText('套索选区预览闭合').closest('label')?.querySelector('input')).not.toBeChecked()
    expect(screen.getByText('吸管取色后切回铅笔').closest('label')?.querySelector('input')).not.toBeChecked()
    expect(screen.getByText('直线算法优化').closest('label')?.querySelector('input')).toBeChecked()
    fireEvent.pointerEnter(screen.getByText('直线算法优化'))
    expect(screen.getByRole('tooltip')).toHaveTextContent('斜线像素会均匀分配为长度相近的阶梯')
  })

  it('separates system cursor behavior from tool previews', () => {
    render(<PreferencesDialog onClose={vi.fn()} onPresetChange={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: '光标' }))
    const localCursor = screen.getByText('使用本地指针').closest('label')?.querySelector('input')
    expect(localCursor).not.toBeChecked()
    expect(screen.getByRole('button', { name: '鼠标光标比例' })).toBeEnabled()
    fireEvent.click(localCursor!)
    expect(screen.getByRole('button', { name: '鼠标光标比例' })).toBeDisabled()
    expect(screen.queryByText('笔刷预览')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '工具预览' }))
    expect(screen.getByText('笔刷预览')).toBeInTheDocument()
    expect(screen.getByText('完整预览')).toBeInTheDocument()
    expect(screen.queryByText('绘制时显示笔刷边缘')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '笔刷预览' }))
    fireEvent.click(screen.getByRole('option', { name: '完整预览并显示边缘' }))
    expect(screen.getByText('绘制时显示笔刷边缘')).toBeInTheDocument()
    expect(screen.getByText('框选时显示十字指针')).toBeInTheDocument()
  })

  it('allows layer display color presets to be added and restored', () => {
    render(<PreferencesDialog onClose={vi.fn()} onPresetChange={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: '图层' }))

    expect(screen.getByText('图层属性颜色预设').closest('.preference-checker-colors')).not.toBeNull()

    const initialPresetCount = screen.getAllByLabelText(/图层显示颜色预设 \d+/).length
    fireEvent.click(screen.getByRole('button', { name: '新增颜色' }))
    expect(screen.getAllByLabelText(/图层显示颜色预设 \d+/)).toHaveLength(initialPresetCount + 1)
    fireEvent.click(screen.getByRole('button', { name: '恢复默认' }))
    expect(screen.getAllByLabelText(/图层显示颜色预设 \d+/)).toHaveLength(initialPresetCount)
    expect(screen.getAllByRole('button', { name: /删除图层颜色预设/ }).every((button) => button.classList.contains('regular'))).toBe(true)
  })

  it('uses the shared compact delete button for size and export presets', () => {
    render(<PreferencesDialog onClose={vi.fn()} onPresetChange={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: '预设' }))

    const deleteButtons = screen.getAllByRole('button', { name: /删除/ })
    expect(deleteButtons.length).toBeGreaterThan(0)
    expect(deleteButtons.every((button) => button.classList.contains('delete-icon-button') && button.classList.contains('compact'))).toBe(true)
  })

  it('previews a theme immediately and restores the persisted theme when canceled', () => {
    const { unmount } = render(<PreferencesDialog onClose={vi.fn()} onPresetChange={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: '主题' }))
    fireEvent.click(screen.getByRole('option', { name: 'MoonSprite Light可用主题' }))

    expect(document.documentElement.dataset.themeMode).toBe('light')
    expect(localStorage.getItem(THEME_PREFERENCE_KEY)).toBeNull()
    unmount()
    expect(document.documentElement.dataset.themeMode).toBe('dark')
  })

  it('selects and persists a custom default save directory', async () => {
    const previousApi = window.moonSprite
    const chooseDirectory = vi.fn(async () => ({ canceled: false, directoryPath: 'D:\\MoonSprite\\custom-gallery' }))
    Object.defineProperty(window, 'moonSprite', { configurable: true, writable: true, value: {
      getDefaultFileDirectories: vi.fn(async () => ({ saveDirectory: 'D:\\MoonSprite\\gallery', exportDirectory: 'D:\\MoonSprite\\exports' })),
      chooseDirectory
    } as unknown as MoonSpriteApi })
    try {
      render(<PreferencesDialog onClose={vi.fn()} onPresetChange={vi.fn()} />)
      fireEvent.click(screen.getByRole('button', { name: '文件' }))
      await waitFor(() => expect(screen.getByDisplayValue('D:\\MoonSprite\\gallery')).toBeInTheDocument())
      fireEvent.click(screen.getByRole('button', { name: '选择默认保存文件夹' }))
      await waitFor(() => expect(screen.getByDisplayValue('D:\\MoonSprite\\custom-gallery')).toBeInTheDocument())
      fireEvent.click(screen.getByRole('button', { name: '应用' }))
      expect(localStorage.getItem('moonsprite.preference.save-directory')).toBe('D:\\MoonSprite\\custom-gallery')
    } finally {
      Object.defineProperty(window, 'moonSprite', { configurable: true, writable: true, value: previousApi })
    }
  })

})
