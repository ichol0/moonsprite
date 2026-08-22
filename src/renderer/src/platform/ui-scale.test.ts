import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { isMaximized, maximize, onResized, onScaleChanged, resizedHandlers, scaleChangedHandlers, scaleFactor, setMinSize, setZoom } = vi.hoisted(() => {
  const handlers: Array<(event: { payload: { scaleFactor: number } }) => void> = []
  const resizeHandlers: Array<() => void> = []
  return {
    isMaximized: vi.fn(() => Promise.resolve(false)),
    maximize: vi.fn(() => Promise.resolve()),
    onResized: vi.fn((handler: () => void) => {
      resizeHandlers.push(handler)
      return Promise.resolve(() => undefined)
    }),
    onScaleChanged: vi.fn((handler: (event: { payload: { scaleFactor: number } }) => void) => {
      handlers.push(handler)
      return Promise.resolve(() => undefined)
    }),
    resizedHandlers: resizeHandlers,
    scaleChangedHandlers: handlers,
    scaleFactor: vi.fn(() => Promise.resolve(1)),
    setMinSize: vi.fn((_size: unknown) => Promise.resolve()),
    setZoom: vi.fn((_zoom: number) => Promise.resolve())
  }
})

vi.mock('@tauri-apps/api/webview', () => ({
  getCurrentWebview: () => ({ setZoom })
}))

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({ isMaximized, maximize, onResized, onScaleChanged, scaleFactor, setMinSize })
}))

function enableTauriRuntime(): void {
  ;(window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {}
}

describe('UI scale platform adapter', () => {
  beforeEach(() => {
    vi.resetModules()
    delete (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__
    resizedHandlers.length = 0
    scaleChangedHandlers.length = 0
    isMaximized.mockClear()
    isMaximized.mockResolvedValue(false)
    maximize.mockClear()
    onResized.mockClear()
    onScaleChanged.mockClear()
    scaleFactor.mockClear()
    scaleFactor.mockResolvedValue(1)
    setMinSize.mockClear()
    setZoom.mockClear()
  })

  afterEach(() => {
    delete (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__
    delete document.documentElement.dataset.toolIconScale
    for (const name of ['--tool-rail-icon-size', '--tool-rail-utility-icon-size', '--tool-rail-button-size', '--tool-rail-flyout-offset', '--tool-rail-column-size']) document.documentElement.style.removeProperty(name)
  })

  it('does not apply native zoom in browser previews', async () => {
    const { applyUiScale } = await import('./ui-scale')
    await applyUiScale(0.75)
    expect(setZoom).not.toHaveBeenCalled()
    expect(setMinSize).not.toHaveBeenCalled()
    expect(scaleFactor).not.toHaveBeenCalled()
    expect(onScaleChanged).not.toHaveBeenCalled()
  })

  it('compensates native WebView zoom for the current display scale', async () => {
    enableTauriRuntime()
    scaleFactor.mockResolvedValue(1.25)
    const { applyUiScale } = await import('./ui-scale')
    await applyUiScale(1)
    await applyUiScale(1)
    await applyUiScale(1.5)
    expect(setZoom.mock.calls).toEqual([[0.8], [1.2]])
    expect(setMinSize).toHaveBeenCalledTimes(2)
    expect(setMinSize.mock.calls[0][0]).toMatchObject({ width: 1024, height: 640 })
    expect(setMinSize.mock.calls[1][0]).toMatchObject({ width: 1536, height: 960 })
    expect(onScaleChanged).toHaveBeenCalledTimes(1)
  })

  it('keeps the native minimum window size in physical pixels at 175% display scale', async () => {
    enableTauriRuntime()
    scaleFactor.mockResolvedValue(1.75)
    const { applyUiScale } = await import('./ui-scale')
    await applyUiScale(1)
    expect(setZoom).toHaveBeenLastCalledWith(1 / 1.75)
    expect(setMinSize).toHaveBeenLastCalledWith(expect.objectContaining({ width: 1024, height: 640 }))
  })

  it('reapplies the requested interface scale when the display DPI changes', async () => {
    enableTauriRuntime()
    scaleFactor.mockResolvedValue(1.25)
    const { applyUiScale } = await import('./ui-scale')
    await applyUiScale(1)
    expect(scaleChangedHandlers).toHaveLength(1)
    scaleChangedHandlers[0]({ payload: { scaleFactor: 2 } })
    await vi.waitFor(() => expect(setZoom.mock.calls).toEqual([[0.8], [0.5]]))
    expect(setMinSize).toHaveBeenCalledTimes(1)
    expect(setMinSize.mock.calls[0][0]).toMatchObject({ width: 1024, height: 640 })
  })

  it('defers the minimum size while maximized and applies it after restore', async () => {
    enableTauriRuntime()
    isMaximized.mockResolvedValue(true)
    const { applyUiScale } = await import('./ui-scale')

    await applyUiScale(1.5)

    expect(setZoom).toHaveBeenCalledWith(1.5)
    expect(setMinSize).not.toHaveBeenCalled()
    expect(onResized).toHaveBeenCalledTimes(1)
    expect(resizedHandlers).toHaveLength(1)

    isMaximized.mockResolvedValue(false)
    resizedHandlers[0]()
    await vi.waitFor(() => expect(setMinSize).toHaveBeenCalledWith(expect.objectContaining({ width: 1536, height: 960 })))
  })

  it('restores maximized state if native zoom unexpectedly unmaximizes the window', async () => {
    enableTauriRuntime()
    isMaximized.mockResolvedValueOnce(true).mockResolvedValueOnce(false)
    const { applyUiScale } = await import('./ui-scale')

    await applyUiScale(1.5)

    expect(maximize).toHaveBeenCalledTimes(1)
    expect(setMinSize).not.toHaveBeenCalled()
  })

  it('applies the toolbar icon scale as an exact CSS pixel size', async () => {
    const { applyToolIconScale } = await import('./ui-scale')
    applyToolIconScale(1)
    expect(document.documentElement.dataset.toolIconScale).toBe('normal')
    expect(document.documentElement.style.getPropertyValue('--tool-rail-icon-size')).toBe('22px')
    expect(document.documentElement.style.getPropertyValue('--tool-rail-button-size')).toBe('32px')
    expect(document.documentElement.style.getPropertyValue('--tool-rail-column-size')).toBe('45px')
    applyToolIconScale(2)
    expect(document.documentElement.dataset.toolIconScale).toBe('large')
    expect(document.documentElement.style.getPropertyValue('--tool-rail-icon-size')).toBe('32px')
    expect(document.documentElement.style.getPropertyValue('--tool-rail-button-size')).toBe('44px')
    expect(document.documentElement.style.getPropertyValue('--tool-rail-column-size')).toBe('57px')
  })
})
