import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LatestReleaseDialog } from './LatestReleaseDialog'

afterEach(cleanup)

describe('LatestReleaseDialog', () => {
  it('shows only the latest packaged release summary', () => {
    render(<LatestReleaseDialog onClose={vi.fn()} />)
    expect(screen.getByRole('heading', { name: '更新日志' })).toBeInTheDocument()
    expect(screen.getByText('最新版本：DEV.6')).toBeInTheDocument()
    expect(screen.getAllByRole('listitem')).toHaveLength(16)
    expect(screen.queryByText('重置对称中心')).not.toBeInTheDocument()
  })

  it('closes from the unified icon button', () => {
    const onClose = vi.fn()
    render(<LatestReleaseDialog onClose={onClose} />)
    fireEvent.click(screen.getByRole('button', { name: '关闭' }))
    expect(onClose).toHaveBeenCalledOnce()
  })
})
