import { describe, expect, it } from 'vitest'
import type { WorkspaceLayout } from '@shared/types'
import { INSPECTOR_WIDTH_STORAGE_KEY, LEGACY_LAYERS_DOCK_STORAGE_KEY, loadInspectorWidth, loadMainWindowState, loadPanelDocks, normalizeWorkspaceLayout, saveMainWindowState } from './workspace-layout-preferences'

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
  previewOpen: true,
  inspectorLayout: null,
  colorSquareDock: null,
  colorSquareAnchor: null,
  floatingPanels: { color: null, palette: null, layers: null, preview: null },
  mainWindow: null,
  ...changes
})

describe('workspace layout preferences', () => {
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
    expect(normalizeWorkspaceLayout(layout({ inspectorWidth: 9000, leftDockWidth: -10, bottomDockHeight: 9000, toolRailSide: 'right' }), 1200)).toMatchObject({
      inspectorWidth: 980,
      leftDockWidth: 180,
      bottomDockHeight: 520,
      toolRailSide: 'right'
    })
  })
})
