import { useEffect, useState } from 'react'
import type { OutlineDirections, OutlineKernel, OutlinePosition, RgbaColor } from '@shared/types'
import { ColorPicker } from '@/components/ColorPicker'
import { DialogHeader } from '@/components/DialogHeader'
import { useI18n } from '@/components/I18nProvider'
import { ModalShell } from '@/components/ModalShell'
import { LivePreviewToggle } from '@/components/LivePreviewToggle'
import { defaultOutlineSettings, normalizeOutlineSettings } from '@/core/outline-settings'
import { useWorkspace, type DocumentSession } from '@/store/workspace'
import { OutlineStrokeControls } from '@/components/OutlineStrokeControls'

export function OutlineDialog({ open, session, onClose }: { open: boolean; session: DocumentSession; onClose: () => void }) {
  const { t } = useI18n()
  const setOutlinePreview = useWorkspace((state) => state.setOutlinePreview)
  const outlineActiveSelection = useWorkspace((state) => state.outlineActiveSelection)
  const [color, setColor] = useState<RgbaColor>(() => ({ ...session.primaryColor }))
  const [thickness, setThickness] = useState(1)
  const [position, setPosition] = useState<OutlinePosition>('outside')
  const [kernel, setKernel] = useState<OutlineKernel>('round')
  const [edgeDirections, setEdgeDirections] = useState<OutlineDirections>(() => defaultOutlineSettings(session.primaryColor).directions)
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
    setEdgeDirections({ ...settings.directions })
    setPreviewEnabled(settings.previewEnabled)
  }, [open, session.document.id, session.primaryColor.r, session.primaryColor.g, session.primaryColor.b, session.primaryColor.a, setOutlinePreview])

  useEffect(() => {
    if (open && previewEnabled) setOutlinePreview({ color, thickness, position, directions: edgeDirections, kernel })
    else setOutlinePreview(null)
  }, [open, previewEnabled, color, thickness, position, edgeDirections, kernel, setOutlinePreview])

  const close = (): void => { setOutlinePreview(null); onClose() }
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
    <ModalShell as="form" storageKey="outline" defaultWidth={560} defaultHeight={470} className="outline-modal" onSubmit={(event) => { event.preventDefault(); submit() }} onKeyDown={(event) => {
      if (event.key !== 'Enter' || event.nativeEvent.isComposing || (event.target as HTMLElement).tagName === 'TEXTAREA') return
      event.stopPropagation()
      if (event.defaultPrevented) return
      event.preventDefault()
      submit()
    }}>
      <DialogHeader eyebrow="OUTLINE" title={t('outline.title')} closeLabel={t('common.close')} onClose={close} />
      <div className="modal-body outline-modal-body">
        <section className="outline-color-section"><span className="outline-section-label">{t('outline.color')}</span><ColorPicker color={color} onChange={setColor} compact label={t('outline.color')} /></section>
        <OutlineStrokeControls thickness={thickness} position={position} kernel={kernel} directions={edgeDirections} onThicknessChange={setThickness} onPositionChange={setPosition} onPatternChange={(nextKernel, nextDirections) => { setKernel(nextKernel); setEdgeDirections(nextDirections) }} />
        <LivePreviewToggle checked={previewEnabled} onChange={setPreviewEnabled} />
      </div>
      <footer><button type="button" className="quiet-button" onClick={close}>{t('common.cancel')}</button><button type="submit" className="primary-button">{t('outline.apply')}</button></footer>
    </ModalShell>
  </div>
}
