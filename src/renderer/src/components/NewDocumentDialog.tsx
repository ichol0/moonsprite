import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import type { ColorMode } from '@shared/types'
import { DEFAULT_DOCUMENT_SIZE_PRESETS, type DocumentSizePreset } from '@/core/file-preferences'
import { NumberInput } from './NumberInput'

export function getWindowsFileNameError(value: string): string | null {
  const name = value
  if (!name.trim()) return '请输入工程名称。'
  if (name.length > 255) return '工程名称不能超过 255 个字符。'
  const invalidCharacter = name.match(/[<>:"/\\|?*\u0000-\u001F]/)
  if (invalidCharacter) return `工程名称不能包含 Windows 不允许的字符“${invalidCharacter[0]}”。`
  if (/[. ]$/.test(name)) return '工程名称不能以空格或句点结尾。'
  if (/^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\..*)?$/i.test(name)) return '该名称是 Windows 保留设备名，不能作为工程文件名。'
  return null
}

export function NewDocumentDialog({ open, presets = DEFAULT_DOCUMENT_SIZE_PRESETS, onClose, onCreate }: { open: boolean; presets?: readonly DocumentSizePreset[]; onClose: () => void; onCreate: (name: string, width: number, height: number, mode: ColorMode) => void }) {
  const [name, setName] = useState('未命名作品')
  const [width, setWidth] = useState(64)
  const [height, setHeight] = useState(64)
  const [mode, setMode] = useState<ColorMode>('rgba')
  const [nameError, setNameError] = useState<string | null>(null)

  useEffect(() => {
    if (!open || !window.moonSprite) return
    let active = true
    void window.moonSprite.readClipboardImage().then((image) => {
      if (!active || !image || image.width < 1 || image.height < 1) return
      setWidth(image.width)
      setHeight(image.height)
    }).catch(() => {
      // Clipboard access is optional; keep the normal document defaults.
    })
    return () => { active = false }
  }, [open])

  if (!open) return null
  const submit = (event: React.FormEvent): void => {
    event.preventDefault()
    const nextName = name || '未命名作品'
    const error = getWindowsFileNameError(nextName)
    if (error) {
      setNameError(error)
      return
    }
    onCreate(nextName, width, height, mode)
    onClose()
  }
  return <div className="modal-backdrop" role="presentation" onPointerDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
    <form className="modal" onSubmit={submit} aria-label="新建画布">
      <header><div><span className="eyebrow">NEW DOCUMENT</span><h2>新建画布</h2></div><button type="button" className="icon-button" aria-label="关闭" onClick={onClose}><X size={16} /></button></header>
      <div className="modal-body"><label>名称<input autoFocus value={name} aria-invalid={Boolean(nameError)} onChange={(event) => { setName(event.target.value); setNameError(getWindowsFileNameError(event.target.value)) }} /></label>{nameError && <p className="field-error" role="alert">{nameError}</p>}
        <div className="form-grid">
          <label>宽度<NumberInput aria-label="画布宽度" min={1} value={width} onValueChange={setWidth} /></label>
          <label>高度<NumberInput aria-label="画布高度" min={1} value={height} onValueChange={setHeight} /></label>
        </div>
        <div className="new-document-presets" aria-label="常用画布尺寸">{presets.map((preset) => <button type="button" key={`${preset.width}x${preset.height}`} className={width === preset.width && height === preset.height ? 'selected' : ''} onClick={() => { setWidth(preset.width); setHeight(preset.height) }}>{preset.width}x{preset.height}</button>)}</div>
        <fieldset><legend>颜色模式</legend>
          <label className="mode-option"><input type="radio" checked={mode === 'rgba'} onChange={() => setMode('rgba')} />RGBA 真彩色</label>
          <label className="mode-option"><input type="radio" checked={mode === 'indexed'} onChange={() => setMode('indexed')} />索引调色板</label>
        </fieldset>
        <p className="modal-note">画布尺寸没有预设上限。创建前会根据当前设备资源进行安全检查。</p>
      </div>
      <footer><button type="button" className="quiet-button" onClick={onClose}>取消</button><button className="primary-button" type="submit">创建画布</button></footer>
    </form>
  </div>
}
