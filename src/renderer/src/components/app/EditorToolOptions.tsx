import { memo, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import { ArrowLeftRight } from 'lucide-react'
import type { BrushPaintMode, GradientDither, ImageBrush, ImageBrushSettings, ProceduralBrushId, ProceduralBrushSettings, RgbaColor, SelectionMode } from '@shared/types'
import { NumberInput } from '@/components/NumberInput'
import { ColorValueControl } from '@/components/ColorValueControl'
import { PerformanceProfiler } from '@/components/PerformanceProfiler'
import { ThemedSelect } from '@/components/ThemedSelect'
import { Tooltip } from '@/components/Tooltip'
import { useI18n } from '@/components/I18nProvider'
import { toolOptionsRenderKey } from '@/core/app-render-keys'
import { isProceduralBrushId } from '@/core/brushes'
import type { TranslationKey } from '@/core/localization'
import { brushMaskOffsets, brushStampDimensions } from '@/core/tools'
import { loadEditorPreferences, parseLineDirectionStep, saveEditorPreferences, type CheckerboardPreferences } from '@/core/file-preferences'
import { gradientColorAt } from '@/core/gradient'
import { BRUSH_SPEED_INPUT_LIMIT, DEFAULT_PRESSURE_INPUT_RANGE, DEFAULT_SPEED_INPUT_RANGE, type BrushDynamicsCurve, type BrushDynamicsDirection, type BrushDynamicsEffect, type BrushDynamicsMapping, type BrushDynamicsSensor, type BrushDynamicsSettings } from '@/core/pressure'
import { getBrushDynamicsTelemetry, subscribeBrushDynamicsTelemetry, type BrushDynamicsTelemetrySnapshot } from '@/core/brush-dynamics-telemetry'
import { useWorkspace } from '@/store/workspace'
import { useBrushLibrary } from './useBrushLibrary'
import { PixelDownIcon as ChevronDown, PixelUtilityIcon } from '@/components/PixelUtilityIcon'
import { PixelCheckbox } from '@/components/PixelCheckbox'
import { PixelAssetIcon, PixelShapeIcon, activeToolPresentation, selectionModes, temporarySelectionModeForModifiers } from './editor-tools'
import { SymmetryControls } from './SymmetryControls'

function GrayscaleBrushThumbnail({ brush }: { brush: ImageBrush }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const context = canvasRef.current?.getContext('2d')
    if (!context) return
    const size = 32
    const image = context.createImageData(size, size)
    for (let y = 0; y < size; y += 1) for (let x = 0; x < size; x += 1) {
      const sourceX = Math.min(brush.width - 1, Math.floor(x * brush.width / size))
      const sourceY = Math.min(brush.height - 1, Math.floor(y * brush.height / size))
      const gray = brush.coverage[sourceY * brush.width + sourceX] ?? 0
      const offset = (y * size + x) * 4
      image.data[offset] = gray
      image.data[offset + 1] = gray
      image.data[offset + 2] = gray
      image.data[offset + 3] = 255
    }
    context.putImageData(image, 0, 0)
  }, [brush])
  return <canvas ref={canvasRef} width={32} height={32} aria-hidden="true" />
}

function GradientPresetPreview({ preset }: { preset: GradientDither }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [checkerboard, setCheckerboard] = useState<CheckerboardPreferences>(() => loadEditorPreferences().checkerboard)
  useEffect(() => {
    const syncPreferences = (): void => setCheckerboard(loadEditorPreferences().checkerboard)
    window.addEventListener('moonsprite:preferences-changed', syncPreferences)
    return () => window.removeEventListener('moonsprite:preferences-changed', syncPreferences)
  }, [])
  useEffect(() => {
    const canvas = canvasRef.current
    const context = canvas?.getContext('2d')
    if (!canvas || !context) return
    const width = canvas.width
    const height = canvas.height
    const startColor: RgbaColor = { r: 0, g: 0, b: 0, a: 255 }
    const endColor: RgbaColor = { r: 255, g: 255, b: 255, a: 255 }
    context.clearRect(0, 0, width, height)
    context.fillStyle = `rgb(${checkerboard.darkColor.r} ${checkerboard.darkColor.g} ${checkerboard.darkColor.b})`
    context.fillRect(0, 0, width, height)
    context.fillStyle = `rgb(${checkerboard.lightColor.r} ${checkerboard.lightColor.g} ${checkerboard.lightColor.b})`
    for (let y = 0; y < height; y += 2) for (let x = 0; x < width; x += 2) if (((x / 2) + (y / 2)) % 2 === 1) context.fillRect(x, y, 2, 2)
    const image = context.createImageData(width, height)
    for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
      const color = gradientColorAt(startColor, endColor, x, y, { x: 0, y: 0 }, { x: width - 1, y: 0 }, preset)
      const offset = (y * width + x) * 4
      image.data[offset] = color.r
      image.data[offset + 1] = color.g
      image.data[offset + 2] = color.b
      image.data[offset + 3] = color.a
    }
    context.putImageData(image, 0, 0)
  }, [checkerboard, preset])
  return <canvas ref={canvasRef} className="gradient-preset-preview" width={104} height={16} aria-hidden="true" />
}

const brushGradientDitherGroups = (t: (key: TranslationKey) => string): Array<{ label: string; options: Array<{ value: GradientDither; label: string; description: string }> }> => [
  {
    label: t('toolOptions.gradientGroup.smooth'),
    options: [{ value: 'none', label: t('toolOptions.gradientDither.none'), description: t('toolOptions.gradientDither.noneDescription') }]
  },
  {
    label: t('toolOptions.gradientGroup.dither'),
    options: [
      { value: 'bayer-2', label: t('toolOptions.gradientDither.bayer2'), description: t('toolOptions.gradientDither.ditherDescription') },
      { value: 'bayer-4', label: t('toolOptions.gradientDither.bayer4'), description: t('toolOptions.gradientDither.ditherDescription') },
      { value: 'bayer-8', label: t('toolOptions.gradientDither.bayer8'), description: t('toolOptions.gradientDither.ditherDescription') },
      { value: 'checker', label: t('toolOptions.gradientDither.checker'), description: t('toolOptions.gradientDither.ditherDescription') },
      { value: 'diagonal', label: t('toolOptions.gradientDither.diagonalLeft'), description: t('toolOptions.gradientDither.ditherDescription') },
      { value: 'diagonal-reverse', label: t('toolOptions.gradientDither.diagonalRight'), description: t('toolOptions.gradientDither.ditherDescription') },
      { value: 'horizontal', label: t('toolOptions.gradientDither.horizontal'), description: t('toolOptions.gradientDither.ditherDescription') },
      { value: 'vertical', label: t('toolOptions.gradientDither.vertical'), description: t('toolOptions.gradientDither.ditherDescription') }
    ]
  }
]

function GrayscaleBrushPreview({ brush, settings, color, paintMode, proceduralAntialiasStrength = 0 }: {
  brush: ImageBrush
  settings: ImageBrushSettings
  color: RgbaColor
  paintMode: 'paint' | 'pattern-source' | 'pattern-target'
  proceduralAntialiasStrength?: number
}) {
  const { t } = useI18n()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [checkerboard, setCheckerboard] = useState<CheckerboardPreferences>(() => loadEditorPreferences().checkerboard)
  useEffect(() => {
    const syncPreferences = (): void => setCheckerboard(loadEditorPreferences().checkerboard)
    window.addEventListener('moonsprite:preferences-changed', syncPreferences)
    return () => window.removeEventListener('moonsprite:preferences-changed', syncPreferences)
  }, [])
  useEffect(() => {
    const canvas = canvasRef.current
    const context = canvas?.getContext('2d')
    if (!canvas || !context) return
    const checker = checkerboard.size
    context.clearRect(0, 0, canvas.width, canvas.height)
    for (let y = 0; y < canvas.height; y += checker) for (let x = 0; x < canvas.width; x += checker) {
      const background = ((x / checker) + (y / checker)) % 2 === 0 ? checkerboard.lightColor : checkerboard.darkColor
      context.fillStyle = `rgb(${background.r} ${background.g} ${background.b})`
      context.fillRect(x, y, checker, checker)
    }
    const stampSize = Math.min(64, Math.max(8, Math.max(brush.width, brush.height)))
    const stamp = brushStampDimensions(stampSize, brush)
    const pixelScale = Math.max(1, Math.floor(64 / Math.max(stamp.width, stamp.height)))
    const startX = Math.floor((canvas.width - stamp.width * pixelScale) / 2)
    const startY = Math.floor((canvas.height - stamp.height * pixelScale) / 2)
    const originX = paintMode === 'pattern-source' ? brush.sourceX ?? 0 : 0
    const originY = paintMode === 'pattern-source' ? brush.sourceY ?? 0 : 0
    for (const point of brushMaskOffsets(stampSize, 'square', 'solid', 1, originX, originY, brush, settings, proceduralAntialiasStrength, paintMode, 0, 0)) {
      const pointColor = point.color ?? color
      context.fillStyle = `rgb(${pointColor.r} ${pointColor.g} ${pointColor.b})`
      context.globalAlpha = pointColor.a / 255 * point.coverage / 255
      context.fillRect(startX + point.x * pixelScale, startY + point.y * pixelScale, pixelScale, pixelScale)
    }
    context.globalAlpha = 1
  }, [brush, checkerboard, color, paintMode, proceduralAntialiasStrength, settings])
  return <canvas ref={canvasRef} className="brush-live-preview" width={232} height={82} aria-label={t('toolOptions.brushPreviewAria')} />
}

