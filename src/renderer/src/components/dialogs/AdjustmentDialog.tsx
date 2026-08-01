import { useEffect, useMemo, useRef, useState } from 'react'
import { Eye, Trash2, X } from 'lucide-react'
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
import { useWorkspace } from '@/store/workspace'

function AdjustmentSlider({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (value: number) => void }) {
  return <label className="adjustment-slider-row"><span>{label}</span><input type="range" min={min} max={max} value={value} onChange={(event) => onChange(Number(event.target.value))} /><NumberInput min={min} max={max} value={value} onValueChange={onChange} /></label>
}

function CurveEditor({ points, channel = 'rgb', histogram, onChange }: { points: CurvePoint[]; channel?: CurveChannel; histogram?: Uint32Array; onChange: (points: CurvePoint[]) => void }) {
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
  const tendency = channel === 'rgb' ? '中性色调' : channel === 'red' ? '青 ↔ 红' : channel === 'green' ? '洋红 ↔ 绿' : '黄 ↔ 蓝'
  return <div className={`curve-editor curve-editor-${channel}`}><div className="curve-editor-toolbar"><span>{tendency}</span><button type="button" className="icon-button" title="删除选中的控制点" aria-label="删除选中的控制点" disabled={selectedPoint === null || selectedPoint === 0 || selectedPoint === points.length - 1} onClick={removeSelected}><Trash2 size={13} /></button></div><svg viewBox="0 0 255 255" preserveAspectRatio="none" role="application" tabIndex={0} aria-label="曲线编辑器：点击添加控制点，拖动调整，右键或删除按钮移除中间点" onKeyDown={(event) => { if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); removeSelected() } }} onPointerDown={begin} onPointerMove={move} onPointerUp={end} onPointerCancel={end} onDoubleClick={remove} onContextMenu={removeContext}>{histogram && <path className={`curve-histogram curve-histogram-${channel}`} d={buildHistogramPath(histogram)} />}{points.length > 1 && <path className={`curve-line curve-line-${channel}`} d={path} />}{points.map((point, index) => <rect key={index} className={`curve-point curve-point-${channel} ${selectedPoint === index ? 'selected' : ''}`} x={point.x - 4} y={251 - point.y} width="8" height="8" />)}</svg><div className="curve-editor-axis"><span>暗部</span><span>亮部</span></div></div>
}

