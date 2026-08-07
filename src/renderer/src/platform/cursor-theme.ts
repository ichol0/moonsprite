import type { CursorScale } from '@/core/file-preferences'
import { translateCurrent as tr } from '@/core/localization'
import cursorDefault from '@/assets/pixel-icons/01-Slice-1.png'
import cursorBlack from '@/assets/pixel-icons/02-Slice-2.png'
import cursorWhite from '@/assets/pixel-icons/03-Slice-3.png'
import cursorProgress from '@/assets/pixel-icons/04-Slice-4.png'
import cursorGrab from '@/assets/pixel-icons/05-Slice-5.png'
import cursorUnavailable from '@/assets/pixel-icons/06-Slice-6.png'
import cursorNsResize from '@/assets/pixel-icons/10-Slice-7.png'
import cursorEwResize from '@/assets/pixel-icons/11-Slice-8.png'
import cursorNwseResize from '@/assets/pixel-icons/12-Slice-9.png'
import cursorNeswResize from '@/assets/pixel-icons/13-Slice-10.png'
import cursorMove from '@/assets/pixel-icons/14-Slice-11.png'
import cursorEyedropper from '@/assets/pixel-icons/15-Slice-12.png'
import cursorSelectionMove from '@/assets/pixel-icons/16-Icon-16.png'
import cursorCopy from '@/assets/pixel-icons/17-Icon-17.png'
import cursorZoom from '@/assets/pixel-icons/19-Slice-13.png'
import cursorRotate from '@/assets/pixel-icons/20-Slice-14.png'
import cursorRotateNe from '@/assets/pixel-icons/21-Slice-15.png'
import cursorRotateSe from '@/assets/pixel-icons/22-Slice-16.png'
import cursorRotateSw from '@/assets/pixel-icons/23-Slice-17.png'
import cursorRotateNw from '@/assets/pixel-icons/24-Icon-24.png'
import builtinRotate from '@/assets/pixel-icons/cursor-rotate.png'
import builtinRotateNe from '@/assets/pixel-icons/cursor-selection-rotate-ne.png'
import builtinRotateSe from '@/assets/pixel-icons/cursor-selection-rotate-se.png'
import builtinRotateSw from '@/assets/pixel-icons/cursor-selection-rotate-sw.png'
import builtinRotateNw from '@/assets/pixel-icons/cursor-selection-rotate-nw.png'
import cursorShearHorizontal from '@/assets/pixel-icons/cursor-selection-shear-horizontal.png'
import cursorShearVertical from '@/assets/pixel-icons/cursor-selection-shear-vertical.png'

interface CursorDefinition {
  variable: string
  source: string
  builtinSource?: string
  hotspot: [number, number]
  fallback: string
}

const cursorDefinitions: CursorDefinition[] = [
  { variable: '--cursor-default', source: cursorDefault, hotspot: [9, 5], fallback: 'default' },
  { variable: '--cursor-help', source: cursorDefault, hotspot: [9, 5], fallback: 'help' },
  { variable: '--cursor-progress', source: cursorProgress, hotspot: [11, 5], fallback: 'progress' },
  { variable: '--cursor-wait', source: cursorProgress, hotspot: [11, 5], fallback: 'wait' },
  { variable: '--cursor-project', source: cursorProgress, hotspot: [11, 5], fallback: 'pointer' },
  { variable: '--cursor-crosshair', source: cursorWhite, hotspot: [15, 15], fallback: 'crosshair' },
  { variable: '--cursor-text', source: cursorDefault, hotspot: [9, 5], fallback: 'text' },
  { variable: '--cursor-pointer', source: cursorDefault, hotspot: [9, 5], fallback: 'pointer' },
  { variable: '--cursor-pencil-black', source: cursorBlack, hotspot: [15, 15], fallback: 'crosshair' },
  { variable: '--cursor-pencil-white', source: cursorWhite, hotspot: [15, 15], fallback: 'crosshair' },
  { variable: '--cursor-selection-black', source: cursorBlack, hotspot: [15, 15], fallback: 'crosshair' },
  { variable: '--cursor-selection-white', source: cursorWhite, hotspot: [15, 15], fallback: 'crosshair' },
  { variable: '--cursor-unavailable', source: cursorUnavailable, hotspot: [15, 15], fallback: 'not-allowed' },
  { variable: '--cursor-grab', source: cursorGrab, hotspot: [16, 16], fallback: 'grab' },
  { variable: '--cursor-grabbing', source: cursorGrab, hotspot: [16, 16], fallback: 'grabbing' },
  { variable: '--cursor-move', source: cursorMove, hotspot: [3, 3], fallback: 'move' },
  { variable: '--cursor-swatch-edge', source: cursorMove, hotspot: [3, 3], fallback: 'default' },
  { variable: '--cursor-eyedropper', source: cursorEyedropper, hotspot: [5, 28], fallback: 'crosshair' },
  { variable: '--cursor-selection-move', source: cursorSelectionMove, hotspot: [3, 3], fallback: 'move' },
  { variable: '--cursor-copy', source: cursorCopy, hotspot: [5, 3], fallback: 'copy' },
  { variable: '--cursor-zoom', source: cursorZoom, hotspot: [13, 13], fallback: 'zoom-in' },
  { variable: '--cursor-rotate', source: cursorRotate, builtinSource: builtinRotate, hotspot: [12, 22], fallback: 'crosshair' },
  { variable: '--cursor-ns-resize', source: cursorNsResize, hotspot: [15, 15], fallback: 'ns-resize' },
  { variable: '--cursor-n-resize', source: cursorNsResize, hotspot: [15, 15], fallback: 'n-resize' },
  { variable: '--cursor-ew-resize', source: cursorEwResize, hotspot: [15, 15], fallback: 'ew-resize' },
  { variable: '--cursor-nwse-resize', source: cursorNwseResize, hotspot: [16, 16], fallback: 'nwse-resize' },
  { variable: '--cursor-nesw-resize', source: cursorNeswResize, hotspot: [16, 16], fallback: 'nesw-resize' },
  { variable: '--cursor-selection-rotate-ne', source: cursorRotateNe, builtinSource: builtinRotateNe, hotspot: [16, 16], fallback: 'crosshair' },
  { variable: '--cursor-selection-rotate-se', source: cursorRotateSe, builtinSource: builtinRotateSe, hotspot: [16, 16], fallback: 'crosshair' },
  { variable: '--cursor-selection-rotate-sw', source: cursorRotateSw, builtinSource: builtinRotateSw, hotspot: [16, 16], fallback: 'crosshair' },
  { variable: '--cursor-selection-rotate-nw', source: cursorRotateNw, builtinSource: builtinRotateNw, hotspot: [16, 16], fallback: 'crosshair' },
  { variable: '--cursor-selection-shear-horizontal', source: cursorShearHorizontal, builtinSource: cursorShearHorizontal, hotspot: [16, 16], fallback: 'ew-resize' },
  { variable: '--cursor-selection-shear-vertical', source: cursorShearVertical, builtinSource: cursorShearVertical, hotspot: [16, 16], fallback: 'ns-resize' }
]

