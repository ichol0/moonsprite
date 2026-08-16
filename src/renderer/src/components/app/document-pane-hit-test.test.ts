import { afterEach, describe, expect, it, vi } from 'vitest'
import { captureDocumentPaneDockTargets, paneDockTargetAtPoint, type DocumentPaneDockTarget } from './document-pane-hit-test'

afterEach(() => {
  document.body.replaceChildren()
  const patchedDocument = document as unknown as { elementFromPoint?: typeof document.elementFromPoint }
  delete patchedDocument.elementFromPoint
  vi.restoreAllMocks()
})

describe('document pane hit testing', () => {
  it('keeps the original target rectangle while a preview shifts the live pane', () => {
    const pane = document.createElement('section')
    pane.dataset.documentPaneId = 'target'
    document.body.append(pane)
    vi.spyOn(pane, 'getBoundingClientRect').mockReturnValue({ left: 366, top: 136, right: 980, bottom: 620, width: 614, height: 484, x: 366, y: 136, toJSON: () => ({}) })
    Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: vi.fn(() => null) })
    const currentTarget: DocumentPaneDockTarget = {
      paneId: 'target',
      rect: { left: 340, top: 136, right: 980, bottom: 620, width: 640, height: 484 }
    }

    const hit = paneDockTargetAtPoint(350, 300, { currentTarget, strictPoint: true })

    expect(hit.target).toBe(currentTarget)
    expect(hit.direction).toBe('left')
  })

  it('does not acquire a canvas before the pointer enters its bounds', () => {
    const pane = document.createElement('section')
    pane.dataset.documentPaneId = 'target'
    document.body.append(pane)
    vi.spyOn(pane, 'getBoundingClientRect').mockReturnValue({ left: 340, top: 136, right: 980, bottom: 620, width: 640, height: 484, x: 340, y: 136, toJSON: () => ({}) })
    const sidebar = document.createElement('aside')
    document.body.append(sidebar)
    Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: vi.fn(() => sidebar) })

    const hit = paneDockTargetAtPoint(300, 130, { strictPoint: true })

    expect(hit.pane).toBeNull()
    expect(hit.target).toBeNull()
    expect(hit.direction).toBeNull()
  })

  it('acquires the crossed top region when a fast pointer move skips over it', () => {
    const pane = document.createElement('section')
    pane.dataset.documentPaneId = 'target'
    document.body.append(pane)
    vi.spyOn(pane, 'getBoundingClientRect').mockReturnValue({ left: 340, top: 136, right: 980, bottom: 620, width: 640, height: 484, x: 340, y: 136, toJSON: () => ({}) })
    Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: vi.fn(() => pane) })

    const hit = paneDockTargetAtPoint(660, 350, {
      strictPoint: true,
      previousPoint: { x: 660, y: 16 }
    })

    expect(hit.target?.paneId).toBe('target')
    expect(hit.direction).toBe('top')
  })

  it('uses a stable target snapshot when the drag ghost owns elementFromPoint', () => {
    const pane = document.createElement('section')
    pane.dataset.documentPaneId = 'target'
    document.body.append(pane)
    vi.spyOn(pane, 'getBoundingClientRect').mockReturnValue({ left: 340, top: 136, right: 980, bottom: 620, width: 640, height: 484, x: 340, y: 136, toJSON: () => ({}) })
    const ghost = document.createElement('div')
    document.body.append(ghost)
    Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: vi.fn(() => ghost) })
    const targets = captureDocumentPaneDockTargets()

    const hit = paneDockTargetAtPoint(600, 300, { strictPoint: true, targets })

    expect(hit.target?.paneId).toBe('target')
    expect(hit.direction).toBe('top')
  })

  it('switches regions against the original canvas rectangle after preview layout changes', () => {
    const pane = document.createElement('section')
    pane.dataset.documentPaneId = 'target'
    document.body.append(pane)
    vi.spyOn(pane, 'getBoundingClientRect').mockReturnValue({ left: 366, top: 136, right: 980, bottom: 620, width: 614, height: 484, x: 366, y: 136, toJSON: () => ({}) })
    Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: vi.fn(() => null) })
    const currentTarget: DocumentPaneDockTarget = {
      paneId: 'target',
      rect: { left: 340, top: 136, right: 980, bottom: 620, width: 640, height: 484 }
    }

    const topHit = paneDockTargetAtPoint(500, 150, { currentTarget, strictPoint: true })
    const leftHit = paneDockTargetAtPoint(350, 300, { currentTarget, strictPoint: true })

    expect(topHit.target).toBe(currentTarget)
    expect(topHit.direction).toBe('top')
    expect(leftHit.target).toBe(currentTarget)
    expect(leftHit.direction).toBe('left')
  })

  it('switches repeatedly between adjacent regions without clearing the target', () => {
    const pane = document.createElement('section')
    pane.dataset.documentPaneId = 'target'
    document.body.append(pane)
    vi.spyOn(pane, 'getBoundingClientRect').mockReturnValue({ left: 340, top: 136, right: 980, bottom: 620, width: 640, height: 484, x: 340, y: 136, toJSON: () => ({}) })
    Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: vi.fn(() => null) })
    const targets = captureDocumentPaneDockTargets()

    const leftHit = paneDockTargetAtPoint(360, 360, { strictPoint: true, targets })
    const topHit = paneDockTargetAtPoint(500, 150, { currentTarget: leftHit.target, strictPoint: true, targets })
    const rightHit = paneDockTargetAtPoint(960, 360, { currentTarget: topHit.target, strictPoint: true, targets })

    expect(leftHit.direction).toBe('left')
    expect(topHit.direction).toBe('top')
    expect(rightHit.direction).toBe('right')
  })
})
