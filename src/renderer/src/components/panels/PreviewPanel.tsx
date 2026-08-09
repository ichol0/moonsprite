import { useEffect, useRef, useState } from 'react'
import { FloatingDockPreview, PanelResizeHandles, useFloatingPanel } from '@/components/floating-panel'
import { AnimationPlaybackMenu } from '@/components/AnimationPlaybackMenu'
import { PlaybackPixelIcon } from '@/components/PlaybackPixelIcon'
import { PixelUtilityIcon } from '@/components/PixelUtilityIcon'
import type { DockDragProps } from '@/components/workspace-panel-types'
import { compositeRegion } from '@/core/document'
import { cloneDocumentForAnimationFrame, ensureAnimationDocument, nextAnimationFrameId } from '@/core/animation'
import { anchoredPreviewPan, previewCheckerCellSize } from '@/core/preview-geometry'
import { steppedCanvasZoom } from '@/core/canvas-input'
import { pixelSamplingMode } from '@/core/pixel-display'
import { applyRelativeLuminance } from '@/core/raster'
import { loadEditorPreferences, type CheckerboardPreferences } from '@/core/file-preferences'
import { useWorkspace, type DocumentSession } from '@/store/workspace'
import { useI18n } from '@/components/I18nProvider'
import { resolveTheme } from '@/core/theme'

