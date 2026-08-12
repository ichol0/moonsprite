import { useMemo, useRef, useState } from 'react'
import { FileUp, TriangleAlert } from 'lucide-react'
import {
  DEFAULT_SHORTCUTS,
  SHORTCUT_GROUPS,
  deriveShortcutConflicts,
  shortcutGroupLabels,
  shortcutLabels,
  type ShortcutGroupId,
  type ShortcutId,
  shortcutText
} from '@/core/shortcuts'
import { ModalShell } from '@/components/ModalShell'
import { DialogHeader } from '@/components/DialogHeader'
import { PixelCloseIcon as X } from '@/components/PixelUtilityIcon'
import { SettingsNavigation } from '@/components/SettingsNavigation'
import { TextInput } from '@/components/TextInput'
import { useI18n } from '@/components/I18nProvider'

const defaultShortcuts: Record<string, string> = { ...DEFAULT_SHORTCUTS }

interface ShortcutDialogProps {
  shortcuts: Record<string, string>
  onSave: (next: Record<string, string>) => void
  onClose: () => void
}

interface ImportNotice {
  tone: 'success' | 'error'
  text: string
}

export function ShortcutDialog({ shortcuts, onSave, onClose }: ShortcutDialogProps) {
  const { locale, t } = useI18n()
  const groupLabels = shortcutGroupLabels(locale)
  const labels = shortcutLabels(locale)
  const [draftShortcuts, setDraftShortcuts] = useState<Record<string, string>>(() => ({ ...shortcuts }))
  const [section, setSection] = useState<ShortcutGroupId>('tools')
  const [query, setQuery] = useState('')
  const [importNotice, setImportNotice] = useState<ImportNotice | null>(null)
  const [recording, setRecording] = useState<{ id: string; text: string } | null>(null)
  const importInputRef = useRef<HTMLInputElement>(null)
  const conflictState = useMemo(() => deriveShortcutConflicts(draftShortcuts), [draftShortcuts])
  const normalizedQuery = query.trim().toLocaleLowerCase(locale)
  const visibleCommands = useMemo(() => {
    const groupIds = normalizedQuery ? Object.keys(SHORTCUT_GROUPS) as ShortcutGroupId[] : [section]
    return groupIds.flatMap((groupId) => SHORTCUT_GROUPS[groupId].filter((id) => {
      if (!normalizedQuery) return true
      const shortcut = recording?.id === id ? recording.text : draftShortcuts[id] ?? defaultShortcuts[id]
      return [labels[id], shortcut, groupLabels[groupId], id].some((value) => value.toLocaleLowerCase(locale).includes(normalizedQuery))
    }))
  }, [draftShortcuts, groupLabels, labels, locale, normalizedQuery, recording, section])
  const assign = (id: string, value: string): void => {
    const normalized = value.trim()
    setImportNotice(null)
    setDraftShortcuts((current) => ({ ...current, [id]: normalized }))
  }
  const finishRecording = (id: string): void => {
    if (recording?.id !== id) return
    assign(id, recording.text)
    setRecording(null)
  }
  const importShortcuts = async (file: File | undefined): Promise<void> => {
    if (!file) return
    try {
      const parsed = JSON.parse(await file.text()) as Record<string, unknown>
      const imported = Object.fromEntries(Object.entries(parsed).filter(([key, value]) => key in defaultShortcuts && typeof value === 'string')) as Record<string, string>
      setDraftShortcuts({ ...defaultShortcuts, ...imported })
      setImportNotice({ tone: 'success', text: t('shortcuts.importSuccess') })
    } catch {
      setImportNotice({ tone: 'error', text: t('shortcuts.importError') })
    }
  }
  const exportShortcuts = async (): Promise<void> => {
    try {
      const result = await window.moonSprite.saveShortcutFile('moonsprite-shortcuts.json')
      if (result.canceled || !result.filePath) return
      const bytes = new TextEncoder().encode(JSON.stringify(draftShortcuts, null, 2))
      await window.moonSprite.writeBinaryAtomic(result.filePath, bytes)
      setImportNotice(null)
    } catch {
      setImportNotice({ tone: 'error', text: t('shortcuts.exportError') })
    }
  }
  const conflictSummary = conflictState.conflicts.map((item) => t('shortcuts.conflictItem', { shortcut: item.shortcut, winner: labels[item.winner], blocked: item.conflicting.map((id) => labels[id]).join(t('shortcuts.labelSeparator')) })).join(t('shortcuts.conflictSeparator'))
  const renderShortcut = (id: ShortcutId) => { const winner = conflictState.blocked[id]; return <label key={id} className={winner ? 'shortcut-blocked' : ''}><span>{labels[id]}</span>{winner && <span className="shortcut-warning" title={t('shortcuts.conflictHint', { winner: labels[winner] })}><TriangleAlert size={15} /></span>}<input data-shortcut-recorder="true" value={recording?.id === id ? recording.text : draftShortcuts[id] ?? defaultShortcuts[id]} placeholder={t('shortcuts.unset')} readOnly onKeyDown={(event) => {
    event.preventDefault()
    event.stopPropagation()
    if (event.key === 'Backspace' || event.key === 'Delete') { assign(id, ''); setRecording(null); return }
    if (event.key === 'Escape') { setRecording(null); return }
    const text = shortcutText(event.nativeEvent)
    if (['Control', 'Meta', 'Alt', 'Shift'].includes(event.key)) setRecording({ id, text })
    else { assign(id, text); setRecording(null) }
  }} onKeyUp={(event) => {
    if (recording?.id !== id || !['Control', 'Meta', 'Alt', 'Shift'].includes(event.key)) return
    if (!event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey) finishRecording(id)
  }} onBlur={() => finishRecording(id)} /><button type="button" className="shortcut-clear" title={t('shortcuts.clear')} aria-label={t('shortcuts.clearAria', { label: labels[id] })} onClick={() => { assign(id, ''); setRecording(null) }}><X size={13} /></button></label> }
  return <div className="modal-backdrop" role="presentation"><ModalShell storageKey="shortcuts" defaultWidth={800} defaultHeight={620} className="settings-modal shortcut-settings-modal" role="dialog" aria-label={t('shortcuts.title')}><DialogHeader eyebrow={t('shortcuts.eyebrow')} title={t('shortcuts.title')} closeLabel={t('common.close')} onClose={onClose} /><div className="settings-layout"><aside className="shortcut-settings-sidebar"><div className="shortcut-sidebar-search"><TextInput className="shortcut-search" placeholder={t('shortcuts.search')} aria-label={t('shortcuts.searchGlobal')} value={query} onChange={(event) => setQuery(event.target.value)} /></div><SettingsNavigation label={t('shortcuts.title')} value={section} items={(Object.keys(SHORTCUT_GROUPS) as ShortcutGroupId[]).map((value) => ({ value, label: groupLabels[value] }))} onChange={setSection} /></aside><main>{importNotice && <p className={`shortcut-import-notice ${importNotice.tone}`} role={importNotice.tone === 'success' ? 'status' : 'alert'}>{importNotice.text}</p>}{conflictSummary && <p className="shortcut-conflict">{conflictSummary}</p>}{visibleCommands.length === 0 ? <p className="shortcut-empty">{t('shortcuts.noResults')}</p> : <div className="shortcut-list">{visibleCommands.map(renderShortcut)}</div>}</main></div><footer><input ref={importInputRef} hidden type="file" accept="application/json,.json" onChange={(event) => { void importShortcuts(event.target.files?.[0]); event.currentTarget.value = '' }} /><button className="quiet-button" onClick={() => importInputRef.current?.click()}><FileUp size={14} />{t('shortcuts.import')}</button><button className="quiet-button" onClick={() => { void exportShortcuts() }}>{t('shortcuts.export')}</button><button className="quiet-button" onClick={() => { setImportNotice(null); setDraftShortcuts({ ...defaultShortcuts }) }}>{t('common.reset')}</button><button className="primary-button" onClick={() => { onSave(draftShortcuts); onClose() }}>{t('common.done')}</button></footer></ModalShell></div>
}
