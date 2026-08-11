import { useEffect, useMemo, useRef, useState } from 'react'
import {
  buildCurveHistogram,
  buildCurvePath,
  buildHistogramPath,
  type AdjustmentKind,
  type ColorAdjustment,
  type CurveChannel,
  type CurvePoint
} from '@/core/adjustments'
import { NumberInput } from '@/components/NumberInput'
import { PixelUtilityIcon } from '@/components/PixelUtilityIcon'
import { LivePreviewToggle } from '@/components/LivePreviewToggle'
import { PixelCheckbox } from '@/components/PixelCheckbox'
import { ModalShell } from '@/components/ModalShell'
import { useI18n } from '@/components/I18nProvider'
import { useWorkspace } from '@/store/workspace'
import { beginAdjustmentPreviewEdit, endAdjustmentPreviewEdit, registerAdjustmentPreviewController } from '@/core/adjustment-preview-lifecycle'

const adjustmentTargetState = (documentId: string | null) => {
  const state = useWorkspace.getState()
  const session = state.sessions.find((item) => item.document.id === documentId)
  return {
    selection: session?.selection ?? null,
    layerKey: session ? `${session.document.activeLayerId}|${session.selectedGroupId ?? ''}|${session.selectedGroupIds.join(',')}|${session.selectedLayerIds.join(',')}` : ''
  }
}

function AdjustmentSlider({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (value: number) => void }) {
  return <label className="adjustment-slider-row"><span>{label}</span><input type="range" min={min} max={max} value={value} onChange={(event) => onChange(Number(event.target.value))} /><NumberInput min={min} max={max} value={value} onValueChange={onChange} /></label>
}