export function PreviewPanel({ session, onClose, docked = false, onDockDragStart, onPanelContextMenu, onFloatingDock, relativeLuminanceInPreview = true }: { session: DocumentSession; onClose: () => void; relativeLuminanceInPreview?: boolean } & DockDragProps) {
  const { t } = useI18n()
  const defaultPosition = { x: Math.max(12, window.innerWidth - 310 - 250 - 16), y: Math.max(46, window.innerHeight - 27 - 260 - 16), width: 250, height: 260 }
  const floating = useFloatingPanel(docked ? null : defaultPosition, false, true, 'moonsprite.preview-panel.v1', false, onFloatingDock, docked)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [spaceHeld, setSpaceHeld] = useState(false)
  const [panning, setPanning] = useState(false)
  const [checkerboard, setCheckerboard] = useState<CheckerboardPreferences>(() => loadEditorPreferences().checkerboard)
  const [canvasSurround, setCanvasSurround] = useState(() => resolveTheme(loadEditorPreferences().theme).definition.seeds.canvasSurround)
  const [playbackMenu, setPlaybackMenu] = useState<{ x: number; y: number } | null>(null)
  const timeline = ensureAnimationDocument(session.document)
  const initialFrameId = timeline.activeFrameId
  const [previewFrameId, setPreviewFrameId] = useState(initialFrameId)
  const [previewStartFrameId, setPreviewStartFrameId] = useState<string | null>(null)
  const [previewPlaying, setPreviewPlaying] = useState(false)
  const [previewRate, setPreviewRate] = useState(1)
  const [previewLoop, setPreviewLoop] = useState(timeline.loop)
  const [previewReturnToStart, setPreviewReturnToStart] = useState(false)
  const panDrag = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null)
  const sourceCacheRef = useRef(new Map<string, { canvas: OffscreenCanvas; revision: number }>())
  const baseFitRef = useRef<{ documentId: string; width: number; height: number; viewportWidth: number; viewportHeight: number; scale: number } | null>(null)
  const panFrameRef = useRef<number | null>(null)
  const pendingPanRef = useRef<{ x: number; y: number } | null>(null)
  const showRelativeLuminance = session.view.relativeLuminance && relativeLuminanceInPreview

  useEffect(() => {
    if (!timeline.frames.some((frame) => frame.id === previewFrameId)) setPreviewFrameId(timeline.activeFrameId)
    if (previewPlaying && !timeline.frames.some((frame) => frame.id === previewStartFrameId)) setPreviewStartFrameId(previewFrameId)
  }, [session.document, previewFrameId, previewPlaying, previewStartFrameId, timeline])

  useEffect(() => {
    if (!previewPlaying) return
    const frame = timeline.frames.find((candidate) => candidate.id === previewFrameId)
    if (!frame) return
    const nextFrameId = nextAnimationFrameId({ ...timeline, loop: previewLoop }, previewFrameId)
    const timer = window.setTimeout(() => {
      if (nextFrameId === previewFrameId) {
        const returnFrameId = previewReturnToStart ? previewStartFrameId : previewFrameId
        setPreviewPlaying(false)
        setPreviewStartFrameId(null)
        if (returnFrameId) setPreviewFrameId(returnFrameId)
        return
      }
      setPreviewFrameId(nextFrameId)
    }, frame.duration / Math.max(0.01, previewRate))
    return () => window.clearTimeout(timer)
  }, [previewFrameId, previewPlaying, previewRate, previewLoop, previewReturnToStart, previewStartFrameId, timeline])

  const setPreviewPlayingState = (playing: boolean): void => {
    if (playing) {
      const startFrameId = previewFrameId
      setPreviewStartFrameId(startFrameId)
      if (!previewLoop && startFrameId !== timeline.frames[0]?.id) setPreviewFrameId(timeline.frames[0]?.id ?? startFrameId)
    } else {
      if (previewReturnToStart && previewStartFrameId) setPreviewFrameId(previewStartFrameId)
      setPreviewStartFrameId(null)
    }
    setPreviewPlaying(playing)
  }

  const previewPlayback = {
    playing: previewPlaying,
    rate: previewRate,
    loop: previewLoop,
    returnToStart: previewReturnToStart,
    setPlaying: setPreviewPlayingState,
    setRate: setPreviewRate,
    setLoop: setPreviewLoop,
    setReturnToStart: setPreviewReturnToStart
  }

  useEffect(() => {
    const syncPreferences = (): void => {
      const preferences = loadEditorPreferences()
      setCheckerboard(preferences.checkerboard)
      setCanvasSurround(resolveTheme(preferences.theme).definition.seeds.canvasSurround)
    }
    window.addEventListener('moonsprite:preferences-changed', syncPreferences)
    return () => window.removeEventListener('moonsprite:preferences-changed', syncPreferences)
  }, [])

  useEffect(() => {
    const editableTarget = (target: EventTarget | null): boolean => {
      const element = target instanceof HTMLElement ? target : null
      return Boolean(element && (element.matches('input, textarea, select') || element.isContentEditable))
    }
    const keyDown = (event: KeyboardEvent): void => {
      if (event.code !== 'Space' || editableTarget(event.target)) return
      event.preventDefault()
      setSpaceHeld(true)
    }
    const keyUp = (event: KeyboardEvent): void => {
      if (event.code !== 'Space') return
      event.preventDefault()
      setSpaceHeld(false)
    }
    const blur = (): void => {
      panDrag.current = null
      setSpaceHeld(false)
      setPanning(false)
    }
    window.addEventListener('keydown', keyDown)
    window.addEventListener('keyup', keyUp)
    window.addEventListener('blur', blur)
    return () => {
      window.removeEventListener('keydown', keyDown)
      window.removeEventListener('keyup', keyUp)
      window.removeEventListener('blur', blur)
    }
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const sourceKey = `${session.document.id}:${previewFrameId}:${showRelativeLuminance ? 1 : 0}`
    let source = sourceCacheRef.current.get(sourceKey)
    const invalidation = session.contentInvalidation
    const canPatch = source
      && source.revision !== session.contentRevision
      && invalidation?.revision === session.contentRevision
      && invalidation.fromRevision === source.revision
      && invalidation.kind === 'region'
    if (source && source.revision !== session.contentRevision && !canPatch) source = undefined
    if (source && canPatch) {
      if ((invalidation.frameId ?? 'static') === previewFrameId) {
        const left = Math.max(0, Math.floor(invalidation.rect.x))
        const top = Math.max(0, Math.floor(invalidation.rect.y))
        const right = Math.min(session.document.width, Math.ceil(invalidation.rect.x + invalidation.rect.width))
        const bottom = Math.min(session.document.height, Math.ceil(invalidation.rect.y + invalidation.rect.height))
        if (right > left && bottom > top) {
          const previewDocument = cloneDocumentForAnimationFrame(session.document, previewFrameId)
          const pixels = compositeRegion(previewDocument, left, top, right - left, bottom - top)
          if (showRelativeLuminance) applyRelativeLuminance(pixels)
          source.canvas.getContext('2d')?.putImageData(new ImageData(pixels as Uint8ClampedArray<ArrayBuffer>, right - left, bottom - top), left, top)
        }
      }
      source.revision = session.contentRevision
    }
    if (!source) {
      const width = session.document.width
      const height = session.document.height
      const previewDocument = cloneDocumentForAnimationFrame(session.document, previewFrameId)
      const pixels = compositeRegion(previewDocument, 0, 0, width, height)
      if (showRelativeLuminance) applyRelativeLuminance(pixels)
      const sourceCanvas = new OffscreenCanvas(width, height)
      sourceCanvas.getContext('2d')?.putImageData(new ImageData(pixels as Uint8ClampedArray<ArrayBuffer>, width, height), 0, 0)
      source = { canvas: sourceCanvas, revision: session.contentRevision }
      sourceCacheRef.current.set(sourceKey, source)
      while (sourceCacheRef.current.size > 32) sourceCacheRef.current.delete(sourceCacheRef.current.keys().next().value!)
    }
    const sourceCanvas = source.canvas
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
      if (!baseFit || baseFit.documentId !== session.document.id || baseFit.width !== session.document.width || baseFit.height !== session.document.height || baseFit.viewportWidth !== displayWidth || baseFit.viewportHeight !== displayHeight) {
        baseFit = { documentId: session.document.id, width: session.document.width, height: session.document.height, viewportWidth: displayWidth, viewportHeight: displayHeight, scale: Math.min(displayWidth / session.document.width, displayHeight / session.document.height) }
        baseFitRef.current = baseFit
      }
      const scale = baseFit.scale * zoom
      const drawWidth = session.document.width * scale
      const drawHeight = session.document.height * scale
      const originX = (displayWidth - drawWidth) / 2 + pan.x
      const originY = (displayHeight - drawHeight) / 2 + pan.y
      context.fillStyle = canvasSurround
      context.fillRect(0, 0, displayWidth, displayHeight)
      context.save()
      context.beginPath()
      context.rect(originX, originY, drawWidth, drawHeight)
      context.clip()
      context.fillStyle = `rgb(${checkerboard.lightColor.r} ${checkerboard.lightColor.g} ${checkerboard.lightColor.b})`
      context.fillRect(originX, originY, drawWidth, drawHeight)
      const checkerCell = previewCheckerCellSize(checkerboard.size, scale)
      if (checkerCell >= 2) {
        const columnCount = Math.ceil(session.document.width / checkerboard.size)
        const rowCount = Math.ceil(session.document.height / checkerboard.size)
        const firstColumn = Math.max(0, Math.floor((0 - originX) / checkerCell))
        const firstRow = Math.max(0, Math.floor((0 - originY) / checkerCell))
        const lastColumn = Math.min(columnCount, Math.ceil((displayWidth - originX) / checkerCell))
        const lastRow = Math.min(rowCount, Math.ceil((displayHeight - originY) / checkerCell))
        context.fillStyle = `rgb(${checkerboard.darkColor.r} ${checkerboard.darkColor.g} ${checkerboard.darkColor.b})`
        for (let row = firstRow; row < lastRow; row += 1) for (let column = firstColumn; column < lastColumn; column += 1) {
          if ((column + row) % 2 === 0) continue
          context.fillRect(originX + column * checkerCell, originY + row * checkerCell, checkerCell, checkerCell)
        }
      }
      context.imageSmoothingEnabled = pixelSamplingMode(scale) === 'smooth'
      if (context.imageSmoothingEnabled) context.imageSmoothingQuality = 'high'
      context.drawImage(sourceCanvas, originX, originY, drawWidth, drawHeight)
      context.restore()
    }
    draw()
    const observer = new ResizeObserver(draw)
    observer.observe(canvas)
    return () => observer.disconnect()
  }, [session.document, session.contentRevision, previewFrameId, showRelativeLuminance, checkerboard, canvasSurround, zoom, pan])

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

  const adjustZoom = (zoomIn: boolean, pointer?: { x: number; y: number }): void => {
    const canvas = canvasRef.current
    if (!canvas) return
    const bounds = canvas.getBoundingClientRect()
    if (bounds.width < 1 || bounds.height < 1) return
    const nextZoom = steppedCanvasZoom(zoom, zoomIn)
    if (nextZoom === zoom) return
    setPan(anchoredPreviewPan({
      documentSize: { width: session.document.width, height: session.document.height },
      viewportSize: { width: bounds.width, height: bounds.height },
      pointer: pointer ?? { x: bounds.width / 2, y: bounds.height / 2 },
      pan,
      zoom,
      nextZoom
    }))
    setZoom(nextZoom)
  }
  const finishPan = (event: React.PointerEvent<HTMLDivElement>): void => {
    panDrag.current = null
    setPanning(false)
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }
  return <section ref={floating.ref} className={`panel preview-panel ${floating.style ? 'floating-panel' : ''}`} style={floating.style} onPointerDown={floating.bringToFront} onContextMenu={onPanelContextMenu}>
    <header onPointerDown={(event) => floating.style ? floating.startDrag(event) : onDockDragStart?.(event, floating.startDetachedDrag)}><span>{t('panel.preview')}</span><span className="panel-actions"><button title={t('preview.zoomOut')} aria-label={t('preview.zoomOut')} onClick={() => adjustZoom(false)}><PixelUtilityIcon kind="minus" /></button><button title={t('preview.zoomIn')} aria-label={t('preview.zoomIn')} onClick={() => adjustZoom(true)}><PixelUtilityIcon kind="plus" /></button><button className={previewPlaying ? 'active' : ''} disabled={timeline.frames.length <= 1} title={t(previewPlaying ? 'timeline.pause' : 'timeline.play')} aria-label={t(previewPlaying ? 'timeline.pause' : 'timeline.play')} onClick={() => setPreviewPlayingState(!previewPlaying)} onContextMenu={(event) => { event.preventDefault(); event.stopPropagation(); setPlaybackMenu({ x: event.clientX, y: event.clientY }) }}><PlaybackPixelIcon kind={previewPlaying ? 'pause' : 'play'} /></button><button title={t('preview.close')} aria-label={t('preview.close')} onClick={onClose}><PixelUtilityIcon kind="close" /></button></span></header>
    <div className={`preview-canvas-wrap ${spaceHeld ? 'space-pan-ready' : ''} ${panning ? 'space-panning' : ''}`} onWheel={(event) => { const bounds = canvasRef.current?.getBoundingClientRect(); if (!bounds) return; event.preventDefault(); adjustZoom(event.deltaY < 0, { x: event.clientX - bounds.left, y: event.clientY - bounds.top }) }} onPointerDown={(event) => { if (event.button !== 1 && !(event.button === 0 && spaceHeld)) return; panDrag.current = { x: event.clientX, y: event.clientY, panX: pan.x, panY: pan.y }; setPanning(true); event.currentTarget.setPointerCapture(event.pointerId); event.preventDefault() }} onPointerMove={(event) => { const drag = panDrag.current; if (!drag) return; schedulePan({ x: drag.panX + event.clientX - drag.x, y: drag.panY + event.clientY - drag.y }) }} onPointerUp={finishPan} onPointerCancel={finishPan}><div className="preview-canvas-frame"><canvas ref={canvasRef} aria-label={t('preview.canvasAria')} /></div></div>
    {floating.style && <PanelResizeHandles onResize={floating.startResize} />}
    <FloatingDockPreview style={floating.dockPreview} />
    {playbackMenu && <AnimationPlaybackMenu session={session} x={playbackMenu.x} y={playbackMenu.y} playback={previewPlayback} onClose={() => setPlaybackMenu(null)} />}
  </section>
}
