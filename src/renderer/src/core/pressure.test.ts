import { describe, expect, it } from 'vitest'
import {
  DEFAULT_BRUSH_DYNAMICS_SETTINGS,
  brushPressureFromDynamics,
  calibrateBrushPressure,
  cloneBrushDynamicsSettings,
  migrateBrushPressureSettings,
  normalizeBrushDynamicsSettings,
  patchBrushDynamicsGradientDither,
  patchBrushDynamicsMapping,
  resolveBrushDynamics,
  smoothBrushSizeEnvelope
} from './pressure'

describe('brush dynamics', () => {
  it('migrates legacy pressure effects to v4 with gradient and dithering disabled', () => {
    const migrated = migrateBrushPressureSettings({
      enabled: true,
      affectsSize: true,
      affectsOpacity: true,
      minSizePercent: 32,
      minOpacityPercent: 14,
      curve: 'hard'
    })

    expect(migrated).toEqual({
      version: 4,
      effects: {
        size: { sensor: 'pressure', outputMin: 32, outputMax: 100, inputMin: 0, inputMax: 100, curve: 'hard', direction: 'direct' },
        strength: { sensor: 'pressure', outputMin: 14, outputMax: 100, inputMin: 0, inputMax: 100, curve: 'hard', direction: 'direct' },
        gradient: { sensor: null, outputMin: 0, outputMax: 100, inputMin: 0, inputMax: 100, curve: 'linear', direction: 'direct' }
      },
      gradientDither: 'none'
    })
    expect(brushPressureFromDynamics(patchBrushDynamicsMapping(migrated, 'gradient', { sensor: 'speed' }))).toMatchObject({
      enabled: true,
      affectsSize: true,
      affectsOpacity: true,
      minSizePercent: 32,
      minOpacityPercent: 14,
      curve: 'hard'
    })
  })

  it('uses new sensor defaults and clamps speed ranges to 4000', () => {
    expect(patchBrushDynamicsMapping(DEFAULT_BRUSH_DYNAMICS_SETTINGS, 'size', { sensor: 'pressure' }).effects.size).toMatchObject({ inputMin: 0, inputMax: 70, curve: 'hard' })
    expect(patchBrushDynamicsMapping(DEFAULT_BRUSH_DYNAMICS_SETTINGS, 'strength', { sensor: 'speed' }).effects.strength).toMatchObject({ inputMin: 50, inputMax: 2400, curve: 'linear' })

    const normalized = normalizeBrushDynamicsSettings({
      version: 3,
      effects: {
        size: { sensor: 'pressure', outputMin: 140, outputMax: -10, inputMin: 120, inputMax: -20, curve: 'invalid' as 'linear', direction: 'invalid' as 'direct' },
        strength: { sensor: 'speed', outputMin: 80, outputMax: 20, inputMin: 5000, inputMax: -1, curve: 'soft', direction: 'inverse' },
        gradient: DEFAULT_BRUSH_DYNAMICS_SETTINGS.effects.gradient
      }
    })

    expect(normalized.effects.size).toEqual({ sensor: 'pressure', outputMin: 0, outputMax: 100, inputMin: 0, inputMax: 100, curve: 'hard', direction: 'direct' })
    expect(normalized.effects.strength).toEqual({ sensor: 'speed', outputMin: 20, outputMax: 80, inputMin: 0, inputMax: 4000, curve: 'soft', direction: 'inverse' })
  })

  it('migrates only exact v2 factory mappings', () => {
    const migrated = normalizeBrushDynamicsSettings({
      version: 2,
      effects: {
        size: { sensor: 'pressure', outputMin: 20, outputMax: 100, inputMin: 0, inputMax: 100, curve: 'linear', direction: 'direct' },
        strength: { sensor: 'speed', outputMin: 20, outputMax: 100, inputMin: 0, inputMax: 1200, curve: 'linear', direction: 'direct' }
      }
    })
    expect(migrated.effects.size).toMatchObject({ inputMin: 0, inputMax: 70, curve: 'hard' })
    expect(migrated.effects.strength).toMatchObject({ inputMin: 50, inputMax: 2400, curve: 'linear' })
    expect(migrated.effects.gradient.sensor).toBeNull()
    expect(migrated.gradientDither).toBe('none')

    const custom = normalizeBrushDynamicsSettings({
      version: 2,
      effects: {
        size: { sensor: 'pressure', outputMin: 35, outputMax: 100, inputMin: 0, inputMax: 100, curve: 'linear', direction: 'direct' },
        strength: { sensor: 'speed', outputMin: 20, outputMax: 100, inputMin: 25, inputMax: 3500, curve: 'hard', direction: 'inverse' }
      }
    })
    expect(custom.effects.size).toMatchObject({ outputMin: 35, inputMin: 0, inputMax: 100, curve: 'linear' })
    expect(custom.effects.strength).toMatchObject({ inputMin: 25, inputMax: 3500, curve: 'hard', direction: 'inverse' })
  })

  it('migrates v3 dithering to none and round-trips valid v4 presets', () => {
    const v3 = normalizeBrushDynamicsSettings({
      version: 3,
      effects: DEFAULT_BRUSH_DYNAMICS_SETTINGS.effects
    })
    expect(v3).toMatchObject({ version: 4, gradientDither: 'none' })

    const dithered = patchBrushDynamicsGradientDither(DEFAULT_BRUSH_DYNAMICS_SETTINGS, 'bayer-8')
    expect(cloneBrushDynamicsSettings(dithered)).toEqual(dithered)
    expect(normalizeBrushDynamicsSettings(dithered)).toEqual(dithered)
    expect(patchBrushDynamicsMapping(dithered, 'gradient', { outputMin: 25 }).gradientDither).toBe('bayer-8')

    const fallback = patchBrushDynamicsGradientDither(DEFAULT_BRUSH_DYNAMICS_SETTINGS, 'diagonal')
    expect(normalizeBrushDynamicsSettings({
      ...dithered,
      gradientDither: 'invalid' as 'none'
    }, fallback).gradientDither).toBe('diagonal')
  })

  it('calibrates pen pressure before applying mappings', () => {
    expect(calibrateBrushPressure(0.02)).toBe(0)
    expect(calibrateBrushPressure(1)).toBe(100)
    expect(calibrateBrushPressure(0.5)).toBeCloseTo(29.75, 1)

    const settings = patchBrushDynamicsMapping(DEFAULT_BRUSH_DYNAMICS_SETTINGS, 'size', {
      sensor: 'pressure', outputMin: 0, outputMax: 100, inputMin: 0, inputMax: 100, curve: 'linear'
    })
    expect(resolveBrushDynamics(settings, { pointerType: 'pen', pressure: 0.5 }, 10)).toEqual({ size: 3, opacityScale: 1, gradientAmount: null })
  })

  it('resolves missing speed as zero with direction-aware endpoints', () => {
    const direct = patchBrushDynamicsMapping(DEFAULT_BRUSH_DYNAMICS_SETTINGS, 'strength', {
      sensor: 'speed', outputMin: 20, outputMax: 80, inputMin: 50, inputMax: 2400, direction: 'direct'
    })
    const inverse = patchBrushDynamicsMapping(direct, 'strength', { direction: 'inverse' })
    expect(resolveBrushDynamics(direct, { pointerType: 'mouse' }, 10).opacityScale).toBe(0.2)
    expect(resolveBrushDynamics(inverse, { pointerType: 'mouse', speed: null }, 10).opacityScale).toBe(0.8)
  })

  it('bypasses unavailable pressure and resolves gradient independently', () => {
    let settings = patchBrushDynamicsMapping(DEFAULT_BRUSH_DYNAMICS_SETTINGS, 'size', {
      sensor: 'pressure', outputMin: 0, outputMax: 100
    })
    settings = patchBrushDynamicsMapping(settings, 'gradient', {
      sensor: 'speed', outputMin: 0, outputMax: 100, inputMin: 0, inputMax: 1000, curve: 'linear'
    })

    expect(resolveBrushDynamics(settings, { pointerType: 'mouse', pressure: 0, speed: 500 }, 7)).toEqual({ size: 7, opacityScale: 1, gradientAmount: 0.5 })
    expect(resolveBrushDynamics(settings, { pointerType: 'pen', speed: 500 }, 7)).toEqual({ size: 7, opacityScale: 1, gradientAmount: 0.5 })
    expect(resolveBrushDynamics(settings, { pointerType: 'pen', pressure: 0, speed: 0 }, 7)).toEqual({ size: 1, opacityScale: 1, gradientAmount: 0 })
  })

  it('smooths rising and falling sizes by a distance-scaled integer budget', () => {
    expect(smoothBrushSizeEnvelope(4, 20, 12, 1)).toBe(6)
    expect(smoothBrushSizeEnvelope(4, 20, 12, 3)).toBe(10)
    expect(smoothBrushSizeEnvelope(20, 2, 12, 2)).toBe(16)
    expect(smoothBrushSizeEnvelope(2, 20, 1, 0)).toBe(3)
    expect(smoothBrushSizeEnvelope(1, -20, 12, 5)).toBe(1)
  })
})
