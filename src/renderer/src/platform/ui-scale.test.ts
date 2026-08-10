import { afterEach, describe, expect, it, vi } from 'vitest'

const { setZoom } = vi.hoisted(() => ({ setZoom: vi.fn(() => Promise.resolve()) }))

vi.mock('@tauri-apps/api/webview', () => ({
  getCurrentWebview: () => ({ setZoom })
}))

import { applyUiScale } from './ui-scale'

describe('UI scale platform adapter', () => {
  afterEach(() => {
    delete (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__
    setZoom.mockClear()
  })

  it('does not apply native zoom in browser previews', async () => {
    await applyUiScale(1.25)
    expect(setZoom).not.toHaveBeenCalled()
  })

  it('applies native WebView zoom and skips duplicate values', async () => {
    ;(window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {}
    await applyUiScale(1.25)
    await applyUiScale(1.25)
    await applyUiScale(1.5)
    expect(setZoom.mock.calls).toEqual([[1.25], [1.5]])
  })
})
