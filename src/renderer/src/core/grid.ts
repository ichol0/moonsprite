import type { GridSettings, SelectionRect } from '@shared/types'

export const DEFAULT_GRID_SETTINGS: GridSettings = { x: 0, y: 0, width: 16, height: 16 }
export const PIXEL_GRID_MIN_ZOOM = 8

export const shouldRenderPixelGrid = (zoom: number): boolean => Number.isFinite(zoom) && zoom >= PIXEL_GRID_MIN_ZOOM

export const normalizeGridSettings = (value?: Partial<GridSettings> | null): GridSettings => ({
  x: Number.isFinite(value?.x) ? Math.trunc(value!.x!) : DEFAULT_GRID_SETTINGS.x,
  y: Number.isFinite(value?.y) ? Math.trunc(value!.y!) : DEFAULT_GRID_SETTINGS.y,
  width: Number.isFinite(value?.width) ? Math.max(1, Math.trunc(value!.width!)) : DEFAULT_GRID_SETTINGS.width,
  height: Number.isFinite(value?.height) ? Math.max(1, Math.trunc(value!.height!)) : DEFAULT_GRID_SETTINGS.height
})

export const gridCellBoundsAt = (point: { x: number; y: number }, grid: GridSettings, canvasWidth: number, canvasHeight: number): SelectionRect | null => {
  if (![point.x, point.y, grid.x, grid.y, grid.width, grid.height, canvasWidth, canvasHeight].every(Number.isFinite)) return null
  if (grid.width <= 0 || grid.height <= 0 || canvasWidth <= 0 || canvasHeight <= 0 || point.x < 0 || point.y < 0 || point.x >= canvasWidth || point.y >= canvasHeight) return null
  const cellX = grid.x + Math.floor((point.x - grid.x) / grid.width) * grid.width
  const cellY = grid.y + Math.floor((point.y - grid.y) / grid.height) * grid.height
  const left = Math.max(0, cellX)
  const top = Math.max(0, cellY)
  const right = Math.min(canvasWidth, cellX + grid.width)
  const bottom = Math.min(canvasHeight, cellY + grid.height)
  return right > left && bottom > top ? { x: left, y: top, width: right - left, height: bottom - top } : null
}

const lineStride = (cellSize: number, zoom: number, minimumScreenSpacing: number): number => {
  const screenSpacing = Math.abs(cellSize * zoom)
  if (screenSpacing <= 0) return 1
  return Math.max(1, Math.ceil(minimumScreenSpacing / screenSpacing))
}

/** Returns grid coordinates visible in [from, to], skipping dense lines at low zoom. */
export const gridLinePositions = (
  origin: number,
  cellSize: number,
  from: number,
  to: number,
  zoom: number,
  minimumScreenSpacing = 4
): number[] => {
  if (!Number.isFinite(origin) || !Number.isFinite(cellSize) || cellSize <= 0 || to < from) return []
  const stride = lineStride(cellSize, zoom, minimumScreenSpacing)
  const first = Math.ceil((from - origin) / cellSize)
  const last = Math.floor((to - origin) / cellSize)
  const firstAligned = Math.ceil(first / stride) * stride
  const positions: number[] = []
  for (let index = firstAligned; index <= last; index += stride) positions.push(origin + index * cellSize)
  return positions
}
