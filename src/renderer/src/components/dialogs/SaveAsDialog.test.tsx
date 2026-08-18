import type { MoonSpriteApi } from '@shared/types'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SaveAsDialog } from './SaveAsDialog'

afterEach(cleanup)

describe('SaveAsDialog', () => {
  it('uses the configured initial format and warns for flattened images', () => {
    render(<SaveAsDialog initialName="sprite" initialFormat="png-auto" initialDirectory="D:/gallery" onSave={vi.fn(async () => true)} onClose={vi.fn()} />)

    expect(screen.getByRole('button', { name: '保存格式' })).toHaveTextContent('PNG 自动索引')
    expect(screen.getByText(/不会保留图层和工程结构/)).toBeInTheDocument()
  })

  it('chooses and displays a custom save location', async () => {
    const previousApi = window.moonSprite
    const chooseDirectory = vi.fn(async () => ({ canceled: false, directoryPath: 'E:/delivery' }))
    window.moonSprite = { chooseDirectory } as unknown as MoonSpriteApi
    try {
      render(<SaveAsDialog initialName="sprite" initialFormat="moonsprite" initialDirectory="D:/gallery" onSave={vi.fn(async () => true)} onClose={vi.fn()} />)

      fireEvent.click(screen.getByRole('button', { name: '选择保存位置' }))

      await waitFor(() => expect(chooseDirectory).toHaveBeenCalledWith('D:/gallery'))
      expect(await screen.findByText('保存位置：E:/delivery')).toBeInTheDocument()
    } finally {
      window.moonSprite = previousApi
    }
  })
})
