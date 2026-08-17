import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { onScaleChanged, scaleChangedHandlers, scaleFactor, setMinSize, setZoom } = vi.hoisted(() => {
  const handlers: Array<(event: { payload: { scaleFactor: number } }) => void> = []
  return {
    onScaleChanged: vi.fn((handler: (event: { payload: { scaleFactor: number } }) => void) => {
      handlers.push(handler)
      return Promise.resolve(() => undefined)
    }),
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
  getCurrentWindow: () => ({ onScaleChanged, scaleFactor, setMinSize })
}))

function enableTauriRuntime(): void {
  ;(window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {}
}

describe('UI scale platform adapter', () => {
  beforeEach(() => {
    vi.resetModules()
    delete (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__
    scaleChangedHandlers.length = 0
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
    expect(setMinSize).toHaveBeenCalledTimes(2)
    expect(setMinSize.mock.calls[1][0]).toMatchObject({ width: 1024, height: 640 })
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
