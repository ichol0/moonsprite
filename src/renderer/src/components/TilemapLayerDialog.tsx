import { useState } from 'react'
import { DialogHeader } from './DialogHeader'
import { FormField } from './FormField'
import { ModalShell } from './ModalShell'
import { NumberInput } from './NumberInput'
import { PixelUtilityIcon } from './PixelUtilityIcon'
import { TextInput } from './TextInput'
import { useI18n } from './I18nProvider'
import type { TilemapLayerOptions } from '@/store/workspace'

export function TilemapLayerDialog({ documentWidth, documentHeight, onClose, onCreate }: {
  documentWidth: number
  documentHeight: number
  onClose: () => void
  onCreate: (options: TilemapLayerOptions) => Promise<void>
}) {
  const { t } = useI18n()
  const defaultName = t('workspace.tilemap.layerName')
  const [name, setName] = useState(defaultName)
  const [tileWidth, setTileWidth] = useState(Math.max(1, Math.min(16, documentWidth)))
  const [tileHeight, setTileHeight] = useState(Math.max(1, Math.min(16, documentHeight)))
  const [creating, setCreating] = useState(false)

  const create = async (): Promise<void> => {
    if (creating) return
    setCreating(true)
    try {
      await onCreate({ name: name.trim() || defaultName, tileWidth, tileHeight })
      onClose()
    } finally {
      setCreating(false)
    }
  }

  return <div className="modal-backdrop" role="presentation" onPointerDown={(event) => { if (event.target === event.currentTarget && !creating) onClose() }}>
    <ModalShell as="form" storageKey="new-tilemap-layer-v3" defaultWidth={470} defaultHeight={320} minWidth={420} minHeight={290} maxWidth={720} maxHeight={520} resizable className="layer-modal tilemap-layer-dialog" role="dialog" aria-modal="true" aria-labelledby="tilemap-layer-dialog-title" onSubmit={(event) => { event.preventDefault(); void create() }}>
      <DialogHeader eyebrow="TILEMAP" title={t('layers.newTilemap')} titleId="tilemap-layer-dialog-title" closeLabel={t('common.close')} closeDisabled={creating} onClose={onClose} />
      <div className="modal-body tilemap-layer-dialog-body">
        <p>{t('layers.tilemapDialogDescription')}</p>
        <FormField label={t('layers.name')}><TextInput autoFocus maxLength={96} value={name} onChange={(event) => setName(event.target.value)} /></FormField>
        <div className="tilemap-size-fields">
          <FormField label={t('layers.tileWidth')}><NumberInput min={1} max={256} suffix="px" value={tileWidth} onValueChange={setTileWidth} /></FormField>
          <FormField label={t('layers.tileHeight')}><NumberInput min={1} max={256} suffix="px" value={tileHeight} onValueChange={setTileHeight} /></FormField>
        </div>
      </div>
      <footer><button type="button" className="quiet-button" disabled={creating} onClick={onClose}>{t('common.cancel')}</button><button type="submit" className="primary-button" disabled={creating}><PixelUtilityIcon kind="tilemap" />{t('layers.createTilemap')}</button></footer>
    </ModalShell>
  </div>
}
