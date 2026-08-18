import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  availableMonitors: vi.fn(),
  getCurrentWindow: vi.fn()
}))

vi.mock('@tauri-apps/api/dpi', () => ({
  PhysicalPosition: class PhysicalPosition {
    constructor(public x: number, public y: number) {}
  },
  PhysicalSize: class PhysicalSize {
    constructor(public width: number, public height: number) {}
  }
}))

vi.mock('@tauri-apps/api/window', () => ({
  availableMonitors: mocks.availableMonitors,
  getCurrentWindow: mocks.getCurrentWindow
}))

import { applyAppWindowLayout, initializeAppWindow, readAppWindowLayout } from './app-window'

const createWindow = () => ({
  isMaximized: vi.fn(async () => false),
  outerPosition: vi.fn(async () => ({ x: 10, y: 20 })),
  innerSize: vi.fn(async () => ({ width: 800, height: 600 })),
  unmaximize: vi.fn(async () => {}),
  maximize: vi.fn(async () => {}),
  setSize: vi.fn(async () => {}),
  setPosition: vi.fn(async () => {}),
  center: vi.fn(async () => {}),
  show: vi.fn(async () => {}),
  onMoved: vi.fn(async () => vi.fn()),
  onResized: vi.fn(async () => vi.fn()),
  minimize: vi.fn(async () => {}),
  toggleMaximize: vi.fn(async () => {}),
  close: vi.fn(async () => {})
})

beforeEach(() => {
  vi.clearAllMocks()
  Object.defineProperty(window, '__TAURI_INTERNALS__', { value: {}, configurable: true })
  mocks.availableMonitors.mockResolvedValue([{
    workArea: { position: { x: 0, y: 0 }, size: { width: 1920, height: 1080 } }
  }])
})

describe('app window platform adapter', () => {
  it('reads native geometry without leaking Tauri APIs into App', async () => {
    const appWindow = createWindow()
    appWindow.isMaximized.mockResolvedValue(true)
    mocks.getCurrentWindow.mockReturnValue(appWindow)

    await expect(readAppWindowLayout()).resolves.toEqual({ x: 10, y: 20, width: 800, height: 600, maximized: true })
  })

  it('skips redundant workspace restoration when the maximized state already matches', async () => {
    const appWindow = createWindow()
    appWindow.isMaximized.mockResolvedValue(true)
    mocks.getCurrentWindow.mockReturnValue(appWindow)

    await applyAppWindowLayout({ x: 30, y: 40, width: 1200, height: 800, maximized: true })

    expect(appWindow.unmaximize).not.toHaveBeenCalled()
    expect(appWindow.setSize).not.toHaveBeenCalled()
    expect(appWindow.setPosition).not.toHaveBeenCalled()
  })

  it('centers layouts that no longer overlap an available monitor', async () => {
    const appWindow = createWindow()
    mocks.getCurrentWindow.mockReturnValue(appWindow)

    await applyAppWindowLayout({ x: 5000, y: 5000, width: 900, height: 700, maximized: false })

    expect(appWindow.setSize).toHaveBeenCalledWith(expect.objectContaining({ width: 900, height: 700 }))
    expect(appWindow.center).toHaveBeenCalledTimes(1)
    expect(appWindow.setPosition).not.toHaveBeenCalled()
  })

  it('initializes observers and returns one cleanup boundary', async () => {
    const appWindow = createWindow()
    const removeMoved = vi.fn()
    const removeResized = vi.fn()
    appWindow.onMoved.mockResolvedValue(removeMoved)
    appWindow.onResized.mockResolvedValue(removeResized)
    mocks.getCurrentWindow.mockReturnValue(appWindow)

    const onGeometryChanged = vi.fn()
    const dispose = await initializeAppWindow(null, onGeometryChanged)

    expect(appWindow.show).toHaveBeenCalledTimes(1)
    expect(appWindow.onMoved).toHaveBeenCalledWith(onGeometryChanged)
    expect(appWindow.onResized).toHaveBeenCalledWith(onGeometryChanged)
    dispose()
    expect(removeMoved).toHaveBeenCalledTimes(1)
    expect(removeResized).toHaveBeenCalledTimes(1)
  })
})
