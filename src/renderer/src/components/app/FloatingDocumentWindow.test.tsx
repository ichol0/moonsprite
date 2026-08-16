import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '@/components/I18nProvider'
import { createDocument } from '@/core/document'
import { useWorkspace } from '@/store/workspace'
import { FloatingDocumentWindow } from './FloatingDocumentWindow'

vi.mock('@/components/CanvasStage', () => ({
  CanvasStage: ({ session }: { session: { document: { id: string } } }) => <div data-canvas-document-id={session.document.id} />
}))

afterEach(() => {
  cleanup()
  useWorkspace.setState({ sessions: [], activeId: null })
  vi.restoreAllMocks()
})

describe('FloatingDocumentWindow', () => {
  it('uses the shared floating resize handles and can return to the project tabs', () => {
    const project = createDocument('floating project', 8, 8, 'rgba')
    useWorkspace.getState().addSession(project)
    const session = useWorkspace.getState().sessions[0]
    if (!session) throw new Error('Expected a document session')
    const onActivate = vi.fn()
    const onPinnedChange = vi.fn()
    const onReturnToTabs = vi.fn()

    const view = render(<I18nProvider><FloatingDocumentWindow session={session} initialPosition={{ x: 80, y: 60, width: 480, height: 360 }} pinned={false} stackIndex={2} onActivate={onActivate} onPinnedChange={onPinnedChange} onReturnToTabs={onReturnToTabs} onCloseDocument={vi.fn()} shortcutFor={() => ''} onToggleMirror={vi.fn()} onOpenPreferences={vi.fn()} /></I18nProvider>)

    const floatingWindow = document.querySelector<HTMLElement>('.floating-document-window')
    const pinButton = floatingWindow?.querySelector<HTMLButtonElement>('.floating-document-pin')
    const returnButton = [...floatingWindow?.querySelectorAll<HTMLButtonElement>('header > button') ?? []].find((button) => button !== pinButton)
    if (!floatingWindow || !pinButton || !returnButton) throw new Error('Floating project window was not rendered')
    expect(floatingWindow.querySelectorAll('.floating-resize-handle')).toHaveLength(8)
    expect(floatingWindow.querySelectorAll('.quick-command-bar')).toHaveLength(1)
    expect(floatingWindow).toHaveStyle({ left: '80px', top: '60px', width: '480px', height: '360px', zIndex: '183' })

    fireEvent.pointerDown(floatingWindow, { button: 0, pointerId: 4 })
    expect(onActivate).toHaveBeenCalledWith(project.id)
    fireEvent.click(pinButton)
    expect(onPinnedChange).toHaveBeenCalledWith(project.id, true)
    fireEvent.click(returnButton)
    expect(onReturnToTabs).toHaveBeenCalledWith(project.id)

    view.rerender(<I18nProvider><FloatingDocumentWindow session={session} initialPosition={{ x: 80, y: 60, width: 480, height: 360 }} pinned stackIndex={2} onActivate={onActivate} onPinnedChange={onPinnedChange} onReturnToTabs={onReturnToTabs} onCloseDocument={vi.fn()} shortcutFor={() => ''} onToggleMirror={vi.fn()} onOpenPreferences={vi.fn()} /></I18nProvider>)
    expect(document.querySelector('.floating-document-window')).toHaveClass('pinned')
    expect(document.querySelector('.floating-document-window')).toHaveStyle({ zIndex: '10022' })
  })

  it('returns to the tab strip at the pointer insertion position after a title drag', () => {
    const project = createDocument('floating project', 8, 8, 'rgba')
    useWorkspace.getState().addSession(project)
    const session = useWorkspace.getState().sessions[0]
    if (!session) throw new Error('Expected a document session')
    const onReturnToTabs = vi.fn()

    render(<><div className="tab-strip"><button className="document-tab">first</button><button className="document-tab">second</button></div><I18nProvider><FloatingDocumentWindow session={session} initialPosition={{ x: 80, y: 60, width: 480, height: 360 }} pinned={false} stackIndex={0} onActivate={vi.fn()} onPinnedChange={vi.fn()} onReturnToTabs={onReturnToTabs} onCloseDocument={vi.fn()} shortcutFor={() => ''} onToggleMirror={vi.fn()} onOpenPreferences={vi.fn()} /></I18nProvider></>)

    const tabStrip = document.querySelector<HTMLElement>('.tab-strip')
    const tabs = [...document.querySelectorAll<HTMLButtonElement>('.document-tab')]
    const header = document.querySelector<HTMLElement>('.floating-document-window > header')
    if (!tabStrip || tabs.length !== 2 || !header) throw new Error('Expected floating title and project tabs')
    vi.spyOn(tabStrip, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, right: 300, bottom: 40, width: 300, height: 40, x: 0, y: 0, toJSON: () => ({}) })
    vi.spyOn(tabs[0], 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, right: 100, bottom: 40, width: 100, height: 40, x: 0, y: 0, toJSON: () => ({}) })
    vi.spyOn(tabs[1], 'getBoundingClientRect').mockReturnValue({ left: 100, top: 0, right: 200, bottom: 40, width: 100, height: 40, x: 100, y: 0, toJSON: () => ({}) })
    Object.assign(header, { setPointerCapture: vi.fn(), hasPointerCapture: vi.fn(() => false), releasePointerCapture: vi.fn() })

    fireEvent.pointerDown(header, { button: 0, pointerId: 7, clientX: 120, clientY: 70 })
    fireEvent.pointerMove(window, { pointerId: 7, clientX: 120, clientY: 20 })

    expect(document.querySelector('.floating-document-tab-return-preview')).toHaveStyle({ left: '99px', top: '3px', height: '34px' })
    expect(document.querySelector('.floating-document-window')).toHaveClass('returning-to-tabs')
    expect(document.querySelector('.floating-document-window')).toHaveAttribute('aria-hidden', 'true')
    expect(document.querySelector('.floating-document-tab-ghost')).toHaveTextContent('floating project')
    expect(document.querySelector('.floating-document-tab-ghost')).toHaveClass('document-tab-drag-ghost')
    expect(document.querySelector('.floating-document-tab-ghost')).not.toHaveClass('active')

    fireEvent.pointerMove(window, { pointerId: 7, clientX: 320, clientY: 60 })
    expect(document.querySelector('.floating-document-window')).not.toHaveClass('returning-to-tabs')
    expect(document.querySelector('.floating-document-window')).not.toHaveAttribute('aria-hidden')
    expect(document.querySelector('.floating-document-tab-ghost')).not.toBeInTheDocument()

    fireEvent.pointerMove(window, { pointerId: 7, clientX: 280, clientY: 20 })
    expect(document.querySelector('.floating-document-window')).toHaveClass('returning-to-tabs')
    expect(document.querySelector('.floating-document-tab-return-preview')).toHaveStyle({ left: '199px' })
    fireEvent.pointerUp(window, { pointerId: 7, clientX: 280, clientY: 20 })
    expect(onReturnToTabs).toHaveBeenCalledWith(project.id, 2)
    expect(document.querySelector('.floating-document-tab-return-preview')).not.toBeInTheDocument()
    expect(document.querySelector('.floating-document-tab-ghost')).not.toBeInTheDocument()
  })
})
