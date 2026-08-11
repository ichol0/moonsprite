import type { ToolRailSide, WorkspaceLayout, WorkspacePanelDock, WorkspacePanelId } from '@shared/types'
import { readStoredJson, readStoredString, removeStoredValue, writeStoredJson, writeStoredString } from './storage'

export type MainWindowState = NonNullable<WorkspaceLayout['mainWindow']>

export const MAIN_WINDOW_STORAGE_KEY = 'moonsprite.main-window-state.v2'
export const INSPECTOR_WIDTH_STORAGE_KEY = 'moonsprite.inspector-width.v1'
export const PANEL_DOCKS_STORAGE_KEY = 'moonsprite.panel-docks.v1'
export const PANEL_VISIBILITY_STORAGE_KEY = 'moonsprite.panel-visibility.v1'
export const LEGACY_LAYERS_DOCK_STORAGE_KEY = 'moonsprite.layers-dock.v1'
export const BOTTOM_DOCK_HEIGHT_STORAGE_KEY = 'moonsprite.bottom-layers-height.v1'
export const LEFT_DOCK_WIDTH_STORAGE_KEY = 'moonsprite.left-dock-width.v1'
export const TOOL_RAIL_SIDE_STORAGE_KEY = 'moonsprite.tool-rail-side.v1'
export const INSPECTOR_LAYOUT_STORAGE_KEY = 'moonsprite.inspector-layout.v2'
export const COLOR_SQUARE_DOCK_STORAGE_KEY = 'moonsprite.color-picker-square-dock'
export const COLOR_SQUARE_ANCHOR_STORAGE_KEY = 'moonsprite.color-picker-square-anchor'
export const ACTIVE_WORKSPACE_STORAGE_KEY = 'moonsprite.active-workspace.v1'
export const FLOATING_PANEL_STORAGE_KEYS: Record<WorkspacePanelId, string> = {
  color: 'moonsprite.color-panel.v1',
  palette: 'moonsprite.palette-panel.v1',
  layers: 'moonsprite.layers-panel.v1',
  preview: 'moonsprite.preview-panel.v1'
}

export const DEFAULT_PANEL_DOCKS: Record<WorkspacePanelId, WorkspacePanelDock> = {
  color: 'left', palette: 'left', layers: 'right', preview: 'right'
}
export const DEFAULT_PANEL_VISIBILITY: Record<WorkspacePanelId, boolean> = {
  color: true, palette: true, layers: true, preview: true
}

const clamp = (value: unknown, fallback: number, minimum: number, maximum: number): number => {
  const number = Number(value)
  return Number.isFinite(number) ? Math.max(minimum, Math.min(maximum, number)) : fallback
}

export function constrainInspectorWidth(width: number, viewportWidth: number): number {
  return clamp(width, 310, 180, Math.max(180, viewportWidth - 220))
}

export function constrainLeftDockWidth(width: number, viewportWidth: number): number {
  return clamp(width, 250, 180, Math.min(520, Math.max(180, viewportWidth - 520)))
}

export function constrainBottomDockHeight(height: number, availableHeight: number): number {
  return clamp(height, 190, 120, Math.max(120, Math.min(520, availableHeight - 43 - 150)))
}

export function loadToolRailSide(storage?: Storage): ToolRailSide {
  return readStoredString(TOOL_RAIL_SIDE_STORAGE_KEY, storage) === 'right' ? 'right' : 'left'
}

export function loadInspectorWidth(viewportWidth: number, storage?: Storage): number {
  return constrainInspectorWidth(Number(readStoredString(INSPECTOR_WIDTH_STORAGE_KEY, storage)), viewportWidth)
}

export function loadPanelDocks(storage?: Storage): Record<WorkspacePanelId, WorkspacePanelDock> {
  const stored = readStoredJson<Partial<Record<WorkspacePanelId, WorkspacePanelDock>> | null>(PANEL_DOCKS_STORAGE_KEY, null, storage)
  const next = { ...DEFAULT_PANEL_DOCKS }
  for (const id of Object.keys(next) as WorkspacePanelId[]) {
    const dock = stored?.[id]
    if (dock === 'right' || dock === 'left' || dock === 'bottom' || dock === 'floating') next[id] = dock
  }
  if (!stored && readStoredString(LEGACY_LAYERS_DOCK_STORAGE_KEY, storage) === 'bottom') next.layers = 'bottom'
  return next
}

