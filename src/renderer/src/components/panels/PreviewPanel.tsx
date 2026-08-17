import { useEffect, useRef, useState } from 'react'
import { FloatingDockPreview, PanelResizeHandles, useFloatingPanel } from '@/components/floating-panel'
import { AnimationPlaybackMenu } from '@/components/AnimationPlaybackMenu'
import { PlaybackPixelIcon } from '@/components/PlaybackPixelIcon'
import { PixelUtilityIcon } from '@/components/PixelUtilityIcon'
import { CanvasCompositeCache } from '@/components/canvas-composite-cache'
import type { DockDragProps } from '@/components/workspace-panel-types'
import { cloneDocumentForAnimationFrame, ensureAnimationDocument, nextAnimationFrameId } from '@/core/animation'
import { anchoredPreviewPan, followPreviewPosition, previewCheckerCellSize } from '@/core/preview-geometry'
import { normalizeCanvasWheelDelta, steppedCanvasZoom } from '@/core/canvas-input'
import { loadEditorPreferences, type CheckerboardPreferences } from '@/core/file-preferences'
import { registerViewPreviewListener } from '@/core/view-preview-lifecycle'
import { useWorkspace, type DocumentSession } from '@/store/workspace'
import { useI18n } from '@/components/I18nProvider'
import { resolveTheme } from '@/core/theme'
import { initialDocumentCompositePending, subscribeInitialDocumentComposite } from '@/core/initial-document-composite'
import { pixelSamplingMode } from '@/core/pixel-display'

interface FollowViewportSnapshot {
  viewportSize: { width: number; height: number }
  view: Pick<DocumentSession['view'], 'zoom' | 'panX' | 'panY' | 'rotation' | 'mirrored' | 'mirroredVertical'>
}

const followViewportView = (view: DocumentSession['view']): FollowViewportSnapshot['view'] => ({
  zoom: view.zoom,
  panX: view.panX,
  panY: view.panY,
  rotation: view.rotation,
  mirrored: view.mirrored,
  mirroredVertical: view.mirroredVertical
})

const followViewportSnapshot = (session: DocumentSession): FollowViewportSnapshot => ({ viewportSize: { ...session.viewportSize }, view: followViewportView(session.view) })

const sameFollowViewportSnapshot = (left: FollowViewportSnapshot, right: FollowViewportSnapshot): boolean =>
  left.viewportSize.width === right.viewportSize.width
  && left.viewportSize.height === right.viewportSize.height
  && left.view.zoom === right.view.zoom
  && left.view.panX === right.view.panX
  && left.view.panY === right.view.panY
  && left.view.rotation === right.view.rotation
  && left.view.mirrored === right.view.mirrored
  && left.view.mirroredVertical === right.view.mirroredVertical

