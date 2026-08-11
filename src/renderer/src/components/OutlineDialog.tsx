import { useEffect, useState } from 'react'
import type { OutlineDirection, OutlineDirections, OutlineKernel, OutlinePosition, RgbaColor } from '@shared/types'
import { ColorPicker } from '@/components/ColorPicker'
import { useI18n } from '@/components/I18nProvider'
import { ModalShell } from '@/components/ModalShell'
import { NumberInput } from '@/components/NumberInput'
import { PixelUtilityIcon } from '@/components/PixelUtilityIcon'
import { LivePreviewToggle } from '@/components/LivePreviewToggle'
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

const quickShapeIds: OutlineKernel[] = ['round', 'square', 'horizontal', 'vertical']

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
  const { t } = useI18n()
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
  const quickShapes = quickShapeIds.map((id) => ({ id, label: t(`outline.shape.${id}`) }))

  return <div className="modal-backdrop" role="presentation">
    <ModalShell as="form" storageKey="outline" defaultWidth={560} defaultHeight={540} className="outline-modal" onSubmit={(event) => { event.preventDefault(); submit() }} onKeyDown={(event) => {
      if (event.key !== 'Enter' || event.nativeEvent.isComposing || (event.target as HTMLElement).tagName === 'TEXTAREA') return
      event.stopPropagation()
      if (event.defaultPrevented) return
      event.preventDefault()
      submit()
    }}>
      <header><div><span className="eyebrow">OUTLINE</span><h2>{t('outline.title')}</h2></div><button type="button" className="icon-button" aria-label={t('common.close')} onClick={close}><PixelUtilityIcon kind="close" /></button></header>
      <div className="modal-body outline-modal-body">
        <section className="outline-color-section"><span className="outline-section-label">{t('outline.color')}</span><ColorPicker color={color} onChange={setColor} compact label={t('outline.color')} /></section>
        <section className="outline-width-setting"><label><span>{t('outline.width')}</span><div className="outline-width-row"><input type="range" min="1" max="64" value={thickness} onChange={(event) => setThickness(Number(event.target.value))} /><NumberInput min={1} max={64} value={thickness} onValueChange={setThickness} /><span>px</span></div></label></section>
        <fieldset className="outline-settings-fieldset"><legend>{t('outline.settings')}</legend>
          <div className="outline-setting-group"><span>{t('outline.position')}</span><div className="outline-position-control segmented-control"><button type="button" className={position === 'outside' ? 'selected' : ''} onClick={() => setPosition('outside')}>{t('outline.outside')}</button><button type="button" className={position === 'inside' ? 'selected' : ''} onClick={() => setPosition('inside')}>{t('outline.inside')}</button></div></div>
          <div className="outline-pattern-layout">
            <div className="outline-setting-group"><span>{t('outline.quickShapes')}</span><div className="outline-quick-shapes">{quickShapes.map((shape) => <button key={shape.id} type="button" className={activeQuickShape === shape.id ? 'selected' : ''} title={shape.label} aria-label={shape.label} onClick={() => applyQuickShape(shape.id)}><OutlineKernelIcon kernel={shape.id} /></button>)}</div></div>
            <div className="outline-setting-group outline-direction-setting"><span>{t('outline.pixelDirections')}</span><div className="outline-direction-grid" aria-label={t('outline.pixelDirectionsAria')}>{directionGrid.map((direction) => {
              if (direction === 'center') return <span key={direction} className="outline-direction-center" aria-hidden="true"><i /></span>
              return <button key={direction} type="button" className={edgeDirections[direction] ? 'selected' : ''} title={t('outline.allowDirection', { direction })} aria-label={t('outline.allowDirection', { direction })} onClick={() => toggleDirection(direction)}><span /></button>
            })}</div></div>
          </div>
        </fieldset>
        <LivePreviewToggle checked={previewEnabled} onChange={setPreviewEnabled} />
      </div>
      <footer><button type="button" className="quiet-button" onClick={close}>{t('common.cancel')}</button><button type="submit" className="primary-button">{t('outline.apply')}</button></footer>
    </ModalShell>
  </div>
}