export type CursorPreferenceSource = 'system' | 'moonsprite'

export const cursorPreferenceSource = (variable: string, useLocalCursors: boolean): CursorPreferenceSource => {
  const definition = cursorDefinitions.find((item) => item.variable === variable)
  return useLocalCursors && !definition?.builtinSource ? 'system' : 'moonsprite'
}

const scaledCursorCache = new Map<string, Promise<string>>()
let applicationGeneration = 0

const scaledCursorUrl = (source: string, scale: CursorScale): Promise<string> => {
  const key = `${source}:${scale}`
  const cached = scaledCursorCache.get(key)
  if (cached) return cached
  const pending = new Promise<string>((resolve, reject) => {
    const image = new Image()
    image.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale))
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale))
      const context = canvas.getContext('2d')
      if (!context) { reject(new Error(tr('core.cursor.scaleFailed'))); return }
      context.imageSmoothingEnabled = false
      context.drawImage(image, 0, 0, canvas.width, canvas.height)
      resolve(canvas.toDataURL('image/png'))
    }
    image.onerror = () => reject(new Error(tr('core.cursor.readFailed')))
    image.src = source
  })
  scaledCursorCache.set(key, pending)
  return pending
}

export async function applyCursorPreferences(useLocalCursors: boolean, scale: CursorScale): Promise<void> {
  const generation = ++applicationGeneration
  const root = document.documentElement.style
  // Install an unscaled value synchronously so a preference refresh never falls
  // back to the browser cursor while scaled assets are loading.
  for (const definition of cursorDefinitions) {
    if (cursorPreferenceSource(definition.variable, useLocalCursors) === 'system') {
      root.setProperty(definition.variable, definition.fallback)
      continue
    }
    const builtinSource = definition.builtinSource ?? definition.source
    const preferredSource = useLocalCursors ? builtinSource : definition.source
    const hotspotX = definition.hotspot[0]
    const hotspotY = definition.hotspot[1]
    root.setProperty(definition.variable, `url('${preferredSource}') ${hotspotX} ${hotspotY}, url('${builtinSource}') ${hotspotX} ${hotspotY}, ${definition.fallback}`)
  }
  const values = await Promise.all(cursorDefinitions.map(async (definition) => {
    if (cursorPreferenceSource(definition.variable, useLocalCursors) === 'system') {
      return [definition.variable, definition.fallback] as const
    }
    const builtinSource = definition.builtinSource ?? definition.source
    const preferredSource = useLocalCursors ? builtinSource : definition.source
    const source = scale === 1
      ? preferredSource
      : await scaledCursorUrl(preferredSource, scale).catch(() => scaledCursorUrl(builtinSource, scale))
    const builtin = scale === 1 ? builtinSource : await scaledCursorUrl(builtinSource, scale)
    const hotspotX = Math.round(definition.hotspot[0] * scale)
    const hotspotY = Math.round(definition.hotspot[1] * scale)
    const builtinValue = `url('${builtin}') ${hotspotX} ${hotspotY}`
    return [definition.variable, `url('${source}') ${hotspotX} ${hotspotY}, ${builtinValue}, ${definition.fallback}`] as const
  }))
  if (generation !== applicationGeneration) return
  for (const [variable, value] of values) root.setProperty(variable, value)
}
