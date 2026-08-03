import type { OutlineDirection, OutlineKernel, OutlinePosition, OutlineSettings, RgbaColor } from '@shared/types'

const directions: OutlineDirection[] = ['nw', 'n', 'ne', 'w', 'e', 'sw', 's', 'se']
const positions = new Set<OutlinePosition>(['inside', 'outside', 'both'])
const kernels = new Set<OutlineKernel>(['round', 'square', 'horizontal', 'vertical'])

const clampChannel = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(255, Math.round(value))) : fallback

export const defaultOutlineSettings = (color: RgbaColor): OutlineSettings => ({
  color: { ...color },
  thickness: 1,
  position: 'outside',
  kernel: 'round',
  directions: { nw: false, n: true, ne: false, w: true, e: true, sw: false, s: true, se: false },
  previewEnabled: true
})

export const cloneOutlineSettings = (settings: OutlineSettings): OutlineSettings => ({
  ...settings,
  color: { ...settings.color },
  directions: { ...settings.directions }
})

export const normalizeOutlineSettings = (value: unknown, fallbackColor?: RgbaColor): OutlineSettings | null => {
  if (!value || typeof value !== 'object') return fallbackColor ? defaultOutlineSettings(fallbackColor) : null
  const candidate = value as Partial<OutlineSettings>
  const fallback = defaultOutlineSettings(fallbackColor ?? { r: 0, g: 0, b: 0, a: 255 })
  const color = candidate.color && typeof candidate.color === 'object' ? candidate.color : fallback.color
  return {
    color: {
      r: clampChannel(color.r, fallback.color.r),
      g: clampChannel(color.g, fallback.color.g),
      b: clampChannel(color.b, fallback.color.b),
      a: clampChannel(color.a, fallback.color.a)
    },
    thickness: typeof candidate.thickness === 'number' && Number.isFinite(candidate.thickness)
      ? Math.max(1, Math.min(64, Math.round(candidate.thickness)))
      : fallback.thickness,
    position: positions.has(candidate.position as OutlinePosition) ? candidate.position as OutlinePosition : fallback.position,
    kernel: kernels.has(candidate.kernel as OutlineKernel) ? candidate.kernel as OutlineKernel : fallback.kernel,
    directions: Object.fromEntries(directions.map((direction) => [direction, candidate.directions?.[direction] === true])) as OutlineSettings['directions'],
    previewEnabled: candidate.previewEnabled !== false
  }
}
