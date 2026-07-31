import { useEffect, useState, type FormEvent } from 'react'
import { Lock, LockOpen, X } from 'lucide-react'
import type { ImageResizeInterpolation } from '@shared/types'
import { NumberInput } from './NumberInput'

export function ImageResizeDialog({ open, currentWidth, currentHeight, onClose, onResize }: {
  open: boolean
  currentWidth: number
  currentHeight: number
  onClose: () => void
  onResize: (width: number, height: number, interpolation: ImageResizeInterpolation) => Promise<void>
}) {
  const [width, setWidth] = useState(currentWidth)
  const [height, setHeight] = useState(currentHeight)
  const [widthPercent, setWidthPercent] = useState(100)
  const [heightPercent, setHeightPercent] = useState(100)
  const [locked, setLocked] = useState(true)
  const [interpolation, setInterpolation] = useState<ImageResizeInterpolation>('nearest')

  useEffect(() => {
    if (!open) return
    setWidth(currentWidth)
    setHeight(currentHeight)
    setWidthPercent(100)
    setHeightPercent(100)
    setLocked(true)
    setInterpolation('nearest')
  }, [open, currentWidth, currentHeight])

  if (!open) return null

  const updateWidth = (next: number): void => {
    const normalized = Math.max(1, Math.min(16384, Math.round(next) || 1))
    const nextHeight = locked ? Math.max(1, Math.round(normalized * currentHeight / currentWidth)) : height
    setWidth(normalized)
    setHeight(nextHeight)
    setWidthPercent(Math.max(1, Math.round(normalized / currentWidth * 100)))
    setHeightPercent(Math.max(1, Math.round(nextHeight / currentHeight * 100)))
  }

  const updateHeight = (next: number): void => {
    const normalized = Math.max(1, Math.min(16384, Math.round(next) || 1))
    const nextWidth = locked ? Math.max(1, Math.round(normalized * currentWidth / currentHeight)) : width
    setWidth(nextWidth)
    setHeight(normalized)
    setWidthPercent(Math.max(1, Math.round(nextWidth / currentWidth * 100)))
    setHeightPercent(Math.max(1, Math.round(normalized / currentHeight * 100)))
  }

  const updateWidthPercent = (next: number): void => updateWidth(Math.max(1, Math.round(currentWidth * Math.max(1, Math.min(6400, next)) / 100)))
  const updateHeightPercent = (next: number): void => updateHeight(Math.max(1, Math.round(currentHeight * Math.max(1, Math.min(6400, next)) / 100)))
  const submit = (event: FormEvent): void => {
    event.preventDefault()
    void onResize(width, height, interpolation).then(onClose)
  }

  return <div className="modal-backdrop" role="presentation">
    <form className="modal image-resize-modal" onSubmit={submit} aria-label="调整图像尺寸">
      <header>
        <div><span className="eyebrow">IMAGE SIZE</span><h2>调整图像尺寸</h2></div>
        <button type="button" className="icon-button" aria-label="关闭" onClick={onClose}><X size={16} /></button>
      </header>
      <div className="modal-body image-resize-body">
        <div className="image-resize-current"><span>当前图像</span><strong>{currentWidth} x {currentHeight} px</strong></div>
        <section className="image-resize-section">
          <div className="image-resize-section-heading"><h3>像素尺寸</h3><small>{locked ? '已锁定长宽比' : '自由调整'}</small></div>
          <div className="image-resize-fields">
            <label><span>宽</span><div className="image-resize-input"><NumberInput aria-label="图像宽度" min={1} max={16384} value={width} onValueChange={updateWidth} /><small>px</small></div></label>
            <button type="button" className="image-resize-lock" aria-label={locked ? '解除锁定长宽比' : '锁定长宽比'} title={locked ? '解除锁定长宽比' : '锁定长宽比'} onClick={() => setLocked((value) => !value)}>{locked ? <Lock size={15} /> : <LockOpen size={15} />}</button>
            <label><span>高</span><div className="image-resize-input"><NumberInput aria-label="图像高度" min={1} max={16384} value={height} onValueChange={updateHeight} /><small>px</small></div></label>
          </div>
        </section>
        <section className="image-resize-section">
          <div className="image-resize-section-heading"><h3>按比例缩放</h3><small>相对于当前图像</small></div>
          <div className="image-resize-percent-fields">
            <label><span>宽</span><div className="image-resize-input"><NumberInput aria-label="图像宽度百分比" min={1} max={6400} value={widthPercent} onValueChange={updateWidthPercent} /><small>%</small></div></label>
            <label><span>高</span><div className="image-resize-input"><NumberInput aria-label="图像高度百分比" min={1} max={6400} value={heightPercent} onValueChange={updateHeightPercent} /><small>%</small></div></label>
          </div>
        </section>
        <label className="image-resize-interpolation"><span>插值算法</span><select value={interpolation} onChange={(event) => setInterpolation(event.target.value as ImageResizeInterpolation)}><option value="nearest">最近邻（像素）</option><option value="smooth">平滑（双线性）</option></select></label>
      </div>
      <footer><button type="button" className="quiet-button" onClick={onClose}>取消</button><button className="primary-button" type="submit">完成</button></footer>
    </form>
  </div>
}