type ProceduralControl = { key: keyof ProceduralBrushSettings; label: TranslationKey; min: number; max: number; suffix?: string }
const proceduralControls: Record<ProceduralBrushId, ProceduralControl[]> = {
  'procedural:noise': [
    { key: 'scale', label: 'toolOptions.parameter.grain', min: 1, max: 12, suffix: 'px' },
    { key: 'detail', label: 'toolOptions.parameter.density', min: 5, max: 95, suffix: '%' },
    { key: 'variation', label: 'toolOptions.parameter.contrast', min: 0, max: 100, suffix: '%' }
  ],
  'procedural:clouds': [
    { key: 'scale', label: 'toolOptions.parameter.scale', min: 4, max: 64, suffix: 'px' },
    { key: 'detail', label: 'toolOptions.parameter.detail', min: 1, max: 5 },
    { key: 'variation', label: 'toolOptions.parameter.contrast', min: 0, max: 100, suffix: '%' }
  ],
  'procedural:cells': [
    { key: 'scale', label: 'toolOptions.parameter.size', min: 4, max: 40, suffix: 'px' },
    { key: 'detail', label: 'toolOptions.parameter.edge', min: 0, max: 100, suffix: '%' },
    { key: 'variation', label: 'toolOptions.parameter.random', min: 0, max: 100, suffix: '%' }
  ],
  'procedural:fibers': [
    { key: 'scale', label: 'toolOptions.parameter.spacing', min: 2, max: 32, suffix: 'px' },
    { key: 'angle', label: 'toolOptions.parameter.direction', min: 0, max: 180, suffix: '°' },
    { key: 'detail', label: 'toolOptions.parameter.curvature', min: 0, max: 100, suffix: '%' },
    { key: 'variation', label: 'toolOptions.parameter.disorder', min: 0, max: 100, suffix: '%' }
  ]
}

const proceduralPresets: Record<ProceduralBrushId, Array<{ label: TranslationKey; values: Partial<ProceduralBrushSettings> }>> = {
  'procedural:noise': [
    { label: 'toolOptions.preset.fine', values: { scale: 1, detail: 42, variation: 30 } },
    { label: 'toolOptions.preset.standard', values: { scale: 2, detail: 50, variation: 50 } },
    { label: 'toolOptions.preset.coarse', values: { scale: 6, detail: 60, variation: 75 } }
  ],
  'procedural:clouds': [
    { label: 'toolOptions.preset.soft', values: { scale: 12, detail: 4, variation: 25 } },
    { label: 'toolOptions.preset.standard', values: { scale: 18, detail: 3, variation: 45 } },
    { label: 'toolOptions.preset.surging', values: { scale: 38, detail: 2, variation: 80 } }
  ],
  'procedural:cells': [
    { label: 'toolOptions.preset.cells', values: { scale: 7, detail: 25, variation: 35 } },
    { label: 'toolOptions.preset.standard', values: { scale: 12, detail: 38, variation: 70 } },
    { label: 'toolOptions.preset.rocks', values: { scale: 25, detail: 62, variation: 95 } }
  ],
  'procedural:fibers': [
    { label: 'toolOptions.preset.fineFibers', values: { scale: 5, detail: 18, variation: 12 } },
    { label: 'toolOptions.preset.standard', values: { scale: 9, detail: 35, variation: 28 } },
    { label: 'toolOptions.preset.woodGrain', values: { scale: 17, detail: 72, variation: 58 } }
  ]
}

function ProceduralBrushControls({ brushId, settings, onChange }: {
  brushId: ProceduralBrushId
  settings: ProceduralBrushSettings
  onChange: (settings: Partial<ProceduralBrushSettings>) => void
}) {
  const { t } = useI18n()
  return <>
    <div className="procedural-preset-row">{proceduralPresets[brushId].map((preset) => <button type="button" key={preset.label} onClick={() => onChange(preset.values)}>{t(preset.label)}</button>)}</div>
    <div className="procedural-parameter-list">
      {proceduralControls[brushId].map((control) => <label key={control.key}><span>{t(control.label)}</span><input type="range" min={control.min} max={control.max} value={settings[control.key]} onChange={(event) => onChange({ [control.key]: Number(event.target.value) })} /><NumberInput min={control.min} max={control.max} value={settings[control.key]} onValueChange={(value) => onChange({ [control.key]: value })} /><strong>{control.suffix ?? ''}</strong></label>)}
      <label className="procedural-seed"><span>{t('toolOptions.parameter.seed')}</span><NumberInput min={0} max={9999} value={settings.seed} onValueChange={(seed) => onChange({ seed })} /><button type="button" title={t('toolOptions.randomizeSeed')} aria-label={t('toolOptions.randomizeSeed')} onClick={() => onChange({ seed: Math.floor(Math.random() * 10000) })}><PixelUtilityIcon kind="refresh" /></button></label>
    </div>
  </>
}

function BrushOutputControls({ settings, onChange }: { settings: ImageBrushSettings; onChange: (settings: Partial<ImageBrushSettings>) => void }) {
  const { t } = useI18n()
  return <>
    <div className="brush-gray-presets"><button type="button" onClick={() => onChange({ mode: 'dither', blackPoint: 0, whitePoint: 255, threshold: 128, invert: false })}>{t('toolOptions.preset.soft')}</button><button type="button" onClick={() => onChange({ mode: 'dither', blackPoint: 40, whitePoint: 215, threshold: 128, invert: false })}>{t('toolOptions.preset.crisp')}</button><button type="button" onClick={() => onChange({ mode: 'threshold', blackPoint: 0, whitePoint: 255, threshold: 128, invert: false })}>{t('toolOptions.preset.hardEdge')}</button></div>
    <div className="brush-gray-mode"><button type="button" className={settings.mode === 'dither' ? 'selected' : ''} onClick={() => onChange({ mode: 'dither' })}>{t('toolOptions.output.dither')}</button><button type="button" className={settings.mode === 'threshold' ? 'selected' : ''} onClick={() => onChange({ mode: 'threshold' })}>{t('toolOptions.output.threshold')}</button></div>
    <div className="brush-level-controls">
      <label><span>{t('toolOptions.output.blackPoint')}</span><input type="range" min={0} max={settings.whitePoint - 1} value={settings.blackPoint} onChange={(event) => onChange({ blackPoint: Number(event.target.value) })} /><NumberInput min={0} max={settings.whitePoint - 1} value={settings.blackPoint} onValueChange={(blackPoint) => onChange({ blackPoint })} /></label>
      <label><span>{t('toolOptions.output.whitePoint')}</span><input type="range" min={settings.blackPoint + 1} max={255} value={settings.whitePoint} onChange={(event) => onChange({ whitePoint: Number(event.target.value) })} /><NumberInput min={settings.blackPoint + 1} max={255} value={settings.whitePoint} onValueChange={(whitePoint) => onChange({ whitePoint })} /></label>
      {settings.mode === 'threshold' && <label><span>{t('toolOptions.output.threshold')}</span><input type="range" min={0} max={255} value={settings.threshold} onChange={(event) => onChange({ threshold: Number(event.target.value) })} /><NumberInput min={0} max={255} value={settings.threshold} onValueChange={(threshold) => onChange({ threshold })} /></label>}
    </div>
  </>
}

