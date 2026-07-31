import { useEffect, useRef, useState } from 'react'
import { ArrowDown, ArrowDownLeft, ArrowDownRight, ArrowLeft, ArrowRight, ArrowUp, ArrowUpLeft, ArrowUpRight, CircleDot, Info, X } from 'lucide-react'
import type { CanvasAnchor } from '@shared/types'
import type { CanvasResizePreview } from '@/store/workspace'
import { NumberInput } from './NumberInput'

const anchors: Array<{ id: CanvasAnchor; label: string; icon: typeof ArrowUp }> = [
  { id: 'nw', label: '左上', icon: ArrowUpLeft }, { id: 'n', label: '上', icon: ArrowUp }, { id: 'ne', label: '右上', icon: ArrowUpRight },
  { id: 'w', label: '左', icon: ArrowLeft }, { id: 'center', label: '居中', icon: CircleDot }, { id: 'e', label: '右', icon: ArrowRight },
  { id: 'sw', label: '左下', icon: ArrowDownLeft }, { id: 's', label: '下', icon: ArrowDown }, { id: 'se', label: '右下', icon: ArrowDownRight }
]

type Edge = 'left' | 'right' | 'top' | 'bottom'

export function CanvasResizeDialog({ open, currentWidth, currentHeight, onClose, onResize, onPreview, preview }: { open: boolean; currentWidth: number; currentHeight: number; onClose: () => void; onResize: (width: number, height: number, anchor: CanvasAnchor, offsetX?: number, offsetY?: number, trimOutside?: boolean) => Promise<void>; onPreview: (preview: CanvasResizePreview | null) => void; preview: CanvasResizePreview | null }) {
  const [anchor, setAnchor] = useState<CanvasAnchor>('center')
  const [trimOutside, setTrimOutside] = useState(true)
  const [value, setValue] = useState<CanvasResizePreview>({ width: currentWidth, height: currentHeight, offsetX: 0, offsetY: 0 })
  const onPreviewRef = useRef(onPreview)
  const pendingPreviewRef = useRef<CanvasResizePreview | null>(null)
  const previewFrameRef = useRef<number | null>(null)
  onPreviewRef.current = onPreview

  const flushPreview = (): void => {
    if (previewFrameRef.current !== null) {
      window.cancelAnimationFrame(previewFrameRef.current)
      previewFrameRef.current = null
    }
    const pending = pendingPreviewRef.current
    pendingPreviewRef.current = null
    if (pending) onPreviewRef.current(pending)
  }

  const updateValue = (next: CanvasResizePreview): void => {
    setValue(next)
    pendingPreviewRef.current = next
    if (previewFrameRef.current !== null) return
    previewFrameRef.current = window.requestAnimationFrame(() => {
      previewFrameRef.current = null
      const pending = pendingPreviewRef.current
      pendingPreviewRef.current = null
      if (pending) onPreviewRef.current(pending)
    })
  }

  useEffect(() => {
    if (open) {
      setAnchor('center')
      setTrimOutside(true)
      const initial = { width: currentWidth, height: currentHeight, offsetX: 0, offsetY: 0 }
      setValue(initial)
      onPreviewRef.current(initial)
    } else {
      if (previewFrameRef.current !== null) window.cancelAnimationFrame(previewFrameRef.current)
      previewFrameRef.current = null
      pendingPreviewRef.current = null
      onPreviewRef.current(null)
    }
    return () => { if (previewFrameRef.current !== null) window.cancelAnimationFrame(previewFrameRef.current) }
  }, [open, currentWidth, currentHeight])

  useEffect(() => {
    if (!open || !preview) return
    setValue((current) => current.width === preview.width && current.height === preview.height && current.offsetX === preview.offsetX && current.offsetY === preview.offsetY ? current : { ...preview })
  }, [open, preview?.width, preview?.height, preview?.offsetX, preview?.offsetY])

  if (!open) return null

  const applyAnchor = (width: number, height: number, nextAnchor: CanvasAnchor): void => {
    const deltaX = width - currentWidth; const deltaY = height - currentHeight
    const offsetX = nextAnchor === 'nw' || nextAnchor === 'w' || nextAnchor === 'sw' ? 0 : nextAnchor === 'ne' || nextAnchor === 'e' || nextAnchor === 'se' ? deltaX : Math.floor(deltaX / 2)
    const offsetY = nextAnchor === 'nw' || nextAnchor === 'n' || nextAnchor === 'ne' ? 0 : nextAnchor === 'sw' || nextAnchor === 's' || nextAnchor === 'se' ? deltaY : Math.floor(deltaY / 2)
    updateValue({ width, height, offsetX, offsetY })
  }
  const setDimension = (dimension: 'width' | 'height', raw: number): void => {
    const next = Math.max(1, Math.floor(raw) || 1)
    applyAnchor(dimension === 'width' ? next : value.width, dimension === 'height' ? next : value.height, anchor)
  }
  const setEdge = (edge: Edge, raw: number): void => {
    const next = Math.trunc(raw) || 0
    const left = value.offsetX; const top = value.offsetY
    const right = value.width - currentWidth - left; const bottom = value.height - currentHeight - top
    if (edge === 'left') updateValue({ width: Math.max(1, currentWidth + next + right), height: value.height, offsetX: next, offsetY: top })
    if (edge === 'right') updateValue({ width: Math.max(1, currentWidth + left + next), height: value.height, offsetX: left, offsetY: top })
    if (edge === 'top') updateValue({ width: value.width, height: Math.max(1, currentHeight + next + bottom), offsetX: left, offsetY: next })
    if (edge === 'bottom') updateValue({ width: value.width, height: Math.max(1, currentHeight + top + next), offsetX: left, offsetY: top })
  }
  const submit = (event: React.FormEvent): void => {
    event.preventDefault()
    flushPreview()
    void onResize(value.width, value.height, anchor, value.offsetX, value.offsetY, trimOutside).then(onClose)
  }
  const left = value.offsetX; const top = value.offsetY
  const right = value.width - currentWidth - left; const bottom = value.height - currentHeight - top

  return <div className="modal-backdrop" role="presentation">
    <form className="modal canvas-resize-modal" onSubmit={submit} aria-label="调整画布尺寸">
      <header><div><span className="eyebrow">CANVAS SIZE</span><h2>画布大小</h2></div><button type="button" className="icon-button" aria-label="关闭" onClick={onClose}><X size={16} /></button></header>
      <div className="modal-body canvas-resize-body">
        <section><h3>大小</h3><div className="canvas-size-grid"><div className="resize-fields"><label className="component-number-input-row canvas-resize-number-row"><span>宽</span><NumberInput aria-label="画布宽度" min={1} suffix="px" value={value.width} onValueChange={(next) => setDimension('width', next)} /></label><label className="component-number-input-row canvas-resize-number-row"><span>高</span><NumberInput aria-label="画布高度" min={1} suffix="px" value={value.height} onValueChange={(next) => setDimension('height', next)} /></label></div><div className="anchor-grid" aria-label="画布锚点">{anchors.map((item) => { const Icon = item.icon; return <button type="button" key={item.id} aria-label={item.label} title={item.label} className={`icon-button ${anchor === item.id ? 'selected' : ''}`} onClick={() => { setAnchor(item.id); applyAnchor(value.width, value.height, item.id) }}><Icon size={16} /></button> })}</div></div></section>
        <section><h3>边界</h3><div className="canvas-edge-grid"><label className="component-number-input-row canvas-resize-number-row"><span>左</span><NumberInput aria-label="左边距" suffix="px" value={left} onValueChange={(next) => setEdge('left', next)} /></label><label className="component-number-input-row canvas-resize-number-row"><span>顶</span><NumberInput aria-label="上边距" suffix="px" value={top} onValueChange={(next) => setEdge('top', next)} /></label><label className="component-number-input-row canvas-resize-number-row"><span>右</span><NumberInput aria-label="右边距" suffix="px" value={right} onValueChange={(next) => setEdge('right', next)} /></label><label className="component-number-input-row canvas-resize-number-row"><span>底</span><NumberInput aria-label="下边距" suffix="px" value={bottom} onValueChange={(next) => setEdge('bottom', next)} /></label></div></section>
        <label className="tool-checkbox trim-canvas-checkbox"><input type="checkbox" checked={trimOutside} onChange={(event) => setTrimOutside(event.target.checked)} /><span>裁掉画布外的内容</span><span className="setting-help" title="缩小画布时，移出新边界的像素将被裁掉。"><Info size={14} aria-label="说明" /></span></label>
      </div>
      <footer><button type="button" className="quiet-button" onClick={onClose}>取消</button><button className="primary-button" type="submit">完成</button></footer>
    </form>
  </div>
}
