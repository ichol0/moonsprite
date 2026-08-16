import { useState } from 'react'
import { ThemedSelect } from '@/components/ThemedSelect'
import { DialogHeader } from '@/components/DialogHeader'
import { ModalShell } from '@/components/ModalShell'
import { FormField } from '@/components/FormField'
import { TextInput } from '@/components/TextInput'
import type { SaveAsOptions } from '@/store/workspace'
import { useI18n } from '@/components/I18nProvider'
import { PixelUtilityIcon } from '@/components/PixelUtilityIcon'

interface SaveAsDialogProps {
  initialName: string
  initialFormat: SaveAsOptions['format']
  onSave: (options: SaveAsOptions) => Promise<boolean>
  onClose: () => void
}

export function SaveAsDialog({ initialName, initialFormat, onSave, onClose }: SaveAsDialogProps) {
  const { t } = useI18n()
  const saveAsFormatOptions: Array<{ value: SaveAsOptions['format']; label: string }> = [
    { value: 'moonsprite', label: t('saveAs.format.moonsprite') },
    { value: 'png-auto', label: t('saveAs.format.pngAuto') },
    { value: 'png-rgba', label: t('saveAs.format.pngRgba') },
    { value: 'jpeg', label: t('saveAs.format.jpeg') },
    { value: 'webp', label: t('saveAs.format.webp') },
    { value: 'ase', label: t('saveAs.format.ase') },
    { value: 'aseprite', label: t('saveAs.format.aseprite') }
  ]
  const [form, setForm] = useState<SaveAsOptions>({ name: initialName, format: initialFormat, scalePercent: 100 })
  const [saving, setSaving] = useState(false)
  const submit = async (): Promise<void> => {
    if (!form.name.trim() || saving) return
    setSaving(true)
    try {
      if (await onSave(form)) onClose()
    } finally {
      setSaving(false)
    }
  }
  const flattened = form.format === 'png-auto' || form.format === 'png-rgba' || form.format === 'jpeg' || form.format === 'webp'
  return <div className="modal-backdrop" role="presentation" onPointerDown={(event) => { if (event.target === event.currentTarget && !saving) onClose() }}><ModalShell as="form" storageKey="save-as" defaultWidth={400} defaultHeight={300} className="save-as-modal" onSubmit={(event) => { event.preventDefault(); void submit() }}><DialogHeader eyebrow={t('saveAs.eyebrow')} title={t('saveAs.title')} closeLabel={t('common.close')} closeDisabled={saving} onClose={onClose} /><div className="modal-body"><FormField label={t('saveAs.fileName')}><TextInput autoFocus value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></FormField><FormField label={t('saveAs.format')}><ThemedSelect value={form.format} groups={[{ label: t('saveAs.formatGroup'), options: saveAsFormatOptions }]} label={t('saveAs.formatGroup')} onChange={(format) => setForm({ ...form, format })} /></FormField>{flattened && <p className="modal-note save-as-format-warning">{t('saveAs.flattenedWarning')}</p>}</div><footer><button type="button" className="quiet-button" disabled={saving} onClick={onClose}>{t('common.cancel')}</button><button type="submit" className="primary-button" disabled={saving || !form.name.trim()}><PixelUtilityIcon kind="save" />{t('common.save')}</button></footer></ModalShell></div>
}
