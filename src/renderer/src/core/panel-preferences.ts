import { readStoredJson, readStoredString, removeStoredValue, writeStoredString } from './storage'

export { readStoredString, removeStoredValue, writeStoredString } from './storage'

export interface FloatingPosition { x: number; y: number; width?: number; height?: number }

interface PersistedFloatingPosition extends FloatingPosition {
  viewportWidth?: number
  viewportHeight?: number
}

interface ViewportSize { width: number; height: number }

export function loadFloatingPosition(key: string | undefined, initialPosition: FloatingPosition | null, viewport: ViewportSize, responsiveToViewport: boolean, forceDocked: boolean, storage?: Storage): FloatingPosition | null {
  if (forceDocked || !key) return forceDocked ? null : initialPosition
  try {
    const stored = readStoredJson<PersistedFloatingPosition | null>(key, null, storage)
    if (stored && Number.isFinite(stored.x) && Number.isFinite(stored.y)) {
      const scaleX = responsiveToViewport && stored.viewportWidth ? viewport.width / stored.viewportWidth : 1
      const scaleY = responsiveToViewport && stored.viewportHeight ? viewport.height / stored.viewportHeight : 1
      const scaledWidth = typeof stored.width === 'number' && Number.isFinite(stored.width) ? stored.width * scaleX : undefined
      const scaledHeight = typeof stored.height === 'number' && Number.isFinite(stored.height) ? stored.height * scaleY : undefined
      const width = scaledWidth === undefined ? undefined : scaledWidth > viewport.width * 1.25 ? initialPosition?.width ?? 280 : Math.max(180, Math.min(viewport.width - 12, scaledWidth))
      const height = scaledHeight === undefined ? undefined : scaledHeight > viewport.height * 1.25 ? initialPosition?.height ?? 240 : Math.max(120, Math.min(viewport.height - 12, scaledHeight))
      const measuredWidth = width ?? 220
      const measuredHeight = height ?? 130
      return {
        x: Math.max(0, Math.min(Math.max(0, viewport.width - measuredWidth), stored.x * scaleX)),
        y: Math.max(0, Math.min(Math.max(0, viewport.height - measuredHeight), stored.y * scaleY)),
        width,
        height
      }
    }
  } catch {
    return initialPosition
  }
  return initialPosition
}

export function saveFloatingPosition(key: string | undefined, position: FloatingPosition | null, viewport: ViewportSize, storage?: Storage): void {
  if (!key) return
  if (!position) {
    removeStoredValue(key, storage)
    return
  }
  writeStoredString(key, JSON.stringify({ ...position, viewportWidth: viewport.width, viewportHeight: viewport.height }), storage)
}

export type PanelColorPickerScheme = 'moon-ring' | 'sv-square' | 'hs-square' | 'wheel'
export interface PanelColorPickerConfig {
  scheme: PanelColorPickerScheme
  hueSteps: number
  colorSteps: number
  moonField?: 'hsv-square' | 'hsl-triangle'
}

export function parseColorPickerConfig(configValue: string | null, schemeValue: string | null, huePresets: readonly number[], colorPresets: readonly number[], fallbackScheme: PanelColorPickerScheme = 'sv-square'): PanelColorPickerConfig {
  const schemes: readonly PanelColorPickerScheme[] = ['moon-ring', 'sv-square', 'hs-square', 'wheel']
  const schemeFromStorage = schemes.includes(schemeValue as PanelColorPickerScheme) ? schemeValue as PanelColorPickerScheme : fallbackScheme
  const defaults: PanelColorPickerConfig = { scheme: schemeFromStorage, hueSteps: huePresets[0] ?? 0, colorSteps: colorPresets[0] ?? 0, moonField: 'hsv-square' }
  try {
    const stored = JSON.parse(configValue ?? 'null') as Partial<PanelColorPickerConfig> | null
    if (!stored) return defaults
    const nearestPreset = (value: unknown, presets: readonly number[]): number => {
      const numeric = Number(value)
      if (!Number.isFinite(numeric) || presets.length === 0) return presets[0] ?? 0
      return presets.reduce((nearest, preset) => Math.abs(preset - numeric) < Math.abs(nearest - numeric) ? preset : nearest, presets[0])
    }
    return {
      scheme: schemes.includes(stored.scheme as PanelColorPickerScheme) ? stored.scheme as PanelColorPickerScheme : defaults.scheme,
      hueSteps: nearestPreset(stored.hueSteps, huePresets),
      colorSteps: nearestPreset(stored.colorSteps, colorPresets),
      moonField: stored.moonField === 'hsl-triangle' ? 'hsl-triangle' : 'hsv-square'
    }
  } catch {
    return defaults
  }
}

export function saveColorPickerConfig(config: PanelColorPickerConfig, storage?: Storage): void {
  writeStoredString('moonsprite.color-picker-config', JSON.stringify(config), storage)
  writeStoredString('moonsprite.color-picker-scheme', config.scheme, storage)
}
