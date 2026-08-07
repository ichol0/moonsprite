import type { RgbaColor, SelectionMask, ToolId } from '@shared/types'
import type { SelectionHandle, SelectionRotationHandle, SelectionShearHandle } from './canvas-input'
import { DEFAULT_CHECKERBOARD_PREFERENCES, type CheckerboardPreferences } from './file-preferences'

export const canvasCursors = {
  default: 'var(--cursor-default)', unavailable: 'var(--cursor-unavailable)', crosshair: 'var(--cursor-crosshair)', pencilWhite: 'var(--cursor-pencil-white)', pencilBlack: 'var(--cursor-pencil-black)', grab: 'var(--cursor-grab)', grabbing: 'var(--cursor-grabbing)',
  selectionWhite: 'var(--cursor-selection-white)', selectionBlack: 'var(--cursor-selection-black)', eyedropper: 'var(--cursor-eyedropper)', zoom: 'var(--cursor-zoom)', rotate: 'var(--cursor-rotate)', move: 'var(--cursor-move)', ewResize: 'var(--cursor-ew-resize)', nsResize: 'var(--cursor-ns-resize)',
  nwseResize: 'var(--cursor-nwse-resize)', neswResize: 'var(--cursor-nesw-resize)', selectionMove: 'var(--cursor-selection-move)', copy: 'var(--cursor-copy)',
  rotateNe: 'var(--cursor-selection-rotate-ne)', rotateSe: 'var(--cursor-selection-rotate-se)', rotateSw: 'var(--cursor-selection-rotate-sw)', rotateNw: 'var(--cursor-selection-rotate-nw)', shearHorizontal: 'var(--cursor-selection-shear-horizontal)', shearVertical: 'var(--cursor-selection-shear-vertical)'
} as const

export const resizeCursors: Record<SelectionHandle, string> = { nw: canvasCursors.nwseResize, n: canvasCursors.nsResize, ne: canvasCursors.neswResize, w: canvasCursors.ewResize, e: canvasCursors.ewResize, sw: canvasCursors.neswResize, s: canvasCursors.nsResize, se: canvasCursors.nwseResize }
export const rotationCursors: Record<SelectionRotationHandle, string> = { 'rotate-ne': canvasCursors.rotateNe, 'rotate-se': canvasCursors.rotateSe, 'rotate-sw': canvasCursors.rotateSw, 'rotate-nw': canvasCursors.rotateNw }
export const shearCursors: Record<SelectionShearHandle, string> = { 'shear-n': canvasCursors.shearHorizontal, 'shear-s': canvasCursors.shearHorizontal, 'shear-w': canvasCursors.shearVertical, 'shear-e': canvasCursors.shearVertical }

export const selectionTransformDragCursor = (kind: string): string | null =>
  kind === 'transform-content' || kind === 'rotate-content' || kind === 'shear-content' ? canvasCursors.move : null

export const selectionCreationCursor = (showCrosshair: boolean, available = true): string =>
  available ? showCrosshair ? canvasCursors.crosshair : 'none' : canvasCursors.unavailable

export const colorLuminance = (color: RgbaColor): number => color.r * 0.2126 + color.g * 0.7152 + color.b * 0.0722

export const canvasStatusTextColor = (backgrounds: RgbaColor[]): '#111318' | '#f1f4f8' => {
  const luminance = backgrounds.length > 0
    ? backgrounds.reduce((total, color) => total + colorLuminance(color), 0) / backgrounds.length
    : 0
  return luminance > 145 ? '#111318' : '#f1f4f8'
}

export interface VisualRect { x: number; y: number; width: number; height: number }

export const selectionPathPreviewPixelVisible = (
  pixel: VisualRect,
  viewportWidth: number,
  viewportHeight: number,
  insideDocument: boolean
): boolean => insideDocument
  && pixel.x + pixel.width > 0
  && pixel.y + pixel.height > 0
  && pixel.x < viewportWidth
  && pixel.y < viewportHeight

