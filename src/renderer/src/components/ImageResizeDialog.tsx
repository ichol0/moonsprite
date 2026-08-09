import { useEffect, useState, type FormEvent } from 'react'
import type { ImageResizeInterpolation } from '@shared/types'
import { ModalShell } from './ModalShell'
import { NumberInput } from './NumberInput'
import { useI18n } from './I18nProvider'
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
      <header>
        <div><span className="eyebrow">{t('imageResize.eyebrow')}</span><h2>{t('imageResize.title')}</h2></div>
        <button type="button" className="icon-button" aria-label={t('common.close')} onClick={onClose}><PixelUtilityIcon kind="close" /></button>
      </header>
      <div className="modal-body image-resize-body">
        <div className="image-resize-current"><span>{t('imageResize.current')}</span><strong>{currentWidth} x {currentHeight} px</strong></div>
        <section className="image-resize-section">
          <div className="image-resize-section-heading"><h3>{t('imageResize.pixelSize')}</h3><small>{t(locked ? 'imageResize.locked' : 'imageResize.free')}</small></div>
          <div className="image-resize-fields">
            <label><span>{t('common.width')}</span><div className="image-resize-input"><NumberInput autoFocus onFocus={(event) => event.currentTarget.select()} aria-label={t('newDocument.widthAria')} min={1} max={16384} value={width} onValueChange={updateWidth} /><small>px</small></div></label>
            <button type="button" className="image-resize-lock" aria-label={t(locked ? 'imageResize.unlockRatio' : 'imageResize.lockRatio')} title={t(locked ? 'imageResize.unlockRatio' : 'imageResize.lockRatio')} onClick={() => setLocked((value) => !value)}>{locked ? <PixelUtilityIcon kind="lock" /> : <PixelUtilityIcon kind="unlock" />}</button>
            <label><span>{t('common.height')}</span><div className="image-resize-input"><NumberInput aria-label={t('newDocument.heightAria')} min={1} max={16384} value={height} onValueChange={updateHeight} /><small>px</small></div></label>
          </div>
        </section>
        <section className="image-resize-section">
          <div className="image-resize-section-heading"><h3>{t('imageResize.scale')}</h3><small>{t('imageResize.relative')}</small></div>
          <div className="image-resize-percent-fields">
            <label><span>{t('common.width')}</span><div className="image-resize-input"><NumberInput aria-label={t('imageResize.widthPercentAria')} min={1} max={6400} value={widthPercent} onValueChange={updateWidthPercent} /><small>%</small></div></label>
            <label><span>{t('common.height')}</span><div className="image-resize-input"><NumberInput aria-label={t('imageResize.heightPercentAria')} min={1} max={6400} value={heightPercent} onValueChange={updateHeightPercent} /><small>%</small></div></label>
          </div>
        </section>
        <label className="image-resize-interpolation"><span>{t('imageResize.interpolation')}</span><select value={interpolation} onChange={(event) => setInterpolation(event.target.value as ImageResizeInterpolation)}><option value="nearest">{t('imageResize.nearest')}</option><option value="smooth">{t('imageResize.smooth')}</option></select></label>
      </div>
      <footer><button type="button" className="quiet-button" onClick={onClose}>{t('common.cancel')}</button><button className="primary-button" type="submit">{t('common.done')}</button></footer>
    </ModalShell>
  </div>
}
