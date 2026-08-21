import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '@/components/I18nProvider'
import { AppWindowTitleBar } from './AppWindowTitleBar'

const mocks = vi.hoisted(() => {
  const state = { maximized: false, onResized: null as (() => void) | null }
  const invoke = vi.fn(async (command: string) => command === 'start_window_drag_if_primary_pressed')
  const appWindow = {
    minimize: vi.fn(async () => {}),
    toggleMaximize: vi.fn(async () => { state.maximized = !state.maximized }),
    isMaximized: vi.fn(async () => state.maximized),
    setCursorIcon: vi.fn(async () => {}),
    close: vi.fn(async () => {}),
    onResized: vi.fn(async (handler: () => void) => {
      state.onResized = handler
      return vi.fn()
    })
  }
  return { state, appWindow, invoke }
})

vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }))
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => mocks.appWindow }))

beforeEach(() => {
  Object.defineProperty(window, '__TAURI_INTERNALS__', { configurable: true, value: {} })
  mocks.state.maximized = false
  mocks.state.onResized = null
  mocks.invoke.mockClear()
  for (const mock of Object.values(mocks.appWindow)) {
    if ('mockClear' in mock) mock.mockClear()
  }
})

afterEach(() => {
  cleanup()
  Reflect.deleteProperty(window, '__TAURI_INTERNALS__')
})

describe('AppWindowTitleBar', () => {
  it('starts native dragging only after a held primary pointer actually moves', async () => {
    render(<I18nProvider><AppWindowTitleBar /></I18nProvider>)

    expect(document.querySelector('.app-window-titlebar')).toHaveTextContent('MoonSprite DEV.6')
    await waitFor(() => expect(mocks.appWindow.onResized).toHaveBeenCalledTimes(1))

    const dragRegion = document.querySelector<HTMLElement>('.app-window-titlebar-drag')
    if (!dragRegion) throw new Error('Window drag region was not rendered')
    Object.assign(dragRegion, { setPointerCapture: vi.fn(), hasPointerCapture: vi.fn(() => false), releasePointerCapture: vi.fn() })
    expect(dragRegion).not.toHaveAttribute('data-tauri-drag-region')

    fireEvent.pointerDown(dragRegion, { button: 0, buttons: 1, isPrimary: true, pointerId: 1, clientX: 40, clientY: 12 })
    fireEvent.pointerUp(dragRegion, { button: 0, buttons: 0, isPrimary: true, pointerId: 1, clientX: 40, clientY: 12 })
    expect(mocks.invoke).not.toHaveBeenCalled()

    fireEvent.pointerDown(dragRegion, { button: 0, buttons: 1, isPrimary: true, pointerId: 2, clientX: 40, clientY: 12 })
    fireEvent.pointerMove(dragRegion, { buttons: 1, isPrimary: true, pointerId: 2, clientX: 42, clientY: 12 })
    expect(mocks.invoke).not.toHaveBeenCalled()
    fireEvent.pointerMove(dragRegion, { buttons: 1, isPrimary: true, pointerId: 2, clientX: 46, clientY: 12 })
    expect(mocks.invoke).toHaveBeenCalledWith('start_window_drag_if_primary_pressed')

    fireEvent.doubleClick(dragRegion, { button: 0 })
    await waitFor(() => expect(screen.getByRole('button', { name: '还原' })).toBeInTheDocument())
    expect(mocks.appWindow.toggleMaximize).toHaveBeenCalledTimes(1)
    expect(mocks.appWindow.setCursorIcon).toHaveBeenCalledWith('default')

    fireEvent.pointerMove(dragRegion, { buttons: 0, isPrimary: true, pointerId: 3, clientX: 40, clientY: 12 })
    await waitFor(() => expect(mocks.appWindow.setCursorIcon).toHaveBeenCalledTimes(2))

    fireEvent.click(screen.getByRole('button', { name: '最小化' }))
    expect(mocks.appWindow.minimize).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: '还原' }))
    await waitFor(() => expect(screen.getByRole('button', { name: '最大化' })).toBeInTheDocument())
    expect(mocks.appWindow.toggleMaximize).toHaveBeenCalledTimes(2)
    fireEvent.click(screen.getByRole('button', { name: '关闭' }))
    expect(mocks.appWindow.close).toHaveBeenCalledTimes(1)
  })

  it('tracks maximize changes caused outside the caption buttons', async () => {
    render(<I18nProvider><AppWindowTitleBar /></I18nProvider>)
    await waitFor(() => expect(mocks.state.onResized).not.toBeNull())

    mocks.state.maximized = true
    act(() => { mocks.state.onResized?.() })

    await waitFor(() => expect(screen.getByRole('button', { name: '还原' })).toBeInTheDocument())
  })
})