function CurveEditor({ points, channel = 'rgb', histogram, onChange }: { points: CurvePoint[]; channel?: CurveChannel; histogram?: Uint32Array; onChange: (points: CurvePoint[]) => void }) {
  const { t } = useI18n()
  const activePointRef = useRef<number | null>(null)
  const [selectedPoint, setSelectedPoint] = useState<number | null>(null)
  const pointsRef = useRef(points)
  pointsRef.current = points
  useEffect(() => {
    if (selectedPoint !== null && selectedPoint >= points.length) setSelectedPoint(null)
  }, [points.length, selectedPoint])
  const eventPoint = (event: React.PointerEvent<SVGSVGElement>): CurvePoint => {
    const bounds = event.currentTarget.getBoundingClientRect()
    return {
      x: Math.max(0, Math.min(255, Math.round((event.clientX - bounds.left) / Math.max(1, bounds.width) * 255))),
      y: Math.max(0, Math.min(255, Math.round((bounds.bottom - event.clientY) / Math.max(1, bounds.height) * 255)))
    }
  }
  const nearestPoint = (event: React.PointerEvent<SVGSVGElement>): number => {
    const bounds = event.currentTarget.getBoundingClientRect()
    return pointsRef.current.findIndex((point) => Math.hypot(point.x / 255 * bounds.width - (event.clientX - bounds.left), (255 - point.y) / 255 * bounds.height - (event.clientY - bounds.top)) <= 12)
  }
  const begin = (event: React.PointerEvent<SVGSVGElement>): void => {
    if (event.button !== 0) return
    event.currentTarget.setPointerCapture(event.pointerId)
    const hit = nearestPoint(event)
    if (hit >= 0) {
      activePointRef.current = hit
      setSelectedPoint(hit)
    } else {
      const point = eventPoint(event)
      const next = [...pointsRef.current, point].sort((left, right) => left.x - right.x)
      activePointRef.current = next.indexOf(point)
      setSelectedPoint(activePointRef.current)
      pointsRef.current = next
      onChange(next)
    }
    event.preventDefault()
  }
  const move = (event: React.PointerEvent<SVGSVGElement>): void => {
    const index = activePointRef.current
    if (index === null) return
    const source = pointsRef.current
    const point = eventPoint(event)
    const next = source.map((item) => ({ ...item }))
    point.x = index === 0 ? 0 : index === next.length - 1 ? 255 : Math.max(next[index - 1].x + 1, Math.min(next[index + 1].x - 1, point.x))
    next[index] = point
    pointsRef.current = next
    onChange(next)
  }
  const end = (event: React.PointerEvent<SVGSVGElement>): void => {
    activePointRef.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }
  const removeAt = (clientX: number, clientY: number, bounds: DOMRect): void => {
    const index = pointsRef.current.findIndex((point) => Math.hypot(point.x / 255 * bounds.width - (clientX - bounds.left), (255 - point.y) / 255 * bounds.height - (clientY - bounds.top)) <= 12)
    if (index <= 0 || index >= pointsRef.current.length - 1) return
    const next = pointsRef.current.filter((_, pointIndex) => pointIndex !== index)
    pointsRef.current = next
    setSelectedPoint(null)
    onChange(next)
  }
  const remove = (event: React.MouseEvent<SVGSVGElement>): void => {
    const bounds = event.currentTarget.getBoundingClientRect()
    removeAt(event.clientX, event.clientY, bounds)
  }
  const removeContext = (event: React.MouseEvent<SVGSVGElement>): void => {
    event.preventDefault()
    removeAt(event.clientX, event.clientY, event.currentTarget.getBoundingClientRect())
  }
  const removeSelected = (): void => {
    if (selectedPoint === null || selectedPoint <= 0 || selectedPoint >= pointsRef.current.length - 1) return
    const next = pointsRef.current.filter((_, index) => index !== selectedPoint)
    pointsRef.current = next
    setSelectedPoint(null)
    onChange(next)
  }
  const path = buildCurvePath(points)
  const tendency = channel === 'rgb' ? t('adjustment.curve.neutral') : channel === 'red' ? t('adjustment.curve.cyanRed') : channel === 'green' ? t('adjustment.curve.magentaGreen') : t('adjustment.curve.yellowBlue')
  return <div className={`curve-editor curve-editor-${channel}`}><div className="curve-editor-toolbar"><span>{tendency}</span><button type="button" className="icon-button" title={t('adjustment.curve.deletePoint')} aria-label={t('adjustment.curve.deletePoint')} disabled={selectedPoint === null || selectedPoint === 0 || selectedPoint === points.length - 1} onClick={removeSelected}><PixelUtilityIcon kind="delete" /></button></div><svg className="curve-editor-plot" viewBox="0 0 255 255" preserveAspectRatio="none" role="application" tabIndex={0} aria-label={t('adjustment.curve.editorAria')} onKeyDown={(event) => { if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); removeSelected() } }} onPointerDown={begin} onPointerMove={move} onPointerUp={end} onPointerCancel={end} onDoubleClick={remove} onContextMenu={removeContext}>{histogram && <path className={`curve-histogram curve-histogram-${channel}`} d={buildHistogramPath(histogram)} />}{points.length > 1 && <path className={`curve-line curve-line-${channel}`} d={path} />}{points.map((point, index) => <rect key={index} className={`curve-point curve-point-${channel} ${selectedPoint === index ? 'selected' : ''}`} x={point.x - 4} y={251 - point.y} width="8" height="8" />)}</svg><div className="curve-editor-axis"><span>{t('adjustment.curve.shadows')}</span><span>{t('adjustment.curve.highlights')}</span></div></div>
}

