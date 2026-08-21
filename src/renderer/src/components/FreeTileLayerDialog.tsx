import { useState } from 'react'
import { DialogHeader } from './DialogHeader'
import { FormField } from './FormField'
import { ModalShell } from './ModalShell'
import { PixelUtilityIcon } from './PixelUtilityIcon'
import { TextInput } from './TextInput'
import { useI18n } from './I18nProvider'
import type { FreeTileLayerOptions } from '@/store/workspace'

export function FreeTileLayerDialog({ onClose, onConfirm }: {
  onClose: () => void
  onConfirm: (options: FreeTileLayerOptions) => Promise<void>
}) {
  const { t } = useI18n()
  const defaultName = t('workspace.freeTile.layerName')
  const [name, setName] = useState(defaultName)
  const [submitting, setSubmitting] = useState(false)

  const confirm = async (): Promise<void> => {
    if (submitting) return
    setSubmitting(true)
    try {
      await onConfirm({ name: name.trim() || defaultName })
      onClose()
    } finally {
      setSubmitting(false)
    }
  }

  return <div className="modal-backdrop" role="presentation" onPointerDown={(event) => { if (event.target === event.currentTarget && !submitting) onClose() }}>
    <ModalShell as="form" storageKey="new-free-tile-layer-v2" defaultWidth={440} defaultHeight={250} minWidth={380} minHeight={230} maxWidth={640} maxHeight={420} resizable className="layer-modal tilemap-layer-dialog" role="dialog" aria-modal="true" aria-labelledby="free-tile-layer-dialog-title" onSubmit={(event) => { event.preventDefault(); void confirm() }}>
      <DialogHeader eyebrow="FREE TILE" title={t('layers.newFreeTile')} titleId="free-tile-layer-dialog-title" closeLabel={t('common.close')} closeDisabled={submitting} onClose={onClose} />
      <div className="modal-body tilemap-layer-dialog-body">
        <FormField label={t('layers.name')}><TextInput autoFocus maxLength={96} value={name} onChange={(event) => setName(event.target.value)} /></FormField>
      </div>
      <footer><button type="button" className="quiet-button" disabled={submitting} onClick={onClose}>{t('common.cancel')}</button><button type="submit" className="primary-button" disabled={submitting}><PixelUtilityIcon kind="freeTile" />{t('layers.createFreeTile')}</button></footer>
    </ModalShell>
  </div>
}
