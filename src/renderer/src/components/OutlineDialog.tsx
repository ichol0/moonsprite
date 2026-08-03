import { useEffect, useState } from 'react'
import { Eye, X } from 'lucide-react'
import type { OutlineDirection, OutlineDirections, OutlineKernel, OutlinePosition, RgbaColor } from '@shared/types'
import { ColorPicker } from '@/components/ColorPicker'
import { ModalShell } from '@/components/ModalShell'
import { NumberInput } from '@/components/NumberInput'
import { defaultOutlineSettings, normalizeOutlineSettings } from '@/core/outline-settings'
import { useWorkspace, type DocumentSession } from '@/store/workspace'

const directionGrid: Array<OutlineDirection | 'center'> = ['nw', 'n', 'ne', 'w', 'center', 'e', 'sw', 's', 'se']
const diagonalDirections = new Set<OutlineDirection>(['nw', 'ne', 'sw', 'se'])
const allDirections = (): OutlineDirections => ({ nw: true, n: true, ne: true, w: true, e: true, sw: true, s: true, se: true })
const kernelDirections = (kernel: OutlineKernel): OutlineDirections => {
  const directions = allDirections()
  if (kernel === 'round') for (const direction of diagonalDirections) directions[direction] = false
  if (kernel === 'horizontal') for (const direction of ['nw', 'n', 'ne', 'sw', 's', 'se'] as OutlineDirection[]) directions[direction] = false
  if (kernel === 'vertical') for (const direction of ['nw', 'w', 'sw', 'ne', 'e', 'se'] as OutlineDirection[]) directions[direction] = false
  return directions
}
const matchesKernelDirections = (kernel: OutlineKernel, directions: OutlineDirections): boolean => {
  const preset = kernelDirections(kernel)
  return (Object.keys(preset) as OutlineDirection[]).every((direction) => preset[direction] === directions[direction])
}

const quickShapes: Array<{ id: OutlineKernel; label: string }> = [
  { id: 'round', label: '圆形' },
  { id: 'square', label: '方形' },
  { id: 'horizontal', label: '水平' },
  { id: 'vertical', label: '垂直' }
]

const kernelMasks: Record<OutlineKernel, string[]> = {
  round: ['010', '101', '010'],
  square: ['111', '101', '111'],
  horizontal: ['000', '101', '000'],
  vertical: ['010', '000', '010']
}

function OutlineKernelIcon({ kernel }: { kernel: OutlineKernel }) {
  return <span className="outline-kernel-icon" aria-hidden="true">{kernelMasks[kernel].flatMap((row, y) => [...row].map((cell, x) => <i key={`${x}-${y}`} className={`${cell === '1' ? 'active' : ''} ${x === 1 && y === 1 ? 'source' : ''}`} />))}</span>
}