function ToleranceControl({ value, open, label, inputLabel, sliderLabel, onOpen, onChange }: {
  value: number
  open: boolean
  label: string
  inputLabel: string
  sliderLabel: string
  onOpen: () => void
  onChange: (value: number) => void
}) {
  return <div className="tolerance-control" onPointerDown={onOpen}>
    <label><span>{label}</span><NumberInput aria-label={inputLabel} min={0} max={255} value={value} onValueChange={onChange} onFocus={onOpen} /></label>
    {open && <div className="brush-size-popover tolerance-popover" role="dialog" aria-label={inputLabel}>
      <input aria-label={sliderLabel} type="range" min="0" max="255" value={value} onChange={(event) => onChange(Number(event.target.value))} />
      <strong>{value}</strong>
    </div>}
  </div>
}

const pressureSensorBounds: Record<BrushDynamicsSensor, { max: number; defaultMin: number; defaultMax: number; defaultCurve: BrushDynamicsCurve; step: number; suffix: string }> = {
  pressure: { max: 100, defaultMin: DEFAULT_PRESSURE_INPUT_RANGE.inputMin, defaultMax: DEFAULT_PRESSURE_INPUT_RANGE.inputMax, defaultCurve: DEFAULT_PRESSURE_INPUT_RANGE.curve, step: 1, suffix: '%' },
  speed: { max: BRUSH_SPEED_INPUT_LIMIT, defaultMin: DEFAULT_SPEED_INPUT_RANGE.inputMin, defaultMax: DEFAULT_SPEED_INPUT_RANGE.inputMax, defaultCurve: DEFAULT_SPEED_INPUT_RANGE.curve, step: 10, suffix: 'px/s' }
}

const brushDynamicsEffects: BrushDynamicsEffect[] = ['size', 'strength', 'gradient']

function PressureValueSlider({ label, value, min, max, step = 1, suffix, onChange }: {
  label: string
  value: number
  min: number
  max: number
  step?: number
  suffix: string
  onChange: (value: number) => void
}) {
  return <label className="pressure-slider-row">
    <span>{label}</span>
    <input aria-label={label} type="range" min={min} max={max} step={step} value={value} onChange={(event) => onChange(Number(event.target.value))} />
    <NumberInput aria-label={label} min={min} max={max} step={step} suffix={suffix} value={value} onValueChange={onChange} />
  </label>
}

type BrushDynamicsRangeEndpoint = 'min' | 'max'

export const nearestBrushDynamicsRangeEndpoint = (
  value: number,
  minimum: number,
  maximum: number,
  previous: BrushDynamicsRangeEndpoint
): BrushDynamicsRangeEndpoint => {
  const minimumDistance = Math.abs(value - minimum)
  const maximumDistance = Math.abs(value - maximum)
  if (minimumDistance === maximumDistance) return previous === 'min' ? 'max' : 'min'
  return minimumDistance < maximumDistance ? 'min' : 'max'
}

function BrushDynamicsRangeControl({ minimum, maximum, limit, step, rangeStart, rangeEnd, liveSensorPosition, liveSensorValue, liveActive, minimumLabel, maximumLabel, onChange }: {
  minimum: number
  maximum: number
  limit: number
  step: number
  rangeStart: number
  rangeEnd: number
  liveSensorPosition: number
  liveSensorValue: number | null
  liveActive: boolean
  minimumLabel: string
  maximumLabel: string
  onChange: (endpoint: BrushDynamicsRangeEndpoint, value: number) => void
}) {
  const minimumRef = useRef<HTMLInputElement>(null)
  const maximumRef = useRef<HTMLInputElement>(null)
  const draggedEndpointRef = useRef<BrushDynamicsRangeEndpoint | null>(null)
  const lastEndpointRef = useRef<BrushDynamicsRangeEndpoint>('max')
  const [activeEndpoint, setActiveEndpoint] = useState<BrushDynamicsRangeEndpoint>('max')
  const valueAtClientX = (clientX: number, surface: HTMLDivElement): number => {
    const bounds = surface.getBoundingClientRect()
    const progress = bounds.width > 0 ? Math.max(0, Math.min(1, (clientX - bounds.left) / bounds.width)) : 0
    const rawValue = progress * limit
    return Math.max(0, Math.min(limit, Math.round(rawValue / step) * step))
  }
  const selectEndpoint = (endpoint: BrushDynamicsRangeEndpoint): void => {
    lastEndpointRef.current = endpoint
    setActiveEndpoint(endpoint)
    const input = endpoint === 'min' ? minimumRef.current : maximumRef.current
    window.requestAnimationFrame(() => input?.focus({ preventScroll: true }))
  }
  const updateEndpoint = (endpoint: BrushDynamicsRangeEndpoint, value: number): void => {
    onChange(endpoint, endpoint === 'min' ? Math.min(value, maximum) : Math.max(value, minimum))
  }
  const handleSurfacePointerDown = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0) return
    const value = valueAtClientX(event.clientX, event.currentTarget)
    const endpoint = nearestBrushDynamicsRangeEndpoint(value, minimum, maximum, lastEndpointRef.current)
    draggedEndpointRef.current = endpoint
    selectEndpoint(endpoint)
    updateEndpoint(endpoint, value)
    event.currentTarget.setPointerCapture(event.pointerId)
    event.preventDefault()
  }
  const handleSurfacePointerMove = (event: React.PointerEvent<HTMLDivElement>): void => {
    const endpoint = draggedEndpointRef.current
    if (!endpoint || !event.currentTarget.hasPointerCapture(event.pointerId)) return
    updateEndpoint(endpoint, valueAtClientX(event.clientX, event.currentTarget))
  }
  const finishSurfaceDrag = (event: React.PointerEvent<HTMLDivElement>): void => {
    draggedEndpointRef.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }

  return <div className="pressure-range-stack">
    <span className="pressure-range-track" aria-hidden="true">
      <span className={`pressure-range-live ${liveSensorValue === null ? 'is-empty' : liveActive ? 'is-active' : 'is-inactive'}`} style={{ width: `${liveSensorPosition}%` }} />
      <span className="pressure-range-selection" style={{ left: `${rangeStart}%`, right: `${100 - rangeEnd}%` }} />
      <span className={`pressure-range-live-marker ${liveSensorValue === null ? 'is-empty' : liveActive ? 'is-active' : 'is-inactive'}`} style={{ left: `${liveSensorPosition}%` }} />
    </span>
    <div className="pressure-range-hit-surface" aria-hidden="true" onPointerDown={handleSurfacePointerDown} onPointerMove={handleSurfacePointerMove} onPointerUp={finishSurfaceDrag} onPointerCancel={finishSurfaceDrag} />
    <input ref={minimumRef} className={`pressure-range-min ${activeEndpoint === 'min' ? 'is-active' : ''}`} aria-label={minimumLabel} type="range" min={0} max={maximum} step={step} value={minimum} onFocus={() => selectEndpoint('min')} onPointerDown={() => selectEndpoint('min')} onChange={(event) => updateEndpoint('min', Number(event.target.value))} />
    <input ref={maximumRef} className={`pressure-range-max ${activeEndpoint === 'max' ? 'is-active' : ''}`} aria-label={maximumLabel} type="range" min={minimum} max={limit} step={step} value={maximum} onFocus={() => selectEndpoint('max')} onPointerDown={() => selectEndpoint('max')} onChange={(event) => updateEndpoint('max', Number(event.target.value))} />
  </div>
}

