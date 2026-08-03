import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PreferencesDialog } from './PreferencesDialog'
import { useWorkspace } from '@/store/workspace'

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
    expect(screen.getByText('使用本地指针')).toBeInTheDocument()
    expect(screen.queryByText('笔刷预览')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '工具预览' }))
    expect(screen.getByText('笔刷预览')).toBeInTheDocument()
    expect(screen.getByText('框选时显示十字指针')).toBeInTheDocument()
  })

  it('allows layer display color presets to be added and restored', () => {
    render(<PreferencesDialog onClose={vi.fn()} onPresetChange={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: '图层' }))

    expect(screen.getByText('图层属性颜色预设').closest('.preference-checker-colors')).not.toBeNull()

    const initialPresetCount = screen.getAllByLabelText(/图层显示颜色预设 \d+/).length
    fireEvent.click(screen.getByRole('button', { name: '新增颜色' }))
    expect(screen.getAllByLabelText(/图层显示颜色预设 \d+/)).toHaveLength(initialPresetCount + 1)
    fireEvent.click(screen.getByRole('button', { name: '恢复默认颜色' }))
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
})
