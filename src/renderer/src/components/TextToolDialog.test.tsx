import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { MoonSpriteApi } from '@shared/types'
import { TextToolDialog } from './TextToolDialog'

afterEach(() => {
  cleanup()
  localStorage.clear()
})

const installApi = (overrides: Partial<MoonSpriteApi> = {}): void => {
  window.moonSprite = {
    listFonts: vi.fn(async () => ({ directoryPath: 'Font', fonts: [] })),
    listSystemFonts: vi.fn(async () => [{ id: 'system:Arial', family: 'Arial System', filePath: 'C:/Windows/Fonts/arial.ttf', imported: false }]),
    importFont: vi.fn(async () => null),
    importSystemFont: vi.fn(async () => ({ id: 'arial.ttf', family: 'Arial System', filePath: 'Font/arial.ttf', imported: true })),
    deleteFont: vi.fn(async () => {}),
    readBinary: vi.fn(async () => new Uint8Array()),
    ...overrides
  } as unknown as MoonSpriteApi
}

const initial = {
  text: 'Moon',
  fontFamily: 'Consolas',
  fontSize: 16,
  lineSpacing: 0,
  letterSpacing: 0,
  spacingMode: 'font' as const,
  antialias: 'pixel' as const,
  color: { r: 12, g: 34, b: 56, a: 255 }
}