export const selectionCursorCornerRects = (pixel: VisualRect, devicePixelRatio = 1): VisualRect[] => {
  const dpr = Number.isFinite(devicePixelRatio) && devicePixelRatio > 0 ? devicePixelRatio : 1
  const align = (value: number): number => Math.round(value * dpr) / dpr
  const visualWidth = Math.max(8, pixel.width)
  const visualHeight = Math.max(8, pixel.height)
  const left = align(pixel.x + (pixel.width - visualWidth) / 2)
  const top = align(pixel.y + (pixel.height - visualHeight) / 2)
  const right = align(left + visualWidth)
  const bottom = align(top + visualHeight)
  const arm = Math.max(2, Math.min(4, Math.floor(Math.min(visualWidth, visualHeight) / 4)))
  const stroke = 1
  return [
    { x: left, y: top, width: arm, height: stroke },
    { x: left, y: top, width: stroke, height: arm },
    { x: right - arm, y: top, width: arm, height: stroke },
    { x: right - stroke, y: top, width: stroke, height: arm },
    { x: left, y: bottom - stroke, width: arm, height: stroke },
    { x: left, y: bottom - arm, width: stroke, height: arm },
    { x: right - arm, y: bottom - stroke, width: arm, height: stroke },
    { x: right - stroke, y: bottom - arm, width: stroke, height: arm }
  ]
}

export const transparencyColorAt = (pixelX: number, pixelY: number, checkerboard: CheckerboardPreferences = DEFAULT_CHECKERBOARD_PREFERENCES): RgbaColor =>
  (Math.floor(pixelX / checkerboard.size) + Math.floor(pixelY / checkerboard.size)) % 2 === 0
    ? checkerboard.lightColor
    : checkerboard.darkColor

const colorCursorTools = new Set<ToolId>(['pencil', 'eraser', 'fill', 'selection'])
export const previewCursorTools = new Set<ToolId>(['pencil', 'eraser', 'fill', 'shape'])

export const canvasToolCursor = (tool: ToolId, color: RgbaColor, available = true): string => {
  if (tool === 'rotate') return canvasCursors.rotate
  if (!available) return canvasCursors.unavailable
  if (tool === 'hand') return canvasCursors.grab
  if (tool === 'move') return canvasCursors.move
  if (tool === 'zoom') return canvasCursors.zoom
  if (tool === 'selection') return colorLuminance(color) < 145 ? canvasCursors.selectionWhite : canvasCursors.selectionBlack
  if (colorCursorTools.has(tool)) return colorLuminance(color) < 145 ? canvasCursors.pencilWhite : canvasCursors.pencilBlack
  return canvasCursors.crosshair
}

/** 返回选区边界像素，供预览层单独绘制，避免与文档像素合成耦合。 */
export const selectionPreviewPixels = (selection: SelectionMask): Set<string> => {
  const pixels = new Set<string>()
  if (!selection.mask) {
    for (let x = selection.x; x < selection.x + selection.width; x += 1) {
      pixels.add(`${x}:${selection.y}`)
      pixels.add(`${x}:${selection.y + selection.height - 1}`)
    }
    for (let y = selection.y + 1; y < selection.y + selection.height - 1; y += 1) {
      pixels.add(`${selection.x}:${y}`)
      pixels.add(`${selection.x + selection.width - 1}:${y}`)
    }
    return pixels
  }
  const selectedAt = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < selection.width && y < selection.height && selection.mask![y * selection.width + x] === 1
  for (let y = 0; y < selection.height; y += 1) for (let x = 0; x < selection.width; x += 1) {
    if (!selectedAt(x, y)) continue
    if (!selectedAt(x - 1, y) || !selectedAt(x + 1, y) || !selectedAt(x, y - 1) || !selectedAt(x, y + 1)) pixels.add(`${selection.x + x}:${selection.y + y}`)
  }
  return pixels
}
