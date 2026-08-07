import { describe, expect, it } from 'vitest'
import { createDocument } from './document'
import { appCoordinatorRenderKey, appMenuRenderKey, documentTabsRenderKey, statusBarRenderKey, toolOptionsRenderKey, toolRailRenderKey } from './app-render-keys'
import { sessionFromDocument } from '@/store/workspace-session'

const createSession = () => sessionFromDocument(createDocument('render key', 4, 4, 'rgba'))

describe('app render keys', () => {
  it('keeps non-canvas shell regions stable for pixel-only edits', () => {
    const session = createSession()
    const state = { activeId: session.document.id, sessions: [session] }
    const before = {
      menu: appMenuRenderKey(session),
      tabs: documentTabsRenderKey(state),
      rail: toolRailRenderKey(session),
      options: toolOptionsRenderKey(session),
      status: statusBarRenderKey(session, null)
    }

    session.document.layers[0].pixels[0] = 0xff00ffff
    session.revision += 1

    expect(appMenuRenderKey(session)).toBe(before.menu)
    expect(documentTabsRenderKey(state)).toBe(before.tabs)
    expect(toolRailRenderKey(session)).toBe(before.rail)
    expect(toolOptionsRenderKey(session)).toBe(before.options)
    expect(statusBarRenderKey(session, null)).toBe(before.status)
  })

  it('invalidates only the shell region whose visible state changed', () => {
    const session = createSession()
    const state = { activeId: session.document.id, sessions: [session] }
    const tabs = documentTabsRenderKey(state)
    const rail = toolRailRenderKey(session)
    const options = toolOptionsRenderKey(session)
    const status = statusBarRenderKey(session, null)

    session.tool = 'fill'
    expect(toolRailRenderKey(session)).not.toBe(rail)
    expect(toolOptionsRenderKey(session)).not.toBe(options)
    expect(documentTabsRenderKey(state)).toBe(tabs)
    expect(statusBarRenderKey(session, null)).toBe(status)

    const fillRail = toolRailRenderKey(session)
    const fillOptions = toolOptionsRenderKey(session)
    session.fillKind = 'gradient'
    session.gradientDither = 'bayer-4'
    expect(toolRailRenderKey(session)).not.toBe(fillRail)
    expect(toolOptionsRenderKey(session)).not.toBe(fillOptions)

    const menu = appMenuRenderKey(session)
    session.history.push({ label: 'edit', bytes: 1, undo: () => undefined, redo: () => undefined })
    expect(appMenuRenderKey(session)).not.toBe(menu)

    session.document.name = 'renamed'
    expect(documentTabsRenderKey(state)).not.toBe(tabs)
  })

  it('tracks status changes without serializing document pixels', () => {
    const session = createSession()
    const before = statusBarRenderKey(session, null)
    session.view.zoom = 8
    expect(statusBarRenderKey(session, null)).not.toBe(before)
    expect(statusBarRenderKey(session, 'saved')).toContain('saved')
  })

  it('keeps the app coordinator stable for high-frequency canvas updates', () => {
    const session = createSession()
    const state = { activeId: session.document.id, sessions: [session], dialog: null, saveProgress: null }
    const before = appCoordinatorRenderKey(state)
    session.document.layers[0].pixels[0] = 0xff00ffff
    session.revision += 1
    session.view.panX += 12
    expect(appCoordinatorRenderKey(state)).toBe(before)

    session.view.showGrid = true
    expect(appCoordinatorRenderKey(state)).not.toBe(before)

    const defaultGrid = appCoordinatorRenderKey(state)
    session.view.showPixelGrid = true
    expect(appCoordinatorRenderKey(state)).not.toBe(defaultGrid)
    const pixelGrid = appCoordinatorRenderKey(state)
    session.view.grid = { x: 2, y: 3, width: 8, height: 6 }
    expect(appCoordinatorRenderKey(state)).not.toBe(pixelGrid)

    const hiddenOutline = appCoordinatorRenderKey(state)
    session.view.showSelectionOutline = false
    expect(appCoordinatorRenderKey(state)).not.toBe(hiddenOutline)
    expect(appMenuRenderKey(session)).toContain(';0;')
  })
})
