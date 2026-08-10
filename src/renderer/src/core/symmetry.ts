import type { SelectionMask, SelectionRect } from '@shared/types'
import { selectionContains, transformedSelectionBounds, transformedSelectionSourcePoint, type SelectionShearTransform } from './selection'

export interface SymmetryAxes {
  horizontal: boolean
  vertical: boolean
  diagonalUp: boolean
  diagonalDown: boolean
}

export interface SymmetryPoint { x: number; y: number }
export interface SymmetryCenter { x: number; y: number }
export type SymmetryAxis = keyof SymmetryAxes
export interface SymmetryAxisSegment { start: SymmetryPoint; end: SymmetryPoint }

export const DEFAULT_SYMMETRY_AXES: SymmetryAxes = {
  horizontal: false,
  vertical: false,
  diagonalUp: false,
  diagonalDown: false
}

export const hasSymmetry = (axes: SymmetryAxes | null | undefined): boolean =>
  Boolean(axes?.horizontal || axes?.vertical || axes?.diagonalUp || axes?.diagonalDown)

export const defaultSymmetryCenter = (width: number, height: number): SymmetryCenter => ({ x: width / 2, y: height / 2 })

const resolvedCenter = (width: number, height: number, center?: SymmetryCenter | null): SymmetryCenter => center ?? defaultSymmetryCenter(width, height)
const snapHalf = (value: number): number => Math.round(value * 2) / 2
const clamp = (value: number, minimum: number, maximum: number): number => Math.max(minimum, Math.min(maximum, value))

export function moveSymmetryCenter(center: SymmetryCenter, axis: SymmetryAxis | 'center', point: SymmetryCenter, width: number, height: number): SymmetryCenter {
  let x = center.x
  let y = center.y
  if (axis === 'center') {
    x = point.x
    y = point.y
  } else if (axis === 'horizontal') y = point.y
  else if (axis === 'vertical') x = point.x
  else if (axis === 'diagonalDown') {
    const delta = (point.y - center.y - (point.x - center.x)) / 2
    x = center.x - delta
    y = center.y + delta
  } else {
    const delta = (point.x - center.x + point.y - center.y) / 2
    x = center.x + delta
    y = center.y + delta
  }
  return { x: snapHalf(clamp(x, 0, width)), y: snapHalf(clamp(y, 0, height)) }
}

const addCandidate = (points: SymmetryPoint[], x: number, y: number, width: number, height: number): void => {
  const epsilon = 1e-6
  if (x < -epsilon || y < -epsilon || x > width + epsilon || y > height + epsilon) return
  const point = { x: Math.max(0, Math.min(width, x)), y: Math.max(0, Math.min(height, y)) }
  if (!points.some((candidate) => Math.abs(candidate.x - point.x) < epsilon && Math.abs(candidate.y - point.y) < epsilon)) points.push(point)
}

export function symmetryAxisSegment(axis: SymmetryAxis, width: number, height: number, center?: SymmetryCenter | null): SymmetryAxisSegment | null {
  const pivot = resolvedCenter(width, height, center)
  if (axis === 'horizontal') return pivot.y < 0 || pivot.y > height ? null : { start: { x: 0, y: pivot.y }, end: { x: width, y: pivot.y } }
  if (axis === 'vertical') return pivot.x < 0 || pivot.x > width ? null : { start: { x: pivot.x, y: 0 }, end: { x: pivot.x, y: height } }
  const points: SymmetryPoint[] = []
  if (axis === 'diagonalDown') {
    const offset = pivot.y - pivot.x
    addCandidate(points, 0, offset, width, height)
    addCandidate(points, width, width + offset, width, height)
    addCandidate(points, -offset, 0, width, height)
    addCandidate(points, height - offset, height, width, height)
  } else {
    const sum = pivot.x + pivot.y
    addCandidate(points, 0, sum, width, height)
    addCandidate(points, width, sum - width, width, height)
    addCandidate(points, sum, 0, width, height)
    addCandidate(points, sum - height, height, width, height)
  }
  if (points.length < 2) return null
  points.sort((left, right) => left.x - right.x || left.y - right.y)
  return { start: points[0], end: points.at(-1)! }
}

const pointKey = ({ x, y }: SymmetryPoint): string => `${x}:${y}`

