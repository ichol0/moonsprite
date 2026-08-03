import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { SaveAsDialog } from './SaveAsDialog'

describe('SaveAsDialog', () => {
  it('uses the configured initial format and warns for flattened images', () => {
    render(<SaveAsDialog initialName="sprite" initialFormat="png-auto" onSave={vi.fn(async () => true)} onClose={vi.fn()} />)

    expect(screen.getByRole('button', { name: '保存格式' })).toHaveTextContent('PNG 自动索引')
    expect(screen.getByText(/不会保留图层和工程结构/)).toBeInTheDocument()
  })
})
