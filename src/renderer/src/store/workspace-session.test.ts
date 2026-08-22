import { describe, expect, it } from 'vitest'
import type { ImageBrush } from '@shared/types'
import { packColor, unpackColor } from '@/core/raster'
import { remapSelectionBrushColors } from './workspace-session'

describe('selection brush color remapping', () => {
  const colors = Uint32Array.of(
    packColor({ r: 240, g: 240, b: 240, a: 255 }),
    packColor({ r: 20, g: 20, b: 20, a: 128 })
  )
  const base: ImageBrush = { id: 'brush.png', name: 'Brush', width: 2, height: 1, coverage: Uint8Array.of(255, 128), colors, intrinsicSize: true }
  const primary = { r: 255, g: 0, b: 0, a: 255 }
  const secondary = { r: 0, g: 0, b: 255, a: 255 }

  it('does not remap ordinary imported RGBA brushes', () => {
    const result = remapSelectionBrushColors(base, primary, secondary)
    expect(result).toBe(base)
    expect(result.paintColors).toBeUndefined()
  })

  it('retains foreground/background remapping for source-aligned selection brushes', () => {
    const result = remapSelectionBrushColors({ ...base, sourceX: 0, sourceY: 0 }, primary, secondary)
    expect(Array.from(result.paintColors ?? [], unpackColor)).toEqual([
      primary,
      { ...secondary, a: 128 }
    ])
  })
})
