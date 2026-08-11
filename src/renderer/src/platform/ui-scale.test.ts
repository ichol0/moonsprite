import { afterEach, describe, expect, it, vi } from 'vitest'

const { setZoom } = vi.hoisted(() => ({ setZoom: vi.fn(() => Promise.resolve()) }))

vi.mock('@tauri-apps/api/webview', () => ({
  getCurrentWebview: () => ({ setZoom })
}))

import { applyToolIconScale, applyUiScale } from './ui-scale'

describe('UI scale platform adapter', () => {
  afterEach(() => {
    delete (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__
    delete document.documentElement.dataset.toolIconScale
    for (const name of ['--tool-rail-icon-size', '--tool-rail-utility-icon-size', '--tool-rail-button-size', '--tool-rail-flyout-offset', '--tool-rail-column-size']) document.documentElement.style.removeProperty(name)
    setZoom.mockClear()
  })

  it('does not apply native zoom in browser previews', async () => {
    await applyUiScale(0.75)
    expect(setZoom).not.toHaveBeenCalled()
  })

  it('applies native WebView zoom and skips duplicate values', async () => {
    ;(window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {}
    await applyUiScale(0.75)
    await applyUiScale(0.75)
    await applyUiScale(1.5)
    expect(setZoom.mock.calls).toEqual([[0.75], [1.5]])
  })

  it('applies the toolbar icon scale as an exact CSS pixel size', () => {
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
