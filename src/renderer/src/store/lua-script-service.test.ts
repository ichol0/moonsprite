import { beforeEach, describe, expect, it } from 'vitest'
import type { LuaScriptExecutionContext, LuaScriptRunResult } from '@shared/types'
import { createDocument, getActiveLayer, readLayerPacked } from '@/core/document'
import {
  dispatchLuaScriptDialogForActiveDocument,
  luaScriptTargetIsActive,
  runLuaScriptForActiveDocument
} from './lua-script-service'
import { useWorkspace } from './workspace'

const result = (overrides: Partial<LuaScriptRunResult> = {}): LuaScriptRunResult => ({
  sessionId: null,
  fileName: 'paint.lua',
  filePath: 'C:/scripts/paint.lua',
  output: [],
  elapsedMs: 3,
  batches: [],
  createdLayers: [],
  createdDocuments: [],
  dialogs: [],
  finished: true,
  ...overrides
})

beforeEach(() => {
  localStorage.clear()
  useWorkspace.setState({ sessions: [], activeId: null, message: null, saveProgress: null, dialog: null })
})

describe('Lua script document service', () => {
  it('commits each Lua transaction through targeted pixel history', async () => {
    const document = createDocument('script target', 2, 1, 'rgba')
    useWorkspace.getState().addSession(document)
    let received: LuaScriptExecutionContext | null = null
    const red = 0xff0000ff
    const green = 0xff00ff00

    const outcome = await runLuaScriptForActiveDocument({
      runLuaScript: async (scriptId, context) => {
        expect(scriptId).toBe('paint.lua')
        received = context
        return result({
          output: ['done'],
          batches: [
            { label: 'Red', changes: [{ index: 0, before: 0, after: red }], surfaceChange: null },
            { label: 'Green', changes: [{ index: 1, before: 0, after: green }], surfaceChange: null }
          ]
        })
      }
    }, 'paint.lua')

    const layer = getActiveLayer(document)
    expect(received).toMatchObject({ documentName: 'script target', layerWidth: 2, layerHeight: 1, frameNumber: 1, selection: null })
    expect(outcome.summary).toMatchObject({ fileName: 'paint.lua', transactionCount: 2, changedPixelCount: 2, output: ['done'] })
    expect(outcome.session).toBeNull()
    expect(readLayerPacked(document, layer, 0) >>> 0).toBe(red)
    expect(readLayerPacked(document, layer, 1) >>> 0).toBe(green)

    useWorkspace.getState().undo()
    expect(readLayerPacked(document, layer, 0) >>> 0).toBe(red)
    expect(readLayerPacked(document, layer, 1) >>> 0).toBe(0)
    useWorkspace.getState().undo()
    expect(readLayerPacked(document, layer, 0) >>> 0).toBe(0)
  })

  it('commits cel image replacement and position as one undoable transaction', async () => {
    const document = createDocument('surface target', 2, 2, 'rgba')
    useWorkspace.getState().addSession(document)
    const red = 0xff0000ff

    const outcome = await runLuaScriptForActiveDocument({
      runLuaScript: async () => result({
        batches: [{
          label: 'Replace cel',
          changes: [],
          surfaceChange: {
            before: { format: 'rgba', width: 2, height: 2, offsetX: 0, offsetY: 0, pixels: [0, 0, 0, 0] },
            after: { format: 'rgba', width: 3, height: 2, offsetX: -1, offsetY: 1, pixels: [red, 0, 0, 0, 0, 0] }
          }
        }]
      })
    }, 'replace.lua')

    const layer = getActiveLayer(document)
    expect(outcome.summary).toMatchObject({ transactionCount: 1, changedPixelCount: 6 })
    expect(layer).toMatchObject({ width: 3, height: 2, offsetX: -1, offsetY: 1 })
    expect(readLayerPacked(document, layer, 0) >>> 0).toBe(red)

    useWorkspace.getState().undo()
    expect(layer).toMatchObject({ width: 2, height: 2, offsetX: 0, offsetY: 0 })
    expect(readLayerPacked(document, layer, 0) >>> 0).toBe(0)
    useWorkspace.getState().redo()
    expect(layer).toMatchObject({ width: 3, height: 2, offsetX: -1, offsetY: 1 })
    expect(readLayerPacked(document, layer, 0) >>> 0).toBe(red)
  })

  it('creates a script layer through undoable store history', async () => {
    const document = createDocument('layer creation target', 2, 2, 'rgba')
    useWorkspace.getState().addSession(document)
    const blue = 0xffff0000

    const outcome = await runLuaScriptForActiveDocument({
      runLuaScript: async () => result({
        createdLayers: [{
          id: 'lua-layer-1',
          name: 'Cube',
          opacity: 255,
          visible: true,
          locked: false,
          frameNumber: 1,
          surface: { format: 'rgba', width: 2, height: 2, offsetX: 0, offsetY: 0, pixels: [blue, 0, 0, 0] }
        }]
      })
    }, 'layer.lua')

    expect(outcome.summary).toMatchObject({ transactionCount: 1, changedPixelCount: 1 })
    expect(document.layers).toHaveLength(2)
    expect(document.activeLayerId).toBe('lua-layer-1')
    expect(readLayerPacked(document, getActiveLayer(document), 0) >>> 0).toBe(blue)

    useWorkspace.getState().undo()
    expect(document.layers).toHaveLength(1)
    useWorkspace.getState().redo()
    expect(document.layers).toHaveLength(2)
    expect(document.activeLayerId).toBe('lua-layer-1')
  })

  it('invalidates a persistent target when its generated layer is undone', async () => {
    const document = createDocument('persistent layer target', 1, 1, 'rgba')
    useWorkspace.getState().addSession(document)
    const initial = await runLuaScriptForActiveDocument({
      runLuaScript: async () => result({
        sessionId: 'lua-layer-session',
        finished: false,
        createdLayers: [{
          id: 'lua-generated-layer',
          name: 'Generated',
          opacity: 255,
          visible: true,
          locked: false,
          frameNumber: 1,
          surface: { format: 'rgba', width: 1, height: 1, offsetX: 0, offsetY: 0, pixels: [0xff0000ff] }
        }]
      })
    }, 'persistent-layer.lua')

    expect(initial.session).not.toBeNull()
    expect(luaScriptTargetIsActive(initial.session!)).toBe(true)

    useWorkspace.getState().undo()
    expect(document.layers.some((layer) => layer.id === 'lua-generated-layer')).toBe(false)
    expect(luaScriptTargetIsActive(initial.session!)).toBe(false)

    useWorkspace.getState().redo()
    expect(luaScriptTargetIsActive(initial.session!)).toBe(true)
    useWorkspace.getState().deleteActiveLayer()
    expect(document.layers.some((layer) => layer.id === 'lua-generated-layer')).toBe(false)
    expect(luaScriptTargetIsActive(initial.session!)).toBe(false)
  })

  it('opens a script-created sprite as a new document session', async () => {
    const document = createDocument('sprite creation target', 1, 1, 'rgba')
    useWorkspace.getState().addSession(document)
    const red = 0xff0000ff

    const outcome = await runLuaScriptForActiveDocument({
      runLuaScript: async () => result({
        createdDocuments: [{
          name: 'Guidelines',
          width: 3,
          height: 2,
          colorMode: 'rgba',
          layers: [{
            id: 'lua-layer-guides',
            name: 'Layer 1',
            opacity: 255,
            visible: true,
            locked: false,
            frameNumber: 1,
            surface: { format: 'rgba', width: 3, height: 2, offsetX: 0, offsetY: 0, pixels: [red, 0, 0, 0, 0, red] }
          }]
        }]
      })
    }, 'sprite.lua')

    const state = useWorkspace.getState()
    expect(outcome.summary).toMatchObject({ transactionCount: 1, changedPixelCount: 2 })
    expect(state.sessions).toHaveLength(2)
    const created = state.sessions.find((session) => session.document.name === 'Guidelines')
    expect(created?.document).toMatchObject({ width: 3, height: 2, dirty: true })
    expect(readLayerPacked(created!.document, getActiveLayer(created!.document), 5) >>> 0).toBe(red)
  })

  it('continues a dialog callback against the same validated target', async () => {
    const document = createDocument('dialog target', 1, 1, 'rgba')
    useWorkspace.getState().addSession(document)
    const dialog = {
      id: 'dialog-1',
      title: 'Options',
      controls: [{
        id: 'apply',
        dataKey: 'apply',
        kind: 'button' as const,
        label: '',
        text: 'Apply',
        value: null,
        min: null,
        max: null,
        step: null,
        decimals: null,
        options: [],
        enabled: true,
        visible: true
      }]
    }
    const initial = await runLuaScriptForActiveDocument({
      runLuaScript: async () => result({ sessionId: 'lua-1', dialogs: [dialog], finished: false })
    }, 'dialog.lua')
    expect(initial.session?.dialogs).toEqual([dialog])

    const blue = 0xffff0000
    const continued = await dispatchLuaScriptDialogForActiveDocument({
      dispatchLuaScriptDialog: async (sessionId, action, context) => {
        expect(sessionId).toBe('lua-1')
        expect(action).toMatchObject({ dialogId: 'dialog-1', controlId: 'apply', event: 'click' })
        expect(context.pixels).toEqual([0])
        return result({ batches: [{ label: 'Apply', changes: [{ index: 0, before: 0, after: blue }], surfaceChange: null }] })
      }
    }, initial.session!, { dialogId: 'dialog-1', controlId: 'apply', event: 'click', values: {} })

    expect(continued.session).toBeNull()
    expect(readLayerPacked(document, getActiveLayer(document), 0) >>> 0).toBe(blue)
  })

  it('rebases a persistent dialog callback after undo on the same cel', async () => {
    const document = createDocument('dialog undo target', 1, 1, 'rgba')
    useWorkspace.getState().addSession(document)
    const dialog = {
      id: 'dialog-1',
      title: 'Options',
      controls: [{
        id: 'apply',
        dataKey: 'apply',
        kind: 'button' as const,
        label: '',
        text: 'Apply',
        value: null,
        min: null,
        max: null,
        step: null,
        decimals: null,
        options: [],
        enabled: true,
        visible: true
      }]
    }
    const initial = await runLuaScriptForActiveDocument({
      runLuaScript: async () => result({ sessionId: 'lua-1', dialogs: [dialog], finished: false })
    }, 'dialog.lua')
    const red = 0xff0000ff
    const first = await dispatchLuaScriptDialogForActiveDocument({
      dispatchLuaScriptDialog: async (_sessionId, _action, context) => {
        expect(context.pixels).toEqual([0])
        return result({
          sessionId: 'lua-1',
          dialogs: [dialog],
          finished: false,
          batches: [{ label: 'Apply', changes: [{ index: 0, before: 0, after: red }], surfaceChange: null }]
        })
      }
    }, initial.session!, { dialogId: 'dialog-1', controlId: 'apply', event: 'click', values: {} })

    expect(readLayerPacked(document, getActiveLayer(document), 0) >>> 0).toBe(red)
    useWorkspace.getState().undo()
    expect(readLayerPacked(document, getActiveLayer(document), 0) >>> 0).toBe(0)

    await dispatchLuaScriptDialogForActiveDocument({
      dispatchLuaScriptDialog: async (_sessionId, _action, context) => {
        expect(context.pixels).toEqual([0])
        return result({
          sessionId: 'lua-1',
          dialogs: [dialog],
          finished: false,
          batches: [{ label: 'Apply again', changes: [{ index: 0, before: 0, after: red }], surfaceChange: null }]
        })
      }
    }, first.session!, { dialogId: 'dialog-1', controlId: 'apply', event: 'click', values: {} })

    expect(readLayerPacked(document, getActiveLayer(document), 0) >>> 0).toBe(red)
  })

  it('rejects results after the active target changes', async () => {
    const document = createDocument('stale target', 1, 1, 'rgba')
    useWorkspace.getState().addSession(document)
    let resolveResult!: (value: LuaScriptRunResult) => void
    const pending = runLuaScriptForActiveDocument({
      runLuaScript: async () => new Promise((resolve) => { resolveResult = resolve })
    }, 'stale.lua')

    await Promise.resolve()
    useWorkspace.getState().addLayer()
    resolveResult(result({
      fileName: 'stale.lua',
      batches: [{ label: 'Stale', changes: [{ index: 0, before: 0, after: 0xffffffff }], surfaceChange: null }]
    }))

    await expect(pending).rejects.toThrow('目标')
  })
})
