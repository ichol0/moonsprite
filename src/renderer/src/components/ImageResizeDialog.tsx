import { useEffect, useState, type FormEvent } from 'react'
import type { ImageResizeInterpolation } from '@shared/types'
import { ModalShell } from './ModalShell'
import { NumberInput } from './NumberInput'
import { FormField } from './FormField'
import { ThemedSelect } from './ThemedSelect'
import { useI18n } from './I18nProvider'
import { DialogHeader } from './DialogHeader'
import { PixelUtilityIcon } from './PixelUtilityIcon'

export function ImageResizeDialog({ open, currentWidth, currentHeight, onClose, onResize }: {
  open: boolean
  currentWidth: number
  currentHeight: number
  onClose: () => void
  onResize: (width: number, height: number, interpolation: ImageResizeInterpolation) => Promise<void>
}) {
  const { t } = useI18n()
  const [width, setWidth] = useState(currentWidth)
  const [height, setHeight] = useState(currentHeight)
  const [widthPercent, setWidthPercent] = useState(100)
  const [heightPercent, setHeightPercent] = useState(100)
  const [locked, setLocked] = useState(true)
  const [interpolation, setInterpolation] = useState<ImageResizeInterpolation>('nearest')

  useEffect(() => {
    if (!open) return
    setWidth(currentWidth)
    setHeight(currentHeight)
    setWidthPercent(100)
    setHeightPercent(100)
    setLocked(true)
    setInterpolation('nearest')
  }, [open, currentWidth, currentHeight])

  if (!open) return null

  const updateWidth = (next: number): void => {
    const normalized = Math.max(1, Math.min(16384, Math.round(next) || 1))
    const nextHeight = locked ? Math.max(1, Math.round(normalized * currentHeight / currentWidth)) : height
    setWidth(normalized)
    setHeight(nextHeight)
    setWidthPercent(Math.max(1, Math.round(normalized / currentWidth * 100)))
    setHeightPercent(Math.max(1, Math.round(nextHeight / currentHeight * 100)))
  }

  const updateHeight = (next: number): void => {
    const normalized = Math.max(1, Math.min(16384, Math.round(next) || 1))
    const nextWidth = locked ? Math.max(1, Math.round(normalized * currentWidth / currentHeight)) : width
    setWidth(nextWidth)
    setHeight(normalized)
    setWidthPercent(Math.max(1, Math.round(nextWidth / currentWidth * 100)))
    setHeightPercent(Math.max(1, Math.round(normalized / currentHeight * 100)))
  }

  const updateWidthPercent = (next: number): void => updateWidth(Math.max(1, Math.round(currentWidth * Math.max(1, Math.min(6400, next)) / 100)))
  const updateHeightPercent = (next: number): void => updateHeight(Math.max(1, Math.round(currentHeight * Math.max(1, Math.min(6400, next)) / 100)))
  const submit = (event: FormEvent): void => {
    event.preventDefault()
    void onResize(width, height, interpolation).then(onClose)
  }

  return <div className="modal-backdrop" role="presentation">
    <ModalShell as="form" storageKey="image-resize-v3" placement="right" defaultWidth={450} defaultHeight={500} minWidth={400} minHeight={430} maxWidth={600} maxHeight={720} className="image-resize-modal" onSubmit={submit} aria-label={t('imageResize.title')}>
      <DialogHeader eyebrow={t('imageResize.eyebrow')} title={t('imageResize.title')} closeLabel={t('common.close')} onClose={onClose} />
      <div className="modal-body image-resize-body">
        <div className="image-resize-current"><span>{t('imageResize.current')}</span><strong>{currentWidth} x {currentHeight} px</strong></div>
        <section className="image-resize-section">
          <div className="image-resize-section-heading"><h3>{t('imageResize.pixelSize')}</h3><small>{t(locked ? 'imageResize.locked' : 'imageResize.free')}</small></div>
          <div className="image-resize-fields">
            <FormField label={t('common.width')}><NumberInput autoFocus onFocus={(event) => event.currentTarget.select()} aria-label={t('newDocument.widthAria')} min={1} max={16384} suffix="px" value={width} onValueChange={updateWidth} /></FormField>
            <button type="button" className="image-resize-lock" aria-label={t(locked ? 'imageResize.unlockRatio' : 'imageResize.lockRatio')} title={t(locked ? 'imageResize.unlockRatio' : 'imageResize.lockRatio')} onClick={() => setLocked((value) => !value)}>{locked ? <PixelUtilityIcon kind="lock" /> : <PixelUtilityIcon kind="unlock" />}</button>
            <FormField label={t('common.height')}><NumberInput aria-label={t('newDocument.heightAria')} min={1} max={16384} suffix="px" value={height} onValueChange={updateHeight} /></FormField>
          </div>
        </section>
        <section className="image-resize-section">
          <div className="image-resize-section-heading"><h3>{t('imageResize.scale')}</h3><small>{t('imageResize.relative')}</small></div>
          <div className="image-resize-percent-fields">
            <FormField label={t('common.width')}><NumberInput aria-label={t('imageResize.widthPercentAria')} min={1} max={6400} suffix="%" value={widthPercent} onValueChange={updateWidthPercent} /></FormField>
            <FormField label={t('common.height')}><NumberInput aria-label={t('imageResize.heightPercentAria')} min={1} max={6400} suffix="%" value={heightPercent} onValueChange={updateHeightPercent} /></FormField>
          </div>
        </section>
        <FormField className="image-resize-interpolation" label={t('imageResize.interpolation')}><ThemedSelect value={interpolation} groups={[{ label: t('imageResize.interpolation'), options: [{ value: 'nearest', label: t('imageResize.nearest') }, { value: 'smooth', label: t('imageResize.smooth') }] }]} label={t('imageResize.interpolation')} onChange={setInterpolation} /></FormField>
      </div>
      <footer><button type="button" className="quiet-button" onClick={onClose}>{t('common.cancel')}</button><button className="primary-button" type="submit">{t('common.done')}</button></footer>
    </ModalShell>
  </div>
}
