import { describe, expect, it } from 'vitest'
import type { WorkspaceLayout } from '@shared/types'
import { BOTTOM_DOCK_HEIGHT_STORAGE_KEY, constrainBottomDockHeight, constrainInspectorWidth, constrainLeftDockWidth, DEFAULT_BOTTOM_DOCK_HEIGHT_RATIO, DEFAULT_INSPECTOR_WIDTH_RATIO, dockSizeFromRatio, dockSizeRatio, INSPECTOR_WIDTH_STORAGE_KEY, LEFT_DOCK_WIDTH_STORAGE_KEY, LEGACY_LAYERS_DOCK_STORAGE_KEY, PANEL_VISIBILITY_STORAGE_KEY, TOOL_RAIL_SIDE_STORAGE_KEY, loadBottomDockHeight, loadInspectorWidth, loadLeftDockWidth, loadMainWindowState, loadPanelDocks, loadPanelVisibility, loadToolRailSide, normalizeWorkspaceLayout, resolveDockSizeRatio, saveMainWindowState, savePanelVisibility, toolRailDockTargetAtPointer, workspaceDockSizesForParent, workspacePanelDockPresence } from './workspace-layout-preferences'

function createStorage(): Storage {
  const values = new Map<string, string>()
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value) },
    removeItem: (key) => { values.delete(key) },
    clear: () => { values.clear() },
    key: (index) => [...values.keys()][index] ?? null,
    get length() { return values.size }
  }
}

const layout = (changes: Partial<WorkspaceLayout> = {}): WorkspaceLayout => ({
  panelDocks: { color: 'left', palette: 'left', layers: 'right', preview: 'right', tileset: 'right' },
  inspectorWidth: 300,
  leftDockWidth: 280,
  bottomDockHeight: 180,
  toolRailSide: 'left',
  panelVisibility: { color: true, palette: true, layers: true, preview: true, tileset: false },
  previewOpen: true,
  inspectorLayout: null,
  colorSquareDock: null,
  colorSquareAnchor: null,
  floatingPanels: { color: null, palette: null, layers: null, preview: null, tileset: null },
  mainWindow: null,
  ...changes
})

