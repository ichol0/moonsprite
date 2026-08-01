import type { RgbaColor, SelectionMask, ToolId } from '@shared/types'
import type { SelectionHandle, SelectionRotationHandle } from './canvas-input'

export const canvasCursors = {
  default: 'var(--cursor-default)', unavailable: 'var(--cursor-unavailable)', crosshair: 'var(--cursor-crosshair)', pencilWhite: 'var(--cursor-pencil-white)', pencilBlack: 'var(--cursor-pencil-black)', grab: 'var(--cursor-grab)', grabbing: 'var(--cursor-grabbing)',
  selectionWhite: 'var(--cursor-selection-white)', selectionBlack: 'var(--cursor-selection-black)', eyedropper: 'var(--cursor-eyedropper)', zoom: 'var(--cursor-zoom)', rotate: 'var(--cursor-rotate)', move: 'var(--cursor-move)', ewResize: 'var(--cursor-ew-resize)', nsResize: 'var(--cursor-ns-resize)',
  nwseResize: 'var(--cursor-nwse-resize)', neswResize: 'var(--cursor-nesw-resize)', selectionMove: 'var(--cursor-selection-move)', copy: 'var(--cursor-copy)',
  rotateNe: 'var(--cursor-selection-rotate-ne)', rotateSe: 'var(--cursor-selection-rotate-se)', rotateSw: 'var(--cursor-selection-rotate-sw)', rotateNw: 'var(--cursor-selection-rotate-nw)'
} as const

export const resizeCursors: Record<SelectionHandle, string> = { nw: canvasCursors.nwseResize, n: canvasCursors.nsResize, ne: canvasCursors.neswResize, w: canvasCursors.ewResize, e: canvasCursors.ewResize, sw: canvasCursors.neswResize, s: canvasCursors.nsResize, se: canvasCursors.nwseResize }
export const rotationCursors: Record<SelectionRotationHandle, string> = { 'rotate-ne': canvasCursors.rotateNe, 'rotate-se': canvasCursors.rotateSe, 'rotate-sw': canvasCursors.rotateSw, 'rotate-nw': canvasCursors.rotateNw }

export const colorLuminance = (color: RgbaColor): number => color.r * 0.2126 + color.g * 0.7152 + color.b * 0.0722

export const transparencyColorAt = (pixelX: number, pixelY: number): RgbaColor =>
  (Math.floor(pixelX / 16) + Math.floor(pixelY / 16)) % 2 === 0
    ? { r: 215, g: 215, b: 217, a: 255 }
    : { r: 155, g: 155, b: 159, a: 255 }

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
