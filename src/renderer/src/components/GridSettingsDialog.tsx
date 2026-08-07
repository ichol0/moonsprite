import { useState } from 'react'
import { X } from 'lucide-react'
import type { GridSettings } from '@shared/types'
import { normalizeGridSettings } from '@/core/grid'
import { useI18n } from '@/components/I18nProvider'
import { ModalShell } from '@/components/ModalShell'
import { NumberInput } from '@/components/NumberInput'

interface GridSettingsDialogProps {
  value?: GridSettings
  onApply: (value: GridSettings) => void
  onClose: () => void
}

export function GridSettingsDialog({ value, onApply, onClose }: GridSettingsDialogProps) {
  const { t } = useI18n()
  const [draft, setDraft] = useState<GridSettings>(() => normalizeGridSettings(value))
  const update = (key: keyof GridSettings, value: number): void => {
    setDraft((current) => normalizeGridSettings({ ...current, [key]: value }))
  }

  return <div className="modal-backdrop" role="presentation" onPointerDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
    <ModalShell as="form" storageKey="grid-settings" defaultWidth={360} defaultHeight={220} fitContentKey="grid-settings-fields" minWidth={320} minHeight={210} maxWidth={480} maxHeight={360} className="grid-settings-modal" onSubmit={(event) => { event.preventDefault(); onApply(normalizeGridSettings(draft)); onClose() }} aria-labelledby="grid-settings-title">
      <header><div><h2 id="grid-settings-title">{t('gridSettings.title')}</h2></div><button type="button" className="icon-button" aria-label={t('common.close')} onClick={onClose}><X size={16} /></button></header>
      <div className="modal-body grid-settings-body">
        <label className="component-number-input-row"><span>{t('gridSettings.x')}</span><NumberInput live autoFocus value={draft.x} step={1} suffix="px" onFocus={(event) => event.currentTarget.select()} onValueChange={(next) => update('x', next)} /></label>
        <label className="component-number-input-row"><span>{t('gridSettings.y')}</span><NumberInput live value={draft.y} step={1} suffix="px" onValueChange={(next) => update('y', next)} /></label>
        <label className="component-number-input-row"><span>{t('gridSettings.width')}</span><NumberInput live value={draft.width} min={1} step={1} suffix="px" onValueChange={(next) => update('width', next)} /></label>
        <label className="component-number-input-row"><span>{t('gridSettings.height')}</span><NumberInput live value={draft.height} min={1} step={1} suffix="px" onValueChange={(next) => update('height', next)} /></label>
      </div>
      <footer><button type="button" className="quiet-button" onClick={onClose}>{t('common.cancel')}</button><button type="submit" className="primary-button">{t('common.done')}</button></footer>
    </ModalShell>
  </div>
}
