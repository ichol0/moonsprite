import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '@/components/I18nProvider'
import { AppWindowTitleBar } from './AppWindowTitleBar'

const mocks = vi.hoisted(() => {
  const state = { maximized: false, onResized: null as (() => void) | null }
  const appWindow = {
    minimize: vi.fn(async () => {}),
    toggleMaximize: vi.fn(async () => { state.maximized = !state.maximized }),
    isMaximized: vi.fn(async () => state.maximized),
    close: vi.fn(async () => {}),
    onResized: vi.fn(async (handler: () => void) => {
      state.onResized = handler
      return vi.fn()
    })
  }
  return { state, appWindow }
})

vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => mocks.appWindow }))

beforeEach(() => {
  Object.defineProperty(window, '__TAURI_INTERNALS__', { configurable: true, value: {} })
  mocks.state.maximized = false
  mocks.state.onResized = null
  for (const mock of Object.values(mocks.appWindow)) {
    if ('mockClear' in mock) mock.mockClear()
  }
})

afterEach(() => {
  cleanup()
  Reflect.deleteProperty(window, '__TAURI_INTERNALS__')
})

describe('AppWindowTitleBar', () => {
  it('uses the native Tauri drag region contract and delegates caption buttons', async () => {
    render(<I18nProvider><AppWindowTitleBar /></I18nProvider>)

    expect(document.querySelector('.app-window-titlebar')).toHaveTextContent('MoonSprite DEV.5')
    await waitFor(() => expect(mocks.appWindow.onResized).toHaveBeenCalledTimes(1))

    const dragRegion = document.querySelector<HTMLElement>('.app-window-titlebar-drag')
    if (!dragRegion) throw new Error('Window drag region was not rendered')
    expect(dragRegion).toHaveAttribute('data-tauri-drag-region', 'deep')

    fireEvent.click(screen.getByRole('button', { name: '最小化' }))
    expect(mocks.appWindow.minimize).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: '最大化' }))
    await waitFor(() => expect(screen.getByRole('button', { name: '还原' })).toBeInTheDocument())
    expect(mocks.appWindow.toggleMaximize).toHaveBeenCalledTimes(1)
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
