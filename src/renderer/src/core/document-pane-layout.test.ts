import { describe, expect, it } from 'vitest'
import { createDocumentPaneLayout, documentPaneDockDirection, documentPaneDockDirectionAlongPath, documentPaneDropDirection, documentPaneLeafIds, insertDocumentPane, moveDocumentPane, removeDocumentPane, resizeDocumentPane, resolveDocumentPanePreviewLayout, type DocumentPaneNode } from './document-pane-layout'

describe('document pane layout', () => {
  it('uses normalized directional zones for non-square pane targets', () => {
    const widePane = { left: 0, top: 0, right: 1000, bottom: 400, width: 1000, height: 400 }

    expect(documentPaneDropDirection(widePane, 120, 80)).toBe('left')
    expect(documentPaneDropDirection(widePane, 180, 8)).toBe('left')
    expect(documentPaneDropDirection(widePane, 880, 80)).toBe('right')
    expect(documentPaneDropDirection(widePane, 500, 40)).toBe('top')
    expect(documentPaneDropDirection(widePane, 500, 360)).toBe('bottom')
  })

  it('limits magnetic docking to stable edge bands', () => {
    const pane = { left: 100, top: 50, right: 1100, bottom: 650, width: 1000, height: 600 }

    expect(documentPaneDockDirection(pane, 112, 300)).toBe('left')
    expect(documentPaneDockDirection(pane, 1088, 300)).toBe('right')
    expect(documentPaneDockDirection(pane, 500, 62)).toBe('top')
    expect(documentPaneDockDirection(pane, 500, 638)).toBe('bottom')
    expect(documentPaneDockDirection(pane, 500, 300)).toBeNull()
    expect(documentPaneDockDirection(pane, 180, 300)).toBe('left')
    expect(documentPaneDockDirection(pane, 181, 300)).toBeNull()
    expect(documentPaneDockDirection(pane, 90, 300)).toBe('left')
    expect(documentPaneDockDirection(pane, 500, 42)).toBe('top')
    expect(documentPaneDockDirection(pane, 81, 300)).toBe('left')
    expect(documentPaneDockDirection(pane, 77, 300)).toBeNull()
    expect(documentPaneDockDirection(pane, 108, 70)).toBe('left')
    expect(documentPaneDockDirection(pane, 120, 58)).toBe('top')
  })

  it('switches docking direction while crossing an outer corner', () => {
    const pane = { left: 100, top: 50, right: 1100, bottom: 650, width: 1000, height: 600 }

    expect(documentPaneDockDirection(pane, 90, 62)).toBe('left')
    expect(documentPaneDockDirection(pane, 300, 42)).toBe('top')
    expect(documentPaneDockDirection(pane, 90, 42)).toBe('top')
  })

  it('detects a magnetic edge crossed by a fast pointer move', () => {
    const pane = { left: 100, top: 50, right: 1100, bottom: 650, width: 1000, height: 600 }

    expect(documentPaneDockDirectionAlongPath(pane, { x: 70, y: 300 }, { x: 240, y: 300 })).toBe('left')
    expect(documentPaneDockDirectionAlongPath(pane, { x: 300, y: 20 }, { x: 300, y: 180 })).toBe('top')
    expect(documentPaneDockDirectionAlongPath(pane, { x: 90, y: 300 }, { x: 300, y: 20 })).toBe('top')
  })

  it('renders a dock preview when the dragged document is currently active', () => {
    const preview = resolveDocumentPanePreviewLayout(null, 'source', {
      documentId: 'source',
      targetPaneId: 'target',
      direction: 'left'
    })

    expect(preview?.kind).toBe('split')
    if (!preview) throw new Error('Expected a preview layout')
    expect(documentPaneLeafIds(preview)).toEqual(['source', 'target'])
  })

  it('inserts panes on all four sides and keeps nested splits independent', () => {
    let layout: DocumentPaneNode = createDocumentPaneLayout('a')
    layout = insertDocumentPane(layout, 'a', 'b', 'right')
    layout = insertDocumentPane(layout, 'a', 'c', 'bottom')
    layout = insertDocumentPane(layout, 'b', 'd', 'left')
    layout = insertDocumentPane(layout, 'c', 'e', 'top')

    expect(documentPaneLeafIds(layout)).toEqual(['a', 'e', 'c', 'd', 'b'])
  })

  it('resizes only the selected split and removes panes without leaving empty branches', () => {
    let layout: DocumentPaneNode = createDocumentPaneLayout('a')
    layout = insertDocumentPane(layout, 'a', 'b', 'right')
    layout = insertDocumentPane(layout, 'b', 'c', 'bottom')
    if (layout.kind !== 'split') throw new Error('Expected a split layout')
    const nested = layout.second
    if (nested.kind !== 'split') throw new Error('Expected a nested split layout')

    const resized = resizeDocumentPane(layout, nested.id, 0.7)
    if (resized.kind !== 'split' || resized.second.kind !== 'split') throw new Error('Expected nested split layout')
    expect(resized.second.ratio).toBe(0.7)
    expect(resized.ratio).toBe(0.5)

    const remaining = removeDocumentPane(resized, 'b')
    expect(remaining && documentPaneLeafIds(remaining)).toEqual(['a', 'c'])
  })

  it('moves an existing pane to another pane edge without duplicating it', () => {
    let layout: DocumentPaneNode = createDocumentPaneLayout('a')
    layout = insertDocumentPane(layout, 'a', 'b', 'right')
    layout = insertDocumentPane(layout, 'b', 'c', 'bottom')

    const moved = moveDocumentPane(layout, 'c', 'a', 'left')
    expect(documentPaneLeafIds(moved)).toEqual(['c', 'a', 'b'])
    expect(documentPaneLeafIds(moved).filter((id) => id === 'c')).toHaveLength(1)
  })
})
