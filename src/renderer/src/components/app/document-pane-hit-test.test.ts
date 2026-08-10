import { afterEach, describe, expect, it, vi } from 'vitest'
import { paneDockTargetAtPoint, type DocumentPaneDockTarget } from './document-pane-hit-test'

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

    const hit = paneDockTargetAtPoint(326, 300, { currentTarget })

    expect(hit.target).toBe(currentTarget)
    expect(hit.direction).toBe('left')
  })
})