describe('workspace layout preferences', () => {
  it('uses the built-in workspace arrangement when layout storage is empty', () => {
    const storage = createStorage()
    expect(loadPanelDocks(storage)).toEqual({ color: 'left', palette: 'left', layers: 'bottom', preview: 'bottom', tileset: 'right' })
    expect(loadToolRailSide(storage)).toBe('right')
    expect(loadInspectorWidth(1440, storage)).toBe(300)
    expect(loadLeftDockWidth(storage)).toBe(280)
    expect(loadBottomDockHeight(storage)).toBe(220)
  })

  it('restores every toolbar edge and resolves drag targets by the nearest edge', () => {
    const storage = createStorage()
    storage.setItem(TOOL_RAIL_SIDE_STORAGE_KEY, 'top')
    expect(loadToolRailSide(storage)).toBe('top')
    storage.setItem(TOOL_RAIL_SIDE_STORAGE_KEY, 'bottom')
    expect(loadToolRailSide(storage)).toBe('bottom')
    storage.setItem(TOOL_RAIL_SIDE_STORAGE_KEY, 'invalid')
    expect(loadToolRailSide(storage)).toBe('right')
    expect(toolRailDockTargetAtPointer(4, 400, 1000, 800)).toBe('left')
    expect(toolRailDockTargetAtPointer(996, 400, 1000, 800)).toBe('right')
    expect(toolRailDockTargetAtPointer(500, 4, 1000, 800)).toBe('top')
    expect(toolRailDockTargetAtPointer(500, 796, 1000, 800)).toBe('bottom')
    expect(normalizeWorkspaceLayout(layout({ toolRailSide: 'top' }), 1200, 800).toolRailSide).toBe('top')
    expect(normalizeWorkspaceLayout(layout({ toolRailSide: 'bottom' }), 1200, 800).toolRailSide).toBe('bottom')
  })

  it('constrains dock sizes for a smaller viewport without changing the preferred values', () => {
    expect(constrainInspectorWidth(420, 900)).toBe(420)
    expect(constrainInspectorWidth(420, 600)).toBe(380)
    expect(constrainLeftDockWidth(420, 900)).toBe(380)
    expect(constrainBottomDockHeight(500, 600)).toBe(407)
    expect(constrainInspectorWidth(-1, 900)).toBe(32)
    expect(constrainLeftDockWidth(-1, 900)).toBe(32)
    expect(constrainBottomDockHeight(-1, 600)).toBe(48)
  })

  it('clamps stored dimensions and migrates the legacy bottom layers dock', () => {
    const storage = createStorage()
    storage.setItem(INSPECTOR_WIDTH_STORAGE_KEY, '5000')
    storage.setItem(LEFT_DOCK_WIDTH_STORAGE_KEY, '0')
    storage.setItem(BOTTOM_DOCK_HEIGHT_STORAGE_KEY, '0')
    storage.setItem(LEGACY_LAYERS_DOCK_STORAGE_KEY, 'bottom')
    expect(loadInspectorWidth(1024, storage)).toBe(804)
    expect(loadLeftDockWidth(storage)).toBe(32)
    expect(loadBottomDockHeight(storage)).toBe(48)
    expect(loadPanelDocks(storage).layers).toBe('bottom')
  })

  it('validates native window geometry before restoring it', () => {
    const storage = createStorage()
    saveMainWindowState({ x: 20, y: 40, width: 1280, height: 720, maximized: true }, storage)
    expect(loadMainWindowState(storage)).toEqual({ x: 20, y: 40, width: 1280, height: 720, maximized: true })
    storage.setItem('moonsprite.main-window-state.v2', JSON.stringify({ x: 0, y: 0, width: 12, height: 12 }))
    expect(loadMainWindowState(storage)).toBeNull()
  })

  it('normalizes imported workspace layouts against the current viewport', () => {
    expect(normalizeWorkspaceLayout(layout({ inspectorWidth: 9000, leftDockWidth: -10, bottomDockHeight: 9000, toolRailSide: 'right' }), 1200, 800)).toMatchObject({
      inspectorWidth: 980,
      leftDockWidth: 32,
      bottomDockHeight: 520,
      toolRailSide: 'right'
    })
  })

  it('keeps side dock widths fixed while the bottom dock height follows its percentage', () => {
    const proportional = layout({ inspectorWidthRatio: 0.25, leftDockWidthRatio: 0.2, bottomDockHeightRatio: 0.3 })
    expect(normalizeWorkspaceLayout(proportional, 1200, 800)).toMatchObject({ inspectorWidth: 300, leftDockWidth: 280, bottomDockHeight: 240 })
    expect(normalizeWorkspaceLayout(proportional, 1800, 1000)).toMatchObject({ inspectorWidth: 300, leftDockWidth: 280, bottomDockHeight: 300 })
    expect(workspaceDockSizesForParent(300, 280, 0.3, 1800, 1000)).toEqual({ inspectorWidth: 300, leftDockWidth: 280, bottomDockHeight: 300 })
  })

  it('migrates ratio-only side docks once and applies compact visible minimums', () => {
    expect(resolveDockSizeRatio(null, 300, 1200, DEFAULT_INSPECTOR_WIDTH_RATIO)).toBe(0.25)
    expect(dockSizeRatio(220, 800, DEFAULT_BOTTOM_DOCK_HEIGHT_RATIO)).toBe(0.275)
    expect(dockSizeRatio(0, 800, DEFAULT_BOTTOM_DOCK_HEIGHT_RATIO)).toBe(0)
    expect(dockSizeFromRatio(0.25, 1600, DEFAULT_INSPECTOR_WIDTH_RATIO)).toBe(400)
    expect(dockSizeFromRatio(0, 1600, DEFAULT_INSPECTOR_WIDTH_RATIO)).toBe(0)
    expect(normalizeWorkspaceLayout(layout({ inspectorWidthRatio: 0.01, leftDockWidthRatio: 0.01, bottomDockHeightRatio: 0.01 }), 1200, 800)).toMatchObject({
      inspectorWidth: 300,
      leftDockWidth: 280,
      bottomDockHeight: 48
    })
    expect(normalizeWorkspaceLayout(layout({ inspectorWidthRatio: 0, leftDockWidthRatio: 0, bottomDockHeightRatio: 0 }), 1200, 800)).toMatchObject({
      inspectorWidth: 300,
      leftDockWidth: 280,
      bottomDockHeight: 48
    })
    const ratioOnly = layout({ inspectorWidth: undefined as unknown as number, leftDockWidth: undefined as unknown as number, inspectorWidthRatio: 0.25, leftDockWidthRatio: 0.2 })
    expect(normalizeWorkspaceLayout(ratioOnly, 1200, 800)).toMatchObject({ inspectorWidth: 300, leftDockWidth: 240 })
  })

  it('persists independent visibility for every workspace panel', () => {
    const storage = createStorage()
    savePanelVisibility({ color: true, palette: false, layers: true, preview: false, tileset: true }, storage)
    expect(storage.getItem(PANEL_VISIBILITY_STORAGE_KEY)).not.toBeNull()
    expect(loadPanelVisibility(storage)).toEqual({ color: true, palette: false, layers: true, preview: false, tileset: true })
  })

  it('migrates legacy preview visibility and repairs incomplete workspace layouts', () => {
    const legacy = layout({ panelVisibility: undefined, previewOpen: false })
    expect(normalizeWorkspaceLayout(legacy, 1200).panelVisibility).toEqual({ color: true, palette: true, layers: true, preview: false, tileset: false })
    expect(normalizeWorkspaceLayout(layout({ panelVisibility: { color: false, layers: false } }), 1200).panelVisibility).toEqual({ color: false, palette: true, layers: false, preview: true, tileset: false })
  })

  it('shows a newly added panel even when the live dock state still has legacy keys', () => {
    expect(workspacePanelDockPresence(
      { color: 'left', palette: 'left', layers: 'bottom', preview: 'bottom' },
      { color: false, palette: false, layers: false, preview: false, tileset: true }
    )).toEqual({ left: false, right: true, bottom: false })
  })
})
