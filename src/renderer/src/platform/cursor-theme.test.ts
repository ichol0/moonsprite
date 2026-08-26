import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { onScaleChanged, scaleChangedHandlers, scaleFactor, setCursorVisible } = vi.hoisted(() => {
  const handlers: Array<(event: { payload: { scaleFactor: number } }) => void> = []
  return {
    onScaleChanged: vi.fn((handler: (event: { payload: { scaleFactor: number } }) => void) => {
      handlers.push(handler)
      return Promise.resolve(() => undefined)
    }),
    scaleChangedHandlers: handlers,
    scaleFactor: vi.fn(() => Promise.resolve(1)),
    setCursorVisible: vi.fn(() => Promise.resolve())
  }
})

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({ onScaleChanged, scaleFactor, setCursorVisible })
}))

function enableTauriRuntime(): void {
  ;(window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {}
}

function clearCursorProperties(): void {
  const root = document.documentElement.style
  const properties = Array.from({ length: root.length }, (_, index) => root.item(index)).filter((name) => name.startsWith('--cursor-'))
  for (const property of properties) root.removeProperty(property)
}

describe('cursor icon library', () => {
  beforeEach(() => {
    vi.resetModules()
    delete (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__
    scaleChangedHandlers.length = 0
    onScaleChanged.mockClear()
    scaleFactor.mockClear()
    scaleFactor.mockResolvedValue(1)
    setCursorVisible.mockClear()
    setCursorVisible.mockResolvedValue()
  })

  afterEach(() => {
    delete (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__
    clearCursorProperties()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('exposes every registered cursor asset with a unique CSS variable', async () => {
    const { CURSOR_ICON_LIBRARY } = await import('./cursor-theme')
    expect(CURSOR_ICON_LIBRARY.length).toBeGreaterThan(0)
    expect(new Set(CURSOR_ICON_LIBRARY.map((item) => item.variable)).size).toBe(CURSOR_ICON_LIBRARY.length)
    expect(CURSOR_ICON_LIBRARY.every((item) => item.variable.startsWith('--cursor-') && item.source.length > 0 && item.fallback.length > 0)).toBe(true)
  })

  it('uses system cursors for supported scenes and MoonSprite cursors for missing scenes', async () => {
    const { cursorPreferenceSource } = await import('./cursor-theme')
    expect(cursorPreferenceSource('--cursor-default', true)).toBe('system')
    expect(cursorPreferenceSource('--cursor-pointer', true)).toBe('system')
    expect(cursorPreferenceSource('--cursor-crosshair', true)).toBe('moonsprite')
    expect(cursorPreferenceSource('--cursor-eyedropper', true)).toBe('moonsprite')
    expect(cursorPreferenceSource('--cursor-zoom', true)).toBe('moonsprite')
    expect(cursorPreferenceSource('--cursor-selection-rotate-ne', true)).toBe('moonsprite')
    expect(cursorPreferenceSource('--cursor-selection-rotate-n', true)).toBe('moonsprite')
    expect(cursorPreferenceSource('--cursor-selection-rotate-s', true)).toBe('moonsprite')
    expect(cursorPreferenceSource('--cursor-rotate', true)).toBe('moonsprite')
  })

  it('uses MoonSprite cursors everywhere when local system cursors are disabled', async () => {
    const { cursorPreferenceSource } = await import('./cursor-theme')
    expect(cursorPreferenceSource('--cursor-default', false)).toBe('moonsprite')
    expect(cursorPreferenceSource('--cursor-selection-rotate-ne', false)).toBe('moonsprite')
  })

  it('resolves a positioned overlay cursor for pen input without display-DPI coordinates', async () => {
    const { CURSOR_ICON_LIBRARY, cursorOverlayDescriptor } = await import('./cursor-theme')
    const pencil = CURSOR_ICON_LIBRARY.find((item) => item.variable === '--cursor-pencil-black')!
    expect(cursorOverlayDescriptor('var(--cursor-pencil-black)', false, 1.5)).toEqual({
      source: pencil.source,
      size: 48,
      hotspotX: 22.5,
      hotspotY: 22.5
    })
    expect(cursorOverlayDescriptor('var(--cursor-pencil-black)', false, 1.5, 1.5)).toEqual({
      source: pencil.source,
      size: 32,
      hotspotX: 15,
      hotspotY: 15
    })
    expect(cursorOverlayDescriptor('none', false, 1)).toBeNull()
    expect(cursorOverlayDescriptor('crosshair', false, 1)).toBeNull()
  })

  it('hides the native Windows cursor while a pen cursor owns the canvas', async () => {
    enableTauriRuntime()
    const { setNativeCursorVisible } = await import('./cursor-theme')
    await setNativeCursorVisible(false)
    await setNativeCursorVisible(true)
    expect(setCursorVisible.mock.calls).toEqual([[false], [true]])
  })

  it('compensates cursor pixels and hotspots for display DPI changes', async () => {
    enableTauriRuntime()
    scaleFactor.mockResolvedValue(1.25)
    const rasterSizes: Array<[number, number]> = []
    class MockImage {
      naturalWidth = 32
      naturalHeight = 32
      onload: ((event: Event) => void) | null = null
      onerror: ((event: Event) => void) | null = null
      set src(_value: string) { this.onload?.(new Event('load')) }
    }
    vi.stubGlobal('Image', MockImage)
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (this: HTMLCanvasElement) {
      rasterSizes.push([this.width, this.height])
      return { imageSmoothingEnabled: true, drawImage: vi.fn() } as unknown as CanvasRenderingContext2D
    })
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/png;base64,cursor')
    const { applyCursorPreferences } = await import('./cursor-theme')
    await applyCursorPreferences(false, 1)
    const initialValue = document.documentElement.style.getPropertyValue('--cursor-default')
    expect(initialValue).toContain('image-set(')
    expect(initialValue).toContain('1.25x) 7.2 4')
    expect(rasterSizes).toHaveLength(0)
    expect(scaleChangedHandlers).toHaveLength(1)
    scaleChangedHandlers[0]({ payload: { scaleFactor: 2 } })
    await vi.waitFor(() => expect(document.documentElement.style.getPropertyValue('--cursor-default')).toContain('2x) 4.5 2.5'))
    expect(rasterSizes).toHaveLength(0)
    await applyCursorPreferences(false, 1.5)
    expect(rasterSizes).toContainEqual([48, 48])
    expect(document.documentElement.style.getPropertyValue('--cursor-default')).toContain('2x) 7 4')
  })
})
