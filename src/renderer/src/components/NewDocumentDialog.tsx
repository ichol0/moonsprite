import { useEffect, useState } from 'react'
import type { ColorMode } from '@shared/types'
import { DEFAULT_DOCUMENT_SIZE_PRESETS, type DocumentSizePreset } from '@/core/file-preferences'
import { AVAILABLE_APP_LOCALES, DEFAULT_APP_LOCALE, translate, type AppLocale } from '@/core/localization'
import { useI18n } from './I18nProvider'
import { ModalShell } from './ModalShell'
import { NumberInput } from './NumberInput'
import { PixelUtilityIcon } from './PixelUtilityIcon'

export function getWindowsFileNameError(value: string, locale: AppLocale = DEFAULT_APP_LOCALE): string | null {
  const name = value
  if (!name.trim()) return translate(locale, 'newDocument.error.required')
  if (name.length > 255) return translate(locale, 'newDocument.error.tooLong')
  const invalidCharacter = name.match(/[<>:"/\\|?*\u0000-\u001F]/)
  if (invalidCharacter) return translate(locale, 'newDocument.error.invalidCharacter', { character: invalidCharacter[0] })
  if (/[. ]$/.test(name)) return translate(locale, 'newDocument.error.trailing')
  if (/^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\..*)?$/i.test(name)) return translate(locale, 'newDocument.error.reserved')
  return null
}

export function NewDocumentDialog({ open, presets = DEFAULT_DOCUMENT_SIZE_PRESETS, onClose, onCreate }: { open: boolean; presets?: readonly DocumentSizePreset[]; onClose: () => void; onCreate: (name: string, width: number, height: number, mode: ColorMode) => void }) {
  const { locale, t } = useI18n()
  const [name, setName] = useState(() => t('newDocument.untitled'))
  const [width, setWidth] = useState(64)
  const [height, setHeight] = useState(64)
  const [mode, setMode] = useState<ColorMode>('rgba')
  const [nameError, setNameError] = useState<string | null>(null)

  useEffect(() => {
    setName((current) => AVAILABLE_APP_LOCALES.some((candidate) => current === translate(candidate, 'newDocument.untitled')) ? t('newDocument.untitled') : current)
  }, [locale, t])

  useEffect(() => {
    if (!open || !window.moonSprite) return
    let active = true
    void window.moonSprite.readClipboardImageSize().then((size) => {
      if (!active || !size || size.width < 1 || size.height < 1) return
      setWidth(size.width)
      setHeight(size.height)
    }).catch(() => {
      // Clipboard access is optional; keep the normal document defaults.
    })
    return () => { active = false }
  }, [open])

  if (!open) return null
  const submit = (event: React.FormEvent): void => {
    event.preventDefault()
    const nextName = name || t('newDocument.untitled')
    const error = getWindowsFileNameError(nextName, locale)
    if (error) {
      setNameError(error)
      return
    }
    onCreate(nextName, width, height, mode)
    onClose()
  }
  return <div className="modal-backdrop" role="presentation" onPointerDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
    <ModalShell as="form" storageKey="new-document" defaultWidth={480} defaultHeight={520} minWidth={440} onSubmit={submit} aria-label={t('newDocument.title')}>
      <header><div><span className="eyebrow">{t('newDocument.eyebrow')}</span><h2>{t('newDocument.title')}</h2></div><button type="button" className="icon-button" aria-label={t('common.close')} onClick={onClose}><PixelUtilityIcon kind="close" /></button></header>
      <div className="modal-body"><label>{t('newDocument.name')}<input autoFocus value={name} aria-invalid={Boolean(nameError)} onChange={(event) => { setName(event.target.value); setNameError(getWindowsFileNameError(event.target.value, locale)) }} /></label>{nameError && <p className="field-error" role="alert">{nameError}</p>}
        <div className="form-grid">
          <label>{t('common.width')}<NumberInput aria-label={t('newDocument.widthAria')} min={1} value={width} onValueChange={setWidth} /></label>
          <label>{t('common.height')}<NumberInput aria-label={t('newDocument.heightAria')} min={1} value={height} onValueChange={setHeight} /></label>
        </div>
        <div className="new-document-presets" aria-label={t('newDocument.presetsAria')}>{presets.map((preset) => <button type="button" key={`${preset.width}x${preset.height}`} className={width === preset.width && height === preset.height ? 'selected' : ''} onClick={() => { setWidth(preset.width); setHeight(preset.height) }}>{preset.width}x{preset.height}</button>)}</div>
        <fieldset><legend>{t('newDocument.colorMode')}</legend>
          <label className="mode-option"><input type="radio" checked={mode === 'rgba'} onChange={() => setMode('rgba')} />{t('newDocument.rgba')}</label>
          <label className="mode-option"><input type="radio" checked={mode === 'indexed'} onChange={() => setMode('indexed')} />{t('newDocument.indexed')}</label>
        </fieldset>
        <p className="modal-note">{t('newDocument.note')}</p>
      </div>
      <footer><button type="button" className="quiet-button" onClick={onClose}>{t('common.cancel')}</button><button className="primary-button" type="submit">{t('newDocument.create')}</button></footer>
    </ModalShell>
  </div>
}
