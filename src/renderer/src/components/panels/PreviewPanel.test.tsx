import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createDocument } from '@/core/document'
import { useWorkspace } from '@/store/workspace'
import { PreviewPanel } from './PreviewPanel'

class MockResizeObserver {
  static created = 0
  static disconnected = 0
  constructor() { MockResizeObserver.created += 1 }
  observe() {}
  disconnect() { MockResizeObserver.disconnected += 1 }
}

class MockOffscreenCanvas {
  static instances: MockOffscreenCanvas[] = []
  readonly context = { putImageData: vi.fn(), drawImage: vi.fn(), imageSmoothingEnabled: false, imageSmoothingQuality: 'low' }
  constructor(public width: number, public height: number) { MockOffscreenCanvas.instances.push(this) }
  getContext() { return this.context }
}

beforeEach(() => {
  MockOffscreenCanvas.instances = []
  MockResizeObserver.created = 0
  MockResizeObserver.disconnected = 0
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
  it('keeps one exact source surface for dirty-region preview updates', () => {
    const context = {
      setTransform: vi.fn(), clearRect: vi.fn(), fillRect: vi.fn(), save: vi.fn(), restore: vi.fn(),
      beginPath: vi.fn(), rect: vi.fn(), clip: vi.fn(), translate: vi.fn(), scale: vi.fn(), drawImage: vi.fn(),
      imageSmoothingEnabled: true, imageSmoothingQuality: 'high', fillStyle: ''
    }
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => context as never)
    vi.spyOn(HTMLCanvasElement.prototype, 'getBoundingClientRect').mockReturnValue({
      x: 0, y: 0, top: 0, left: 0, right: 320, bottom: 180, width: 320, height: 180, toJSON: () => ({})
    })
    const document = createDocument('exact preview', 512, 256, 'rgba')
    useWorkspace.getState().addSession(document)
    const session = useWorkspace.getState().sessions[0]
    const { rerender } = render(<PreviewPanel session={session} onClose={vi.fn()} docked />)
    const exactSurface = MockOffscreenCanvas.instances.find((canvas) => canvas.width === 512 && canvas.height === 256)
    expect(exactSurface).toBeDefined()
    expect(context.imageSmoothingEnabled).toBe(false)

    const nextSession = {
      ...session,
      contentInvalidation: { kind: 'region' as const, fromRevision: 0, revision: 1, frameId: document.animation!.activeFrameId, rect: { x: 5, y: 6, width: 2, height: 3 } },
      contentRevision: 1
    }
    rerender(<PreviewPanel session={nextSession} onClose={vi.fn()} docked />)

    expect(MockOffscreenCanvas.instances.filter((canvas) => canvas.width === 512 && canvas.height === 256)).toHaveLength(1)
    expect(exactSurface!.context.putImageData).toHaveBeenLastCalledWith(expect.objectContaining({ width: 2, height: 3 }), 5, 6)
    expect(MockResizeObserver.created).toBe(1)
    expect(MockResizeObserver.disconnected).toBe(0)
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

  it('keeps preview zoom available while following the canvas position', () => {
    const document = createDocument('followed preview', 8, 8, 'rgba')
    useWorkspace.getState().addSession(document)
    render(<PreviewPanel session={useWorkspace.getState().sessions[0]} onClose={vi.fn()} docked />)

    const follow = screen.getByRole('button', { name: '跟随画布视窗' })
    const zoomOut = screen.getByRole('button', { name: '缩小预览' })
    const zoomIn = screen.getByRole('button', { name: '放大预览' })
    expect(follow).toHaveAttribute('aria-pressed', 'false')
    expect(zoomOut).toBeEnabled()
    expect(zoomIn).toBeEnabled()

    fireEvent.click(follow)
    expect(follow).toHaveAttribute('aria-pressed', 'true')
    expect(zoomOut).toBeEnabled()
    expect(zoomIn).toBeEnabled()
    fireEvent.click(zoomIn)

    fireEvent.click(follow)
    expect(follow).toHaveAttribute('aria-pressed', 'false')
    expect(zoomOut).toBeEnabled()
    expect(zoomIn).toBeEnabled()
  })

  it('uses the primary pointer button to pan the preview directly', () => {
    const document = createDocument('direct preview pan', 8, 8, 'rgba')
    useWorkspace.getState().addSession(document)
    render(<PreviewPanel session={useWorkspace.getState().sessions[0]} onClose={vi.fn()} docked />)

    const surface = window.document.querySelector('.preview-canvas-wrap') as HTMLDivElement
    expect(surface).not.toHaveClass('space-pan-ready')
    expect(surface).not.toHaveClass('space-panning')
    surface.setPointerCapture = vi.fn()
    surface.hasPointerCapture = vi.fn(() => true)
    surface.releasePointerCapture = vi.fn()

    fireEvent.pointerDown(surface, { button: 0, pointerId: 7, clientX: 20, clientY: 30 })
    expect(surface).toHaveClass('space-panning')
    fireEvent.pointerUp(surface, { button: 0, pointerId: 7, clientX: 28, clientY: 34 })
    expect(surface).not.toHaveClass('space-panning')
  })

  it('hands a followed preview position to manual panning without blocking the drag', () => {
    const document = createDocument('follow to manual preview pan', 8, 8, 'rgba')
    useWorkspace.getState().addSession(document)
    vi.spyOn(HTMLCanvasElement.prototype, 'getBoundingClientRect').mockReturnValue({
      x: 0, y: 0, top: 0, left: 0, right: 200, bottom: 200, width: 200, height: 200, toJSON: () => ({})
    })
    render(<PreviewPanel session={useWorkspace.getState().sessions[0]} onClose={vi.fn()} docked />)

    const follow = screen.getByRole('button', { name: '跟随画布视窗' })
    const surface = window.document.querySelector('.preview-canvas-wrap') as HTMLDivElement
    surface.setPointerCapture = vi.fn()
    surface.hasPointerCapture = vi.fn(() => true)
    surface.releasePointerCapture = vi.fn()

    fireEvent.click(follow)
    expect(follow).toHaveAttribute('aria-pressed', 'true')
    fireEvent.pointerDown(surface, { button: 0, pointerId: 8, clientX: 20, clientY: 30 })
    expect(follow).toHaveAttribute('aria-pressed', 'false')
    expect(surface).toHaveClass('space-panning')
    fireEvent.pointerUp(surface, { button: 0, pointerId: 8, clientX: 28, clientY: 34 })
  })

})
