import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createDocument } from '@/core/document'
import { useWorkspace } from '@/store/workspace'
import { PreviewPanel } from './PreviewPanel'

class MockResizeObserver {
  observe() {}
  disconnect() {}
}

class MockOffscreenCanvas {
  static instances: MockOffscreenCanvas[] = []
  constructor(public width: number, public height: number) { MockOffscreenCanvas.instances.push(this) }
  getContext() { return { putImageData: vi.fn() } }
}

beforeEach(() => {
  MockOffscreenCanvas.instances = []
  useWorkspace.setState({ sessions: [], activeId: null, message: null, dialog: null })
  vi.stubGlobal('ResizeObserver', MockResizeObserver)
  vi.stubGlobal('OffscreenCanvas', MockOffscreenCanvas)
  vi.stubGlobal('ImageData', class {
    constructor(public data: Uint8ClampedArray, public width: number, public height: number) {}
  })
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => null)
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('PreviewPanel animation controls', () => {
  it('keeps the full source resolution for large pixel canvases', () => {
    const document = createDocument('large preview', 640, 720, 'rgba')
    useWorkspace.getState().addSession(document)
    render(<PreviewPanel session={useWorkspace.getState().sessions[0]} onClose={vi.fn()} docked />)
    expect(MockOffscreenCanvas.instances.at(-1)).toMatchObject({ width: 640, height: 720 })
  })

  it('keeps preview playback independent from canvas playback', () => {
    const document = createDocument('preview animation', 1, 1, 'rgba')
    useWorkspace.getState().addSession(document)
    useWorkspace.getState().duplicateAnimationFrame()
    const session = useWorkspace.getState().sessions[0]
    render(<PreviewPanel session={session} onClose={vi.fn()} docked />)

    const play = screen.getByRole('button', { name: '播放动画' })
    fireEvent.contextMenu(play)
    expect(screen.getByRole('menu', { name: '播放设置' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('menuitemradio', { name: '播放速度 2x' }))
    expect(session.animationPlaybackRate).toBe(1)

    fireEvent.click(play)
    expect(session.animationPlaying).toBe(false)
    expect(screen.getByRole('button', { name: '暂停动画' })).toBeInTheDocument()
  })

  it('keeps fixed zoom controls without rendering a percentage label', () => {
    const document = createDocument('stepped preview zoom', 8, 8, 'rgba')
    useWorkspace.getState().addSession(document)
    vi.spyOn(HTMLCanvasElement.prototype, 'getBoundingClientRect').mockReturnValue({
      x: 0, y: 0, top: 0, left: 0, right: 200, bottom: 200, width: 200, height: 200, toJSON: () => ({})
    })
    render(<PreviewPanel session={useWorkspace.getState().sessions[0]} onClose={vi.fn()} docked />)

    fireEvent.click(screen.getByRole('button', { name: '放大预览' }))
    expect(screen.queryByText('125%')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '放大预览' }))
    expect(screen.queryByText('150%')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '缩小预览' }))
    fireEvent.click(screen.getByRole('button', { name: '缩小预览' }))
    fireEvent.click(screen.getByRole('button', { name: '缩小预览' }))
    expect(screen.queryByText('66.67%')).not.toBeInTheDocument()
  })

  it('uses Space plus the primary pointer button to pan the preview', () => {
    const document = createDocument('space preview pan', 8, 8, 'rgba')
    useWorkspace.getState().addSession(document)
    render(<PreviewPanel session={useWorkspace.getState().sessions[0]} onClose={vi.fn()} docked />)

    const surface = window.document.querySelector('.preview-canvas-wrap') as HTMLDivElement
    surface.setPointerCapture = vi.fn()
    surface.hasPointerCapture = vi.fn(() => true)
    surface.releasePointerCapture = vi.fn()

    fireEvent.keyDown(window, { code: 'Space' })
    expect(surface).toHaveClass('space-pan-ready')
    fireEvent.pointerDown(surface, { button: 0, pointerId: 7, clientX: 20, clientY: 30 })
    expect(surface).toHaveClass('space-panning')
    fireEvent.pointerUp(surface, { button: 0, pointerId: 7, clientX: 28, clientY: 34 })
    expect(surface).not.toHaveClass('space-panning')
    fireEvent.keyUp(window, { code: 'Space' })
    expect(surface).not.toHaveClass('space-pan-ready')
  })
})