export function OutlineDialog({ open, session, onClose }: { open: boolean; session: DocumentSession; onClose: () => void }) {
  const setOutlinePreview = useWorkspace((state) => state.setOutlinePreview)
  const outlineActiveSelection = useWorkspace((state) => state.outlineActiveSelection)
  const [color, setColor] = useState<RgbaColor>(() => ({ ...session.primaryColor }))
  const [thickness, setThickness] = useState(1)
  const [position, setPosition] = useState<OutlinePosition>('outside')
  const [kernel, setKernel] = useState<OutlineKernel>('round')
  const [activeQuickShape, setActiveQuickShape] = useState<OutlineKernel | null>('round')
  const [edgeDirections, setEdgeDirections] = useState<OutlineDirections>(() => kernelDirections('round'))
  const [previewEnabled, setPreviewEnabled] = useState(true)

  useEffect(() => {
    if (!open) {
      setOutlinePreview(null)
      return
    }
    const settings = normalizeOutlineSettings(session.document.outlineSettings, session.primaryColor) ?? defaultOutlineSettings(session.primaryColor)
    setColor({ ...settings.color })
    setThickness(settings.thickness)
    setPosition(settings.position)
    setKernel(settings.kernel)
    setActiveQuickShape(matchesKernelDirections(settings.kernel, settings.directions) ? settings.kernel : null)
    setEdgeDirections({ ...settings.directions })
    setPreviewEnabled(settings.previewEnabled)
  }, [open, session.document.id, session.primaryColor.r, session.primaryColor.g, session.primaryColor.b, session.primaryColor.a, setOutlinePreview])

  useEffect(() => {
    if (open && previewEnabled) setOutlinePreview({ color, thickness, position, directions: edgeDirections, kernel })
    else setOutlinePreview(null)
  }, [open, previewEnabled, color, thickness, position, edgeDirections, kernel, setOutlinePreview])

  const close = (): void => { setOutlinePreview(null); onClose() }
  const applyQuickShape = (nextKernel: OutlineKernel): void => {
    setKernel(nextKernel)
    setActiveQuickShape(nextKernel)
    setEdgeDirections(kernelDirections(nextKernel))
  }
  const toggleDirection = (direction: OutlineDirection): void => {
    // Custom direction edits use the full neighborhood so the selected cells are
    // not silently filtered by the previous round/horizontal/vertical preset.
    setKernel('square')
    setActiveQuickShape(null)
    setEdgeDirections((current) => ({ ...current, [direction]: !current[direction] }))
  }
  const submit = (): void => {
    if (outlineActiveSelection(color, thickness, position, edgeDirections, kernel, previewEnabled)) close()
  }

  useEffect(() => {
    if (!open) return
    const keydown = (event: KeyboardEvent): void => {
      if (event.key !== 'Enter' || event.isComposing || (event.target as HTMLElement | null)?.tagName === 'TEXTAREA') return
      if ((event.target as Element | null)?.closest?.('.outline-modal')) return
      event.preventDefault()
      event.stopPropagation()
      submit()
    }
    window.addEventListener('keydown', keydown)
    return () => window.removeEventListener('keydown', keydown)
  }, [open, color, thickness, position, edgeDirections, kernel, previewEnabled])

  if (!open) return null

  return <div className="modal-backdrop" role="presentation">
    <ModalShell as="form" storageKey="outline" defaultWidth={560} defaultHeight={540} className="outline-modal" onSubmit={(event) => { event.preventDefault(); submit() }} onKeyDown={(event) => {
      if (event.key !== 'Enter' || event.nativeEvent.isComposing || (event.target as HTMLElement).tagName === 'TEXTAREA') return
      event.stopPropagation()
      if (event.defaultPrevented) return
      event.preventDefault()
      submit()
    }}>
      <header><div><span className="eyebrow">OUTLINE</span><h2>描边</h2></div><button type="button" className="icon-button" aria-label="关闭" onClick={close}><X size={16} /></button></header>
      <div className="modal-body outline-modal-body">
        <section className="outline-color-section"><span className="outline-section-label">描边颜色</span><ColorPicker color={color} onChange={setColor} compact label="描边颜色" /></section>
        <section className="outline-width-setting"><label><span>宽度</span><div className="outline-width-row"><input type="range" min="1" max="64" value={thickness} onChange={(event) => setThickness(Number(event.target.value))} /><NumberInput min={1} max={64} value={thickness} onValueChange={setThickness} /><span>px</span></div></label></section>
        <fieldset className="outline-settings-fieldset"><legend>描边设置</legend>
          <div className="outline-setting-group"><span>位置</span><div className="outline-position-control segmented-control"><button type="button" className={position === 'outside' ? 'selected' : ''} onClick={() => setPosition('outside')}>外部</button><button type="button" className={position === 'inside' ? 'selected' : ''} onClick={() => setPosition('inside')}>内部</button></div></div>
          <div className="outline-pattern-layout">
            <div className="outline-setting-group"><span>快捷形状</span><div className="outline-quick-shapes">{quickShapes.map((shape) => <button key={shape.id} type="button" className={activeQuickShape === shape.id ? 'selected' : ''} title={shape.label} aria-label={shape.label} onClick={() => applyQuickShape(shape.id)}><OutlineKernelIcon kernel={shape.id} /></button>)}</div></div>
            <div className="outline-setting-group outline-direction-setting"><span>像素方向</span><div className="outline-direction-grid" aria-label="允许描边的像素方向">{directionGrid.map((direction) => {
              if (direction === 'center') return <span key={direction} className="outline-direction-center" aria-hidden="true"><i /></span>
              return <button key={direction} type="button" className={edgeDirections[direction] ? 'selected' : ''} title={`允许 ${direction} 方向`} aria-label={`允许 ${direction} 方向`} onClick={() => toggleDirection(direction)}><span /></button>
            })}</div></div>
          </div>
        </fieldset>
        <label className="outline-preview-toggle"><span className="outline-preview-label"><Eye size={15} />实时预览</span><input type="checkbox" checked={previewEnabled} onChange={(event) => setPreviewEnabled(event.target.checked)} /><span className="toggle-track" aria-hidden="true"><i /></span></label>
      </div>
      <footer><button type="button" className="quiet-button" onClick={close}>取消</button><button type="submit" className="primary-button">应用描边</button></footer>
    </ModalShell>
  </div>
}
