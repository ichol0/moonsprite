import { useState } from 'react'
import { Save, X } from 'lucide-react'
import { ThemedSelect } from '@/components/ThemedSelect'
import type { SaveAsOptions } from '@/store/workspace'

const saveAsFormatOptions: Array<{ value: SaveAsOptions['format']; label: string }> = [
  { value: 'moonsprite', label: 'MoonSprite 工程（.moonsprite）' },
  { value: 'png-auto', label: 'PNG 自动索引（.png）' },
  { value: 'png-rgba', label: 'PNG RGBA（.png）' },
  { value: 'jpeg', label: 'JPEG（.jpg / .jpeg）' },
  { value: 'webp', label: 'WebP（.webp）' },
  { value: 'ase', label: 'Aseprite（.ase）' },
  { value: 'aseprite', label: 'Aseprite（.aseprite）' }
]

interface SaveAsDialogProps {
  initialName: string
  onSave: (options: SaveAsOptions) => Promise<boolean>
  onClose: () => void
}

export function SaveAsDialog({ initialName, onSave, onClose }: SaveAsDialogProps) {
  const [form, setForm] = useState<SaveAsOptions>({ name: initialName, format: 'moonsprite', scalePercent: 100 })
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
  return <div className="modal-backdrop" role="presentation" onPointerDown={(event) => { if (event.target === event.currentTarget && !saving) onClose() }}><form className="modal save-as-modal" onSubmit={(event) => { event.preventDefault(); void submit() }}><header><div><span className="eyebrow">SAVE AS</span><h2>另存为</h2></div><button type="button" className="icon-button" aria-label="关闭" disabled={saving} onClick={onClose}><X size={16} /></button></header><div className="modal-body"><label>文件名称<input autoFocus value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label><label>格式<ThemedSelect value={form.format} groups={[{ label: '保存格式', options: saveAsFormatOptions }]} label="保存格式" onChange={(format) => setForm({ ...form, format })} /></label></div><footer><button type="button" className="quiet-button" disabled={saving} onClick={onClose}>取消</button><button type="submit" className="primary-button" disabled={saving || !form.name.trim()}><Save size={15} />保存</button></footer></form></div>
}