describe('TextToolDialog', () => {
  it('starts new text with TEXT, actual spacing, and the Fusion Pixel native size', async () => {
    installApi()
    const onChange = vi.fn()
    render(<TextToolDialog editing={false} initial={{ color: initial.color }} onChange={onChange} onClose={vi.fn()} onPreview={vi.fn()} onSubmit={vi.fn()} />)

    expect(screen.getByRole('textbox')).toHaveValue('TEXT')
    await waitFor(() => expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({
      text: 'TEXT',
      fontFamily: 'Fusion Pixel 10px Prop Zh_hans',
      fontSize: 10,
      spacingMode: 'actual',
      lineSpacing: 1,
      letterSpacing: 1
    })))
  })

  it('shows language and font details when hovering a built-in font title', async () => {
    installApi()
    render(<TextToolDialog editing={false} initial={{ color: initial.color }} onClose={vi.fn()} onPreview={vi.fn()} onSubmit={vi.fn()} />)

    fireEvent.pointerEnter(screen.getByText('Tiny5'))
    expect(await screen.findByRole('tooltip')).toHaveTextContent('拉丁、希腊和西里尔字母')
    expect(screen.getByRole('tooltip')).toHaveTextContent('8px')
  })

  it('uses a compact text field and previews by default', async () => {
    installApi()
    const onPreview = vi.fn()
    const { container } = render(<TextToolDialog editing initial={initial} onClose={vi.fn()} onPreview={onPreview} onSubmit={vi.fn()} />)

    expect(screen.getByRole('textbox')).toHaveAttribute('rows', '4')
    expect(container.querySelector('form')).toHaveStyle({ minHeight: '450px' })
    await waitFor(() => expect(onPreview).toHaveBeenCalledWith(expect.objectContaining({ text: 'Moon' })))
  })

  it('clears the temporary preview when disabled', async () => {
    installApi()
    const onPreview = vi.fn()
    render(<TextToolDialog editing initial={initial} onClose={vi.fn()} onPreview={onPreview} onSubmit={vi.fn()} />)

    fireEvent.click(screen.getByRole('checkbox'))
    await waitFor(() => expect(onPreview).toHaveBeenLastCalledWith(null))
  })

  it('does not replay a stale boxed preview when preview ownership changes', async () => {
    installApi()
    const previousPreview = vi.fn()
    const nextPreview = vi.fn()
    const { rerender, unmount } = render(<TextToolDialog editing={false} initial={{ ...initial, boxWidth: 24, boxHeight: 16 }} box={{ x: 2, y: 3, width: 24, height: 16 }} onClose={vi.fn()} onPreview={previousPreview} onSubmit={vi.fn()} />)

    await waitFor(() => expect(previousPreview).toHaveBeenCalledWith(expect.objectContaining({ boxWidth: 24, boxHeight: 16 })))
    rerender(<TextToolDialog editing={false} initial={{ ...initial, boxWidth: 24, boxHeight: 16 }} box={{ x: 2, y: 3, width: 24, height: 16 }} onClose={vi.fn()} onPreview={nextPreview} onSubmit={vi.fn()} />)
    await waitFor(() => expect(nextPreview).toHaveBeenCalledWith(expect.objectContaining({ boxWidth: 24, boxHeight: 16 })))
    unmount()

    expect(previousPreview).not.toHaveBeenCalledWith(null)
    expect(nextPreview).not.toHaveBeenCalledWith(null)
  })

  it('still reports entered text when live preview is disabled', async () => {
    installApi()
    const onChange = vi.fn()
    render(<TextToolDialog editing={false} initial={{ ...initial, text: '' }} onChange={onChange} onClose={vi.fn()} onPreview={vi.fn()} onSubmit={vi.fn()} />)

    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'M' } })
    await waitFor(() => expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ text: 'M' })))
  })

  it('shows installed fonts in the import dropdown and activates the selected font', async () => {
    installApi()
    render(<TextToolDialog editing initial={initial} onClose={vi.fn()} onPreview={vi.fn()} onSubmit={vi.fn()} />)

    expect(await screen.findByRole('option', { name: /Consolas/ })).toHaveAttribute('aria-selected', 'true')
    await waitFor(() => expect(screen.getByRole('button', { name: '导入' })).toHaveAttribute('aria-haspopup', 'listbox'))
    fireEvent.click(screen.getByRole('button', { name: '导入' }))
    fireEvent.click(await screen.findByRole('option', { name: 'Arial System' }))
    await waitFor(() => expect(screen.getByRole('option', { name: /Arial System/ })).toHaveAttribute('aria-selected', 'true'))
    expect(screen.getByRole('button', { name: /删除字体：Arial System/ })).toBeInTheDocument()
  })

  it('counts font usage only after submitting and reorders on the next dialog', async () => {
    installApi()
    const first = render(<TextToolDialog editing={false} initial={{ color: initial.color }} onClose={vi.fn()} onPreview={vi.fn()} onSubmit={vi.fn()} />)

    fireEvent.click(screen.getByRole('option', { name: 'Tiny5' }))
    expect(screen.getAllByRole('spinbutton')[0]).toHaveValue('8')
    expect(screen.getAllByRole('option')[0]).toHaveAccessibleName('Fusion Pixel 10px Prop Zh_hans')

    first.unmount()
    const second = render(<TextToolDialog editing={false} initial={{ color: initial.color }} onClose={vi.fn()} onPreview={vi.fn()} onSubmit={vi.fn()} />)
    await waitFor(() => expect(screen.getAllByRole('option')[0]).toHaveAccessibleName('Fusion Pixel 10px Prop Zh_hans'))

    fireEvent.click(screen.getByRole('option', { name: 'Tiny5' }))
    fireEvent.submit(second.container.querySelector('form')!)
    second.unmount()
    render(<TextToolDialog editing={false} initial={{ color: initial.color }} onClose={vi.fn()} onPreview={vi.fn()} onSubmit={vi.fn()} />)
    await waitFor(() => expect(screen.getAllByRole('option')[0]).toHaveAccessibleName('Tiny5'))
  })

  it('restores the last manually selected text size for the next new text', () => {
    installApi()
    const first = render(<TextToolDialog editing={false} initial={{ color: initial.color }} onClose={vi.fn()} onPreview={vi.fn()} onSubmit={vi.fn()} />)
    const size = screen.getAllByRole('spinbutton')[0]
    fireEvent.change(size, { target: { value: '18' } })
    fireEvent.blur(size)

    first.unmount()
    render(<TextToolDialog editing={false} initial={{ color: initial.color }} onClose={vi.fn()} onPreview={vi.fn()} onSubmit={vi.fn()} />)
    expect(screen.getAllByRole('spinbutton')[0]).toHaveValue('18')
  })

  it('opens the local font file selector from the select button', async () => {
    const importFont = vi.fn(async () => null)
    installApi({ importFont })
    render(<TextToolDialog editing initial={initial} onClose={vi.fn()} onPreview={vi.fn()} onSubmit={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: '选择本地字体' }))
    await waitFor(() => expect(importFont).toHaveBeenCalledOnce())
  })

  it('searches the system-font dropdown and exposes spacing and color controls', async () => {
    installApi({ listSystemFonts: vi.fn(async () => [
      { id: 'system:Arial', family: 'Arial System', filePath: 'C:/Windows/Fonts/arial.ttf', imported: false },
      { id: 'system:Consolas', family: 'Consolas System', filePath: 'C:/Windows/Fonts/consola.ttf', imported: false }
    ]) })
    const onPreview = vi.fn()
    render(<TextToolDialog editing initial={initial} onClose={vi.fn()} onPreview={onPreview} onSubmit={vi.fn()} />)

    await waitFor(() => expect(screen.getByRole('button', { name: '导入' })).toHaveAttribute('aria-haspopup', 'listbox'))
    const importButton = screen.getByRole('button', { name: '导入' })
    fireEvent.click(importButton)
    await waitFor(() => expect(importButton).toHaveAttribute('aria-expanded', 'true'))
    fireEvent.change(screen.getByRole('textbox', { name: '搜索系统字体' }), { target: { value: 'Arial' } })
    expect(screen.getByRole('option', { name: 'Arial System' })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'Consolas System' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '间距模式' }))
    fireEvent.click(screen.getByRole('option', { name: /实际间距/ }))
    await waitFor(() => expect(onPreview).toHaveBeenLastCalledWith(expect.objectContaining({ spacingMode: 'actual', lineSpacing: 1, letterSpacing: 1 })))
    expect(screen.getAllByRole('spinbutton')[1]).toHaveValue('1')
    expect(screen.getAllByRole('spinbutton')[2]).toHaveValue('1')
    expect(screen.getByRole('button', { name: '文本颜色' })).toBeInTheDocument()
  })

  it('can delete the selected imported font while editing', async () => {
    const imported = { id: 'pixel.ttf', family: 'Pixel 9x9', filePath: 'Font/pixel.ttf', imported: true }
    const deleteFont = vi.fn(async () => {})
    installApi({ listFonts: vi.fn(async () => ({ directoryPath: 'Font', fonts: [imported] })), deleteFont })
    render(<TextToolDialog editing initial={{ ...initial, fontFamily: imported.family }} onClose={vi.fn()} onPreview={vi.fn()} onSubmit={vi.fn()} />)

    fireEvent.click(await screen.findByRole('button', { name: '删除字体：Pixel 9x9' }))
    await waitFor(() => expect(deleteFont).toHaveBeenCalledWith('pixel.ttf'))
  })

  it('applies size and spacing only to the selected text and exposes mixed values as empty', async () => {
    const onSubmit = vi.fn()
    render(<TextToolDialog editing initial={{ ...initial, text: 'Moon', styleRuns: [{ start: 0, end: 2, fontSize: 24, letterSpacing: 2 }] }} onClose={vi.fn()} onPreview={vi.fn()} onSubmit={onSubmit} />)
    const text = screen.getByRole('textbox')
    text.focus()
    ;(text as HTMLTextAreaElement).setSelectionRange(0, 4)
    fireEvent.select(text)

    const inputs = screen.getAllByRole('spinbutton')
    await waitFor(() => expect(inputs[0]).toHaveValue(''))
    expect(inputs[2]).toHaveValue('')
    fireEvent.change(inputs[0], { target: { value: '18' } })
    fireEvent.blur(inputs[0])
    await waitFor(() => {
      expect((text as HTMLTextAreaElement).selectionStart).toBe(0)
      expect((text as HTMLTextAreaElement).selectionEnd).toBe(4)
    })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      styleRuns: [
        expect.objectContaining({ start: 0, end: 2, fontSize: 18, letterSpacing: 2 }),
        expect.objectContaining({ start: 2, end: 4, fontSize: 18 })
      ]
    }))
  })

  it('uses the preceding selected style at the final caret', async () => {
    render(<TextToolDialog editing initial={{ ...initial, styleRuns: [{ start: 0, end: 4, color: { r: 255, g: 0, b: 0, a: 255 } }] }} onClose={vi.fn()} onPreview={vi.fn()} onSubmit={vi.fn()} />)
    const text = screen.getByRole('textbox') as HTMLTextAreaElement
    text.focus()
    text.setSelectionRange(4, 4)
    fireEvent.select(text)
    await waitFor(() => expect(document.querySelector('.color-value-trigger strong')).toHaveTextContent('#FF0000'))
  })

  it('keeps the caret after newly entered lines and characters', async () => {
    render(<TextToolDialog editing initial={initial} onClose={vi.fn()} onPreview={vi.fn()} onSubmit={vi.fn()} />)
    const text = screen.getByRole('textbox') as HTMLTextAreaElement

    fireEvent.change(text, { target: { value: 'Moon\n', selectionStart: 5, selectionEnd: 5 } })
    await waitFor(() => expect(text.selectionStart).toBe(5))
    fireEvent.change(text, { target: { value: 'Moon\n2', selectionStart: 6, selectionEnd: 6 } })
    await waitFor(() => {
      expect(text.selectionStart).toBe(6)
      expect(text.selectionEnd).toBe(6)
    })
  })

  it('keeps a visible selection mirror while a numeric style control has focus', async () => {
    render(<TextToolDialog editing initial={initial} onClose={vi.fn()} onPreview={vi.fn()} onSubmit={vi.fn()} />)
    const text = screen.getByRole('textbox') as HTMLTextAreaElement
    text.focus()
    text.setSelectionRange(0, 4)
    fireEvent.select(text)

    const size = screen.getAllByRole('spinbutton')[0]
    fireEvent.focus(size)
    fireEvent.blur(text)
    await waitFor(() => expect(document.querySelector('.text-tool-selection-mirror mark')).toHaveTextContent('Moon'))
    fireEvent.change(size, { target: { value: '18' } })
    fireEvent.blur(size)
    expect(document.querySelector('.text-tool-selection-mirror mark')).toHaveTextContent('Moon')
  })
})
