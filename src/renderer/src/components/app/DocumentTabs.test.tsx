import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '@/components/I18nProvider'
import { createDocument } from '@/core/document'
import { useWorkspace } from '@/store/workspace'
import { DocumentTabs } from './DocumentTabs'

afterEach(() => {
  cleanup()
  document.querySelector('.stage-wrap')?.remove()
  const patchedDocument = document as unknown as { elementFromPoint?: typeof document.elementFromPoint }
  delete patchedDocument.elementFromPoint
  useWorkspace.setState({ sessions: [], activeId: null })
  vi.restoreAllMocks()
})

describe('DocumentTabs', () => {
  it('opens a project on a click without capturing the pointer', () => {
    const first = createDocument('first project', 2, 2, 'rgba')
    useWorkspace.getState().addSession(first)
    const onActivate = vi.fn()
    render(<div className="tab-strip"><I18nProvider><DocumentTabs homeOpen={false} hiddenDocumentIds={[]} onNew={vi.fn()} onActivate={onActivate} onContextActivate={vi.fn()} onSplitPreview={vi.fn()} onSplit={vi.fn()} /></I18nProvider></div>)
    const tabStrip = document.querySelector<HTMLElement>('.tab-strip')
    const firstTab = document.querySelector<HTMLButtonElement>('.document-tab')
    if (!tabStrip || !firstTab) throw new Error('Project tab was not rendered')
    const setPointerCapture = vi.fn()
    Object.assign(tabStrip, { setPointerCapture, hasPointerCapture: vi.fn(() => false), releasePointerCapture: vi.fn() })

    fireEvent.pointerDown(firstTab, { button: 0, pointerId: 11, clientX: 20, clientY: 16 })
    expect(setPointerCapture).not.toHaveBeenCalled()
    expect(document.documentElement).not.toHaveClass('document-tabs-dragging')
    fireEvent.pointerUp(firstTab, { pointerId: 11, clientX: 20, clientY: 16 })
    fireEvent.click(firstTab)

    expect(onActivate).toHaveBeenCalledOnce()
    expect(onActivate).toHaveBeenCalledWith(first.id)
  })

  it('keeps a tab drag active after leaving the tab strip', async () => {
    const first = createDocument('first project', 2, 2, 'rgba')
    const second = createDocument('second project', 2, 2, 'rgba')
    useWorkspace.getState().addSession(first)
    useWorkspace.getState().addSession(second)
    useWorkspace.getState().setActive(first.id)
    const onSplit = vi.fn()
    const stage = document.createElement('div')
    stage.className = 'stage-wrap'
    stage.dataset.documentPaneId = first.id
    document.body.append(stage)
    vi.spyOn(stage, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600, x: 0, y: 0, toJSON: () => ({}) })
    Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: vi.fn(() => stage) })

    const onSplitPreview = vi.fn()
    render(<I18nProvider><DocumentTabs homeOpen={false} hiddenDocumentIds={[]} onNew={vi.fn()} onActivate={vi.fn()} onContextActivate={vi.fn()} onSplitPreview={onSplitPreview} onSplit={onSplit} /></I18nProvider>)
    const tabs = [...document.querySelectorAll<HTMLButtonElement>('.document-tab')]
    const secondTab = tabs.find((tab) => tab.textContent?.includes('second project'))
    if (!secondTab) throw new Error('Second project tab was not rendered')
    Object.assign(secondTab, { setPointerCapture: vi.fn(), hasPointerCapture: vi.fn(() => false), releasePointerCapture: vi.fn() })

    fireEvent.pointerDown(secondTab, { button: 0, pointerId: 12, clientX: 20, clientY: 16 })
    fireEvent.pointerMove(window, { pointerId: 12, clientX: 790, clientY: 300 })
    expect(document.querySelector('.document-tab-drag-ghost')).toBeInTheDocument()
    expect(secondTab).toHaveClass('detached')
    expect(onSplitPreview).toHaveBeenCalledWith({ documentId: second.id, targetPaneId: first.id, direction: 'right' })
    fireEvent.pointerUp(window, { pointerId: 12, clientX: 790, clientY: 300 })

    await waitFor(() => expect(onSplit).toHaveBeenCalledWith(second.id, first.id, 'right'))
    expect(onSplitPreview).toHaveBeenLastCalledWith(null)
    expect(secondTab).not.toHaveClass('detached')
  })

  it('docks when entering a pane diagonally from outside its edge', async () => {
    const first = createDocument('first project', 2, 2, 'rgba')
    const second = createDocument('second project', 2, 2, 'rgba')
    useWorkspace.getState().addSession(first)
    useWorkspace.getState().addSession(second)
    useWorkspace.getState().setActive(first.id)
    const stage = document.createElement('div')
    stage.className = 'stage-wrap'
    stage.dataset.documentPaneId = first.id
    document.body.append(stage)
    let stageRect = { left: 340, top: 136, right: 980, bottom: 620, width: 640, height: 484, x: 340, y: 136, toJSON: () => ({}) }
    vi.spyOn(stage, 'getBoundingClientRect').mockImplementation(() => stageRect)
    const sidebar = document.createElement('aside')
    document.body.append(sidebar)
    Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: vi.fn(() => sidebar) })

    const onSplitPreview = vi.fn()
    render(<I18nProvider><DocumentTabs homeOpen={false} hiddenDocumentIds={[]} onNew={vi.fn()} onActivate={vi.fn()} onContextActivate={vi.fn()} onSplitPreview={onSplitPreview} onSplit={vi.fn()} /></I18nProvider>)
    const secondTab = [...document.querySelectorAll<HTMLButtonElement>('.document-tab')].find((tab) => tab.textContent?.includes('second project'))
    if (!secondTab) throw new Error('Second project tab was not rendered')
    Object.assign(secondTab, { setPointerCapture: vi.fn(), hasPointerCapture: vi.fn(() => false), releasePointerCapture: vi.fn() })

    fireEvent.pointerDown(secondTab, { button: 0, pointerId: 32, clientX: 200, clientY: 16 })
    fireEvent.pointerMove(window, { pointerId: 32, clientX: 326, clientY: 300 })

    expect(onSplitPreview).toHaveBeenCalledWith({ documentId: second.id, targetPaneId: first.id, direction: 'left' })
    stageRect = { ...stageRect, left: 366, width: 614, x: 366 }
    fireEvent.pointerMove(window, { pointerId: 32, clientX: 327, clientY: 300 })
    expect(onSplitPreview).toHaveBeenLastCalledWith({ documentId: second.id, targetPaneId: first.id, direction: 'left' })
    fireEvent.pointerUp(window, { pointerId: 32, clientX: 326, clientY: 300 })
  })

  it('switches from the left dock zone to the top dock zone during one held drag', () => {
    const first = createDocument('first project', 2, 2, 'rgba')
    const second = createDocument('second project', 2, 2, 'rgba')
    useWorkspace.getState().addSession(first)
    useWorkspace.getState().addSession(second)
    useWorkspace.getState().setActive(first.id)
    const stage = document.createElement('div')
    stage.className = 'stage-wrap'
    stage.dataset.documentPaneId = first.id
    document.body.append(stage)
    vi.spyOn(stage, 'getBoundingClientRect').mockReturnValue({ left: 340, top: 136, right: 980, bottom: 620, width: 640, height: 484, x: 340, y: 136, toJSON: () => ({}) })
    Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: vi.fn(() => stage) })

    const onSplitPreview = vi.fn()
    render(<I18nProvider><DocumentTabs homeOpen={false} hiddenDocumentIds={[]} onNew={vi.fn()} onActivate={vi.fn()} onContextActivate={vi.fn()} onSplitPreview={onSplitPreview} onSplit={vi.fn()} /></I18nProvider>)
    const secondTab = [...document.querySelectorAll<HTMLButtonElement>('.document-tab')].find((tab) => tab.textContent?.includes('second project'))
    if (!secondTab) throw new Error('Second project tab was not rendered')
    Object.assign(secondTab, { setPointerCapture: vi.fn(), hasPointerCapture: vi.fn(() => false), releasePointerCapture: vi.fn() })

    fireEvent.pointerDown(secondTab, { button: 0, pointerId: 34, clientX: 200, clientY: 16 })
    fireEvent.pointerMove(window, { pointerId: 34, clientX: 326, clientY: 300 })
    expect(onSplitPreview).toHaveBeenLastCalledWith({ documentId: second.id, targetPaneId: first.id, direction: 'left' })
    fireEvent.pointerMove(window, { pointerId: 34, clientX: 500, clientY: 100 })
    expect(onSplitPreview).toHaveBeenLastCalledWith({ documentId: second.id, targetPaneId: first.id, direction: 'top' })
    fireEvent.pointerUp(window, { pointerId: 34, clientX: 500, clientY: 100 })
  })

  it('uses another visible document without changing the active tab during preview', () => {
    const first = createDocument('first project', 2, 2, 'rgba')
    const second = createDocument('second project', 2, 2, 'rgba')
    useWorkspace.getState().addSession(first)
    useWorkspace.getState().addSession(second)
    useWorkspace.getState().setActive(first.id)
    const stage = document.createElement('div')
    stage.className = 'stage-wrap'
    stage.dataset.documentPaneId = first.id
    document.body.append(stage)
    vi.spyOn(stage, 'getBoundingClientRect').mockReturnValue({ left: 340, top: 136, right: 980, bottom: 620, width: 640, height: 484, x: 340, y: 136, toJSON: () => ({}) })
    Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: vi.fn(() => stage) })

    const onSplitPreview = vi.fn()
    render(<I18nProvider><DocumentTabs homeOpen={false} hiddenDocumentIds={[]} onNew={vi.fn()} onActivate={vi.fn()} onContextActivate={vi.fn()} onSplitPreview={onSplitPreview} onSplit={vi.fn()} /></I18nProvider>)
    const firstTab = [...document.querySelectorAll<HTMLButtonElement>('.document-tab')].find((tab) => tab.textContent?.includes('first project'))
    if (!firstTab) throw new Error('First project tab was not rendered')
    Object.assign(firstTab, { setPointerCapture: vi.fn(), hasPointerCapture: vi.fn(() => false), releasePointerCapture: vi.fn() })

    fireEvent.pointerDown(firstTab, { button: 0, pointerId: 33, clientX: 200, clientY: 16 })
    fireEvent.pointerMove(window, { pointerId: 33, clientX: 326, clientY: 300 })

    expect(useWorkspace.getState().activeId).toBe(first.id)
    expect(onSplitPreview).toHaveBeenCalledWith({ documentId: first.id, targetPaneId: second.id, direction: 'left' })
    fireEvent.pointerUp(window, { pointerId: 33, clientX: 326, clientY: 300 })
  })

  it('reorders tabs while the pointer remains inside the tab strip', async () => {
    const first = createDocument('first project', 2, 2, 'rgba')
    const second = createDocument('second project', 2, 2, 'rgba')
    useWorkspace.getState().addSession(first)
    useWorkspace.getState().addSession(second)
    useWorkspace.getState().setActive(first.id)
    render(<div className="tab-strip"><I18nProvider><DocumentTabs homeOpen={false} hiddenDocumentIds={[]} onNew={vi.fn()} onActivate={vi.fn()} onContextActivate={vi.fn()} onSplitPreview={vi.fn()} onSplit={vi.fn()} /></I18nProvider></div>)
    const tabs = [...document.querySelectorAll<HTMLButtonElement>('.document-tab')]
    const firstTab = tabs[0]
    const secondTab = tabs[1]
    const targetStrip = document.querySelector<HTMLElement>('.tab-strip')
    if (!targetStrip) throw new Error('Tab strip was not rendered')
    Object.assign(firstTab, { setPointerCapture: vi.fn(), hasPointerCapture: vi.fn(() => false), releasePointerCapture: vi.fn() })
    vi.spyOn(targetStrip, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, right: 500, bottom: 40, width: 500, height: 40, x: 0, y: 0, toJSON: () => ({}) })
    vi.spyOn(secondTab, 'getBoundingClientRect').mockReturnValue({ left: 100, top: 0, right: 200, bottom: 40, width: 100, height: 40, x: 100, y: 0, toJSON: () => ({}) })
    Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: vi.fn(() => secondTab) })

    fireEvent.pointerDown(firstTab, { button: 0, pointerId: 14, clientX: 20, clientY: 16 })
    fireEvent.pointerMove(window, { pointerId: 14, clientX: 180, clientY: 16 })
    expect(useWorkspace.getState().sessions.map((item) => item.document.id)).toEqual([second.id, first.id])
    fireEvent.pointerUp(window, { pointerId: 14, clientX: 180, clientY: 16 })

    await waitFor(() => expect(useWorkspace.getState().sessions.map((item) => item.document.id)).toEqual([second.id, first.id]))
    expect(document.querySelector('.document-tab-drag-ghost')).not.toBeInTheDocument()
  })

  it('keeps the pressed point aligned with the drag ghost and clears it on mouseup fallback', async () => {
    const first = createDocument('first project', 2, 2, 'rgba')
    const second = createDocument('second project', 2, 2, 'rgba')
    useWorkspace.getState().addSession(first)
    useWorkspace.getState().addSession(second)
    useWorkspace.getState().setActive(first.id)
    const stage = document.createElement('div')
    stage.className = 'stage-wrap'
    stage.dataset.documentPaneId = first.id
    document.body.append(stage)
    vi.spyOn(stage, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 40, right: 800, bottom: 640, width: 800, height: 600, x: 0, y: 40, toJSON: () => ({}) })
    Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: vi.fn(() => stage) })

    render(<I18nProvider><DocumentTabs homeOpen={false} hiddenDocumentIds={[]} onNew={vi.fn()} onActivate={vi.fn()} onContextActivate={vi.fn()} onSplitPreview={vi.fn()} onSplit={vi.fn()} /></I18nProvider>)
    const secondTab = [...document.querySelectorAll<HTMLButtonElement>('.document-tab')].find((tab) => tab.textContent?.includes('second project'))
    if (!secondTab) throw new Error('Second project tab was not rendered')
    vi.spyOn(secondTab, 'getBoundingClientRect').mockReturnValue({ left: 100, top: 0, right: 300, bottom: 32, width: 200, height: 32, x: 100, y: 0, toJSON: () => ({}) })
    Object.assign(secondTab, { setPointerCapture: vi.fn(), hasPointerCapture: vi.fn(() => false), releasePointerCapture: vi.fn() })

    fireEvent.pointerDown(secondTab, { button: 0, pointerId: 22, clientX: 200, clientY: 16 })
    fireEvent.pointerMove(window, { pointerId: 22, clientX: 500, clientY: 300 })
    const ghost = document.querySelector<HTMLElement>('.document-tab-drag-ghost')
    expect(ghost).toHaveStyle({ left: '400px', top: '284px', width: '200px', height: '32px' })

    fireEvent.pointerMove(window, { pointerId: 22, clientX: 560, clientY: 340 })
    expect(ghost).toHaveStyle({ left: '460px', top: '324px' })

    fireEvent.mouseUp(window, { clientX: 500, clientY: 300 })
    await waitFor(() => expect(document.querySelector('.document-tab-drag-ghost')).not.toBeInTheDocument())
  })

  it('does not stop when a captured mouse move reports no buttons', () => {
    const first = createDocument('first project', 2, 2, 'rgba')
    const second = createDocument('second project', 2, 2, 'rgba')
    useWorkspace.getState().addSession(first)
    useWorkspace.getState().addSession(second)
    useWorkspace.getState().setActive(first.id)
    const stage = document.createElement('div')
    stage.className = 'stage-wrap'
    stage.dataset.documentPaneId = first.id
    document.body.append(stage)
    vi.spyOn(stage, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 40, right: 800, bottom: 640, width: 800, height: 600, x: 0, y: 40, toJSON: () => ({}) })
    Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: vi.fn(() => stage) })

    render(<I18nProvider><DocumentTabs homeOpen={false} hiddenDocumentIds={[]} onNew={vi.fn()} onActivate={vi.fn()} onContextActivate={vi.fn()} onSplitPreview={vi.fn()} onSplit={vi.fn()} /></I18nProvider>)
    const secondTab = [...document.querySelectorAll<HTMLButtonElement>('.document-tab')].find((tab) => tab.textContent?.includes('second project'))
    if (!secondTab) throw new Error('Second project tab was not rendered')
    Object.assign(secondTab, { setPointerCapture: vi.fn(), hasPointerCapture: vi.fn(() => false), releasePointerCapture: vi.fn() })

    fireEvent.pointerDown(secondTab, { button: 0, pointerId: 34, clientX: 20, clientY: 16 })
    fireEvent.pointerMove(window, { pointerId: 34, pointerType: 'mouse', buttons: 0, clientX: 500, clientY: 300 })
    expect(document.querySelector('.document-tab-drag-ghost')).toBeInTheDocument()
    fireEvent.pointerMove(window, { pointerId: 34, pointerType: 'mouse', buttons: 0, clientX: 560, clientY: 340 })
    expect(document.querySelector('.document-tab-drag-ghost')).toBeInTheDocument()
    fireEvent.pointerUp(window, { pointerId: 34, clientX: 560, clientY: 340 })
  })
})
