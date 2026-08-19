import { useState } from 'react'
import { DialogHeader } from './DialogHeader'
import { FormField } from './FormField'
import { ModalShell } from './ModalShell'
import { NumberInput } from './NumberInput'
import { PixelUtilityIcon } from './PixelUtilityIcon'
import { TextInput } from './TextInput'
import { useI18n } from './I18nProvider'
import type { TilemapLayerOptions } from '@/store/workspace'

export function TilemapLayerDialog({ documentWidth, documentHeight, mode = 'create', initialName, onClose, onConfirm }: {
  documentWidth: number
  documentHeight: number
  mode?: 'create' | 'convert'
  initialName?: string
  onClose: () => void
  onConfirm: (options: TilemapLayerOptions) => Promise<void>
}) {
  const { t } = useI18n()
  const defaultName = initialName?.trim() || t('workspace.tilemap.layerName')
  const [name, setName] = useState(defaultName)
  const [tileWidth, setTileWidth] = useState(Math.max(1, Math.min(16, documentWidth)))
  const [tileHeight, setTileHeight] = useState(Math.max(1, Math.min(16, documentHeight)))
  const [submitting, setSubmitting] = useState(false)
  const converting = mode === 'convert'

  const confirm = async (): Promise<void> => {
    if (submitting) return
    setSubmitting(true)
    try {
      await onConfirm({ name: name.trim() || defaultName, tileWidth, tileHeight })
      onClose()
    } finally {
      setSubmitting(false)
    }
  }

  return <div className="modal-backdrop" role="presentation" onPointerDown={(event) => { if (event.target === event.currentTarget && !submitting) onClose() }}>
    <ModalShell as="form" storageKey="new-tilemap-layer-v3" defaultWidth={470} defaultHeight={320} minWidth={420} minHeight={290} maxWidth={720} maxHeight={520} resizable className="layer-modal tilemap-layer-dialog" role="dialog" aria-modal="true" aria-labelledby="tilemap-layer-dialog-title" onSubmit={(event) => { event.preventDefault(); void confirm() }}>
      <DialogHeader eyebrow="TILEMAP" title={t(converting ? 'layers.convertToTilemap' : 'layers.newTilemap')} titleId="tilemap-layer-dialog-title" closeLabel={t('common.close')} closeDisabled={submitting} onClose={onClose} />
      <div className="modal-body tilemap-layer-dialog-body">
        <p>{t(converting ? 'layers.convertTilemapDialogDescription' : 'layers.tilemapDialogDescription')}</p>
        <FormField label={t('layers.name')}><TextInput autoFocus maxLength={96} value={name} onChange={(event) => setName(event.target.value)} /></FormField>
        <div className="tilemap-size-fields">
          <FormField label={t('layers.tileWidth')}><NumberInput min={1} max={256} suffix="px" value={tileWidth} onValueChange={setTileWidth} /></FormField>
          <FormField label={t('layers.tileHeight')}><NumberInput min={1} max={256} suffix="px" value={tileHeight} onValueChange={setTileHeight} /></FormField>
        </div>
      </div>
      <footer><button type="button" className="quiet-button" disabled={submitting} onClick={onClose}>{t('common.cancel')}</button><button type="submit" className="primary-button" disabled={submitting}><PixelUtilityIcon kind="tilemap" />{t(converting ? 'layers.convertTilemap' : 'layers.createTilemap')}</button></footer>
    </ModalShell>
  </div>
}
