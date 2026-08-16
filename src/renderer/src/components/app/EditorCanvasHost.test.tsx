import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '@/components/I18nProvider'
import { createDocument } from '@/core/document'
import { createDocumentPaneLayout, insertDocumentPane } from '@/core/document-pane-layout'
import { useWorkspace } from '@/store/workspace'
import { EditorCanvasHost } from './EditorCanvasHost'

vi.mock('@/components/CanvasStage', () => ({
  CanvasStage: ({ session }: { session: { document: { id: string } } }) => <div data-canvas-document-id={session.document.id} />
}))

afterEach(() => {
  cleanup()
  const patchedDocument = document as unknown as { elementFromPoint?: typeof document.elementFromPoint }
  delete patchedDocument.elementFromPoint
  document.documentElement.classList.remove('document-pane-dragging')
  useWorkspace.setState({ sessions: [], activeId: null })
  vi.restoreAllMocks()
})

describe('EditorCanvasHost', () => {
  it('keeps the source pane visible and shows a project-tab ghost until a pane move is committed', async () => {
    const target = createDocument('target project', 8, 8, 'rgba')
    const source = createDocument('source project', 8, 8, 'rgba')
    useWorkspace.getState().addSession(target)
    useWorkspace.getState().addSession(source)
    useWorkspace.getState().setActive(target.id)
    const layout = insertDocumentPane(createDocumentPaneLayout(target.id), target.id, source.id, 'right')
    const onDocumentPaneMove = vi.fn()

    render(<I18nProvider><EditorCanvasHost documentPaneLayout={layout} workspaceDocumentId={target.id} paneOnlyDocumentIds={[source.id]} onDocumentPaneLayoutChange={vi.fn()} onDocumentPaneMove={onDocumentPaneMove} onDocumentPaneReturnToTabs={vi.fn()} shortcutFor={() => ''} onToggleMirror={vi.fn()} onOpenPreferences={vi.fn()} /></I18nProvider>)

    await waitFor(() => expect(document.querySelectorAll<HTMLElement>('.document-pane')).toHaveLength(2))
    expect(document.querySelectorAll<HTMLElement>('.quick-command-bar')).toHaveLength(2)
    const panes = [...document.querySelectorAll<HTMLElement>('.document-pane')]
    const targetPane = panes.find((pane) => pane.dataset.documentPaneId === target.id)
    const sourcePane = panes.find((pane) => pane.dataset.documentPaneId === source.id)
    if (!targetPane || !sourcePane) throw new Error('Expected both document panes')
    const sourceHeader = sourcePane.querySelector<HTMLElement>(':scope > header')
    const targetCanvas = targetPane.querySelector<HTMLElement>(':scope > .document-pane-canvas')
    const sourceCanvas = sourcePane.querySelector<HTMLElement>(':scope > .document-pane-canvas')
    const stage = document.querySelector<HTMLElement>('.stage-wrap')
    if (!sourceHeader || !targetCanvas || !sourceCanvas || !stage) throw new Error('Expected pane drag surfaces')

    expect(targetPane).toHaveClass('main-tab-pane')
    expect(targetPane.querySelector(':scope > header')).toBeNull()
    expect(sourceHeader).toHaveTextContent('source project')

    vi.spyOn(targetPane, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 40, right: 600, bottom: 440, width: 600, height: 400, x: 0, y: 40, toJSON: () => ({}) })
    vi.spyOn(sourceHeader, 'getBoundingClientRect').mockReturnValue({ left: 600, top: 40, right: 800, bottom: 69, width: 200, height: 29, x: 600, y: 40, toJSON: () => ({}) })
    Object.assign(stage, { setPointerCapture: vi.fn(), hasPointerCapture: vi.fn(() => false), releasePointerCapture: vi.fn() })
    Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: vi.fn(() => targetPane) })

    fireEvent.pointerDown(sourceHeader, { button: 0, pointerId: 41, clientX: 700, clientY: 54 })
    fireEvent.pointerMove(window, { pointerId: 41, clientX: 100, clientY: 220 })

    expect(document.querySelectorAll<HTMLElement>('.document-pane')).toHaveLength(2)
    expect(sourcePane).toContainElement(sourceCanvas)
    expect(targetCanvas).toHaveAttribute('data-document-pane-dock-preview', 'left')
    expect(sourceCanvas).not.toHaveAttribute('data-document-pane-dock-preview')
    expect(document.querySelector('[data-document-pane-drag-ghost="true"]')).toHaveTextContent('source project')

    fireEvent.pointerUp(window, { pointerId: 41, clientX: 100, clientY: 220 })

    expect(onDocumentPaneMove).toHaveBeenCalledWith(source.id, target.id, 'left')
    expect(targetCanvas).not.toHaveAttribute('data-document-pane-dock-preview')
    expect(document.querySelector('[data-document-pane-drag-ghost="true"]')).not.toBeInTheDocument()
  })

  it('offers floating a merged project from its pane title menu', async () => {
    const target = createDocument('target project', 8, 8, 'rgba')
    const source = createDocument('source project', 8, 8, 'rgba')
    useWorkspace.getState().addSession(target)
    useWorkspace.getState().addSession(source)
    useWorkspace.getState().setActive(target.id)
    const layout = insertDocumentPane(createDocumentPaneLayout(target.id), target.id, source.id, 'right')
    const onDocumentPaneFloat = vi.fn()

    render(<I18nProvider><EditorCanvasHost documentPaneLayout={layout} workspaceDocumentId={target.id} paneOnlyDocumentIds={[source.id]} onDocumentPaneLayoutChange={vi.fn()} onDocumentPaneMove={vi.fn()} onDocumentPaneReturnToTabs={vi.fn()} onDocumentPaneFloat={onDocumentPaneFloat} shortcutFor={() => ''} onToggleMirror={vi.fn()} onOpenPreferences={vi.fn()} /></I18nProvider>)

    await waitFor(() => expect(document.querySelectorAll<HTMLElement>('.document-pane')).toHaveLength(2))
    const sourcePane = [...document.querySelectorAll<HTMLElement>('.document-pane')].find((pane) => pane.dataset.documentPaneId === source.id)
    const sourceHeader = sourcePane?.querySelector<HTMLElement>(':scope > header')
    if (!sourceHeader) throw new Error('Expected a pane title for the merged project')

    fireEvent.contextMenu(sourceHeader, { clientX: 220, clientY: 120 })
    const floatItem = document.querySelector<HTMLButtonElement>('.document-pane-context-menu .context-menu-item')
    if (!floatItem) throw new Error('Expected the pane context menu')
    fireEvent.click(floatItem)

    expect(onDocumentPaneFloat).toHaveBeenCalledWith(source.id, { x: 220, y: 120 })
  })
})