/** Returns the complete, de-duplicated orbit of a pixel under the enabled canvas-centered reflections. */
export function symmetryPoints(point: SymmetryPoint, width: number, height: number, axes: SymmetryAxes | null | undefined, center?: SymmetryCenter | null, clipToCanvas = true): SymmetryPoint[] {
  if (width <= 0 || height <= 0 || !hasSymmetry(axes)) return !clipToCanvas || (point.x >= 0 && point.y >= 0 && point.x < width && point.y < height) ? [{ ...point }] : []
  const pivot = resolvedCenter(width, height, center)
  const transforms: Array<(value: SymmetryPoint) => SymmetryPoint> = []
  if (axes!.horizontal) transforms.push(({ x, y }) => ({ x, y: Math.round(2 * pivot.y - y - 1) }))
  if (axes!.vertical) transforms.push(({ x, y }) => ({ x: Math.round(2 * pivot.x - x - 1), y }))
  if (axes!.diagonalDown) transforms.push(({ x, y }) => ({ x: Math.round(y + pivot.x - pivot.y), y: Math.round(x - pivot.x + pivot.y) }))
  if (axes!.diagonalUp) transforms.push(({ x, y }) => ({ x: Math.round(pivot.x + pivot.y - y - 1), y: Math.round(pivot.x + pivot.y - x - 1) }))

  const result: SymmetryPoint[] = []
  const queue: SymmetryPoint[] = [{ ...point }]
  const seen = new Set<string>()
  for (let index = 0; index < queue.length; index += 1) {
    const current = queue[index]
    if (clipToCanvas && (current.x < 0 || current.y < 0 || current.x >= width || current.y >= height)) continue
    const key = pointKey(current)
    if (seen.has(key)) continue
    seen.add(key)
    result.push(current)
    for (const transform of transforms) {
      const next = transform(current)
      if (!seen.has(pointKey(next))) queue.push(next)
    }
  }
  return result
}

export function symmetrySelection(selection: SelectionMask | null, width: number, height: number, axes: SymmetryAxes | null | undefined, center?: SymmetryCenter | null): SelectionMask | null {
  if (!selection) return null
  if (!hasSymmetry(axes)) return { ...selection, mask: selection.mask?.slice() }
  const points: SymmetryPoint[] = []
  let left = width
  let top = height
  let right = -1
  let bottom = -1
  const seen = new Set<string>()
  for (let y = selection.y; y < selection.y + selection.height; y += 1) {
    for (let x = selection.x; x < selection.x + selection.width; x += 1) {
      if (!selectionContains(selection, x, y)) continue
      for (const point of symmetryPoints({ x, y }, width, height, axes, center)) {
        const key = pointKey(point)
        if (seen.has(key)) continue
        seen.add(key)
        points.push(point)
        left = Math.min(left, point.x)
        top = Math.min(top, point.y)
        right = Math.max(right, point.x)
        bottom = Math.max(bottom, point.y)
      }
    }
  }
  if (points.length === 0) return null
  const maskWidth = right - left + 1
  const maskHeight = bottom - top + 1
  const mask = new Uint8Array(maskWidth * maskHeight)
  for (const point of points) mask[(point.y - top) * maskWidth + point.x - left] = 1
  return { x: left, y: top, width: maskWidth, height: maskHeight, mask }
}

const isSelectionSymmetryRepresentative = (point: SymmetryPoint, selection: SelectionMask, width: number, height: number, axes: SymmetryAxes, center?: SymmetryCenter | null, clipToCanvas = true): boolean => {
  const currentKey = point.y * width + point.x
  return symmetryPoints(point, width, height, axes, center, clipToCanvas)
    .filter((candidate) => selectionContains(selection, candidate.x, candidate.y))
    .every((candidate) => currentKey <= candidate.y * width + candidate.x)
}

/** Transforms one fundamental selection region and mirrors the result without duplicating an already symmetric source. */
export function transformSymmetrySelection(selection: SelectionMask, target: SelectionRect, width: number, height: number, angle = 0, shear?: SelectionShearTransform, axes?: SymmetryAxes | null, center?: SymmetryCenter | null, clipToCanvas = true): SelectionMask | null {
  const bounds = transformedSelectionBounds(target, angle, shear)
  const left = clipToCanvas ? Math.max(0, bounds.x) : bounds.x
  const top = clipToCanvas ? Math.max(0, bounds.y) : bounds.y
  const right = clipToCanvas ? Math.min(width, bounds.x + bounds.width) : bounds.x + bounds.width
  const bottom = clipToCanvas ? Math.min(height, bounds.y + bounds.height) : bounds.y + bounds.height
  if (right <= left || bottom <= top) return null
  const points: SymmetryPoint[] = []
  const seen = new Set<string>()
  for (let y = top; y < bottom; y += 1) {
    for (let x = left; x < right; x += 1) {
      const sourcePoint = transformedSelectionSourcePoint(selection, target, x, y, angle, shear)
      if (!sourcePoint || (axes && hasSymmetry(axes) && !isSelectionSymmetryRepresentative(sourcePoint, selection, width, height, axes, center, clipToCanvas))) continue
      for (const destination of symmetryPoints({ x, y }, width, height, axes, center, clipToCanvas)) {
        const key = pointKey(destination)
        if (seen.has(key)) continue
        seen.add(key)
        points.push(destination)
      }
    }
  }
  if (points.length === 0) return null
  const minX = Math.min(...points.map((point) => point.x))
  const minY = Math.min(...points.map((point) => point.y))
  const maxX = Math.max(...points.map((point) => point.x))
  const maxY = Math.max(...points.map((point) => point.y))
  const mask = new Uint8Array((maxX - minX + 1) * (maxY - minY + 1))
  for (const point of points) mask[(point.y - minY) * (maxX - minX + 1) + point.x - minX] = 1
  return { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1, mask }
}
