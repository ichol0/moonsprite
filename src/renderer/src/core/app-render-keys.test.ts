import { describe, expect, it } from 'vitest'
import { createDocument, createLayer } from './document'
import { ensureAnimationDocument } from './animation'
import { appCoordinatorRenderKey, appMenuRenderKey, documentTabsRenderKey, statusBarRenderKey, toolOptionsRenderKey, toolRailRenderKey } from '@/components/app/app-render-keys'
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

    const gradientOptions = toolOptionsRenderKey(session)
    session.gradientTolerance = 64
    session.gradientContiguous = false
    expect(toolOptionsRenderKey(session)).not.toBe(gradientOptions)

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

  it('tracks every brush dynamics mapping option', () => {
    const session = createSession()
    const changes = [
      () => { session.brushDynamics.effects.size.sensor = 'pressure' },
      () => { session.brushDynamics.effects.size.outputMin = 35 },
      () => { session.brushDynamics.effects.size.outputMax = 90 },
      () => { session.brushDynamics.effects.size.inputMin = 8 },
      () => { session.brushDynamics.effects.size.inputMax = 75 },
      () => { session.brushDynamics.effects.size.curve = 'hard' },
      () => { session.brushDynamics.effects.size.direction = 'inverse' },
      () => { session.brushDynamics.effects.strength.sensor = 'speed' },
      () => { session.brushDynamics.effects.gradient.sensor = 'pressure' },
      () => { session.brushDynamics.effects.gradient.outputMin = 12 },
      () => { session.brushDynamics.gradientDither = 'bayer-4' }
    ]

    for (const change of changes) {
      const before = toolOptionsRenderKey(session)
      change()
      expect(toolOptionsRenderKey(session)).not.toBe(before)
    }
  })

  it('invalidates tool options when rotational symmetry changes', () => {
    const session = createSession()
    const before = toolOptionsRenderKey(session)
    session.symmetryAxes.rotational = true
    expect(toolOptionsRenderKey(session)).not.toBe(before)
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

    const hiddenPivot = appCoordinatorRenderKey(state)
    const pivotOptions = toolOptionsRenderKey(session)
    session.view.showSelectionPivot = true
    expect(appCoordinatorRenderKey(state)).not.toBe(hiddenPivot)
    expect(toolOptionsRenderKey(session)).not.toBe(pivotOptions)

    const toolKey = appCoordinatorRenderKey(state)
    session.tool = 'eyedropper'
    expect(appCoordinatorRenderKey(state)).not.toBe(toolKey)
    const eyedropperKey = appCoordinatorRenderKey(state)
    session.tool = 'fill'
    session.fillKind = 'gradient'
    expect(appCoordinatorRenderKey(state)).not.toBe(eyedropperKey)
  })

  it('tracks script target identity without subscribing to pixel revisions', () => {
    const session = createSession()
    const state = { activeId: session.document.id, sessions: [session], dialog: null, saveProgress: null }
    const initial = appCoordinatorRenderKey(state)

    const generated = createLayer('Generated', 4, 4, 'rgba')
    session.document.layers.push(generated)
    session.document.activeLayerId = generated.id
    expect(appCoordinatorRenderKey(state)).not.toBe(initial)

    const withGeneratedLayer = appCoordinatorRenderKey(state)
    session.document.layers = session.document.layers.filter((layer) => layer.id !== generated.id)
    session.document.activeLayerId = session.document.layers[0]!.id
    expect(appCoordinatorRenderKey(state)).not.toBe(withGeneratedLayer)

    const timeline = ensureAnimationDocument(session.document)
    const beforeFrameChange = appCoordinatorRenderKey(state)
    const nextFrame = { id: 'frame-script-target', duration: 100 }
    timeline.frames.push(nextFrame)
    timeline.activeFrameId = nextFrame.id
    expect(appCoordinatorRenderKey(state)).not.toBe(beforeFrameChange)
  })
})