export function AdjustmentDialog({ kind, onClose }: { kind: AdjustmentKind; onClose: () => void }) {
  const [baseline] = useState(() => useWorkspace.getState().captureActiveLayerAdjustmentSnapshot())
  const [previewEnabled, setPreviewEnabled] = useState(true)
  const [brightness, setBrightness] = useState(0)
  const [contrast, setContrast] = useState(0)
  const [hue, setHue] = useState(0)
  const [saturation, setSaturation] = useState(0)
  const [curveChannel, setCurveChannel] = useState<CurveChannel>('rgb')
  const [curvePoints, setCurvePoints] = useState<Record<CurveChannel, CurvePoint[]>>({
    rgb: [{ x: 0, y: 0 }, { x: 255, y: 255 }],
    red: [{ x: 0, y: 0 }, { x: 255, y: 255 }],
    green: [{ x: 0, y: 0 }, { x: 255, y: 255 }],
    blue: [{ x: 0, y: 0 }, { x: 255, y: 255 }]
  })
  const [balanceTone, setBalanceTone] = useState<'shadows' | 'midtones' | 'highlights'>('midtones')
  const [preserveLuminosity, setPreserveLuminosity] = useState(true)
  const histogram = useMemo(() => baseline ? buildCurveHistogram(baseline.pixels, baseline.pixels instanceof Uint8ClampedArray ? 'rgba' : 'indexed', baseline.palette) : null, [baseline])
  const [balance, setBalance] = useState({
    shadowsCyanRed: 0, shadowsMagentaGreen: 0, shadowsYellowBlue: 0,
    midtonesCyanRed: 0, midtonesMagentaGreen: 0, midtonesYellowBlue: 0,
    highlightsCyanRed: 0, highlightsMagentaGreen: 0, highlightsYellowBlue: 0
  })
  const adjustment = useMemo<ColorAdjustment>(() => kind === 'brightness-contrast'
    ? { kind, brightness, contrast }
    : kind === 'hue-saturation'
      ? { kind, hue, saturation }
      : kind === 'curves'
        ? { kind, curvePoints: curvePoints.rgb, curveRedPoints: curvePoints.red, curveGreenPoints: curvePoints.green, curveBluePoints: curvePoints.blue }
        : { kind, ...balance, preserveLuminosity }, [kind, brightness, contrast, hue, saturation, curvePoints, balance, preserveLuminosity])

  useEffect(() => {
    if (!baseline) return
    const workspace = useWorkspace.getState()
    if (previewEnabled) workspace.previewActiveLayerAdjustment(adjustment, baseline)
    else workspace.restoreActiveDocumentSnapshot(baseline)
  }, [adjustment, baseline, previewEnabled])

  const cancel = (): void => {
    if (baseline) useWorkspace.getState().restoreActiveDocumentSnapshot(baseline)
    onClose()
  }
  const apply = (): void => {
    if (baseline) useWorkspace.getState().applyActiveLayerAdjustmentFromSnapshot(adjustment, baseline)
    onClose()
  }
  const title = kind === 'color-balance' ? '色彩平衡' : kind === 'brightness-contrast' ? '亮度/对比度' : kind === 'hue-saturation' ? '色相/饱和度' : '曲线'
  const tonePrefix = balanceTone === 'shadows' ? 'shadows' : balanceTone === 'midtones' ? 'midtones' : 'highlights'
  const updateBalance = (channel: 'CyanRed' | 'MagentaGreen' | 'YellowBlue', value: number): void => setBalance((current) => ({ ...current, [`${tonePrefix}${channel}`]: value }))
  const balanceValue = (channel: 'CyanRed' | 'MagentaGreen' | 'YellowBlue'): number => balance[`${tonePrefix}${channel}` as keyof typeof balance]

  return <div className="modal-backdrop" role="presentation"><section className="modal adjustment-modal" role="dialog" aria-label={title}><header><div><span className="eyebrow">ADJUST</span><h2>{title}</h2></div><button className="icon-button" aria-label="关闭" onClick={cancel}><X size={16} /></button></header><div className="modal-body adjustment-modal-body">
    {kind === 'brightness-contrast' && <section className="adjustment-controls"><AdjustmentSlider label="亮度" min={-100} max={100} value={brightness} onChange={setBrightness} /><AdjustmentSlider label="对比度" min={-100} max={100} value={contrast} onChange={setContrast} /></section>}
    {kind === 'hue-saturation' && <section className="adjustment-controls"><AdjustmentSlider label="色相" min={-180} max={180} value={hue} onChange={setHue} /><AdjustmentSlider label="饱和度" min={-100} max={100} value={saturation} onChange={setSaturation} /></section>}
    {kind === 'curves' && <section className="adjustment-controls curve-controls"><div className="curve-channel-tabs" role="tablist" aria-label="曲线通道">{(['rgb', 'red', 'green', 'blue'] as CurveChannel[]).map((channel) => <button type="button" key={channel} className={`curve-channel-${channel} ${curveChannel === channel ? 'selected' : ''}`} onClick={() => setCurveChannel(channel)}><i aria-hidden="true" />{channel === 'rgb' ? 'RGB' : channel === 'red' ? '红' : channel === 'green' ? '绿' : '蓝'}</button>)}</div><CurveEditor channel={curveChannel} histogram={histogram?.[curveChannel]} points={curvePoints[curveChannel]} onChange={(next) => setCurvePoints((current) => ({ ...current, [curveChannel]: next }))} /><button type="button" className="quiet-button curve-reset" onClick={() => setCurvePoints((current) => ({ ...current, [curveChannel]: [{ x: 0, y: 0 }, { x: 255, y: 255 }] }))}>重置当前通道</button></section>}
    {kind === 'color-balance' && <section className="balance-panel"><div className="balance-tone-tabs segmented-control"><button className={balanceTone === 'shadows' ? 'selected' : ''} onClick={() => setBalanceTone('shadows')}>阴影</button><button className={balanceTone === 'midtones' ? 'selected' : ''} onClick={() => setBalanceTone('midtones')}>中间调</button><button className={balanceTone === 'highlights' ? 'selected' : ''} onClick={() => setBalanceTone('highlights')}>高光</button></div><div className="adjustment-controls balance-controls"><AdjustmentSlider label="青色 - 红色" min={-100} max={100} value={balanceValue('CyanRed')} onChange={(value) => updateBalance('CyanRed', value)} /><AdjustmentSlider label="洋红 - 绿色" min={-100} max={100} value={balanceValue('MagentaGreen')} onChange={(value) => updateBalance('MagentaGreen', value)} /><AdjustmentSlider label="黄色 - 蓝色" min={-100} max={100} value={balanceValue('YellowBlue')} onChange={(value) => updateBalance('YellowBlue', value)} /></div><label className="tool-checkbox preserve-luminosity"><input type="checkbox" checked={preserveLuminosity} onChange={(event) => setPreserveLuminosity(event.target.checked)} />保持明度</label></section>}
    <label className="outline-preview-toggle adjustment-preview-toggle"><span className="outline-preview-label"><Eye size={15} />实时预览</span><input type="checkbox" checked={previewEnabled} onChange={(event) => setPreviewEnabled(event.target.checked)} /><span className="toggle-track" aria-hidden="true"><i /></span></label>
  </div><footer><button className="quiet-button" onClick={cancel}>取消</button><button className="primary-button" onClick={apply}>应用</button></footer></section></div>
}
