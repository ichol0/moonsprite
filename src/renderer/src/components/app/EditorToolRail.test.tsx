import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createDocument } from '@/core/document'
import { useWorkspace } from '@/store/workspace'
import { EditorToolRail } from './EditorToolRail'
import { ALL_EDITOR_TOOL_ICONS, SELECTION_KIND_ICONS, SHAPE_KIND_DEFINITIONS, activeToolPresentation, toolDefinitions } from './editor-tools'

class MockTextCanvasContext {
  font = ''
  textBaseline: CanvasTextBaseline = 'alphabetic'
  fillStyle: string | CanvasGradient | CanvasPattern = ''
  measureText(text: string): TextMetrics { return { width: text.length * 6, actualBoundingBoxAscent: 8, actualBoundingBoxDescent: 2 } as TextMetrics }
  fillText(): void {}
  getImageData(_x: number, _y: number, width: number, height: number): ImageData { return { data: new Uint8ClampedArray(width * height * 4), width, height, colorSpace: 'srgb' } as ImageData }
}

class MockTextCanvas {
  private readonly context = new MockTextCanvasContext()
  constructor(public width: number, public height: number) {}
  getContext(): MockTextCanvasContext { return this.context }
}

beforeEach(() => {
  vi.stubGlobal('OffscreenCanvas', MockTextCanvas)
  localStorage.clear()
  useWorkspace.setState({ sessions: [], activeId: null, message: null, dialog: null })
  useWorkspace.getState().addSession(createDocument('tool rail', 2, 2, 'rgba'))
})

afterEach(cleanup)

describe('EditorToolRail', () => {
  it('keeps every child-tool icon mounted for immediate decoding', () => {
    const { container } = render(<EditorToolRail side="left" onGripPointerDown={vi.fn()} />)
    const preloaded = [...container.querySelectorAll<HTMLElement>('.tool-icon-preload .pixel-asset-icon')].map((icon) => icon.style.getPropertyValue('--pixel-icon-source'))

    expect(preloaded).toHaveLength(ALL_EDITOR_TOOL_ICONS.length)
    expect(preloaded).toEqual(expect.arrayContaining(ALL_EDITOR_TOOL_ICONS.map((source) => `url("${source}")`)))
  })

  it('updates the main tool button in the same click that selects a child tool', () => {
    render(<EditorToolRail side="left" onGripPointerDown={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: '矩形框选工具' }))
    fireEvent.click(screen.getByRole('button', { name: '多边形套索工具' }))
    const polygonButton = screen.getByRole('button', { name: '多边形套索工具' })
    expect(polygonButton.querySelector('.pixel-asset-icon')).toHaveStyle({ '--pixel-icon-source': `url("${SELECTION_KIND_ICONS['polygon-lasso']}")` })

    fireEvent.click(screen.getByRole('button', { name: '矩形填充工具' }))
    fireEvent.click(screen.getByRole('button', { name: '椭圆工具' }))
    const ellipseButton = screen.getByRole('button', { name: '椭圆工具' })
    expect(ellipseButton.querySelector('.pixel-asset-icon')).toHaveStyle({ '--pixel-icon-source': `url("${SHAPE_KIND_DEFINITIONS.find((item) => item.id === 'ellipse-outline')?.icon}")` })
  })

  it('disables raster editing tools while a text layer is selected', () => {
    useWorkspace.getState().createTextLayer({
      text: 'Moon', fontFamily: 'Consolas', fontSize: 16, lineSpacing: 0, letterSpacing: 0,
      spacingMode: 'font', antialias: 'pixel', color: { r: 0, g: 0, b: 0, a: 255 }
    }, 0, 0)
    render(<EditorToolRail side="left" onGripPointerDown={vi.fn()} />)
    const labels = Object.fromEntries(toolDefinitions('zh-CN').map((tool) => [tool.id, tool.label]))
    const selectionLabel = activeToolPresentation('selection', 'rectangle', 'rectangle', 'zh-CN', 'bucket', 'line', 'move').label

    expect(screen.getByRole('button', { name: selectionLabel })).toBeDisabled()
    expect(screen.getByRole('button', { name: labels.pencil })).toBeDisabled()
    expect(screen.getByRole('button', { name: labels.text })).toBeEnabled()
    expect(screen.getByRole('button', { name: labels.move })).toBeEnabled()
  })

  it('shows Move as selected only while the temporary Move modifier is held', () => {
    render(<EditorToolRail side="left" onGripPointerDown={vi.fn()} />)
    const labels = Object.fromEntries(toolDefinitions('zh-CN').map((tool) => [tool.id, tool.label]))
    const pencil = screen.getByRole('button', { name: labels.pencil })
    const move = screen.getByRole('button', { name: labels.move })

    expect(pencil).toHaveClass('selected')
    expect(move).not.toHaveClass('selected')
    fireEvent.keyDown(window, { key: 'Control', ctrlKey: true })
    expect(pencil).not.toHaveClass('selected')
    expect(move).toHaveClass('selected')
    fireEvent.keyUp(window, { key: 'Control', ctrlKey: false })
    expect(pencil).toHaveClass('selected')
    expect(move).not.toHaveClass('selected')
  })

  it('keeps Move selected when another modifier is pressed after Ctrl', () => {
    useWorkspace.getState().setTool('move')
    useWorkspace.getState().setMoveKind('slice')
    render(<EditorToolRail side="left" onGripPointerDown={vi.fn()} />)
    const labels = Object.fromEntries(toolDefinitions('zh-CN').map((tool) => [tool.id, tool.label]))
    const sliceLabel = activeToolPresentation('move', 'rectangle', 'rectangle', 'zh-CN', 'bucket', 'line', 'slice').label
    const slice = screen.getByRole('button', { name: sliceLabel })

    fireEvent.keyDown(window, { key: 'Control', ctrlKey: true })
    const move = screen.getByRole('button', { name: labels.move })
    expect(move).toHaveClass('selected')
    fireEvent.keyDown(window, { key: 'Alt', ctrlKey: true, altKey: true })
    expect(move).toHaveClass('selected')
    fireEvent.keyUp(window, { key: 'Alt', ctrlKey: true, altKey: false })
    expect(move).toHaveClass('selected')
    fireEvent.keyUp(window, { key: 'Control', ctrlKey: false })
    expect(screen.getByRole('button', { name: sliceLabel })).toHaveClass('selected')
  })
})