export function AdjustmentDialog({ kind, onClose }: { kind: AdjustmentKind; onClose: () => void }) {
  const { t } = useI18n()
  const activeDocumentId = useWorkspace((state) => state.activeId)
  const activeSelection = useWorkspace((state) => state.sessions.find((session) => session.document.id === state.activeId)?.selection ?? null)
  const selectedLayerKey = useWorkspace((state) => {
    const session = state.sessions.find((item) => item.document.id === state.activeId)
    return session ? `${session.document.activeLayerId}|${session.selectedGroupId ?? ''}|${session.selectedGroupIds.join(',')}|${session.selectedLayerIds.join(',')}` : ''
  })
  const [baseline, setBaseline] = useState(() => useWorkspace.getState().captureActiveLayerAdjustmentSnapshot())
  const baselineRef = useRef(baseline)
  const baselineTargetRef = useRef(adjustmentTargetState(activeDocumentId))
  const transientBaselineRef = useRef<typeof baseline>(null)
  const suspendedRef = useRef(false)
  const closedRef = useRef(false)
  const [previewEnabled, setPreviewEnabled] = useState(true)
  const [brightness, setBrightness] = useState(0)
  const [contrast, setContrast] = useState(0)
  const [hue, setHue] = useState(0)
  const [saturation, setSaturation] = useState(0)
  const [lightness, setLightness] = useState(0)
  const [curveChannel, setCurveChannel] = useState<CurveChannel>('rgb')
  const [curvePoints, setCurvePoints] = useState<Record<CurveChannel, CurvePoint[]>>({
    rgb: [{ x: 0, y: 0 }, { x: 255, y: 255 }],
    red: [{ x: 0, y: 0 }, { x: 255, y: 255 }],
    green: [{ x: 0, y: 0 }, { x: 255, y: 255 }],
    blue: [{ x: 0, y: 0 }, { x: 255, y: 255 }]
  })
  const [balanceTone, setBalanceTone] = useState<'shadows' | 'midtones' | 'highlights'>('midtones')
  const [preserveLuminosity, setPreserveLuminosity] = useState(true)
  const histogramLayer = baseline?.layers[0]
  const histogram = useMemo(() => histogramLayer ? buildCurveHistogram(histogramLayer.pixels, histogramLayer.pixels instanceof Uint8ClampedArray ? 'rgba' : 'indexed', baseline?.palette ?? []) : null, [baseline, histogramLayer])
  const [balance, setBalance] = useState({
    shadowsCyanRed: 0, shadowsMagentaGreen: 0, shadowsYellowBlue: 0,
    midtonesCyanRed: 0, midtonesMagentaGreen: 0, midtonesYellowBlue: 0,
    highlightsCyanRed: 0, highlightsMagentaGreen: 0, highlightsYellowBlue: 0
  })
  const adjustment = useMemo<ColorAdjustment>(() => kind === 'brightness-contrast'
    ? { kind, brightness, contrast }
    : kind === 'hue-saturation'
      ? { kind, hue, saturation, lightness }
      : kind === 'curves'
        ? { kind, curvePoints: curvePoints.rgb, curveRedPoints: curvePoints.red, curveGreenPoints: curvePoints.green, curveBluePoints: curvePoints.blue }
        : { kind, ...balance, preserveLuminosity }, [kind, brightness, contrast, hue, saturation, lightness, curvePoints, balance, preserveLuminosity])
  const previewFrameRef = useRef<number | null>(null)
  const latestAdjustmentRef = useRef(adjustment)
  const previewEnabledRef = useRef(previewEnabled)
  latestAdjustmentRef.current = adjustment
  previewEnabledRef.current = previewEnabled
  const cancelScheduledPreview = (): void => {
    if (previewFrameRef.current === null) return
    window.cancelAnimationFrame(previewFrameRef.current)
    previewFrameRef.current = null
  }

  useEffect(() => {
    if (!activeDocumentId) return
    return registerAdjustmentPreviewController(activeDocumentId, {
      suspend: () => {
        if (closedRef.current) return
        suspendedRef.current = true
        transientBaselineRef.current = null
        cancelScheduledPreview()
        if (baselineRef.current) useWorkspace.getState().restoreActiveDocumentSnapshot(baselineRef.current)
      },
      prepare: () => {
        if (!suspendedRef.current || !transientBaselineRef.current) return
        useWorkspace.getState().restoreActiveDocumentSnapshot(transientBaselineRef.current)
      },
      render: (selection) => {
        if (!suspendedRef.current || closedRef.current) return
        const workspace = useWorkspace.getState()
        const next = workspace.captureActiveLayerAdjustmentSnapshot()
        transientBaselineRef.current = next
        if (next && previewEnabledRef.current) workspace.previewActiveLayerAdjustment(latestAdjustmentRef.current, next, selection)
      },
      resume: () => {
        if (closedRef.current || !suspendedRef.current) return
        const workspace = useWorkspace.getState()
        if (transientBaselineRef.current) workspace.restoreActiveDocumentSnapshot(transientBaselineRef.current)
        const next = workspace.captureActiveLayerAdjustmentSnapshot()
        transientBaselineRef.current = null
        suspendedRef.current = false
        baselineTargetRef.current = adjustmentTargetState(activeDocumentId)
        baselineRef.current = next
        if (next && previewEnabledRef.current) workspace.previewActiveLayerAdjustment(latestAdjustmentRef.current, next)
        setBaseline(next)
      }
    })
  }, [activeDocumentId])

  useEffect(() => {
    const target = baselineTargetRef.current
    if (target.selection === activeSelection && target.layerKey === selectedLayerKey) return
    if (!activeDocumentId || closedRef.current) return
    beginAdjustmentPreviewEdit(activeDocumentId)
    endAdjustmentPreviewEdit(activeDocumentId)
  }, [activeDocumentId, activeSelection, selectedLayerKey])

  useEffect(() => {
    if (!baseline || suspendedRef.current) return
    baselineRef.current = baseline
    if (previewFrameRef.current !== null) return
    previewFrameRef.current = window.requestAnimationFrame(() => {
      previewFrameRef.current = null
      const workspace = useWorkspace.getState()
      if (previewEnabledRef.current) workspace.previewActiveLayerAdjustment(latestAdjustmentRef.current, baselineRef.current ?? baseline)
      else workspace.restoreActiveDocumentSnapshot(baselineRef.current ?? baseline)
    })
  }, [adjustment, baseline, previewEnabled])

  const cancel = (): void => {
    if (closedRef.current) return
    closedRef.current = true
    cancelScheduledPreview()
    if (baselineRef.current) useWorkspace.getState().restoreActiveDocumentSnapshot(baselineRef.current)
    onClose()
  }
  const apply = (): void => {
    if (closedRef.current) return
    closedRef.current = true
    cancelScheduledPreview()
    if (baselineRef.current) useWorkspace.getState().applyActiveLayerAdjustmentFromSnapshot(latestAdjustmentRef.current, baselineRef.current)
    onClose()
  }
  useEffect(() => {
    const close = (event: Event): void => {
      const target = (event as CustomEvent<{ target?: string }>).detail?.target
      if (!target || target === 'adjustment') cancel()
    }
    window.addEventListener('moonsprite:close-dialog', close)
    return () => window.removeEventListener('moonsprite:close-dialog', close)
  })
  useEffect(() => () => cancelScheduledPreview(), [])
  const title = kind === 'color-balance' ? t('adjustment.title.colorBalance') : kind === 'brightness-contrast' ? t('adjustment.title.brightnessContrast') : kind === 'hue-saturation' ? t('adjustment.title.hueSaturation') : t('adjustment.title.curves')
  const tonePrefix = balanceTone === 'shadows' ? 'shadows' : balanceTone === 'midtones' ? 'midtones' : 'highlights'
  const updateBalance = (channel: 'CyanRed' | 'MagentaGreen' | 'YellowBlue', value: number): void => setBalance((current) => ({ ...current, [`${tonePrefix}${channel}`]: value }))
  const balanceValue = (channel: 'CyanRed' | 'MagentaGreen' | 'YellowBlue'): number => balance[`${tonePrefix}${channel}` as keyof typeof balance]

  return <div className="modal-backdrop" role="presentation"><ModalShell storageKey={`adjustment-${kind}-v3`} placement="right" defaultWidth={kind === 'curves' ? 460 : 400} defaultHeight={kind === 'curves' ? 520 : 380} minWidth={kind === 'curves' ? 420 : 350} minHeight={kind === 'curves' ? 430 : 300} maxWidth={680} maxHeight={760} className="adjustment-modal" role="dialog" aria-label={title}><header><div><span className="eyebrow">ADJUST</span><h2>{title}</h2></div><button className="icon-button" aria-label={t('common.close')} onClick={cancel}><PixelUtilityIcon kind="close" /></button></header><div className="modal-body adjustment-modal-body">
    {kind === 'brightness-contrast' && <section className="adjustment-controls"><AdjustmentSlider label={t('adjustment.brightness')} min={-100} max={100} value={brightness} onChange={setBrightness} /><AdjustmentSlider label={t('adjustment.contrast')} min={-100} max={100} value={contrast} onChange={setContrast} /></section>}
    {kind === 'hue-saturation' && <section className="adjustment-controls"><AdjustmentSlider label={t('adjustment.hue')} min={-180} max={180} value={hue} onChange={setHue} /><AdjustmentSlider label={t('adjustment.saturation')} min={-100} max={100} value={saturation} onChange={setSaturation} /><AdjustmentSlider label={t('adjustment.lightness')} min={-100} max={100} value={lightness} onChange={setLightness} /></section>}
    {kind === 'curves' && <section className="adjustment-controls curve-controls"><div className="curve-channel-tabs" role="tablist" aria-label={t('adjustment.curve.channels')}>{(['rgb', 'red', 'green', 'blue'] as CurveChannel[]).map((channel) => <button type="button" key={channel} className={`curve-channel-${channel} ${curveChannel === channel ? 'selected' : ''}`} onClick={() => setCurveChannel(channel)}><i aria-hidden="true" />{channel === 'rgb' ? 'RGB' : channel === 'red' ? t('adjustment.channel.red') : channel === 'green' ? t('adjustment.channel.green') : t('adjustment.channel.blue')}</button>)}</div><CurveEditor channel={curveChannel} histogram={histogram?.[curveChannel]} points={curvePoints[curveChannel]} onChange={(next) => setCurvePoints((current) => ({ ...current, [curveChannel]: next }))} /><button type="button" className="quiet-button curve-reset" onClick={() => setCurvePoints((current) => ({ ...current, [curveChannel]: [{ x: 0, y: 0 }, { x: 255, y: 255 }] }))}>{t('adjustment.curve.resetChannel')}</button></section>}
    {kind === 'color-balance' && <section className="balance-panel"><div className="balance-tone-tabs segmented-control"><button className={balanceTone === 'shadows' ? 'selected' : ''} onClick={() => setBalanceTone('shadows')}>{t('adjustment.balance.shadows')}</button><button className={balanceTone === 'midtones' ? 'selected' : ''} onClick={() => setBalanceTone('midtones')}>{t('adjustment.balance.midtones')}</button><button className={balanceTone === 'highlights' ? 'selected' : ''} onClick={() => setBalanceTone('highlights')}>{t('adjustment.balance.highlights')}</button></div><div className="adjustment-controls balance-controls"><AdjustmentSlider label={t('adjustment.balance.cyanRed')} min={-100} max={100} value={balanceValue('CyanRed')} onChange={(value) => updateBalance('CyanRed', value)} /><AdjustmentSlider label={t('adjustment.balance.magentaGreen')} min={-100} max={100} value={balanceValue('MagentaGreen')} onChange={(value) => updateBalance('MagentaGreen', value)} /><AdjustmentSlider label={t('adjustment.balance.yellowBlue')} min={-100} max={100} value={balanceValue('YellowBlue')} onChange={(value) => updateBalance('YellowBlue', value)} /></div><label className="tool-checkbox preserve-luminosity"><PixelCheckbox checked={preserveLuminosity} onChange={(event) => setPreserveLuminosity(event.target.checked)} />{t('adjustment.balance.preserveLuminosity')}</label></section>}
    <LivePreviewToggle className="adjustment-preview-toggle" checked={previewEnabled} onChange={setPreviewEnabled} />
  </div><footer><button className="quiet-button" onClick={cancel}>{t('common.cancel')}</button><button className="primary-button" onClick={apply}>{t('common.apply')}</button></footer></ModalShell></div>
}