export function BrushDynamicsSettingsPanel({ settings, tool, intrinsicSize, brushSize, documentId, primaryColor, secondaryColor, telemetryPreview, onChange, onGradientDitherChange }: {
  settings: BrushDynamicsSettings
  tool: 'pencil' | 'eraser'
  intrinsicSize: boolean
  brushSize: number
  documentId: string | null
  primaryColor: RgbaColor
  secondaryColor: RgbaColor
  telemetryPreview?: BrushDynamicsTelemetrySnapshot
  onChange: (effect: BrushDynamicsEffect, patch: Partial<BrushDynamicsMapping>) => void
  onGradientDitherChange: (dither: GradientDither) => void
}) {
  const { t } = useI18n()
  const telemetry = useSyncExternalStore(
    subscribeBrushDynamicsTelemetry,
    getBrushDynamicsTelemetry,
    () => null
  )
  const liveTelemetry = telemetryPreview ?? telemetry
  const effectDisabled = (effect: BrushDynamicsEffect): boolean => (effect === 'size' && intrinsicSize) || (effect === 'gradient' && tool === 'eraser')
  const firstAvailableMapping = (): BrushDynamicsEffect | null => brushDynamicsEffects.find((effect) => !effectDisabled(effect) && settings.effects[effect].sensor) ?? null
  const [activeEffect, setActiveEffect] = useState<BrushDynamicsEffect | null>(firstAvailableMapping)
  const effectLabel = (effect: BrushDynamicsEffect): string => effect === 'size'
    ? t('toolOptions.pressureEffectSize')
    : effect === 'gradient'
      ? t('toolOptions.pressureEffectGradient')
      : t('toolOptions.pressureEffectStrength')
  const sensorLabel = (sensor: BrushDynamicsSensor): string => sensor === 'pressure'
    ? t('toolOptions.pressureSensorPressure')
    : t('toolOptions.pressureSensorSpeed')
  useEffect(() => {
    if (!activeEffect) return
    const activeDisabled = (activeEffect === 'size' && intrinsicSize) || (activeEffect === 'gradient' && tool === 'eraser')
    if (!activeDisabled) return
    const fallback = brushDynamicsEffects.find((effect) => {
      const disabled = (effect === 'size' && intrinsicSize) || (effect === 'gradient' && tool === 'eraser')
      return !disabled && settings.effects[effect].sensor
    })
    setActiveEffect(fallback ?? null)
  }, [activeEffect, intrinsicSize, settings.effects.gradient.sensor, settings.effects.size.sensor, settings.effects.strength.sensor, tool])
  const selectMapping = (effect: BrushDynamicsEffect, sensor: BrushDynamicsSensor): void => {
    if (effectDisabled(effect)) return
    const mapping = settings.effects[effect]
    if (mapping.sensor === sensor) {
      if (activeEffect !== effect) {
        setActiveEffect(effect)
        return
      }
      onChange(effect, { sensor: null })
      setActiveEffect(null)
      return
    }
    const defaults = pressureSensorBounds[sensor]
    onChange(effect, { sensor, inputMin: defaults.defaultMin, inputMax: defaults.defaultMax, curve: defaults.defaultCurve })
    setActiveEffect(effect)
  }
  const renderEffectRow = (effect: BrushDynamicsEffect) => {
    const disabled = effectDisabled(effect)
    const mapping = settings.effects[effect]
    return <div className={`pressure-matrix-row ${disabled ? 'disabled' : ''}`} role="row" aria-disabled={disabled || undefined}>
      <span className="pressure-effect-label" role="rowheader">{effectLabel(effect)}</span>
      {(['pressure', 'speed'] as const).map((sensor) => {
        const enabled = mapping.sensor === sensor
        const selected = enabled && activeEffect === effect && !disabled
        const label = t('toolOptions.pressureMappingToggle', { effect: effectLabel(effect), sensor: sensorLabel(sensor) })
        return <button className={`pressure-matrix-cell ${enabled ? 'enabled' : ''} ${selected ? 'selected' : ''}`} type="button" role="gridcell" aria-label={label} aria-pressed={enabled} disabled={disabled} key={sensor} onClick={() => selectMapping(effect, sensor)}>
          <span className="pressure-matrix-check" aria-hidden="true">{enabled && <PixelUtilityIcon kind="check" scale={2} />}</span>
        </button>
      })}
    </div>
  }
  const activeMapping = activeEffect && !effectDisabled(activeEffect) && settings.effects[activeEffect].sensor ? settings.effects[activeEffect] : null
  const activeSensor = activeMapping?.sensor ?? null
  const sensorBounds = activeSensor ? pressureSensorBounds[activeSensor] : null
  const rangeStart = activeMapping && sensorBounds ? activeMapping.inputMin / sensorBounds.max * 100 : 0
  const rangeEnd = activeMapping && sensorBounds ? activeMapping.inputMax / sensorBounds.max * 100 : 100
  const telemetryMatchesDocument = Boolean(documentId && liveTelemetry?.documentId === documentId)
  const liveSensorValue = activeSensor && telemetryMatchesDocument ? liveTelemetry![activeSensor] : null
  const liveSensorPosition = liveSensorValue !== null && sensorBounds ? Math.max(0, Math.min(100, liveSensorValue / sensorBounds.max * 100)) : 0
  const liveSensorText = liveSensorValue === null || !sensorBounds
    ? t('toolOptions.pressureSensorInactive')
    : `${Math.round(liveSensorValue)}${sensorBounds.suffix === '%' ? '%' : ` ${sensorBounds.suffix}`}`
  const sizeRange = activeEffect === 'size' && activeMapping
    ? t('toolOptions.pressureSizeRangePixels', {
      min: Math.max(1, Math.round(brushSize * activeMapping.outputMin / 100)),
      max: Math.max(1, Math.round(brushSize * activeMapping.outputMax / 100))
    })
    : null
  const curveOptions: Array<{ value: BrushDynamicsCurve; label: string; description: string }> = [
    { value: 'soft', label: t('toolOptions.pressureCurve.soft'), description: t('toolOptions.pressureCurve.softDescription') },
    { value: 'linear', label: t('toolOptions.pressureCurve.linear'), description: t('toolOptions.pressureCurve.linearDescription') },
    { value: 'hard', label: t('toolOptions.pressureCurve.hard'), description: t('toolOptions.pressureCurve.hardDescription') }
  ]
  const directionOptions: Array<{ value: BrushDynamicsDirection; label: string }> = [
    { value: 'direct', label: t('toolOptions.pressureDirection.direct') },
    { value: 'inverse', label: t('toolOptions.pressureDirection.inverse') }
  ]
  const gradientDitherGroups = brushGradientDitherGroups(t)

  return <div className="pressure-settings-panel">
    <div className="pressure-matrix-section">
      <div className="pressure-section-title">{t('toolOptions.pressureMappingMatrix')}</div>
      <div className="pressure-matrix" role="grid" aria-label={t('toolOptions.pressureMappingMatrix')}>
        <div className="pressure-matrix-header" role="row"><span aria-hidden="true" /><span role="columnheader">{sensorLabel('pressure')}</span><span role="columnheader">{sensorLabel('speed')}</span></div>
        {intrinsicSize ? <Tooltip className="pressure-matrix-tooltip" content={t('toolOptions.pressureIntrinsicSizeHint')}>{renderEffectRow('size')}</Tooltip> : renderEffectRow('size')}
        {renderEffectRow('strength')}
        {tool === 'eraser' ? <Tooltip className="pressure-matrix-tooltip" content={t('toolOptions.pressureEraserGradientHint')}>{renderEffectRow('gradient')}</Tooltip> : renderEffectRow('gradient')}
      </div>
    </div>
    {activeMapping && activeSensor && sensorBounds ? <section className="pressure-mapping-details">
      <header><strong>{effectLabel(activeEffect!)} <span className="pressure-mapping-separator" aria-hidden="true">×</span> {sensorLabel(activeSensor)}</strong>{sizeRange && <small>{sizeRange}</small>}</header>
      <div className="pressure-mapping-body">
        {activeEffect === 'gradient' && <div className="pressure-detail-section pressure-gradient-preview">
          <span className="pressure-detail-label">{t('toolOptions.pressureGradientColors')}</span>
          <div className="pressure-gradient-band" role="img" aria-label={t('toolOptions.pressureGradientColors')}>
            <span className="pressure-gradient-swatch" title={t('toolOptions.pressureBackgroundColor')} style={{ background: `rgba(${secondaryColor.r}, ${secondaryColor.g}, ${secondaryColor.b}, ${secondaryColor.a / 255})` }} />
            <span className="pressure-gradient-strip" style={{ background: `linear-gradient(to right, rgba(${secondaryColor.r}, ${secondaryColor.g}, ${secondaryColor.b}, ${secondaryColor.a / 255}), rgba(${primaryColor.r}, ${primaryColor.g}, ${primaryColor.b}, ${primaryColor.a / 255}))` }} />
            <span className="pressure-gradient-swatch" title={t('toolOptions.pressureForegroundColor')} style={{ background: `rgba(${primaryColor.r}, ${primaryColor.g}, ${primaryColor.b}, ${primaryColor.a / 255})` }} />
          </div>
          <label className="pressure-gradient-dither-select"><span className="pressure-detail-label">{t('toolOptions.pressureGradientDither')}</span><ThemedSelect<GradientDither>
            value={settings.gradientDither}
            groups={gradientDitherGroups}
            label={t('toolOptions.pressureGradientDither')}
            onChange={onGradientDitherChange}
            showCheck={false}
            showOptionTooltips={false}
            popoverClassName="gradient-dither-popover pressure-gradient-dither-popover"
            popoverWidth={340}
            renderOption={(option) => <span className="gradient-option-content"><strong>{option.label}</strong><GradientPresetPreview preset={option.value} /></span>}
          /></label>
        </div>}
        <div className="pressure-detail-section pressure-detail-group">
          <span className="pressure-detail-label">{t('toolOptions.pressureOutputRange')}</span>
          <PressureValueSlider label={t('toolOptions.pressureOutputMin')} value={activeMapping.outputMin} min={0} max={activeMapping.outputMax} suffix="%" onChange={(outputMin) => onChange(activeEffect!, { outputMin })} />
          <PressureValueSlider label={t('toolOptions.pressureOutputMax')} value={activeMapping.outputMax} min={activeMapping.outputMin} max={100} suffix="%" onChange={(outputMax) => onChange(activeEffect!, { outputMax })} />
        </div>
        <div className="pressure-detail-section pressure-detail-group">
          <div className="pressure-detail-heading"><span className="pressure-detail-label">{t('toolOptions.pressureSensorRange')}</span><span className={`pressure-live-value ${liveSensorValue === null ? 'is-empty' : liveTelemetry?.active ? 'is-active' : 'is-inactive'}`}>{t('toolOptions.pressureSensorLive')}: {liveSensorText}</span></div>
          <BrushDynamicsRangeControl minimum={activeMapping.inputMin} maximum={activeMapping.inputMax} limit={sensorBounds.max} step={sensorBounds.step} rangeStart={rangeStart} rangeEnd={rangeEnd} liveSensorPosition={liveSensorPosition} liveSensorValue={liveSensorValue} liveActive={Boolean(liveTelemetry?.active)} minimumLabel={t('toolOptions.pressureSensorMin')} maximumLabel={t('toolOptions.pressureSensorMax')} onChange={(endpoint, value) => onChange(activeEffect!, endpoint === 'min' ? { inputMin: value } : { inputMax: value })} />
          <div className="pressure-range-values">
            <label><span>{t('toolOptions.pressureSensorMin')}</span><NumberInput min={0} max={activeMapping.inputMax} step={sensorBounds.step} suffix={sensorBounds.suffix} value={activeMapping.inputMin} onValueChange={(inputMin) => onChange(activeEffect!, { inputMin })} /></label>
            <label><span>{t('toolOptions.pressureSensorMax')}</span><NumberInput min={activeMapping.inputMin} max={sensorBounds.max} step={sensorBounds.step} suffix={sensorBounds.suffix} value={activeMapping.inputMax} onValueChange={(inputMax) => onChange(activeEffect!, { inputMax })} /></label>
          </div>
        </div>
        <div className="pressure-options-grid">
          <div className="pressure-option-group"><span>{t('toolOptions.pressureCurve')}</span><div className="pressure-segmented-control pressure-curve-control">{curveOptions.map((option) => <Tooltip className="pressure-curve-tooltip" content={option.description} key={option.value}><button type="button" className={activeMapping.curve === option.value ? 'selected' : ''} aria-pressed={activeMapping.curve === option.value} onClick={() => onChange(activeEffect!, { curve: option.value })}>{option.label}</button></Tooltip>)}</div></div>
          <div className="pressure-option-group"><span>{t('toolOptions.pressureDirection')}</span><div className="pressure-segmented-control pressure-direction-control">{directionOptions.map((option) => <button type="button" className={activeMapping.direction === option.value ? 'selected' : ''} aria-pressed={activeMapping.direction === option.value} key={option.value} onClick={() => onChange(activeEffect!, { direction: option.value })}>{option.label}</button>)}</div></div>
        </div>
      </div>
    </section> : <p className="pressure-empty-state">{t('toolOptions.pressureSelectMapping')}</p>}
  </div>
}

