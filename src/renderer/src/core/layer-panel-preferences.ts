import { readStoredString, writeStoredString } from './storage'

export type LayerDisplayDensity = 'compact' | 'normal' | 'detailed' | 'expanded' | 'large' | 'huge'
export type FreeTileInstancePanelLayout = 'separate' | 'integrated'

export const LAYER_DENSITY_STORAGE_KEY = 'moonsprite.layers.display-density'
export const LAYER_SIDE_DOCK_AUTO_HIDE_STORAGE_KEY = 'moonsprite.layers.side-dock-auto-hide'
export const FREE_TILE_INSTANCE_PANEL_LAYOUT_STORAGE_KEY = 'moonsprite.layers.free-tile-instance-layout'

export const LAYER_DENSITY_ORDER: LayerDisplayDensity[] = ['compact', 'normal', 'detailed', 'expanded', 'large', 'huge']
export const DEFAULT_LAYER_DENSITY: LayerDisplayDensity = 'compact'
export const DEFAULT_FREE_TILE_INSTANCE_PANEL_LAYOUT: FreeTileInstancePanelLayout = 'separate'

export function loadLayerDensity(storage?: Storage): LayerDisplayDensity {
  const value = readStoredString(LAYER_DENSITY_STORAGE_KEY, storage)
  return LAYER_DENSITY_ORDER.includes(value as LayerDisplayDensity) ? value as LayerDisplayDensity : DEFAULT_LAYER_DENSITY
}

export function saveLayerDensity(value: LayerDisplayDensity, storage?: Storage): void {
  writeStoredString(LAYER_DENSITY_STORAGE_KEY, value, storage)
}

export function loadLayerSideDockAutoHide(storage?: Storage): boolean {
  return readStoredString(LAYER_SIDE_DOCK_AUTO_HIDE_STORAGE_KEY, storage) !== 'false'
}

export function saveLayerSideDockAutoHide(value: boolean, storage?: Storage): void {
  writeStoredString(LAYER_SIDE_DOCK_AUTO_HIDE_STORAGE_KEY, String(value), storage)
}

export function loadFreeTileInstancePanelLayout(storage?: Storage): FreeTileInstancePanelLayout {
  const value = readStoredString(FREE_TILE_INSTANCE_PANEL_LAYOUT_STORAGE_KEY, storage)
  return value === 'integrated' || value === 'separate' ? value : DEFAULT_FREE_TILE_INSTANCE_PANEL_LAYOUT
}

export function saveFreeTileInstancePanelLayout(value: FreeTileInstancePanelLayout, storage?: Storage): void {
  writeStoredString(FREE_TILE_INSTANCE_PANEL_LAYOUT_STORAGE_KEY, value, storage)
}