export function loadPanelVisibility(storage?: Storage): Record<WorkspacePanelId, boolean> {
  const stored = readStoredJson<Partial<Record<WorkspacePanelId, boolean>> | null>(PANEL_VISIBILITY_STORAGE_KEY, null, storage)
  const next = { ...DEFAULT_PANEL_VISIBILITY }
  if (!stored) return next
  for (const id of Object.keys(next) as WorkspacePanelId[]) if (typeof stored[id] === 'boolean') next[id] = stored[id]!
  return next
}

export function loadBottomDockHeight(storage?: Storage): number {
  return clamp(readStoredString(BOTTOM_DOCK_HEIGHT_STORAGE_KEY, storage), 190, 120, 520)
}

export function loadLeftDockWidth(storage?: Storage): number {
  return clamp(readStoredString(LEFT_DOCK_WIDTH_STORAGE_KEY, storage), 250, 180, 520)
}

export function loadMainWindowState(storage?: Storage): MainWindowState | null {
  const value = readStoredJson<Partial<MainWindowState> | null>(MAIN_WINDOW_STORAGE_KEY, null, storage)
  if (!value) return null
  const numbers = [value.x, value.y, value.width, value.height]
  if (!numbers.every((item) => typeof item === 'number' && Number.isFinite(item))) return null
  if (value.width! < 640 || value.height! < 400 || value.width! > 32_768 || value.height! > 32_768) return null
  return { x: value.x!, y: value.y!, width: value.width!, height: value.height!, maximized: value.maximized === true }
}

export function saveMainWindowState(state: MainWindowState, storage?: Storage): void {
  writeStoredJson(MAIN_WINDOW_STORAGE_KEY, state, storage)
}

export function savePanelDocks(panelDocks: Record<WorkspacePanelId, WorkspacePanelDock>, storage?: Storage): void {
  writeStoredJson(PANEL_DOCKS_STORAGE_KEY, panelDocks, storage)
}

export function savePanelVisibility(panelVisibility: Record<WorkspacePanelId, boolean>, storage?: Storage): void {
  writeStoredJson(PANEL_VISIBILITY_STORAGE_KEY, panelVisibility, storage)
}

export function readLayoutStorage(key: string, storage?: Storage): string | null {
  return readStoredString(key, storage)
}

export function writeLayoutStorage(key: string, value: string | null, storage?: Storage): void {
  if (value === null) removeStoredValue(key, storage)
  else writeStoredString(key, value, storage)
}

export interface NormalizedWorkspaceLayout {
  panelDocks: Record<WorkspacePanelId, WorkspacePanelDock>
  panelVisibility: Record<WorkspacePanelId, boolean>
  inspectorWidth: number
  leftDockWidth: number
  bottomDockHeight: number
  toolRailSide: ToolRailSide
  previewOpen: boolean
}

export function normalizeWorkspaceLayout(layout: WorkspaceLayout, viewportWidth: number): NormalizedWorkspaceLayout {
  const panelDocks = { ...DEFAULT_PANEL_DOCKS }
  for (const id of Object.keys(panelDocks) as WorkspacePanelId[]) {
    const dock = layout.panelDocks?.[id]
    if (dock === 'left' || dock === 'right' || dock === 'bottom' || dock === 'floating') panelDocks[id] = dock
  }
  const panelVisibility = { ...DEFAULT_PANEL_VISIBILITY }
  if (layout.panelVisibility) {
    for (const id of Object.keys(panelVisibility) as WorkspacePanelId[]) if (typeof layout.panelVisibility[id] === 'boolean') panelVisibility[id] = layout.panelVisibility[id]!
  } else {
    panelVisibility.preview = layout.previewOpen !== false
  }
  return {
    panelDocks,
    panelVisibility,
    inspectorWidth: constrainInspectorWidth(layout.inspectorWidth, viewportWidth),
    leftDockWidth: constrainLeftDockWidth(layout.leftDockWidth, viewportWidth),
    bottomDockHeight: clamp(layout.bottomDockHeight, 190, 120, 520),
    toolRailSide: layout.toolRailSide === 'right' ? 'right' : 'left',
    previewOpen: panelVisibility.preview
  }
}
