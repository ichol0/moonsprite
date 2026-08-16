import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createDocument } from '@/core/document'
import { loadEditorPreferences, saveEditorPreferences } from '@/core/file-preferences'
import { useWorkspace } from '@/store/workspace'
import { QuickCommandBar } from './QuickCommandBar'

let documentId = ''

beforeEach(() => {
  localStorage.clear()
  useWorkspace.setState({ sessions: [], activeId: null, message: null, dialog: null })
  const document = createDocument('quick commands', 4, 4, 'rgba')
  documentId = document.id
  useWorkspace.getState().addSession(document)
})

afterEach(() => {
  cleanup()
  localStorage.clear()
  vi.restoreAllMocks()
})

describe('QuickCommandBar', () => {
  it('starts collapsed and exposes the existing commands in one expanded row', () => {
    const onToggleMirror = vi.fn()
    render(<QuickCommandBar documentId={documentId} shortcutFor={() => ''} onToggleMirror={onToggleMirror} onOpenPreferences={vi.fn()} />)

    expect(screen.getByRole('toolbar', { name: '快捷指令栏' })).toHaveClass('translucent')
    expect(screen.getByRole('button', { name: '展开快捷指令栏' })).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('button', { name: '水平镜像选中' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '展开快捷指令栏' }))

    expect(screen.getByRole('button', { name: '水平镜像选中' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '垂直镜像选中' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '反选' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '查看相对明暗' })).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(screen.getByRole('button', { name: '水平镜像画布' }))
    expect(onToggleMirror).toHaveBeenCalledWith('horizontal')

    const grid = screen.getByRole('button', { name: '自定义网格' })
    expect(grid).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(grid)
    expect(useWorkspace.getState().sessions[0].view.showGrid).toBe(true)
    expect(grid).toHaveAttribute('aria-pressed', 'true')
  })

  it('enables selection commands when a canvas selection exists', () => {
    useWorkspace.getState().setSelection({ x: 0, y: 0, width: 2, height: 2 })
    render(<QuickCommandBar documentId={documentId} shortcutFor={() => ''} onToggleMirror={vi.fn()} onOpenPreferences={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: '展开快捷指令栏' }))

    expect(screen.getByRole('button', { name: '水平镜像选中' })).toBeEnabled()
    expect(screen.getByRole('button', { name: '垂直镜像选中' })).toBeEnabled()
    expect(screen.getByRole('button', { name: '反选' })).toBeEnabled()
  })

  it('temporarily hides an expanded bar and restores it when canvas focus returns', () => {
    const other = createDocument('other project', 4, 4, 'rgba')
    useWorkspace.getState().addSession(other)
    useWorkspace.getState().setActive(documentId)
    render(<QuickCommandBar documentId={documentId} shortcutFor={() => ''} onToggleMirror={vi.fn()} onOpenPreferences={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: '展开快捷指令栏' }))
    expect(screen.getByRole('button', { name: '水平镜像画布' })).toBeInTheDocument()

    act(() => useWorkspace.getState().setActive(other.id))

    expect(screen.getByRole('button', { name: '展开快捷指令栏' })).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('button', { name: '水平镜像画布' })).not.toBeInTheDocument()
    expect(useWorkspace.getState().sessions.find((session) => session.document.id === documentId)?.view.quickCommandBarExpanded).toBe(true)

    act(() => useWorkspace.getState().setActive(documentId))

    expect(screen.getByRole('button', { name: '折叠快捷指令栏' })).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('button', { name: '水平镜像画布' })).toBeInTheDocument()
  })

  it('uses the configured button visibility and order', () => {
    const current = loadEditorPreferences()
    saveEditorPreferences({
      ...current,
      quickCommandPreferences: [
        { id: 'resetView', enabled: true },
        { id: 'pixelGrid', enabled: true },
        ...current.quickCommandPreferences.filter((item) => item.id !== 'resetView' && item.id !== 'pixelGrid').map((item) => ({ ...item, enabled: false }))
      ]
    })
    render(<QuickCommandBar documentId={documentId} shortcutFor={() => ''} onToggleMirror={vi.fn()} onOpenPreferences={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: '展开快捷指令栏' }))

    expect([...document.querySelectorAll<HTMLButtonElement>('.quick-command-actions .quick-command-button:not(.quick-command-settings):not(.quick-command-move)')].map((button) => button.getAttribute('aria-label'))).toEqual(['重置视图', '像素网格'])
  })

  it('hides the entire control when disabled in preferences', () => {
    render(<QuickCommandBar documentId={documentId} shortcutFor={() => ''} onToggleMirror={vi.fn()} onOpenPreferences={vi.fn()} />)
    expect(screen.getByRole('toolbar', { name: '快捷指令栏' })).toBeInTheDocument()

    act(() => {
      saveEditorPreferences({ ...loadEditorPreferences(), quickCommandBarEnabled: false })
      window.dispatchEvent(new Event('moonsprite:preferences-changed'))
    })

    expect(screen.queryByRole('toolbar', { name: '快捷指令栏' })).not.toBeInTheDocument()
  })

  it('keeps the bar fully opaque when translucent display is disabled', () => {
    render(<QuickCommandBar documentId={documentId} shortcutFor={() => ''} onToggleMirror={vi.fn()} onOpenPreferences={vi.fn()} />)
    expect(screen.getByRole('toolbar', { name: '快捷指令栏' })).toHaveClass('translucent')

    act(() => {
      saveEditorPreferences({ ...loadEditorPreferences(), quickCommandBarTranslucent: false })
      window.dispatchEvent(new Event('moonsprite:preferences-changed'))
    })

    expect(screen.getByRole('toolbar', { name: '快捷指令栏' })).not.toHaveClass('translucent')
  })

  it('opens related settings on right click and includes the hint in descriptions', async () => {
    const onOpenCommandSettings = vi.fn()
    render(<QuickCommandBar documentId={documentId} shortcutFor={() => ''} onToggleMirror={vi.fn()} onOpenPreferences={vi.fn()} onOpenCommandSettings={onOpenCommandSettings} />)
    fireEvent.click(screen.getByRole('button', { name: '展开快捷指令栏' }))

    const customGrid = screen.getByRole('button', { name: '自定义网格' })
    const tooltipAnchor = customGrid.closest('.moon-tooltip-anchor')
    if (!tooltipAnchor) throw new Error('Custom grid tooltip anchor was not rendered')
    fireEvent.pointerEnter(tooltipAnchor)
    expect(await screen.findByRole('tooltip')).toHaveTextContent('右键按钮可直接打开自定义网格设置')

    fireEvent.contextMenu(customGrid)
    expect(onOpenCommandSettings).toHaveBeenLastCalledWith('grid')
    fireEvent.contextMenu(screen.getByRole('button', { name: '查看相对明暗' }))
    expect(onOpenCommandSettings).toHaveBeenLastCalledWith('appearance')
  })

  it('keeps settings before the fixed trailing move button', () => {
    const onOpenPreferences = vi.fn()
    render(<QuickCommandBar documentId={documentId} shortcutFor={() => ''} onToggleMirror={vi.fn()} onOpenPreferences={onOpenPreferences} />)

    fireEvent.click(screen.getByRole('button', { name: '展开快捷指令栏' }))
    const buttons = [...document.querySelectorAll<HTMLButtonElement>('.quick-command-actions .quick-command-button')]
    expect(buttons.at(-2)).toHaveAttribute('aria-label', '设置快捷指令栏')
    expect(buttons.at(-1)).toHaveAttribute('aria-label', '移动快捷指令栏')
    fireEvent.click(screen.getByRole('button', { name: '设置快捷指令栏' }))

    expect(onOpenPreferences).toHaveBeenCalledTimes(1)
  })

  it('moves horizontally while the trailing move button is held and clamps to the canvas', () => {
    render(<QuickCommandBar documentId={documentId} shortcutFor={() => ''} onToggleMirror={vi.fn()} onOpenPreferences={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: '展开快捷指令栏' }))

    const toolbar = screen.getByRole('toolbar', { name: '快捷指令栏' })
    const container = toolbar.parentElement
    if (!container) throw new Error('Quick command bar container was not rendered')
    vi.spyOn(container, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 0, left: 0, top: 0, right: 400, bottom: 200, width: 400, height: 200, toJSON: () => ({}) } as DOMRect)
    vi.spyOn(toolbar, 'getBoundingClientRect').mockReturnValue({ x: 100, y: 4, left: 100, top: 4, right: 300, bottom: 36, width: 200, height: 32, toJSON: () => ({}) } as DOMRect)

    const move = screen.getByRole('button', { name: '移动快捷指令栏' })
    fireEvent.pointerDown(move, { button: 0, pointerId: 7, clientX: 200 })
    expect(toolbar).toHaveClass('moving')
    fireEvent.pointerMove(move, { pointerId: 7, clientX: 208 })
    expect(parseFloat(toolbar.style.getPropertyValue('--quick-command-position-x'))).toBeCloseTo(50)
    fireEvent.pointerMove(move, { pointerId: 7, clientX: 260 })
    expect(parseFloat(toolbar.style.getPropertyValue('--quick-command-position-x'))).toBeCloseTo(65)
    fireEvent.pointerMove(move, { pointerId: 7, clientX: 500 })
    expect(parseFloat(toolbar.style.getPropertyValue('--quick-command-position-x'))).toBeCloseTo(73)
    fireEvent.pointerUp(move, { button: 0, pointerId: 7, clientX: 500 })
    expect(toolbar).not.toHaveClass('moving')
    expect(useWorkspace.getState().sessions[0].view.quickCommandBarPositionX).toBeCloseTo(0.73)
  })

  it('grows inward when commands are added while the bar is touching either canvas edge', () => {
    const current = loadEditorPreferences()
    const initialPreferences = {
      ...current,
      quickCommandPreferences: current.quickCommandPreferences.map((item) => ({ ...item, enabled: item.id === 'resetView' }))
    }
    saveEditorPreferences(initialPreferences)
    useWorkspace.getState().setViewForDocument(documentId, { quickCommandBarPositionX: 0.15 })
    render(<QuickCommandBar documentId={documentId} shortcutFor={() => ''} onToggleMirror={vi.fn()} onOpenPreferences={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: '展开快捷指令栏' }))

    const toolbar = screen.getByRole('toolbar', { name: '快捷指令栏' })
    const container = toolbar.parentElement
    if (!container) throw new Error('Quick command bar container was not rendered')
    vi.spyOn(container, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 0, left: 0, top: 0, right: 400, bottom: 200, width: 400, height: 200, toJSON: () => ({}) } as DOMRect)
    const toolbarRect = vi.spyOn(toolbar, 'getBoundingClientRect')

    toolbarRect.mockReturnValue({ x: 8, y: 4, left: 8, top: 4, right: 248, bottom: 36, width: 240, height: 32, toJSON: () => ({}) } as DOMRect)
    act(() => {
      saveEditorPreferences({ ...initialPreferences, quickCommandPreferences: initialPreferences.quickCommandPreferences.map((item) => ({ ...item, enabled: item.id === 'resetView' || item.id === 'pixelGrid' })) })
      window.dispatchEvent(new Event('moonsprite:preferences-changed'))
    })
    expect(toolbar.style.getPropertyValue('--quick-command-position-x')).toBe('15%')
    expect(toolbar.style.getPropertyValue('--quick-command-edge-offset-x')).toBe('68px')

    act(() => {
      useWorkspace.getState().setViewForDocument(documentId, { quickCommandBarPositionX: 0.85 })
    })
    toolbarRect.mockReturnValue({ x: 124, y: 4, left: 124, top: 4, right: 392, bottom: 36, width: 268, height: 32, toJSON: () => ({}) } as DOMRect)
    act(() => {
      saveEditorPreferences({ ...initialPreferences, quickCommandPreferences: initialPreferences.quickCommandPreferences.map((item) => ({ ...item, enabled: item.id === 'resetView' || item.id === 'pixelGrid' || item.id === 'undo' })) })
      window.dispatchEvent(new Event('moonsprite:preferences-changed'))
    })
    expect(toolbar.style.getPropertyValue('--quick-command-position-x')).toBe('85%')
    expect(toolbar.style.getPropertyValue('--quick-command-edge-offset-x')).toBe('-82px')
  })

  it('restores the saved horizontal percentage after the bar is remounted', () => {
    useWorkspace.getState().setViewForDocument(documentId, { quickCommandBarPositionX: 0.275 })
    const firstRender = render(<QuickCommandBar documentId={documentId} shortcutFor={() => ''} onToggleMirror={vi.fn()} onOpenPreferences={vi.fn()} />)
    expect(screen.getByRole('toolbar', { name: '快捷指令栏' }).style.getPropertyValue('--quick-command-position-x')).toBe('27.5%')

    firstRender.unmount()
    render(<QuickCommandBar documentId={documentId} shortcutFor={() => ''} onToggleMirror={vi.fn()} onOpenPreferences={vi.fn()} />)
    expect(screen.getByRole('toolbar', { name: '快捷指令栏' }).style.getPropertyValue('--quick-command-position-x')).toBe('27.5%')
  })

  it('uses the dedicated SVG icons for selection and view commands', () => {
    const current = loadEditorPreferences()
    const iconKinds = new Map([
      ['selectAll', 'selectAll'],
      ['deselect', 'deselect'],
      ['selectionOutline', 'selectionOutline'],
      ['invertSelection', 'invertSelection'],
      ['resetView', 'resetView'],
      ['deleteSelection', 'deleteSelection'],
      ['rotateViewClockwise90', 'rotateClockwise90'],
      ['rotateViewCounterClockwise90', 'rotateCounterClockwise90']
    ])
    saveEditorPreferences({
      ...current,
      quickCommandPreferences: current.quickCommandPreferences.map((item) => ({ ...item, enabled: iconKinds.has(item.id) }))
    })
    render(<QuickCommandBar documentId={documentId} shortcutFor={() => ''} onToggleMirror={vi.fn()} onOpenPreferences={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: '展开快捷指令栏' }))

    for (const [commandId, iconKind] of iconKinds) {
      const button = document.querySelector<HTMLButtonElement>(`.quick-command-button [data-pixel-icon="${iconKind}"]`)?.closest<HTMLButtonElement>('button')
      expect(button, commandId).toBeInTheDocument()
    }
  })

  it('exposes additional optional commands and runs view rotation for the owning project', () => {
    const current = loadEditorPreferences()
    const enabled = new Set(['fillForeground', 'deleteSelection', 'swapForegroundBackground', 'createBrushFromSelection', 'rotateViewClockwise90', 'rotateViewCounterClockwise90'])
    saveEditorPreferences({
      ...current,
      quickCommandPreferences: current.quickCommandPreferences.map((item) => ({ ...item, enabled: enabled.has(item.id) }))
    })
    render(<QuickCommandBar documentId={documentId} shortcutFor={() => ''} onToggleMirror={vi.fn()} onOpenPreferences={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: '展开快捷指令栏' }))

    expect(screen.getByRole('button', { name: '填充前景色' })).toBeEnabled()
    expect(screen.getByRole('button', { name: '删除选区内容' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '从选区创建笔刷' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: '顺时针旋转视图 90°' }))
    expect(useWorkspace.getState().sessions[0].view.rotation).toBe(90)
    fireEvent.click(screen.getByRole('button', { name: '逆时针旋转视图 90°' }))
    expect(useWorkspace.getState().sessions[0].view.rotation).toBe(0)
  })
})
