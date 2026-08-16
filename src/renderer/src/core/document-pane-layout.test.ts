import { describe, expect, it } from 'vitest'
import { createDocumentPaneLayout, detachDocumentPaneWorkspace, documentPaneDockDirection, documentPaneDockDirectionAlongInnerPath, documentPaneDockDirectionAlongPath, documentPaneDropDirection, documentPaneLeafIds, insertDocumentPane, moveDocumentPane, removeDocumentPane, resizeDocumentPane, resolveDocumentPanePreviewLayout, splitDocumentPaneFromTab, type DocumentPaneNode } from './document-pane-layout'

describe('document pane layout', () => {
  it('uses normalized directional zones for non-square pane targets', () => {
    const widePane = { left: 0, top: 0, right: 1000, bottom: 400, width: 1000, height: 400 }

    expect(documentPaneDropDirection(widePane, 120, 80)).toBe('left')
    expect(documentPaneDropDirection(widePane, 180, 8)).toBe('left')
    expect(documentPaneDropDirection(widePane, 880, 80)).toBe('right')
    expect(documentPaneDropDirection(widePane, 500, 40)).toBe('top')
    expect(documentPaneDropDirection(widePane, 500, 360)).toBe('bottom')
  })

  it('divides the complete pane into four normalized docking regions', () => {
    const pane = { left: 100, top: 50, right: 1100, bottom: 650, width: 1000, height: 600 }

    expect(documentPaneDockDirection(pane, 120, 300)).toBe('left')
    expect(documentPaneDockDirection(pane, 1080, 300)).toBe('right')
    expect(documentPaneDockDirection(pane, 500, 70)).toBe('top')
    expect(documentPaneDockDirection(pane, 500, 630)).toBe('bottom')
    expect(documentPaneDockDirection(pane, 350, 300)).toBe('left')
    expect(documentPaneDockDirection(pane, 500, 250)).toBe('top')
    expect(documentPaneDockDirection(pane, 500, 500)).toBe('bottom')
    expect(documentPaneDockDirection(pane, 900, 350)).toBe('right')
  })

  it('switches docking direction from the current pointer position', () => {
    const pane = { left: 100, top: 50, right: 1100, bottom: 650, width: 1000, height: 600 }

    expect(documentPaneDockDirection(pane, 350, 300)).toBe('left')
    expect(documentPaneDockDirection(pane, 500, 150)).toBe('top')
    expect(documentPaneDockDirection(pane, 850, 300)).toBe('right')
    expect(documentPaneDockDirection(pane, 500, 550)).toBe('bottom')
  })

  it('does not acquire docking while the pointer remains outside the pane', () => {
    const pane = { left: 340, top: 136, right: 980, bottom: 620, width: 640, height: 484 }

    expect(documentPaneDockDirection(pane, 339, 300)).toBeNull()
    expect(documentPaneDockDirection(pane, 500, 135)).toBeNull()
    expect(documentPaneDockDirection(pane, 340, 300)).toBe('left')
    expect(documentPaneDockDirection(pane, 500, 136)).toBe('top')
  })

  it('detects a magnetic edge crossed by a fast pointer move', () => {
    const pane = { left: 100, top: 50, right: 1100, bottom: 650, width: 1000, height: 600 }

    expect(documentPaneDockDirectionAlongPath(pane, { x: 70, y: 300 }, { x: 240, y: 300 })).toBe('left')
    expect(documentPaneDockDirectionAlongPath(pane, { x: 600, y: 20 }, { x: 600, y: 180 })).toBe('top')
    expect(documentPaneDockDirectionAlongPath(pane, { x: 600, y: 40 }, { x: 600, y: 180 })).toBe('top')
    expect(documentPaneDockDirectionAlongPath(pane, { x: 90, y: 300 }, { x: 300, y: 20 })).toBe('left')
  })

  it('detects a skipped pane region along a fast pointer path', () => {
    const pane = { left: 340, top: 136, right: 980, bottom: 620, width: 640, height: 484 }

    expect(documentPaneDockDirectionAlongInnerPath(pane, { x: 660, y: 16 }, { x: 660, y: 350 })).toBe('top')
    expect(documentPaneDockDirectionAlongInnerPath(pane, { x: 300, y: 16 }, { x: 300, y: 130 })).toBeNull()
  })

  it('renders a dock preview when the dragged document is currently active', () => {
    const preview = resolveDocumentPanePreviewLayout(null, 'source', {
      documentId: 'source',
      targetPaneId: 'target',
      direction: 'left',
      previewPaneId: 'source'
    })

    expect(preview?.kind).toBe('split')
    if (!preview) throw new Error('Expected a preview layout')
    expect(documentPaneLeafIds(preview)).toEqual(['source', 'target'])
  })

  it('replaces the displayed canvas before splitting the active project tab', () => {
    const layout = splitDocumentPaneFromTab(null, 'source', {
      documentId: 'source',
      targetPaneId: 'target',
      direction: 'bottom',
      previewPaneId: 'source'
    })

    expect(documentPaneLeafIds(layout)).toEqual(['target', 'source'])
    expect(documentPaneLeafIds(layout).filter((id) => id === 'source')).toHaveLength(1)
    expect(documentPaneLeafIds(layout).filter((id) => id === 'target')).toHaveLength(1)
  })

  it('keeps the normal inactive-tab split behavior', () => {
    const layout = splitDocumentPaneFromTab(null, 'target', {
      documentId: 'source',
      targetPaneId: 'target',
      direction: 'left'
    })

    expect(documentPaneLeafIds(layout)).toEqual(['source', 'target'])
  })

  it('gives a newly docked project one third of the target pane', () => {
    for (const [direction, expectedRatio] of [['left', 1 / 3], ['right', 2 / 3], ['top', 1 / 3], ['bottom', 2 / 3]] as const) {
      const layout = splitDocumentPaneFromTab(null, 'target', {
        documentId: 'source',
        targetPaneId: 'target',
        direction
      })

      expect(layout.kind).toBe('split')
      if (layout.kind !== 'split') throw new Error('Expected a split layout')
      expect(layout.ratio).toBeCloseTo(expectedRatio)
    }
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
    expect(resized.ratio).toBeCloseTo(2 / 3)

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

  it('promotes a remaining pane when the main project is floated', () => {
    let layout: DocumentPaneNode = createDocumentPaneLayout('main')
    layout = insertDocumentPane(layout, 'main', 'second', 'right')
    layout = insertDocumentPane(layout, 'second', 'third', 'bottom')

    const detached = detachDocumentPaneWorkspace(layout, 'main', 'main', ['second', 'third'], ['third', 'second'])

    expect(detached.layout && documentPaneLeafIds(detached.layout)).toEqual(['second', 'third'])
    expect(detached.workspaceDocumentId).toBe('second')
    expect(detached.paneOnlyDocumentIds).toEqual(['third'])
  })

  it('collapses the pane workspace when its secondary project is floated', () => {
    const layout = insertDocumentPane(createDocumentPaneLayout('main'), 'main', 'second', 'right')

    const detached = detachDocumentPaneWorkspace(layout, 'second', 'main', ['second'], ['main'])

    expect(detached.layout).toBeNull()
    expect(detached.workspaceDocumentId).toBe('main')
    expect(detached.paneOnlyDocumentIds).toEqual([])
  })

  it('keeps the current main project when another pane leaves a multi-project workspace', () => {
    let layout: DocumentPaneNode = createDocumentPaneLayout('main')
    layout = insertDocumentPane(layout, 'main', 'second', 'right')
    layout = insertDocumentPane(layout, 'second', 'third', 'bottom')

    const detached = detachDocumentPaneWorkspace(layout, 'second', 'main', ['second', 'third'], ['main', 'third'])

    expect(detached.layout && documentPaneLeafIds(detached.layout)).toEqual(['main', 'third'])
    expect(detached.workspaceDocumentId).toBe('main')
    expect(detached.paneOnlyDocumentIds).toEqual(['third'])
  })
})
