import { useMemo, useRef, useState } from 'react'
import { FileUp, TriangleAlert, X } from 'lucide-react'
import {
  DEFAULT_SHORTCUTS,
  SHORTCUT_GROUP_LABELS,
  SHORTCUT_GROUPS,
  SHORTCUT_LABELS,
  deriveShortcutConflicts,
  shortcutText
} from '@/core/shortcuts'

const defaultShortcuts: Record<string, string> = { ...DEFAULT_SHORTCUTS }

interface ShortcutDialogProps {
  shortcuts: Record<string, string>
  onSave: (next: Record<string, string>) => void
  onClose: () => void
}

export function ShortcutDialog({ shortcuts, onSave, onClose }: ShortcutDialogProps) {
  const [section, setSection] = useState<keyof typeof SHORTCUT_GROUPS>('tools')
  const [query, setQuery] = useState('')
  const [importError, setImportError] = useState<string | null>(null)
  const importInputRef = useRef<HTMLInputElement>(null)
  const conflictState = useMemo(() => deriveShortcutConflicts(shortcuts), [shortcuts])
  const active = SHORTCUT_GROUPS[section].filter((id) => SHORTCUT_LABELS[id].toLowerCase().includes(query.toLowerCase()) || (shortcuts[id] ?? defaultShortcuts[id]).toLowerCase().includes(query.toLowerCase()))
  const assign = (id: string, value: string): void => {
    const normalized = value.trim()
    setImportError(null)
    onSave({ ...shortcuts, [id]: normalized })
  }
  const importShortcuts = async (file: File | undefined): Promise<void> => {
    if (!file) return
    try {
      const parsed = JSON.parse(await file.text()) as Record<string, unknown>
      const imported = Object.fromEntries(Object.entries(parsed).filter(([key, value]) => key in defaultShortcuts && typeof value === 'string')) as Record<string, string>
      onSave({ ...defaultShortcuts, ...imported })
      setImportError(null)
    } catch {
      setImportError('快捷键文件无法读取，请选择 MoonSprite 导出的 JSON 文件。')
    }
  }
  const conflictSummary = conflictState.conflicts.map((item) => `“${item.shortcut}”：${SHORTCUT_LABELS[item.winner]} 优先，${item.conflicting.map((id) => SHORTCUT_LABELS[id]).join('、')}无法触发`).join('；')
  return <div className="modal-backdrop" role="presentation"><section className="modal settings-modal" role="dialog" aria-label="快捷键设置"><header><div><span className="eyebrow">SHORTCUTS</span><h2>快捷键设置</h2></div><button className="icon-button" aria-label="关闭" onClick={onClose}><X size={16} /></button></header><div className="settings-layout"><nav>{Object.keys(SHORTCUT_GROUPS).map((id) => <button key={id} className={section === id ? 'selected' : ''} onClick={() => setSection(id as keyof typeof SHORTCUT_GROUPS)}>{SHORTCUT_GROUP_LABELS[id as keyof typeof SHORTCUT_GROUPS]}</button>)}</nav><main><input className="shortcut-search" placeholder="搜索快捷键" value={query} onChange={(event) => setQuery(event.target.value)} />{importError && <p className="shortcut-conflict">{importError}</p>}{conflictSummary && <p className="shortcut-conflict">{conflictSummary}</p>}<div className="shortcut-list">{active.map((id) => { const winner = conflictState.blocked[id]; return <label key={id} className={winner ? 'shortcut-blocked' : ''}><span>{SHORTCUT_LABELS[id]}</span>{winner && <span className="shortcut-warning" title={`与“${SHORTCUT_LABELS[winner]}”冲突，当前无法触发`}><TriangleAlert size={15} /></span>}<input value={shortcuts[id] ?? defaultShortcuts[id]} placeholder="未设置" readOnly onKeyDown={(event) => { event.preventDefault(); if (event.key === 'Backspace' || event.key === 'Delete') assign(id, ''); else if (event.key !== 'Escape') assign(id, shortcutText(event.nativeEvent)) }} /><button type="button" className="shortcut-clear" title="清除快捷键" aria-label={`清除 ${SHORTCUT_LABELS[id]} 快捷键`} onClick={() => assign(id, '')}><X size={13} /></button></label> })}</div></main></div><footer><input ref={importInputRef} hidden type="file" accept="application/json,.json" onChange={(event) => { void importShortcuts(event.target.files?.[0]); event.currentTarget.value = '' }} /><button className="quiet-button" onClick={() => importInputRef.current?.click()}><FileUp size={14} />导入</button><button className="quiet-button" onClick={() => { const blob = new Blob([JSON.stringify(shortcuts, null, 2)], { type: 'application/json' }); const anchor = document.createElement('a'); anchor.href = URL.createObjectURL(blob); anchor.download = 'moonsprite-shortcuts.json'; anchor.click(); URL.revokeObjectURL(anchor.href) }}>导出</button><button className="quiet-button" onClick={() => onSave({ ...defaultShortcuts })}>重置</button><button className="primary-button" onClick={onClose}>完成</button></footer></section></div>
}