export function PreviewPanel({ session, onClose, docked = false, onDockDragStart, onPanelContextMenu, onFloatingDock, relativeLuminanceInPreview = true, relativeLuminanceOverride = null }: { session: DocumentSession; onClose: () => void; relativeLuminanceInPreview?: boolean; relativeLuminanceOverride?: boolean | null } & DockDragProps) {
  const { t } = useI18n()
  const defaultPosition = { x: Math.max(12, window.innerWidth - 310 - 250 - 16), y: Math.max(46, window.innerHeight - 27 - 260 - 16), width: 250, height: 260 }
  const floating = useFloatingPanel(docked ? null : defaultPosition, false, true, 'moonsprite.preview-panel.v1', true, onFloatingDock, docked)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [followViewport, setFollowViewport] = useState(false)
  const [panning, setPanning] = useState(false)
  const [checkerboard, setCheckerboard] = useState<CheckerboardPreferences>(() => loadEditorPreferences().checkerboard)
  const [canvasSurround, setCanvasSurround] = useState(() => resolveTheme(loadEditorPreferences().theme).definition.seeds.canvasSurround)
  const [rotationIndicatorPosition, setRotationIndicatorPosition] = useState(() => loadEditorPreferences().rotationIndicatorPosition)
  const [timelineHidden, setTimelineHidden] = useState(() => loadEditorPreferences().timelineHidden)
  const [playbackMenu, setPlaybackMenu] = useState<{ x: number; y: number } | null>(null)
  const [initialCompositeReady, setInitialCompositeReady] = useState(() => !initialDocumentCompositePending(session.document))
  const timeline = session.document.animation ?? ensureAnimationDocument(session.document)
  const initialFrameId = timeline.activeFrameId
  const [previewFrameId, setPreviewFrameId] = useState(initialFrameId)
  const [previewStartFrameId, setPreviewStartFrameId] = useState<string | null>(null)
  const [previewPlaying, setPreviewPlaying] = useState(false)
  const [previewRate, setPreviewRate] = useState(1)
  const [previewLoop, setPreviewLoop] = useState(timeline.loop)
  const [previewReturnToStart, setPreviewReturnToStart] = useState(false)
  const panDrag = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null)
  const compositeCacheRef = useRef(new CanvasCompositeCache())
  const baseFitRef = useRef<{ documentId: string; width: number; height: number; viewportWidth: number; viewportHeight: number; scale: number } | null>(null)
  const followSnapshotRef = useRef<FollowViewportSnapshot>(followViewportSnapshot(session))
  const drawRef = useRef<() => void>(() => {})
  const followFrameRef = useRef<number | null>(null)
  const panFrameRef = useRef<number | null>(null)
  const pendingPanRef = useRef<{ x: number; y: number } | null>(null)
  const inheritedRelativeLuminance = session.view.relativeLuminance && relativeLuminanceInPreview
  const showRelativeLuminance = relativeLuminanceOverride ?? inheritedRelativeLuminance

  useEffect(() => {
    setInitialCompositeReady(!initialDocumentCompositePending(session.document))
    return subscribeInitialDocumentComposite(session.document, () => setInitialCompositeReady(true))
  }, [session.document])

  useEffect(() => {
    if (!followViewport) return
    const scheduleDraw = (): void => {
      if (followFrameRef.current !== null) return
      followFrameRef.current = window.requestAnimationFrame(() => {
        followFrameRef.current = null
        drawRef.current()
      })
    }
    const updateSnapshot = (next: FollowViewportSnapshot): void => {
      if (sameFollowViewportSnapshot(followSnapshotRef.current, next)) return
      followSnapshotRef.current = next
      scheduleDraw()
    }
    const syncCommittedView = (): void => {
      const current = useWorkspace.getState().sessions.find((item) => item.document.id === session.document.id)
      if (!current) return
      updateSnapshot(followViewportSnapshot(current))
    }
    syncCommittedView()
    const unsubscribeWorkspace = useWorkspace.subscribe(syncCommittedView)
    const unregisterLiveView = registerViewPreviewListener(session.document.id, (view) => updateSnapshot({
      viewportSize: followSnapshotRef.current.viewportSize,
      view: followViewportView(view)
    }))
    return () => {
      unsubscribeWorkspace()
      unregisterLiveView()
      if (followFrameRef.current !== null) {
        window.cancelAnimationFrame(followFrameRef.current)
        followFrameRef.current = null
      }
    }
  }, [followViewport, session.document.id])

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
      setRotationIndicatorPosition(preferences.rotationIndicatorPosition)
      setTimelineHidden(preferences.timelineHidden)
    }
    window.addEventListener('moonsprite:preferences-changed', syncPreferences)
    return () => window.removeEventListener('moonsprite:preferences-changed', syncPreferences)
  }, [])

  useEffect(() => {
    if (timelineHidden) {
      setPreviewPlayingState(false)
      setPlaybackMenu(null)
    }
  // setPreviewPlayingState deliberately follows the current playback state.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timelineHidden])

  useEffect(() => {
    const blur = (): void => {
      panDrag.current = null
      setPanning(false)
    }
    window.addEventListener('blur', blur)
    return () => window.removeEventListener('blur', blur)
  }, [])

  useEffect(() => {
    if (!followViewport) return
    panDrag.current = null
    pendingPanRef.current = null
    if (panFrameRef.current !== null) {
      window.cancelAnimationFrame(panFrameRef.current)
      panFrameRef.current = null
    }
    setPanning(false)
  }, [followViewport])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !initialCompositeReady) return
    const previewDocument = previewFrameId === timeline.activeFrameId
      ? session.document
      : cloneDocumentForAnimationFrame(session.document, previewFrameId)
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
      const smoothPixelSampling = pixelSamplingMode(scale) === 'smooth'
      const followSnapshot = followSnapshotRef.current
      const effectivePan = followViewport ? followPreviewPosition({
        documentSize: { width: session.document.width, height: session.document.height },
        sourceViewportSize: followSnapshot.viewportSize,
        previewViewportSize: { width: displayWidth, height: displayHeight },
        previewScale: scale,
        sourceView: followSnapshot.view,
        rotationIndicatorPosition
      }) : pan
      const drawWidth = session.document.width * scale
      const drawHeight = session.document.height * scale
      const originX = (displayWidth - drawWidth) / 2 + effectivePan.x
      const originY = (displayHeight - drawHeight) / 2 + effectivePan.y
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
      context.imageSmoothingEnabled = smoothPixelSampling
      if (smoothPixelSampling) context.imageSmoothingQuality = 'high'
      const fromX = Math.max(0, Math.floor((0 - originX) / scale))
      const fromY = Math.max(0, Math.floor((0 - originY) / scale))
      const toX = Math.min(session.document.width, Math.ceil((displayWidth - originX) / scale))
      const toY = Math.min(session.document.height, Math.ceil((displayHeight - originY) / scale))
      if (toX > fromX && toY > fromY) compositeCacheRef.current.draw({
        context,
        document: previewDocument,
        view: { zoom: scale, panX: 0, panY: 0, rotation: 0, mirrored: false, mirroredVertical: false, showGrid: false, relativeLuminance: showRelativeLuminance },
        originX,
        originY,
        canvasWidth: drawWidth,
        canvasHeight: drawHeight,
        fromX,
        fromY,
        toX,
        toY,
        revision: session.revision,
        contentRevision: session.contentRevision,
        contentInvalidation: session.contentInvalidation,
        frameId: previewFrameId,
        imageSmoothingEnabled: smoothPixelSampling
      })
      context.restore()
    }
    drawRef.current = draw
    draw()
  }, [session.document, session.contentRevision, previewFrameId, showRelativeLuminance, checkerboard, canvasSurround, rotationIndicatorPosition, zoom, pan, followViewport, initialCompositeReady])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const observer = new ResizeObserver(() => drawRef.current())
    observer.observe(canvas)
    return () => {
      observer.disconnect()
      drawRef.current = () => {}
    }
  }, [session.document.id])

  useEffect(() => () => {
    if (panFrameRef.current !== null) window.cancelAnimationFrame(panFrameRef.current)
    if (followFrameRef.current !== null) window.cancelAnimationFrame(followFrameRef.current)
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

  const currentFollowPan = (): { x: number; y: number } | null => {
    const bounds = canvasRef.current?.getBoundingClientRect()
    if (!bounds || bounds.width < 1 || bounds.height < 1) return null
    const previewFit = Math.min(bounds.width / session.document.width, bounds.height / session.document.height)
    const followSnapshot = followSnapshotRef.current
    return followPreviewPosition({
      documentSize: { width: session.document.width, height: session.document.height },
      sourceViewportSize: followSnapshot.viewportSize,
      previewViewportSize: { width: bounds.width, height: bounds.height },
      previewScale: previewFit * zoom,
      sourceView: followSnapshot.view,
      rotationIndicatorPosition
    })
  }

  const adjustZoom = (zoomIn: boolean, pointer?: { x: number; y: number }): void => {
    const canvas = canvasRef.current
    if (!canvas) return
    const bounds = canvas.getBoundingClientRect()
    if (bounds.width < 1 || bounds.height < 1) return
    const nextZoom = steppedCanvasZoom(zoom, zoomIn)
    if (nextZoom === zoom) return
    if (followViewport) {
      setZoom(nextZoom)
      return
    }
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
  const adjustWheelZoom = (event: React.WheelEvent<HTMLDivElement>): void => {
    const canvas = canvasRef.current
    if (!canvas) return
    const bounds = canvas.getBoundingClientRect()
    if (bounds.width < 1 || bounds.height < 1) return
    const delta = normalizeCanvasWheelDelta(event.nativeEvent)
    if (delta === 0) return
    event.preventDefault()
    const nextZoom = steppedCanvasZoom(zoom, delta < 0)
    if (nextZoom === zoom) return
    if (followViewport) {
      setZoom(nextZoom)
      return
    }
    setPan(anchoredPreviewPan({
      documentSize: { width: session.document.width, height: session.document.height },
      viewportSize: { width: bounds.width, height: bounds.height },
      pointer: { x: event.clientX - bounds.left, y: event.clientY - bounds.top },
      pan,
      zoom,
      nextZoom
    }))
    setZoom(nextZoom)
  }
  const toggleFollowViewport = (): void => {
    if (followViewport) {
      const followedPan = currentFollowPan()
      if (followedPan) setPan(followedPan)
    }
    setFollowViewport((current) => !current)
  }
  const startPan = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0 && event.button !== 1) return
    let start = pan
    if (followViewport) {
      const followedPan = currentFollowPan()
      if (followedPan) {
        start = followedPan
        setPan(followedPan)
      }
      setFollowViewport(false)
    }
    panDrag.current = { x: event.clientX, y: event.clientY, panX: start.x, panY: start.y }
    setPanning(true)
    event.currentTarget.setPointerCapture(event.pointerId)
    event.preventDefault()
  }
  const finishPan = (event: React.PointerEvent<HTMLDivElement>): void => {
    panDrag.current = null
    setPanning(false)
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }
  return <section ref={floating.ref} className={`panel preview-panel ${floating.style ? 'floating-panel' : ''}`} style={floating.style} onPointerDown={floating.bringToFront} onContextMenu={onPanelContextMenu}>
    <header onPointerDown={(event) => floating.style ? floating.startDrag(event) : onDockDragStart?.(event, floating.startDetachedDrag)}><span>{t('panel.preview')}</span><span className="panel-actions"><button className={followViewport ? 'active' : ''} title={t('preview.followViewport')} aria-label={t('preview.followViewport')} aria-pressed={followViewport} onClick={toggleFollowViewport}><PixelUtilityIcon kind="follow" /></button><button title={t('preview.zoomOut')} aria-label={t('preview.zoomOut')} onClick={() => adjustZoom(false)}><PixelUtilityIcon kind="minus" /></button><button title={t('preview.zoomIn')} aria-label={t('preview.zoomIn')} onClick={() => adjustZoom(true)}><PixelUtilityIcon kind="plus" /></button><button className={previewPlaying ? 'active' : ''} disabled={timelineHidden || timeline.frames.length <= 1} title={t(previewPlaying ? 'timeline.pause' : 'timeline.play')} aria-label={t(previewPlaying ? 'timeline.pause' : 'timeline.play')} onClick={() => setPreviewPlayingState(!previewPlaying)} onContextMenu={(event) => { event.preventDefault(); event.stopPropagation(); if (!timelineHidden) setPlaybackMenu({ x: event.clientX, y: event.clientY }) }}><PlaybackPixelIcon kind={previewPlaying ? 'pause' : 'play'} /></button><button title={t('preview.close')} aria-label={t('preview.close')} onClick={onClose}><PixelUtilityIcon kind="close" /></button></span></header>
    <div className={`preview-canvas-wrap ${panning ? 'space-panning' : ''}`} onWheel={adjustWheelZoom} onPointerDown={startPan} onPointerMove={(event) => { const drag = panDrag.current; if (!drag) return; schedulePan({ x: drag.panX + event.clientX - drag.x, y: drag.panY + event.clientY - drag.y }) }} onPointerUp={finishPan} onPointerCancel={finishPan}><div className="preview-canvas-frame"><canvas ref={canvasRef} aria-label={t('preview.canvasAria')} /></div></div>
    {floating.style && <PanelResizeHandles onResize={floating.startResize} />}
    <FloatingDockPreview style={floating.dockPreview} />
    {playbackMenu && <AnimationPlaybackMenu session={session} x={playbackMenu.x} y={playbackMenu.y} playback={previewPlayback} onClose={() => setPlaybackMenu(null)} />}
  </section>
}
