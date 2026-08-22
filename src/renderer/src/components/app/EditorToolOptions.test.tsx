import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createDocument } from '@/core/document'
import { useWorkspace } from '@/store/workspace'
import { EditorToolOptions } from './EditorToolOptions'

beforeEach(() => {
  localStorage.clear()
  useWorkspace.setState({ sessions: [], activeId: null, message: null, dialog: null })
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('EditorToolOptions basic brush selector', () => {
  it('opens one compact selector and chooses among the three basic brushes', () => {
    useWorkspace.getState().addSession(createDocument('basic brush selector', 4, 4, 'rgba'))
    render(<EditorToolOptions onOpenColorReplacement={vi.fn()} />)

    const trigger = screen.getByRole('button', { name: '基础笔刷' })
    expect(screen.queryByRole('menu', { name: '基础笔刷' })).not.toBeInTheDocument()
    fireEvent.click(trigger)

    const menu = screen.getByRole('menu', { name: '基础笔刷' })
    expect(within(menu).getAllByRole('menuitemradio')).toHaveLength(3)
    fireEvent.click(within(menu).getByRole('menuitemradio', { name: '方形笔刷' }))

    expect(useWorkspace.getState().sessions[0].brushShape).toBe('square')
    expect(screen.queryByRole('menu', { name: '基础笔刷' })).not.toBeInTheDocument()
  })

  it('opens the dither selector, chooses a template, and changes its stage', () => {
    useWorkspace.getState().addSession(createDocument('dither brush selector', 8, 8, 'rgba'))
    render(<EditorToolOptions onOpenColorReplacement={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: '抖动笔刷' }))
    const dialog = screen.getByRole('dialog', { name: '抖动笔刷' })
    const bayer = within(dialog).getByRole('button', { name: 'Bayer 2×2' })
    fireEvent.click(bayer)

    expect(useWorkspace.getState().sessions[0].brushDither).toEqual({ enabled: true, template: 'bayer-2', stage: 2 })
    fireEvent.click(within(dialog).getByRole('button', { name: '上一抖动阶段' }))
    expect(useWorkspace.getState().sessions[0].brushDither).toEqual({ enabled: true, template: 'bayer-2', stage: 1 })
    const nextStage = within(dialog).getByRole('button', { name: '下一抖动阶段' })
    fireEvent.click(nextStage)
    expect(useWorkspace.getState().sessions[0].brushDither).toEqual({ enabled: true, template: 'bayer-2', stage: 2 })
    fireEvent.click(nextStage)
    fireEvent.click(nextStage)
    expect(useWorkspace.getState().sessions[0].brushDither).toEqual({ enabled: true, template: 'bayer-2', stage: 4 })
    expect(nextStage).not.toBeDisabled()
    fireEvent.click(nextStage)
    expect(useWorkspace.getState().sessions[0].brushDither).toEqual({ enabled: true, template: 'bayer-2', stage: 4 })

    fireEvent.click(bayer)
    expect(useWorkspace.getState().sessions[0].brushDither.enabled).toBe(false)

    fireEvent.click(within(dialog).getByRole('button', { name: '横线' }))
    expect(useWorkspace.getState().sessions[0].brushDither).toEqual({ enabled: true, template: 'horizontal', stage: 6 })
    expect(within(dialog).getByText('6/6')).toBeInTheDocument()
  })

  it('keeps a dragged dither selector resident until its title-bar close button is used', () => {
    useWorkspace.getState().addSession(createDocument('detached dither selector', 8, 8, 'rgba'))
    render(<EditorToolOptions onOpenColorReplacement={vi.fn()} />)

    const trigger = screen.getByRole('button', { name: '抖动笔刷' })
    fireEvent.click(trigger)
    const transientDialog = screen.getByRole('dialog', { name: '抖动笔刷' })
    fireEvent.pointerDown(document.body)
    expect(transientDialog).not.toBeInTheDocument()

    fireEvent.click(trigger)
    const residentDialog = screen.getByRole('dialog', { name: '抖动笔刷' })
    const titlebar = residentDialog.querySelector<HTMLElement>('.brush-dither-titlebar')
    if (!titlebar) throw new Error('Dither selector title bar was not rendered')
    fireEvent.pointerDown(titlebar, { button: 0, clientX: 20, clientY: 20 })
    fireEvent.pointerMove(window, { clientX: 60, clientY: 52 })
    fireEvent.pointerUp(window)

    expect(residentDialog).toHaveClass('resident')
    fireEvent.pointerDown(document.body)
    expect(residentDialog).toBeInTheDocument()

    fireEvent.click(within(residentDialog).getByRole('button', { name: '关闭 抖动笔刷' }))
    expect(screen.queryByRole('dialog', { name: '抖动笔刷' })).not.toBeInTheDocument()
  })

  it('keeps the dither selector below the app title bar in a zoom-reduced viewport', () => {
    vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(683)
    vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(427)
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      if (this.classList.contains('app-window-titlebar')) return new DOMRect(0, 0, 683, 32)
      if (this.classList.contains('brush-dither-trigger')) return new DOMRect(38, 155, 32, 32)
      if (this.classList.contains('brush-dither-popover')) return new DOMRect(38, 0, 248, 249)
      return new DOMRect()
    })
    const titlebar = document.createElement('div')
    titlebar.className = 'app-window-titlebar'
    document.body.appendChild(titlebar)
    useWorkspace.getState().addSession(createDocument('responsive dither selector', 8, 8, 'rgba'))
    render(<EditorToolOptions onOpenColorReplacement={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: '抖动笔刷' }))

    expect(screen.getByRole('dialog', { name: '抖动笔刷' })).toHaveStyle({ left: '38px', top: '192px', maxHeight: '227px' })
    titlebar.remove()
  })
})