export const EditorToolOptions = memo(function EditorToolOptions({ onOpenColorReplacement }: { onOpenColorReplacement: () => void }) {
  const { locale, t } = useI18n()
  const renderKey = useWorkspace((state) => toolOptionsRenderKey(
    state.sessions.find((item) => item.document.id === state.activeId) ?? null
  ))
  const [brushFlyoutOpen, setBrushFlyoutOpen] = useState(false)
  const [brushSizeFlyoutOpen, setBrushSizeFlyoutOpen] = useState(false)
  const [toleranceFlyoutOpen, setToleranceFlyoutOpen] = useState<'wand' | 'fill' | 'gradient' | null>(null)
  const [temporarySelectionMode, setTemporarySelectionMode] = useState<SelectionMode | null>(null)
  const [brushOutputOpen, setBrushOutputOpen] = useState(false)
  const [pressureFlyoutOpen, setPressureFlyoutOpen] = useState(false)
  const [pressurePopoverPosition, setPressurePopoverPosition] = useState<{ left: number; top: number; width: number; maxHeight: number } | null>(null)
  const pressureControlRef = useRef<HTMLDivElement>(null)
  const [lineDirectionStep, setLineDirectionStep] = useState(() => loadEditorPreferences().lineDirectionStep)
  const state = useWorkspace.getState()
  const session = state.sessions.find((item) => item.document.id === state.activeId) ?? null
  const {
    brushSaveName,
    setBrushSaveName,
    proceduralBrushes,
    selectionBrushes,
    grayscaleBrushes,
    selectedProjectBrush,
    selectedCustomBrush,
    loadLocalBrushes,
    saveTemporaryBrush,
    deleteLocalBrush
  } = useBrushLibrary(session)

  useEffect(() => {
    const syncPreferences = (): void => setLineDirectionStep(loadEditorPreferences().lineDirectionStep)
    window.addEventListener('moonsprite:preferences-changed', syncPreferences)
    return () => window.removeEventListener('moonsprite:preferences-changed', syncPreferences)
  }, [])

  useEffect(() => {
    const keepsBrushDynamicsOpen = (target: Element): boolean => Boolean(target.closest('.pressure-control, .pressure-popover, .themed-select-popover, .stage-canvas, .stage-surface'))
    const closeOutside = (event: PointerEvent): void => {
      if (!(event.target instanceof Element)) return
      if (!event.target.closest('.brush-source')) setBrushFlyoutOpen(false)
      if (!event.target.closest('.brush-size-control')) setBrushSizeFlyoutOpen(false)
      if (!event.target.closest('.tolerance-control')) setToleranceFlyoutOpen(null)
      if (!keepsBrushDynamicsOpen(event.target)) setPressureFlyoutOpen(false)
    }
    const closeOnFocusOutside = (event: FocusEvent): void => {
      if (!(event.target instanceof Element)) return
      if (!keepsBrushDynamicsOpen(event.target)) setPressureFlyoutOpen(false)
    }
    const closeOnBlur = (): void => { setBrushFlyoutOpen(false); setToleranceFlyoutOpen(null); setPressureFlyoutOpen(false) }
    const closeOnEscape = (event: KeyboardEvent): void => { if (event.key === 'Escape') setPressureFlyoutOpen(false) }
    const closeAll = (event: Event): void => {
      const target = (event as CustomEvent<{ target?: string }>).detail?.target
      if (target && target !== 'popover') return
      setBrushFlyoutOpen(false)
      setBrushSizeFlyoutOpen(false)
      setToleranceFlyoutOpen(null)
      setBrushOutputOpen(false)
      setPressureFlyoutOpen(false)
    }
    window.addEventListener('pointerdown', closeOutside, true)
    window.addEventListener('focusin', closeOnFocusOutside, true)
    window.addEventListener('blur', closeOnBlur)
    window.addEventListener('keydown', closeOnEscape, true)
    window.addEventListener('moonsprite:close-dialog', closeAll)
    return () => {
      window.removeEventListener('pointerdown', closeOutside, true)
      window.removeEventListener('focusin', closeOnFocusOutside, true)
      window.removeEventListener('blur', closeOnBlur)
      window.removeEventListener('keydown', closeOnEscape, true)
      window.removeEventListener('moonsprite:close-dialog', closeAll)
    }
  }, [])

  useLayoutEffect(() => {
    if (!pressureFlyoutOpen) return
    const placePopover = (): void => {
      const trigger = pressureControlRef.current?.getBoundingClientRect()
      if (!trigger) return
      const viewportInset = 6
      const width = Math.min(392, Math.max(1, window.innerWidth - viewportInset * 2))
      const left = Math.max(viewportInset, Math.min(window.innerWidth - width - viewportInset, trigger.left))
      const top = trigger.bottom + 5
      const maxHeight = Math.max(1, window.innerHeight - top - viewportInset)
      setPressurePopoverPosition({ left, top, width, maxHeight })
    }
    placePopover()
    window.addEventListener('resize', placePopover)
    window.addEventListener('scroll', placePopover, true)
    return () => {
      window.removeEventListener('resize', placePopover)
      window.removeEventListener('scroll', placePopover, true)
    }
  }, [pressureFlyoutOpen])

  useEffect(() => {
    if (session?.tool !== 'pencil' && session?.tool !== 'eraser' && !(session?.tool === 'fill' && (session.fillKind ?? 'bucket') === 'bucket')) {
      setBrushFlyoutOpen(false)
      setBrushSizeFlyoutOpen(false)
    }
    if (session?.tool !== 'pencil' && session?.tool !== 'eraser') setPressureFlyoutOpen(false)
  }, [renderKey, session?.tool, session?.fillKind])

  useEffect(() => {
    const supportsTolerance = (session?.tool === 'selection' && session.selectionKind === 'magic')
      || session?.tool === 'fill'
    if (!supportsTolerance) setToleranceFlyoutOpen(null)
  }, [session?.tool, session?.selectionKind, session?.fillKind])

  useEffect(() => {
    if (session?.tool !== 'selection') {
      setTemporarySelectionMode(null)
      return
    }
    let shiftHeld = false
    let secondaryHeld = false
    const refresh = (): void => setTemporarySelectionMode(temporarySelectionModeForModifiers(shiftHeld, secondaryHeld))
    const keyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Shift') return
      shiftHeld = true
      refresh()
    }
    const keyUp = (event: KeyboardEvent): void => {
      if (event.key !== 'Shift') return
      shiftHeld = false
      refresh()
    }
    const pointerDown = (event: PointerEvent): void => {
      if (event.button !== 2 || !(event.target instanceof Element) || !event.target.closest('.stage-canvas')) return
      secondaryHeld = true
      refresh()
    }
    const pointerUp = (event: PointerEvent): void => {
      if (event.button !== 2) return
      secondaryHeld = false
      refresh()
    }
    const reset = (): void => {
      shiftHeld = false
      secondaryHeld = false
      refresh()
    }
    window.addEventListener('keydown', keyDown, true)
    window.addEventListener('keyup', keyUp, true)
    window.addEventListener('pointerdown', pointerDown, true)
    window.addEventListener('pointerup', pointerUp, true)
    window.addEventListener('pointercancel', reset, true)
    window.addEventListener('blur', reset)
    return () => {
      window.removeEventListener('keydown', keyDown, true)
      window.removeEventListener('keyup', keyUp, true)
      window.removeEventListener('pointerdown', pointerDown, true)
      window.removeEventListener('pointerup', pointerUp, true)
      window.removeEventListener('pointercancel', reset, true)
      window.removeEventListener('blur', reset)
    }
  }, [session?.tool])

  if (!session) return null
  const workspace = useWorkspace.getState()
  const fillKind = session.fillKind ?? 'bucket'
  const gradientDither = session.gradientDither ?? 'none'
  const isBrushTool = session.tool === 'pencil' || session.tool === 'eraser' || (session.tool === 'fill' && fillKind === 'bucket')
  const supportsSymmetry = session.tool === 'pencil' || session.tool === 'eraser' || session.tool === 'selection' || session.tool === 'shape' || (session.tool === 'fill' && fillKind === 'bucket')
  const presentation = activeToolPresentation(session.tool, session.selectionKind, session.shapeKind, locale, fillKind)
  const selectionModeItems = selectionModes(locale)
  const brushPaintModeGroups = [{
    label: t('toolOptions.brushMode'),
    options: [
      { value: 'pattern-source' as const, label: t('toolOptions.brushMode.patternSource'), description: t('toolOptions.brushMode.patternSourceDescription') },
      { value: 'pattern-target' as const, label: t('toolOptions.brushMode.patternTarget'), description: t('toolOptions.brushMode.patternTargetDescription') },
      { value: 'paint' as const, label: t('toolOptions.brushMode.paint'), description: t('toolOptions.brushMode.paintDescription') }
    ]
  }]
  const gradientDitherGroups = brushGradientDitherGroups(t)
  const updateLineDirectionStep = (value: number): void => {
    const nextValue = parseLineDirectionStep(String(value))
    setLineDirectionStep(nextValue)
    saveEditorPreferences({ ...loadEditorPreferences(), lineDirectionStep: nextValue })
    window.dispatchEvent(new Event('moonsprite:preferences-changed'))
  }
  return <PerformanceProfiler id="EditorToolOptions"><div className="tool-options">
    <span className="tool-label" title={presentation.description}>{presentation.label}</span>
    {session.tool === 'eyedropper' && <>
      <div className="eyedropper-current-colors" aria-label={t('toolOptions.eyedropperColors')}>
        <ColorValueControl color={session.primaryColor} onChange={workspace.setPrimaryColor} label={t('toolOptions.eyedropperForeground')} roleLabel={t('toolOptions.eyedropperForeground')} className="eyedropper-color-control" storageKey="eyedropper-foreground" fillWithColor />
        <ColorValueControl color={session.secondaryColor} onChange={workspace.setSecondaryColor} label={t('toolOptions.eyedropperBackground')} roleLabel={t('toolOptions.eyedropperBackground')} className="eyedropper-color-control" storageKey="eyedropper-background" fillWithColor />
      </div>
      <div className="eyedropper-replace-control">
        <Tooltip content={t('toolOptions.replaceColorHint')}><button type="button" className="tool-text-button eyedropper-replace-trigger" onClick={onOpenColorReplacement}><PixelUtilityIcon kind="refresh" />{t('toolOptions.replaceColor')}</button></Tooltip>
      </div>
    </>}
    {isBrushTool && <>
      {session.brushImage && <button type="button" className="brush-return-button" title={t('toolOptions.returnToBasicBrush')} onClick={() => { workspace.setBrushImage(null); setBrushFlyoutOpen(false) }}>{t('common.back')}</button>}
      <div className="brush-source">
        <button className={`brush-source-trigger ${brushFlyoutOpen ? 'selected' : ''}`} type="button" title={t('toolOptions.openBrushLibrary')} aria-label={t('toolOptions.openBrushLibrary')} onClick={() => setBrushFlyoutOpen((value) => !value)}>{session.brushImage ? <GrayscaleBrushThumbnail brush={session.brushImage} /> : <PixelShapeIcon kind={session.brushShape} />}</button>
        {brushFlyoutOpen && <>
          <div className="brush-library" role="dialog" aria-label={t('toolOptions.brushLibrary')}>
            <div className="brush-library-selection-column">
              <section className="brush-library-section">
                <header className="brush-library-section-title"><strong>{t('toolOptions.basicBrushes')}</strong><span>{t('toolOptions.shape')}</span></header>
                <div className="brush-library-grid basic-brush-grid" aria-label={t('toolOptions.basicBrushes')}>
                  <button className={!session.brushImage && session.brushShape === 'round' ? 'selected' : ''} type="button" title={t('toolOptions.roundBrush')} aria-label={t('toolOptions.roundBrush')} onClick={() => { workspace.setBrushImage(null); workspace.setBrushShape('round') }}><PixelShapeIcon kind="round" /></button>
                  <button className={!session.brushImage && session.brushShape === 'square' ? 'selected' : ''} type="button" title={t('toolOptions.squareBrush')} aria-label={t('toolOptions.squareBrush')} onClick={() => { workspace.setBrushImage(null); workspace.setBrushShape('square') }}><PixelShapeIcon kind="square" /></button>
                  <button className={!session.brushImage && session.brushShape === 'line' ? 'selected' : ''} type="button" title={t('toolOptions.lineBrush')} aria-label={t('toolOptions.lineBrush')} onClick={() => { workspace.setBrushImage(null); workspace.setBrushShape('line') }}><PixelShapeIcon kind="line" /></button>
                </div>
              </section>
              <section className="brush-library-section">
                <header className="brush-library-section-title"><strong>{t('toolOptions.proceduralTextures')}</strong><span>{t('toolOptions.builtIn')}</span></header>
                <div className="brush-library-grid" aria-label={t('toolOptions.builtInTexturesAria')}>{proceduralBrushes.map((item) => <button key={item.brush.id} className={session.brushImage?.id === item.brush.id ? 'selected procedural' : 'procedural'} title={item.brush.name} aria-label={item.brush.name} onClick={() => workspace.setBrushImage(item.brush)}><GrayscaleBrushThumbnail brush={item.brush} /></button>)}</div>
              </section>
              <section className="brush-library-section">
                <header className="brush-library-section-title"><strong>{t('toolOptions.customBrushes')}</strong><span>{selectionBrushes.length}</span></header>
                {selectionBrushes.length > 0 ? <div className="brush-library-grid local-brush-grid selection-brush-grid" aria-label={t('toolOptions.customBrushes')}>{selectionBrushes.map((item) => <div className="local-brush-item" key={item.brush.id}><button className={session.brushImage?.id === item.brush.id ? 'selected' : ''} title={`${item.brush.name} (${item.brush.width} x ${item.brush.height})`} aria-label={item.brush.name} onClick={() => workspace.setBrushImage(item.brush)}><GrayscaleBrushThumbnail brush={item.brush} /></button></div>)}</div> : <p className="brush-library-empty">{t('toolOptions.customBrushesEmpty')}</p>}
              </section>
              <section className="brush-library-section">
                <header className="brush-library-section-title"><strong>{t('toolOptions.grayscaleBrushes')}</strong><span>{grayscaleBrushes.length}</span></header>
                {grayscaleBrushes.length > 0 ? <div className="brush-library-grid grayscale-brush-grid" aria-label={t('toolOptions.localGrayscaleBrushesAria')}>{grayscaleBrushes.map((item) => <button key={item.brush.id} className={session.brushImage?.id === item.brush.id ? 'selected' : ''} title={`${item.brush.name} (${item.brush.width} x ${item.brush.height})`} aria-label={item.brush.name} onClick={() => workspace.setBrushImage(item.brush)}><GrayscaleBrushThumbnail brush={item.brush} /></button>)}</div> : <p className="brush-library-empty">{t('toolOptions.grayscaleBrushesEmpty')}</p>}
              </section>
            </div>
            <footer><button type="button" onClick={() => void loadLocalBrushes()}>{t('common.refresh')}</button><button type="button" onClick={() => void window.moonSprite.openBrushFolder()}>{t('toolOptions.openBrushFolder')}</button></footer>
          </div>
          {session.brushImage ? <aside className="brush-details-panel">
            {selectedProjectBrush ? <section className="brush-basic-settings custom-brush-settings">
              <GrayscaleBrushPreview brush={session.brushImage} settings={session.brushImageSettings} color={session.primaryColor} paintMode={session.brushPaintMode} />
              <strong>{session.brushImage.name}</strong>
              <p>{t('toolOptions.projectBrushDescription')}</p>
              {selectedCustomBrush && <button type="button" className="brush-delete-command" onClick={() => void deleteLocalBrush(selectedCustomBrush)}><PixelUtilityIcon kind="delete" />{t('toolOptions.deleteBrush')}</button>}
            </section> : <section className="brush-gray-settings">
              <GrayscaleBrushPreview brush={session.brushImage} settings={session.brushImageSettings} color={session.primaryColor} paintMode="paint" proceduralAntialiasStrength={session.proceduralAntialias && session.brushImage.id.startsWith('procedural:') ? session.proceduralAntialiasStrength : 0} />
              <header><strong>{session.brushImage.name}{session.brushImageTemporary && <small>{t('toolOptions.temporary')}</small>}</strong><button type="button" className={session.brushImageSettings.invert ? 'selected' : ''} onClick={() => workspace.setBrushImageSettings({ invert: !session.brushImageSettings.invert })}>{session.brushImageSettings.invert && <PixelUtilityIcon kind="check" />}{t('toolOptions.invert')}</button></header>
              {isProceduralBrushId(session.brushImage.id) ? <>
                <ProceduralBrushControls brushId={session.brushImage.id} settings={session.proceduralBrushSettings[session.brushImage.id]} onChange={workspace.setProceduralBrushSettings} />
                <section className="brush-advanced-settings">
                  <button type="button" className="brush-advanced-trigger" aria-expanded={brushOutputOpen} onClick={() => setBrushOutputOpen((open) => !open)}><span>{t('toolOptions.outputSettings')}</span><ChevronDown size={14} /></button>
                  {brushOutputOpen && <div><div className="procedural-antialias-control"><label className="tool-checkbox"><PixelCheckbox checked={session.proceduralAntialias} onChange={(event) => workspace.setProceduralAntialias(event.target.checked)} />{t('toolOptions.textureAntialiasing')}</label>{session.proceduralAntialias && <label className="procedural-antialias-strength"><span>{t('toolOptions.amount')}</span><input type="range" min="1" max="100" value={session.proceduralAntialiasStrength} onChange={(event) => workspace.setProceduralAntialiasStrength(Number(event.target.value))} /><NumberInput min={1} max={100} value={session.proceduralAntialiasStrength} onValueChange={workspace.setProceduralAntialiasStrength} /><strong>%</strong></label>}</div><BrushOutputControls settings={session.brushImageSettings} onChange={workspace.setBrushImageSettings} /></div>}
                </section>
              </> : <BrushOutputControls settings={session.brushImageSettings} onChange={workspace.setBrushImageSettings} />}
            </section>}
            {session.brushImageTemporary && <div className="temporary-brush-save"><input aria-label={t('toolOptions.permanentBrushName')} value={brushSaveName} maxLength={64} onChange={(event) => setBrushSaveName(event.target.value)} /><button type="button" onClick={() => void saveTemporaryBrush()}>{t('toolOptions.savePermanently')}</button></div>}
          </aside> : <aside className="brush-details-panel"><section className="brush-basic-settings"><div className="brush-basic-settings-preview"><PixelShapeIcon kind={session.brushShape} /></div><strong>{session.brushShape === 'round' ? t('toolOptions.roundBrush') : session.brushShape === 'line' ? t('toolOptions.lineBrush') : t('toolOptions.squareBrush')}</strong><p>{t('toolOptions.basicBrushDescription')}</p></section></aside>}
        </>}
      </div>
      {!session.brushImage?.intrinsicSize && <div className="brush-size-control" onPointerDown={() => setBrushSizeFlyoutOpen(true)}><NumberInput aria-label={t('toolOptions.brushSizeValue')} min={1} max={128} suffix="px" value={session.brushSize} onValueChange={workspace.setBrushSize} onFocus={() => setBrushSizeFlyoutOpen(true)} />{brushSizeFlyoutOpen && <div className="brush-size-popover" role="dialog" aria-label={t('toolOptions.adjustBrushSize')}><input aria-label={t('toolOptions.brushSizeSlider')} type="range" min="1" max="128" value={session.brushSize} onChange={(event) => workspace.setBrushSize(Number(event.target.value))} /><strong>{session.brushSize}px</strong></div>}</div>}
      {session.brushImage?.intrinsicSize && <span className="brush-paint-mode-select" title={t('toolOptions.brushModeHint')}><ThemedSelect<BrushPaintMode> value={session.brushPaintMode} groups={brushPaintModeGroups} label={t('toolOptions.brushMode')} onChange={workspace.setBrushPaintMode} /></span>}
      {session.tool === 'pencil' && <label className="line-direction-step-control"><Tooltip content={t('toolOptions.lineDirectionStepHint')}><span>{t('toolOptions.lineDirectionStep')}</span></Tooltip><NumberInput aria-label={t('toolOptions.lineDirectionStep')} min={1} max={16} value={lineDirectionStep} onValueChange={updateLineDirectionStep} /></label>}
      {(session.tool === 'pencil' || session.tool === 'eraser') && <label className="tool-checkbox"><PixelCheckbox checked={session.perfectPixels} onChange={(event) => workspace.setPerfectPixels(event.target.checked)} />{t('toolOptions.perfectPixels')}</label>}
      {(session.tool === 'pencil' || session.tool === 'eraser') && <div ref={pressureControlRef} className="pressure-control">
        <Tooltip content={t('toolOptions.brushDynamicsDescription')}><button className={`pressure-trigger ${session.brushDynamics.effects.size.sensor || session.brushDynamics.effects.strength.sensor || session.brushDynamics.effects.gradient.sensor ? 'selected' : ''}`} type="button" aria-expanded={pressureFlyoutOpen} onClick={() => setPressureFlyoutOpen((open) => !open)}>{t('toolOptions.brushDynamics')}<ChevronDown size={14} /></button></Tooltip>
        {pressureFlyoutOpen && pressurePopoverPosition && createPortal(<div className="pressure-popover" role="dialog" aria-label={t('toolOptions.brushDynamicsSettings')} style={pressurePopoverPosition}><BrushDynamicsSettingsPanel settings={session.brushDynamics} tool={session.tool} intrinsicSize={Boolean(session.brushImage?.intrinsicSize)} brushSize={session.brushSize} documentId={session.document.id} primaryColor={session.primaryColor} secondaryColor={session.secondaryColor} onChange={workspace.setBrushDynamicsMapping} onGradientDitherChange={workspace.setBrushDynamicsGradientDither} /></div>, document.body)}
      </div>}
    </>}
    {session.tool === 'selection' && <>
      <div className="selection-mode-control" aria-label={t('toolOptions.selectionMode')}>{selectionModeItems.map((mode) => <button key={mode.id} title={mode.label} aria-label={mode.label} className={`icon-button ${(temporarySelectionMode ?? session.selectionMode) === mode.id ? 'selected' : ''}`} onClick={() => workspace.setSelectionMode(mode.id)}><PixelAssetIcon src={mode.icon} /></button>)}</div>
      {session.selectionKind === 'magic' && <><ToleranceControl value={session.wandTolerance} open={toleranceFlyoutOpen === 'wand'} label={t('toolOptions.tolerance')} inputLabel={t('toolOptions.magicWandTolerance')} sliderLabel={t('toolOptions.magicWandToleranceSlider')} onOpen={() => setToleranceFlyoutOpen('wand')} onChange={workspace.setWandTolerance} /><label className="tool-checkbox"><PixelCheckbox aria-label={t('toolOptions.contiguousSelection')} checked={session.wandContiguous} onChange={(event) => workspace.setWandContiguous(event.target.checked)} />{t('toolOptions.contiguous')}</label></>}
    </>}
    {session.tool === 'shape' && <div className="shape-ratio-control"><label className="tool-checkbox"><PixelCheckbox checked={session.shapeRatio !== null} onChange={(event) => workspace.setShapeRatio(event.target.checked ? { width: 1, height: 1 } : null)} />{t('toolOptions.fixedRatio')}</label>{session.shapeRatio !== null && <div className="shape-ratio-inputs"><NumberInput aria-label={t('toolOptions.shapeWidthRatio')} min={0.1} max={100} step={0.1} value={session.shapeRatio.width} onValueChange={(width) => workspace.setShapeRatio({ ...session.shapeRatio!, width })} /><span>:</span><NumberInput aria-label={t('toolOptions.shapeHeightRatio')} min={0.1} max={100} step={0.1} value={session.shapeRatio.height} onValueChange={(height) => workspace.setShapeRatio({ ...session.shapeRatio!, height })} /><button type="button" className="icon-button shape-ratio-swap" title={t('toolOptions.swapRatio')} aria-label={t('toolOptions.swapRatio')} onClick={() => workspace.setShapeRatio({ width: session.shapeRatio!.height, height: session.shapeRatio!.width })}><ArrowLeftRight size={13} /></button></div>}</div>}
    {session.tool === 'fill' && fillKind === 'bucket' && <><ToleranceControl value={session.fillTolerance} open={toleranceFlyoutOpen === 'fill'} label={t('toolOptions.tolerance')} inputLabel={t('toolOptions.fillTolerance')} sliderLabel={t('toolOptions.fillToleranceSlider')} onOpen={() => setToleranceFlyoutOpen('fill')} onChange={workspace.setFillTolerance} /><label className="tool-checkbox"><PixelCheckbox aria-label={t('toolOptions.contiguousFill')} checked={session.fillMode === 'contiguous'} onChange={(event) => workspace.setFillMode(event.target.checked ? 'contiguous' : 'global')} />{t('toolOptions.contiguous')}</label></>}
    {session.tool === 'fill' && fillKind === 'gradient' && <>
      <ToleranceControl value={session.gradientTolerance} open={toleranceFlyoutOpen === 'gradient'} label={t('toolOptions.tolerance')} inputLabel={t('toolOptions.gradientTolerance')} sliderLabel={t('toolOptions.gradientToleranceSlider')} onOpen={() => setToleranceFlyoutOpen('gradient')} onChange={workspace.setGradientTolerance} />
      <label className="tool-checkbox"><PixelCheckbox aria-label={t('toolOptions.contiguousGradient')} checked={session.gradientContiguous} onChange={(event) => workspace.setGradientContiguous(event.target.checked)} />{t('toolOptions.contiguous')}</label>
      <span className="gradient-dither-select"><ThemedSelect<GradientDither>
        value={gradientDither}
        groups={gradientDitherGroups}
        label={t('toolOptions.gradientDither')}
        onChange={workspace.setGradientDither}
        showCheck={false}
        showOptionTooltips={false}
        popoverClassName="gradient-dither-popover"
        popoverWidth={340}
        renderOption={(option) => <span className="gradient-option-content"><strong>{option.label}</strong><GradientPresetPreview preset={option.value} /></span>}
      /></span>
    </>}
    {supportsSymmetry && <SymmetryControls key={session.tool} axes={session.symmetryAxes} onAxisToggle={workspace.setSymmetryAxis} onResetCenter={workspace.resetSymmetryCenter} />}
    {session.tool === 'move' && <label className="tool-checkbox"><PixelCheckbox checked={session.moveAutoSelect} onChange={(event) => workspace.setMoveAutoSelect(event.target.checked)} />{t('toolOptions.autoSelectLayer')}</label>}
    {session.tool === 'rotate' && <div className="rotate-view-options"><label>{t('toolOptions.rotation')} <NumberInput aria-label={t('toolOptions.rotation')} min={0} max={359.9} step={0.1} value={Math.round(session.view.rotation * 10) / 10} onValueChange={(rotation) => workspace.setView({ rotation: ((rotation % 360) + 360) % 360 })} /></label><button type="button" className="tool-text-button" onClick={() => workspace.setView({ rotation: 0 })}>{t('toolOptions.resetView')}</button></div>}
    <span className="tool-options-spacer" />
    <span className="tool-history-actions"><button className="tool-text-button" onClick={() => workspace.undo()} disabled={!session.history.canUndo}><PixelUtilityIcon kind="undo" />{t('common.undo')}</button><button className="tool-text-button" onClick={() => workspace.redo()} disabled={!session.history.canRedo}><PixelUtilityIcon kind="redo" />{t('common.redo')}</button></span>
  </div></PerformanceProfiler>
})
