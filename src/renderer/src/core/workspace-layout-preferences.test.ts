import { describe, expect, it } from 'vitest'
import type { WorkspaceLayout } from '@shared/types'
import { constrainBottomDockHeight, constrainInspectorWidth, constrainLeftDockWidth, DEFAULT_BOTTOM_DOCK_HEIGHT_RATIO, DEFAULT_INSPECTOR_WIDTH_RATIO, dockSizeFromRatio, dockSizeRatio, INSPECTOR_WIDTH_STORAGE_KEY, LEGACY_LAYERS_DOCK_STORAGE_KEY, PANEL_VISIBILITY_STORAGE_KEY, loadBottomDockHeight, loadInspectorWidth, loadLeftDockWidth, loadMainWindowState, loadPanelDocks, loadPanelVisibility, loadToolRailSide, normalizeWorkspaceLayout, resolveDockSizeRatio, saveMainWindowState, savePanelVisibility } from './workspace-layout-preferences'

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
  panelDocks: { color: 'left', palette: 'left', layers: 'right', preview: 'right' },
  inspectorWidth: 300,
  leftDockWidth: 280,
  bottomDockHeight: 180,
  toolRailSide: 'left',
  panelVisibility: { color: true, palette: true, layers: true, preview: true },
  previewOpen: true,
  inspectorLayout: null,
  colorSquareDock: null,
  colorSquareAnchor: null,
  floatingPanels: { color: null, palette: null, layers: null, preview: null },
  mainWindow: null,
  ...changes
})

describe('workspace layout preferences', () => {
  it('uses the built-in workspace arrangement when layout storage is empty', () => {
    const storage = createStorage()
    expect(loadPanelDocks(storage)).toEqual({ color: 'left', palette: 'left', layers: 'bottom', preview: 'bottom' })
    expect(loadToolRailSide(storage)).toBe('right')
    expect(loadInspectorWidth(1440, storage)).toBe(300)
    expect(loadLeftDockWidth(storage)).toBe(280)
    expect(loadBottomDockHeight(storage)).toBe(220)
  })

  it('constrains dock sizes for a smaller viewport without changing the preferred values', () => {
    expect(constrainInspectorWidth(420, 900)).toBe(420)
    expect(constrainInspectorWidth(420, 600)).toBe(380)
    expect(constrainLeftDockWidth(420, 900)).toBe(380)
    expect(constrainBottomDockHeight(500, 600)).toBe(407)
  })

  it('clamps stored dimensions and migrates the legacy bottom layers dock', () => {
    const storage = createStorage()
    storage.setItem(INSPECTOR_WIDTH_STORAGE_KEY, '5000')
    storage.setItem(LEGACY_LAYERS_DOCK_STORAGE_KEY, 'bottom')
    expect(loadInspectorWidth(1024, storage)).toBe(804)
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
      leftDockWidth: 180,
      bottomDockHeight: 520,
      toolRailSide: 'right'
    })
  })

  it('keeps every outer dock proportional to its parent across window sizes', () => {
    const proportional = layout({ inspectorWidthRatio: 0.25, leftDockWidthRatio: 0.2, bottomDockHeightRatio: 0.3 })
    expect(normalizeWorkspaceLayout(proportional, 1200, 800)).toMatchObject({ inspectorWidth: 300, leftDockWidth: 240, bottomDockHeight: 240 })
    expect(normalizeWorkspaceLayout(proportional, 1800, 1000)).toMatchObject({ inspectorWidth: 450, leftDockWidth: 360, bottomDockHeight: 300 })
  })

  it('migrates pixel sizes to ratios and still applies minimum dimensions', () => {
    expect(resolveDockSizeRatio(null, 300, 1200, DEFAULT_INSPECTOR_WIDTH_RATIO)).toBe(0.25)
    expect(dockSizeRatio(220, 800, DEFAULT_BOTTOM_DOCK_HEIGHT_RATIO)).toBe(0.275)
    expect(dockSizeFromRatio(0.25, 1600, DEFAULT_INSPECTOR_WIDTH_RATIO)).toBe(400)
    expect(normalizeWorkspaceLayout(layout({ inspectorWidthRatio: 0.01, leftDockWidthRatio: 0.01, bottomDockHeightRatio: 0.01 }), 1200, 800)).toMatchObject({
      inspectorWidth: 180,
      leftDockWidth: 180,
      bottomDockHeight: 120
    })
  })

  it('persists independent visibility for every workspace panel', () => {
    const storage = createStorage()
    savePanelVisibility({ color: true, palette: false, layers: true, preview: false }, storage)
    expect(storage.getItem(PANEL_VISIBILITY_STORAGE_KEY)).not.toBeNull()
    expect(loadPanelVisibility(storage)).toEqual({ color: true, palette: false, layers: true, preview: false })
  })

  it('migrates legacy preview visibility and repairs incomplete workspace layouts', () => {
    const legacy = layout({ panelVisibility: undefined, previewOpen: false })
    expect(normalizeWorkspaceLayout(legacy, 1200).panelVisibility).toEqual({ color: true, palette: true, layers: true, preview: false })
    expect(normalizeWorkspaceLayout(layout({ panelVisibility: { color: false, layers: false } }), 1200).panelVisibility).toEqual({ color: false, palette: true, layers: false, preview: true })
  })
})
