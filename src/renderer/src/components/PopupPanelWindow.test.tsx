import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { POPUP_PANEL_STORAGE_KEYS } from '@/core/workspace-layout-preferences'
import { PopupPanelWindow, popupPanelInitialPosition } from './PopupPanelWindow'

const renderPopup = (anchor = { x: 500, y: 400 }) => render(<PopupPanelWindow
  id="color"
  anchor={anchor}
  label="Color"
  onClose={() => undefined}
  renderPanel={(startDrag) => <section className="panel"><header data-testid="popup-header" onPointerDown={startDrag}>Color</header></section>}
/>)

afterEach(() => {
  cleanup()
  localStorage.removeItem(POPUP_PANEL_STORAGE_KEYS.color)
  vi.restoreAllMocks()
})

describe('popup panel window geometry', () => {
  it('centers a new popup on the pointer and constrains it to the viewport', () => {
    expect(popupPanelInitialPosition('color', { x: 500, y: 400 }, { width: 1000, height: 800 })).toEqual({
      x: 320,
      y: 140,
      width: 360,
      height: 520
    })
    expect(popupPanelInitialPosition('preview', { x: 4, y: 6 }, { width: 1000, height: 800 })).toEqual({
      x: 6,
      y: 6,
      width: 360,
      height: 380
    })
  })

  it('restores the saved size while centering the next open on the current pointer', () => {
    localStorage.setItem(POPUP_PANEL_STORAGE_KEYS.color, JSON.stringify({
      x: 72,
      y: 84,
      width: 420,
      height: 360,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight
    }))
    renderPopup({ x: 500, y: 400 })

    const popup = document.querySelector<HTMLElement>('.workspace-panel-popup')
    expect(popup?.style.left).toBe('290px')
    expect(popup?.style.top).toBe('220px')
    expect(popup?.style.width).toBe('420px')
    expect(popup?.style.height).toBe('360px')
    expect(popup?.querySelectorAll('.floating-resize-handle')).toHaveLength(8)
  })

  it('persists drag and resize changes for the next open', async () => {
    const first = renderPopup()
    const popup = document.querySelector<HTMLElement>('.workspace-panel-popup')
    if (!popup) throw new Error('Popup panel was not rendered')
    const initial = popupPanelInitialPosition('color', { x: 500, y: 400 }, { width: window.innerWidth, height: window.innerHeight })
    vi.spyOn(popup, 'getBoundingClientRect').mockReturnValue({
      left: initial.x,
      top: initial.y,
      right: initial.x + initial.width!,
      bottom: initial.y + initial.height!,
      width: initial.width!,
      height: initial.height!,
      x: initial.x,
      y: initial.y,
      toJSON: () => ({})
    })

    fireEvent.pointerDown(screen.getByTestId('popup-header'), { button: 0, pointerId: 7, clientX: initial.x + 40, clientY: initial.y + 16 })
    fireEvent.pointerMove(window, { pointerId: 7, clientX: initial.x + 90, clientY: initial.y + 46 })
    fireEvent.pointerUp(window, { pointerId: 7, clientX: initial.x + 90, clientY: initial.y + 46 })

    await waitFor(() => {
      const stored = JSON.parse(localStorage.getItem(POPUP_PANEL_STORAGE_KEYS.color) ?? '{}') as { x?: number; y?: number }
      expect(stored.x).toBe(initial.x + 50)
      expect(stored.y).toBe(initial.y + 30)
    })

    first.unmount()
    const second = renderPopup()
    const restored = document.querySelector<HTMLElement>('.workspace-panel-popup')
    if (!restored) throw new Error('Restored popup panel was not rendered')
    vi.spyOn(restored, 'getBoundingClientRect').mockReturnValue({
      left: initial.x,
      top: initial.y,
      right: initial.x + initial.width!,
      bottom: initial.y + initial.height!,
      width: initial.width!,
      height: initial.height!,
      x: initial.x,
      y: initial.y,
      toJSON: () => ({})
    })
    const southeast = restored.querySelector<HTMLElement>('.resize-se')
    if (!southeast) throw new Error('Resize handle was not rendered')
    fireEvent.pointerDown(southeast, { button: 0, pointerId: 8, clientX: initial.x + initial.width!, clientY: initial.y + initial.height! })
    fireEvent.pointerMove(window, { pointerId: 8, clientX: initial.x + 40 + initial.width!, clientY: initial.y + 20 + initial.height! })
    fireEvent.pointerUp(window, { pointerId: 8, clientX: initial.x + 40 + initial.width!, clientY: initial.y + 20 + initial.height! })

    await waitFor(() => {
      const stored = JSON.parse(localStorage.getItem(POPUP_PANEL_STORAGE_KEYS.color) ?? '{}') as { width?: number; height?: number }
      expect(stored.width).toBe(initial.width! + 40)
      expect(stored.height).toBe(initial.height! + 20)
    })
    second.unmount()
  })
})
