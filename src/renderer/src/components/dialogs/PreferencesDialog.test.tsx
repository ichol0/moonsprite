import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PreferencesDialog } from './PreferencesDialog'
import { useWorkspace } from '@/store/workspace'
import { QUICK_COMMAND_BAR_ENABLED_PREFERENCE_KEY, QUICK_COMMAND_BAR_TRANSLUCENT_PREFERENCE_KEY, QUICK_COMMAND_PREFERENCES_KEY, THEME_PREFERENCE_KEY } from '@/core/file-preferences'
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
    fireEvent.click(screen.getByRole('button', { name: '工具' }))

    expect(screen.getByText('套索选区预览闭合').closest('label')?.querySelector('input')).not.toBeChecked()
    expect(screen.getByText('吸管取色后切回铅笔').closest('label')?.querySelector('input')).not.toBeChecked()
    expect(screen.getByText('直线算法优化').closest('label')?.querySelector('input')).toBeChecked()
    fireEvent.pointerEnter(screen.getByText('直线算法优化'))
    expect(screen.getByRole('tooltip')).toHaveTextContent('斜线像素会均匀分配为长度相近的阶梯')
  })

  it('separates system cursor behavior from tool previews', () => {
    render(<PreferencesDialog onClose={vi.fn()} onPresetChange={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: '输入' }))
    const softwareCursor = screen.getByText('使用软件指针').closest('label')?.querySelector('input')
    expect(softwareCursor).toBeChecked()
    expect(screen.getByRole('button', { name: '鼠标光标比例' })).toBeEnabled()
    fireEvent.click(softwareCursor!)
    expect(screen.getByRole('button', { name: '鼠标光标比例' })).toBeDisabled()
    expect(screen.queryByText('笔刷预览')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '工具' }))
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
    fireEvent.click(screen.getByRole('button', { name: '预设' }))

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

    const deleteButtons = screen.getAllByRole('button', { name: /删除(尺寸|导出倍率)/ })
    expect(deleteButtons.length).toBeGreaterThan(0)
    expect(deleteButtons.every((button) => button.classList.contains('delete-icon-button') && button.classList.contains('compact'))).toBe(true)
  })

  it('keeps reordering color modes after the pointer leaves the drag handle', async () => {
    render(<PreferencesDialog onClose={vi.fn()} onPresetChange={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: '颜色' }))

    const rgbRow = document.querySelector<HTMLElement>('[data-color-mode="rgb"]')
    const hsvRow = document.querySelector<HTMLElement>('[data-color-mode="hsv"]')
    const dragHandle = screen.getByRole('button', { name: 'RGB 拖动调整位置' })
    if (!rgbRow || !hsvRow) throw new Error('Color mode rows were not rendered')

    const setPointerCapture = vi.fn()
    const hasPointerCapture = vi.fn(() => false)
    const releasePointerCapture = vi.fn()
    Object.assign(dragHandle, { setPointerCapture, hasPointerCapture, releasePointerCapture })
    vi.spyOn(hsvRow, 'getBoundingClientRect').mockReturnValue({ top: 40, bottom: 74, left: 0, right: 300, width: 300, height: 34, x: 0, y: 40, toJSON: () => ({}) })
    Object.defineProperty(document, 'elementsFromPoint', { configurable: true, value: vi.fn(() => [hsvRow]) })

    fireEvent.pointerDown(dragHandle, { button: 0, pointerId: 7, clientX: 15, clientY: 17 })
    expect(rgbRow).toHaveClass('dragging')
    expect(setPointerCapture).toHaveBeenCalledWith(7)
    fireEvent.pointerMove(window, { pointerId: 7, clientX: 220, clientY: 70 })

    await waitFor(() => expect([...document.querySelectorAll<HTMLElement>('[data-color-mode]')].slice(0, 2).map((row) => row.dataset.colorMode)).toEqual(['hsv', 'rgb']))
    fireEvent.pointerUp(window, { pointerId: 7, clientX: 220, clientY: 70 })
  })

  it('opens and configures the dedicated quick command preferences section', async () => {
    render(<PreferencesDialog initialSection="quickCommands" onClose={vi.fn()} onPresetChange={vi.fn()} />)

    expect(screen.getByRole('button', { name: '快捷指令栏' })).toHaveAttribute('aria-current', 'page')
    const quickCommandToggle = screen.getByText('显示快捷指令栏').closest('label')?.querySelector('input')
    const translucentToggle = screen.getByText('半透明显示').closest('label')?.querySelector('input')
    const pixelGridToggle = screen.getByLabelText('在快捷指令栏中显示 像素网格')
    expect(quickCommandToggle).toBeChecked()
    expect(translucentToggle).toBeChecked()
    expect(pixelGridToggle).not.toBeChecked()
    fireEvent.click(pixelGridToggle)
    expect(pixelGridToggle).toBeChecked()

    const resetRow = document.querySelector<HTMLElement>('[data-quick-command-id="resetView"]')
    const customGridRow = document.querySelector<HTMLElement>('[data-quick-command-id="customGrid"]')
    const dragHandle = screen.getByRole('button', { name: '重置视图 拖动调整位置' })
    if (!resetRow || !customGridRow) throw new Error('Quick command preference rows were not rendered')
    Object.assign(dragHandle, { setPointerCapture: vi.fn(), hasPointerCapture: vi.fn(() => false), releasePointerCapture: vi.fn() })
    vi.spyOn(customGridRow, 'getBoundingClientRect').mockReturnValue({ top: 40, bottom: 74, left: 0, right: 300, width: 300, height: 34, x: 0, y: 40, toJSON: () => ({}) })
    Object.defineProperty(document, 'elementsFromPoint', { configurable: true, value: vi.fn(() => [customGridRow]) })

    fireEvent.pointerDown(dragHandle, { button: 0, pointerId: 11, clientX: 15, clientY: 17 })
    fireEvent.pointerMove(window, { pointerId: 11, clientX: 220, clientY: 45 })
    await waitFor(() => {
      const ids = [...document.querySelectorAll<HTMLElement>('[data-quick-command-id]')].map((row) => row.dataset.quickCommandId)
      expect(ids.indexOf('resetView')).toBeLessThan(ids.indexOf('customGrid'))
    })
    fireEvent.pointerUp(window, { pointerId: 11, clientX: 220, clientY: 45 })

    fireEvent.click(quickCommandToggle!)
    fireEvent.click(translucentToggle!)
    fireEvent.click(screen.getByRole('button', { name: '应用' }))
    expect(localStorage.getItem(QUICK_COMMAND_BAR_ENABLED_PREFERENCE_KEY)).toBe('false')
    expect(localStorage.getItem(QUICK_COMMAND_BAR_TRANSLUCENT_PREFERENCE_KEY)).toBe('false')
    const stored = JSON.parse(localStorage.getItem(QUICK_COMMAND_PREFERENCES_KEY) ?? '[]') as Array<{ id: string; enabled: boolean }>
    expect(stored.find((item) => item.id === 'pixelGrid')?.enabled).toBe(true)
    expect(stored.findIndex((item) => item.id === 'resetView')).toBeLessThan(stored.findIndex((item) => item.id === 'customGrid'))
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
