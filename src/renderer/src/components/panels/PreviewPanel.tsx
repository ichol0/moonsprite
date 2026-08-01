import { useEffect, useRef, useState } from 'react'
import { Minus, Plus, X } from 'lucide-react'
import { FloatingDockPreview, PanelResizeHandles, useFloatingPanel } from '@/components/floating-panel'
import type { DockDragProps } from '@/components/workspace-panel-types'
import { createCompositeSampler } from '@/core/document'
import { relativeLuminanceColor } from '@/core/raster'
import type { DocumentSession } from '@/store/workspace'

export function PreviewPanel({ session, onClose, docked = false, onDockDragStart, onFloatingDock, relativeLuminanceInPreview = true }: { session: DocumentSession; onClose: () => void; relativeLuminanceInPreview?: boolean } & DockDragProps) {
  const defaultPosition = { x: Math.max(12, window.innerWidth - 310 - 250 - 16), y: Math.max(46, window.innerHeight - 27 - 260 - 16), width: 250, height: 260 }
  const floating = useFloatingPanel(docked ? null : defaultPosition, false, true, 'moonsprite.preview-panel.v1', true, onFloatingDock, docked)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const panDrag = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null)
  const sourceRef = useRef<{ documentId: string; revision: number; relativeLuminance: boolean; canvas: OffscreenCanvas } | null>(null)
  const baseFitRef = useRef<{ documentId: string; width: number; height: number; scale: number } | null>(null)
  const panFrameRef = useRef<number | null>(null)
  const pendingPanRef = useRef<{ x: number; y: number } | null>(null)
  const showRelativeLuminance = session.view.relativeLuminance && relativeLuminanceInPreview

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    let source = sourceRef.current
    if (!source || source.documentId !== session.document.id || source.revision !== session.revision || source.relativeLuminance !== showRelativeLuminance) {
      const documentWidth = session.document.width
      const documentHeight = session.document.height
      const sourceScale = Math.min(1, 512 / Math.max(documentWidth, documentHeight))
      const width = Math.max(1, Math.round(documentWidth * sourceScale))
      const height = Math.max(1, Math.round(documentHeight * sourceScale))
      const pixels = new Uint8ClampedArray(width * height * 4)
      const sampleComposite = createCompositeSampler(session.document)
      for (let index = 0; index < width * height; index += 1) {
        const offset = index * 4
        const previewX = index % width
        const previewY = Math.floor(index / width)
        const sourceX = Math.min(documentWidth - 1, Math.floor(previewX / sourceScale))
        const sourceY = Math.min(documentHeight - 1, Math.floor(previewY / sourceScale))
        const sampled = sampleComposite(sourceY * documentWidth + sourceX)
        const color = showRelativeLuminance ? relativeLuminanceColor(sampled) : sampled
        const checker = (Math.floor(sourceX / 16) + Math.floor(sourceY / 16)) % 2 === 0 ? 215 : 155
        const alpha = color.a / 255
        pixels[offset] = Math.round(color.r * alpha + checker * (1 - alpha))
        pixels[offset + 1] = Math.round(color.g * alpha + checker * (1 - alpha))
        pixels[offset + 2] = Math.round(color.b * alpha + checker * (1 - alpha))
        pixels[offset + 3] = 255
      }
      const sourceCanvas = new OffscreenCanvas(width, height)
      sourceCanvas.getContext('2d')?.putImageData(new ImageData(pixels, width, height), 0, 0)
      source = { documentId: session.document.id, revision: session.revision, relativeLuminance: showRelativeLuminance, canvas: sourceCanvas }
      sourceRef.current = source
    }
    const draw = (): void => {
      const context = canvas.getContext('2d')
      const bounds = canvas.getBoundingClientRect()
      if (!context || bounds.width < 1 || bounds.height < 1) return
      const dpr = Math.max(1, window.devicePixelRatio || 1)
      const width = Math.max(1, Math.round(bounds.width * dpr))
      const height = Math.max(1, Math.round(bounds.height * dpr))
      if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height }
      context.setTransform(dpr, 0, 0, dpr, 0, 0)
      const displayWidth = bounds.width
      const displayHeight = bounds.height
      context.clearRect(0, 0, displayWidth, displayHeight)
      let baseFit = baseFitRef.current
      if (!baseFit || baseFit.documentId !== session.document.id || baseFit.width !== session.document.width || baseFit.height !== session.document.height) {
        baseFit = { documentId: session.document.id, width: session.document.width, height: session.document.height, scale: Math.min(displayWidth / session.document.width, displayHeight / session.document.height) }
        baseFitRef.current = baseFit
      }
      const scale = baseFit.scale * zoom
      const drawWidth = session.document.width * scale
      const drawHeight = session.document.height * scale
      const originX = (displayWidth - drawWidth) / 2 + pan.x
      const originY = (displayHeight - drawHeight) / 2 + pan.y
      context.fillStyle = '#4a4a51'
      context.fillRect(0, 0, displayWidth, displayHeight)
      context.imageSmoothingEnabled = false
      context.drawImage(source.canvas, originX, originY, drawWidth, drawHeight)
    }
    draw()
    const observer = new ResizeObserver(draw)
    observer.observe(canvas)
    return () => observer.disconnect()
  }, [session.document, session.revision, showRelativeLuminance, zoom, pan])

  useEffect(() => () => {
    if (panFrameRef.current !== null) window.cancelAnimationFrame(panFrameRef.current)
  }, [])

  const schedulePan = (next: { x: number; y: number }): void => {
    pendingPanRef.current = next
    if (panFrameRef.current !== null) return
    panFrameRef.current = window.requestAnimationFrame(() => {
      panFrameRef.current = null
      const pending = pendingPanRef.current
      pendingPanRef.current = null
      if (pending) setPan(pending)
    })
  }

  const adjustZoom = (factor: number): void => setZoom((value) => Math.max(0.25, Math.min(16, value * factor)))
  return <section ref={floating.ref} className={`panel preview-panel ${floating.style ? 'floating-panel' : ''}`} style={floating.style} onPointerDown={floating.bringToFront}>
    <header onPointerDown={(event) => floating.style ? floating.startDrag(event) : onDockDragStart?.(event, floating.startDetachedDrag)}><span>预览</span><small>{Math.round(zoom * 100)}%</small><span className="panel-actions"><button title="缩小预览" aria-label="缩小预览" onClick={() => adjustZoom(0.8)}><Minus size={14} /></button><button title="放大预览" aria-label="放大预览" onClick={() => adjustZoom(1.25)}><Plus size={14} /></button><button title="关闭预览" aria-label="关闭预览" onClick={onClose}><X size={14} /></button></span></header>
    <div className="preview-canvas-wrap" onWheel={(event) => { event.preventDefault(); adjustZoom(event.deltaY < 0 ? 1.15 : 1 / 1.15) }} onPointerDown={(event) => { if (event.button !== 1) return; panDrag.current = { x: event.clientX, y: event.clientY, panX: pan.x, panY: pan.y }; event.currentTarget.setPointerCapture(event.pointerId); event.preventDefault() }} onPointerMove={(event) => { const drag = panDrag.current; if (!drag) return; schedulePan({ x: drag.panX + event.clientX - drag.x, y: drag.panY + event.clientY - drag.y }) }} onPointerUp={(event) => { panDrag.current = null; if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId) }} onPointerCancel={() => { panDrag.current = null }}><canvas ref={canvasRef} aria-label="作品预览" /></div>
    {floating.style && <PanelResizeHandles onResize={floating.startResize} />}
    <FloatingDockPreview style={floating.dockPreview} />
  </section>
}


