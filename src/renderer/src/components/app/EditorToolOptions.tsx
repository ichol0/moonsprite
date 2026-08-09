import { memo, useEffect, useRef, useState } from 'react'
import { ArrowLeftRight } from 'lucide-react'
import type { BrushPaintMode, GradientDither, ImageBrush, ImageBrushSettings, ProceduralBrushId, ProceduralBrushSettings, RgbaColor, SelectionMode } from '@shared/types'
import { NumberInput } from '@/components/NumberInput'
import { PerformanceProfiler } from '@/components/PerformanceProfiler'
import { ThemedSelect } from '@/components/ThemedSelect'
import { useI18n } from '@/components/I18nProvider'
import { toolOptionsRenderKey } from '@/core/app-render-keys'
import { isProceduralBrushId } from '@/core/brushes'
import type { TranslationKey } from '@/core/localization'
import { brushMaskOffsets, brushStampDimensions } from '@/core/tools'
import { loadEditorPreferences, type CheckerboardPreferences } from '@/core/file-preferences'
import { gradientColorAt } from '@/core/gradient'
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

export const EditorToolOptions = memo(function EditorToolOptions() {
  const { locale, t } = useI18n()
  const renderKey = useWorkspace((state) => toolOptionsRenderKey(
    state.sessions.find((item) => item.document.id === state.activeId) ?? null
  ))
  const [brushFlyoutOpen, setBrushFlyoutOpen] = useState(false)
  const [brushSizeFlyoutOpen, setBrushSizeFlyoutOpen] = useState(false)
  const [temporarySelectionMode, setTemporarySelectionMode] = useState<SelectionMode | null>(null)
  const [brushOutputOpen, setBrushOutputOpen] = useState(false)
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
    const closeOutside = (event: PointerEvent): void => {
      if (!(event.target instanceof Element)) return
      if (!event.target.closest('.brush-source')) setBrushFlyoutOpen(false)
      if (!event.target.closest('.brush-size-control')) setBrushSizeFlyoutOpen(false)
    }
    const closeOnBlur = (): void => setBrushFlyoutOpen(false)
    const closeAll = (event: Event): void => {
      const target = (event as CustomEvent<{ target?: string }>).detail?.target
      if (target && target !== 'popover') return
      setBrushFlyoutOpen(false)
      setBrushSizeFlyoutOpen(false)
      setBrushOutputOpen(false)
    }
    window.addEventListener('pointerdown', closeOutside, true)
    window.addEventListener('blur', closeOnBlur)
    window.addEventListener('moonsprite:close-dialog', closeAll)
    return () => {
      window.removeEventListener('pointerdown', closeOutside, true)
      window.removeEventListener('blur', closeOnBlur)
      window.removeEventListener('moonsprite:close-dialog', closeAll)
    }
  }, [])

  useEffect(() => {
    if (session?.tool !== 'pencil' && session?.tool !== 'eraser' && !(session?.tool === 'fill' && (session.fillKind ?? 'bucket') === 'bucket')) {
      setBrushFlyoutOpen(false)
      setBrushSizeFlyoutOpen(false)
    }
  }, [renderKey, session?.tool, session?.fillKind])

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
  const gradientDitherGroups: Array<{ label: string; options: Array<{ value: GradientDither; label: string; description: string }> }> = [
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
  return <PerformanceProfiler id="EditorToolOptions"><div className="tool-options">
    <span className="tool-label" title={presentation.description}>{presentation.label}</span>
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
      {(session.tool === 'pencil' || session.tool === 'eraser') && <label className="tool-checkbox"><PixelCheckbox checked={session.perfectPixels} onChange={(event) => workspace.setPerfectPixels(event.target.checked)} />{t('toolOptions.perfectPixels')}</label>}
    </>}
    {session.tool === 'selection' && <>
      <div className="selection-mode-control" aria-label={t('toolOptions.selectionMode')}>{selectionModeItems.map((mode) => <button key={mode.id} title={mode.label} aria-label={mode.label} className={`icon-button ${(temporarySelectionMode ?? session.selectionMode) === mode.id ? 'selected' : ''}`} onClick={() => workspace.setSelectionMode(mode.id)}><PixelAssetIcon src={mode.icon} /></button>)}</div>
      {session.selectionKind === 'magic' && <><label className="wand-tolerance">{t('toolOptions.tolerance')} <NumberInput aria-label={t('toolOptions.magicWandTolerance')} min={0} max={255} value={session.wandTolerance} onValueChange={workspace.setWandTolerance} /></label><label className="tool-checkbox"><PixelCheckbox aria-label={t('toolOptions.contiguousSelection')} checked={session.wandContiguous} onChange={(event) => workspace.setWandContiguous(event.target.checked)} />{t('toolOptions.contiguous')}</label></>}
    </>}
    {session.tool === 'shape' && <div className="shape-ratio-control"><label className="tool-checkbox"><PixelCheckbox checked={session.shapeRatio !== null} onChange={(event) => workspace.setShapeRatio(event.target.checked ? { width: 1, height: 1 } : null)} />{t('toolOptions.fixedRatio')}</label>{session.shapeRatio !== null && <div className="shape-ratio-inputs"><NumberInput aria-label={t('toolOptions.shapeWidthRatio')} min={0.1} max={100} step={0.1} value={session.shapeRatio.width} onValueChange={(width) => workspace.setShapeRatio({ ...session.shapeRatio!, width })} /><span>:</span><NumberInput aria-label={t('toolOptions.shapeHeightRatio')} min={0.1} max={100} step={0.1} value={session.shapeRatio.height} onValueChange={(height) => workspace.setShapeRatio({ ...session.shapeRatio!, height })} /><button type="button" className="icon-button shape-ratio-swap" title={t('toolOptions.swapRatio')} aria-label={t('toolOptions.swapRatio')} onClick={() => workspace.setShapeRatio({ width: session.shapeRatio!.height, height: session.shapeRatio!.width })}><ArrowLeftRight size={13} /></button></div>}</div>}
    {session.tool === 'fill' && fillKind === 'bucket' && <div className="segmented-control fill-mode-control" aria-label={t('toolOptions.fillRange')}><button className={session.fillMode === 'contiguous' ? 'selected' : ''} onClick={() => workspace.setFillMode('contiguous')}>{t('toolOptions.contiguous')}</button><button className={session.fillMode === 'global' ? 'selected' : ''} onClick={() => workspace.setFillMode('global')}>{t('toolOptions.nonContiguous')}</button></div>}
    {session.tool === 'fill' && fillKind === 'gradient' && <span className="gradient-dither-select"><ThemedSelect<GradientDither>
      value={gradientDither}
      groups={gradientDitherGroups}
      label={t('toolOptions.gradientDither')}
      onChange={workspace.setGradientDither}
      showCheck={false}
      showOptionTooltips={false}
      popoverClassName="gradient-dither-popover"
      popoverWidth={340}
      renderOption={(option) => <span className="gradient-option-content"><strong>{option.label}</strong><GradientPresetPreview preset={option.value} /></span>}
    /></span>}
    {supportsSymmetry && <SymmetryControls key={session.tool} axes={session.symmetryAxes} onAxisToggle={workspace.setSymmetryAxis} onResetCenter={workspace.resetSymmetryCenter} />}
    {session.tool === 'move' && <label className="tool-checkbox"><PixelCheckbox checked={session.moveAutoSelect} onChange={(event) => workspace.setMoveAutoSelect(event.target.checked)} />{t('toolOptions.autoSelectLayer')}</label>}
    {session.tool === 'rotate' && <div className="rotate-view-options"><label>{t('toolOptions.rotation')} <NumberInput aria-label={t('toolOptions.rotation')} min={0} max={359.9} step={0.1} value={Math.round(session.view.rotation * 10) / 10} onValueChange={(rotation) => workspace.setView({ rotation: ((rotation % 360) + 360) % 360 })} /></label><button type="button" className="tool-text-button" onClick={() => workspace.setView({ rotation: 0 })}>{t('toolOptions.resetView')}</button></div>}
    <span className="tool-options-spacer" />
    <span className="tool-history-actions"><button className="tool-text-button" onClick={() => workspace.undo()} disabled={!session.history.canUndo}><PixelUtilityIcon kind="undo" />{t('common.undo')}</button><button className="tool-text-button" onClick={() => workspace.redo()} disabled={!session.history.canRedo}><PixelUtilityIcon kind="redo" />{t('common.redo')}</button></span>
  </div></PerformanceProfiler>
})
