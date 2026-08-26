import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createPortal } from 'react-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ModalShell } from './ModalShell'

beforeEach(() => localStorage.clear())
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('ModalShell', () => {
  it('restores the saved bounds and exposes eight resize directions', async () => {
    localStorage.setItem('moonsprite.modal.test', JSON.stringify({
      x: 40,
      y: 50,
      width: 500,
      height: 300,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight
    }))

    render(<ModalShell storageKey="test" role="dialog"><header>测试弹窗</header></ModalShell>)
    const dialog = screen.getByRole('dialog')

    expect(dialog).toHaveStyle({ left: '40px', top: '50px', width: '500px', height: '300px' })
    expect(dialog).toHaveStyle({ overflow: 'hidden' })
    await waitFor(() => expect(document.querySelectorAll('.floating-resize-portal .floating-resize-handle')).toHaveLength(8))
  })

  it('clamps restored bounds to the modal minimum size', () => {
    localStorage.setItem('moonsprite.modal.small', JSON.stringify({
      x: 20,
      y: 20,
      width: 120,
      height: 80,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight
    }))

    render(<ModalShell storageKey="small" role="dialog"><header>小弹窗</header></ModalShell>)

    expect(screen.getByRole('dialog')).toHaveStyle({ width: '300px', height: '220px' })
  })

  it('does not apply preference dialog limits to the narrow layer settings dialog', () => {
    render(<ModalShell storageKey="layer-settings-test" className="layer-settings-modal" defaultWidth={400} minWidth={360} role="dialog"><header>图层设置</header></ModalShell>)

    expect(screen.getByRole('dialog')).toHaveStyle({ width: '360px', minWidth: '360px' })
  })

  it('uses compact default bounds without changing the resize limits', () => {
    render(<ModalShell storageKey="compact-default" fitContent={false} defaultWidth={500} defaultHeight={400} minWidth={300} minHeight={220} role="dialog"><header>紧凑弹窗</header></ModalShell>)

    expect(screen.getByRole('dialog')).toHaveStyle({
      width: '440px',
      height: '328px',
      minWidth: '300px',
      minHeight: '220px'
    })
  })

  it('lets a large settings dialog shrink inside a zoom-reduced viewport', () => {
    vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(683)
    vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(427)
    const titlebar = document.createElement('div')
    titlebar.className = 'app-window-titlebar'
    vi.spyOn(titlebar, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 683, 32))
    document.body.appendChild(titlebar)

    render(<ModalShell storageKey="responsive-settings" className="settings-modal" defaultWidth={760} defaultHeight={470} role="dialog"><header>首选项</header></ModalShell>)

    expect(screen.getByRole('dialog')).toHaveStyle({
      width: '659px',
      height: '421px',
      top: '44px',
      minWidth: '620px',
      minHeight: '371px',
      maxHeight: '371px'
    })
    titlebar.remove()
  })

  it('clears an explicit saved height when content changes in fit-content mode', () => {
    localStorage.setItem('moonsprite.modal.export', JSON.stringify({
      x: 20,
      y: 20,
      width: 440,
      height: 360,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight
    }))

    const { rerender } = render(<ModalShell storageKey="export" fitContentKey="png" role="dialog"><header>Export</header><div>PNG</div></ModalShell>)
    const dialog = screen.getByRole('dialog')
    expect(dialog.style.height).toBe('')

    rerender(<ModalShell storageKey="export" fitContentKey="gif" role="dialog"><header>Export</header><div>GIF options</div></ModalShell>)
    expect(dialog.style.height).toBe('')
  })

  it('places right-side dialogs midway between the stage center and right edge', () => {
    const stage = document.createElement('div')
    stage.className = 'stage-wrap'
    stage.getBoundingClientRect = () => new DOMRect(100, 50, 800, 600)
    document.body.appendChild(stage)

    render(<ModalShell storageKey="right" placement="right" defaultWidth={400} defaultHeight={300} role="dialog"><header>右侧弹窗</header></ModalShell>)

    expect(screen.getByRole('dialog')).toHaveStyle({ left: '524px' })
    stage.remove()
  })

  it('captures the pointer while dragging so movement remains stable at window edges', () => {
    render(<ModalShell storageKey="drag-capture" role="dialog"><header>拖动弹窗</header></ModalShell>)
    const dialog = screen.getByRole('dialog')
    const capture = vi.fn()
    Object.defineProperty(dialog, 'setPointerCapture', { value: capture })
    Object.defineProperty(dialog, 'getBoundingClientRect', { value: () => new DOMRect(100, 80, 420, 300) })

    fireEvent.pointerDown(screen.getByText('拖动弹窗'), { button: 0, pointerId: 7, clientX: 140, clientY: 100 })
    expect(capture).toHaveBeenCalledWith(7)
  })

  it('does not drag the parent modal from a portal-owned child title bar', () => {
    const PortalEditor = () => createPortal(<section role="dialog" aria-label="颜色编辑"><header>颜色编辑标题</header></section>, document.body)
    render(<ModalShell storageKey="portal-child" role="dialog" aria-label="父弹窗"><header>父弹窗标题</header><PortalEditor /></ModalShell>)
    const parent = screen.getByRole('dialog', { name: '父弹窗' })
    const capture = vi.fn()
    Object.defineProperty(parent, 'setPointerCapture', { value: capture })

    fireEvent.pointerDown(screen.getByText('颜色编辑标题'), { button: 0, pointerId: 11, clientX: 40, clientY: 40 })

    expect(capture).not.toHaveBeenCalled()
  })

  it('brings the focused modal and its backdrop above other dialogs', () => {
    render(<>
      <div className="modal-backdrop" data-testid="first-backdrop"><ModalShell storageKey="stack-first" role="dialog" aria-label="第一个弹窗"><header>第一个弹窗</header><button type="button">聚焦第一个</button></ModalShell></div>
      <div className="modal-backdrop" data-testid="second-backdrop"><ModalShell storageKey="stack-second" role="dialog" aria-label="第二个弹窗"><header>第二个弹窗</header><button type="button">聚焦第二个</button></ModalShell></div>
    </>)
    const firstBackdrop = screen.getByTestId('first-backdrop')
    const secondBackdrop = screen.getByTestId('second-backdrop')
    const firstDialog = screen.getByRole('dialog', { name: '第一个弹窗' })
    const secondDialog = screen.getByRole('dialog', { name: '第二个弹窗' })

    fireEvent.focus(screen.getByRole('button', { name: '聚焦第一个' }))
    expect(Number(firstBackdrop.style.zIndex)).toBeGreaterThan(Number(secondBackdrop.style.zIndex))
    expect(Number(firstDialog.style.zIndex)).toBeGreaterThan(Number(secondDialog.style.zIndex))

    fireEvent.focus(screen.getByRole('button', { name: '聚焦第二个' }))
    expect(Number(secondBackdrop.style.zIndex)).toBeGreaterThan(Number(firstBackdrop.style.zIndex))
    expect(Number(secondDialog.style.zIndex)).toBeGreaterThan(Number(firstDialog.style.zIndex))
  })

  it('moves without rerender jitter and keeps only the title reachable below the viewport', () => {
    render(<ModalShell storageKey="drag-below" role="dialog"><header>拖动弹窗</header><div>内容</div></ModalShell>)
    const dialog = screen.getByRole('dialog')
    Object.defineProperty(dialog, 'getBoundingClientRect', { value: () => new DOMRect(100, 80, 420, 300) })

    fireEvent.pointerDown(screen.getByText('拖动弹窗'), { button: 0, pointerId: 9, clientX: 140, clientY: 100 })
    fireEvent.pointerMove(window, { pointerId: 9, clientX: 200, clientY: window.innerHeight + 100 })

    expect(dialog).toHaveStyle({ top: `${window.innerHeight - 32}px` })
    fireEvent.pointerUp(window, { pointerId: 9 })
    expect(JSON.parse(localStorage.getItem('moonsprite.modal.drag-below') ?? '{}')).toMatchObject({ y: window.innerHeight - 32 })
  })
})
