import { useEffect, useMemo, useRef, useState } from 'react'
import { FileVideo, Pause, Play } from 'lucide-react'
import type { TimelapseQuality, TimelapseSettings, TimelapseSnapshot, TimelapseVideoFormat } from '@shared/types'
import { timelapseFrameDurations, timelapseOutputDimensions, timelapseOutputScale, timelapseSourceDurationMs, type TimelapseExportMode, type TimelapseExportOptions } from '@/core/timelapse'
import { loadEditorPreferences } from '@/core/file-preferences'
import { resolveTheme } from '@/core/theme'
import { DialogHeader } from './DialogHeader'
import { ModalShell } from './ModalShell'
import { NumberInput } from './NumberInput'
import { ThemedSelect } from './ThemedSelect'
import { useI18n } from './I18nProvider'
import { PixelUtilityIcon } from './PixelUtilityIcon'
import { FormField } from './FormField'
import { PreferenceToggle } from './PreferenceToggle'

interface TimelapseDialogProps {
  settings: TimelapseSettings
  onChange: (settings: Partial<Omit<TimelapseSettings, 'snapshots'>>) => void
  onClear: () => void
  onExport: (format: TimelapseVideoFormat, options: TimelapseExportOptions) => Promise<boolean>
  onClose: () => void
}

export function TimelapseDialog({ settings, onChange, onClear, onExport, onClose }: TimelapseDialogProps) {
  const { t } = useI18n()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const previewStartFrameRef = useRef(0)
  const [previewPlaying, setPreviewPlaying] = useState(false)
  const [previewFrame, setPreviewFrame] = useState(0)
  const [format, setFormat] = useState<TimelapseVideoFormat>('mp4')
  const [exportMode, setExportMode] = useState<TimelapseExportMode>('duration')
  const [clearConfirm, setClearConfirm] = useState(false)
  const [durationSeconds, setDurationSeconds] = useState(() => Math.max(1, Math.round(timelapseSourceDurationMs(settings) / 1000 / Math.max(1, settings.speed))))
  const [previewVisuals, setPreviewVisuals] = useState(() => {
    const preferences = loadEditorPreferences()
    return { checkerboard: preferences.checkerboard, background: resolveTheme(preferences.theme).variables['--theme-deep-surface'] }
  })
  const snapshot = settings.snapshots[Math.min(previewFrame, Math.max(0, settings.snapshots.length - 1))]
  const exportOptions = useMemo<TimelapseExportOptions>(() => ({ mode: exportMode, durationSeconds }), [durationSeconds, exportMode])
  const frameDurations = useMemo(
    () => timelapseFrameDurations(settings, exportOptions),
    [exportOptions, settings.fps, settings.snapshots.length, settings.speed]
  )
  const { width: outputWidth, height: outputHeight } = timelapseOutputDimensions(settings)
  const outputDurationMs = frameDurations.reduce((total, duration) => total + duration, 0)
  const outputDuration = outputDurationMs === 0 ? '0 s' : outputDurationMs < 10_000 ? `${(outputDurationMs / 1000).toFixed(1)} s` : `${Math.round(outputDurationMs / 1000)} s`
  const effectiveSpeed = outputDurationMs > 0 ? timelapseSourceDurationMs(settings) / outputDurationMs : settings.speed
  const qualityOptions = (['low', 'medium', 'high'] as const).map((quality) => {
    const dimensions = timelapseOutputDimensions({ quality, snapshots: settings.snapshots })
    const name = quality === 'low' ? t('timelapse.qualityLow') : quality === 'medium' ? t('timelapse.qualityMedium') : t('timelapse.qualityHigh')
    const scale = timelapseOutputScale({ quality, snapshots: settings.snapshots })
    return { value: quality, label: `${name} - ${scale}x - ${dimensions.width} x ${dimensions.height}` }
  })
  const togglePreviewPlayback = (): void => {
    if (previewPlaying) {
      setPreviewPlaying(false)
      return
    }
    const lastFrame = Math.max(0, settings.snapshots.length - 1)
    const startFrame = previewFrame >= lastFrame ? 0 : previewFrame
    previewStartFrameRef.current = startFrame
    if (startFrame !== previewFrame) setPreviewFrame(startFrame)
    setPreviewPlaying(true)
  }

  useEffect(() => {
    if (previewFrame < settings.snapshots.length) return
    setPreviewFrame(Math.max(0, settings.snapshots.length - 1))
  }, [previewFrame, settings.snapshots.length])

  useEffect(() => {
    const syncPreferences = (): void => {
      const preferences = loadEditorPreferences()
      setPreviewVisuals({ checkerboard: preferences.checkerboard, background: resolveTheme(preferences.theme).variables['--theme-deep-surface'] })
    }
    window.addEventListener('moonsprite:preferences-changed', syncPreferences)
    return () => window.removeEventListener('moonsprite:preferences-changed', syncPreferences)
  }, [])

  useEffect(() => {
    if (!previewPlaying || settings.snapshots.length < 2 || outputDurationMs <= 0) return
    const frameCount = settings.snapshots.length
    const lastFrame = frameCount - 1
    const frameDuration = outputDurationMs / frameCount
    const startFrame = Math.min(previewStartFrameRef.current, lastFrame)
    const startOffset = startFrame * frameDuration
    const startedAt = performance.now()
    let animationFrame = 0
    const advance = (now: number): void => {
      const elapsed = startOffset + now - startedAt
      if (elapsed >= outputDurationMs) {
        setPreviewFrame(lastFrame)
        setPreviewPlaying(false)
        return
      }
      const nextFrame = Math.min(lastFrame, Math.floor(elapsed / frameDuration))
      setPreviewFrame((frame) => frame === nextFrame ? frame : nextFrame)
      animationFrame = window.requestAnimationFrame(advance)
    }
    animationFrame = window.requestAnimationFrame(advance)
    return () => window.cancelAnimationFrame(animationFrame)
  }, [outputDurationMs, previewPlaying, settings.snapshots.length])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const renderEmpty = (): void => {
      canvas.width = 480
      canvas.height = 270
      const context = canvas.getContext('2d')
      if (!context) return
      context.fillStyle = previewVisuals.background
      context.fillRect(0, 0, canvas.width, canvas.height)
    }
    if (!snapshot) {
      renderEmpty()
      return
    }
    let canceled = false
    const render = async (frame: TimelapseSnapshot): Promise<void> => {
      const previewWidth = 480
      const previewHeight = Math.max(160, Math.min(300, Math.round(previewWidth * frame.height / frame.width)))
      const buffer = frame.data.buffer.slice(frame.data.byteOffset, frame.data.byteOffset + frame.data.byteLength) as ArrayBuffer
      const bitmap = await createImageBitmap(new Blob([buffer], { type: 'image/png' }))
      if (canceled) { bitmap.close(); return }
      canvas.width = previewWidth
      canvas.height = previewHeight
      const context = canvas.getContext('2d')
      if (!context) { bitmap.close(); return }
      const checkerSize = 8
      for (let y = 0; y < previewHeight; y += checkerSize) for (let x = 0; x < previewWidth; x += checkerSize) {
        const color = ((x / checkerSize + y / checkerSize) & 1) === 0 ? previewVisuals.checkerboard.lightColor : previewVisuals.checkerboard.darkColor
        context.fillStyle = `rgb(${color.r} ${color.g} ${color.b})`
        context.fillRect(x, y, checkerSize, checkerSize)
      }
      context.imageSmoothingEnabled = false
      const scale = Math.min(previewWidth / frame.width, previewHeight / frame.height)
      const width = Math.max(1, Math.round(frame.width * scale))
      const height = Math.max(1, Math.round(frame.height * scale))
      context.drawImage(bitmap, Math.floor((previewWidth - width) / 2), Math.floor((previewHeight - height) / 2), width, height)
      bitmap.close()
    }
    void render(snapshot)
    return () => { canceled = true }
  }, [previewVisuals, snapshot])

  return <div className="modal-backdrop" role="presentation" onPointerDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
    <ModalShell storageKey="timelapse-v2" defaultWidth={640} defaultHeight={525} fitContent={false} minWidth={420} minHeight={420} maxWidth={760} maxHeight={760} className="timelapse-modal" role="dialog" aria-modal="true" aria-labelledby="timelapse-title">
      <DialogHeader title={t('timelapse.title')} titleId="timelapse-title" closeLabel={t('common.close')} onClose={onClose} />
      <div className="modal-body timelapse-body component-scrollbar">
        <section className="timelapse-preview" aria-label={t('timelapse.preview')}>
          <div className="timelapse-preview-frame"><canvas ref={canvasRef} /></div>
          <div className="timelapse-preview-controls">
            <button type="button" className="icon-button" disabled={settings.snapshots.length < 2} title={previewPlaying ? t('timelapse.pausePreview') : t('timelapse.playPreview')} aria-label={previewPlaying ? t('timelapse.pausePreview') : t('timelapse.playPreview')} onClick={togglePreviewPlayback}>{previewPlaying ? <Pause size={15} /> : <Play size={15} />}</button>
            <input type="range" min={0} max={Math.max(0, settings.snapshots.length - 1)} value={Math.min(previewFrame, Math.max(0, settings.snapshots.length - 1))} disabled={settings.snapshots.length === 0} aria-label={t('timelapse.previewPosition')} onChange={(event) => { setPreviewPlaying(false); setPreviewFrame(Number(event.target.value)) }} />
            <output>{settings.snapshots.length === 0 ? '0 / 0' : `${previewFrame + 1} / ${settings.snapshots.length}`}</output>
          </div>
        </section>
        <PreferenceToggle className="timelapse-toggle" checked={settings.enabled} label={t('timelapse.recording')} onChange={(enabled) => onChange({ enabled })} />
        <div className="timelapse-config-grid">
          <FormField label={t('timelapse.quality')} hint={t('timelapse.qualityHint')}><ThemedSelect<TimelapseQuality> value={settings.quality} groups={[{ label: t('timelapse.quality'), options: qualityOptions }]} label={t('timelapse.quality')} onChange={(quality) => onChange({ quality })} /></FormField>
          <FormField label={t('timelapse.videoFormat')}><ThemedSelect<TimelapseVideoFormat> value={format} groups={[{ label: t('timelapse.videoFormat'), options: [{ value: 'mp4', label: 'MP4' }, { value: 'webm', label: 'WebM' }] }]} label={t('timelapse.videoFormat')} onChange={setFormat} /></FormField>
        </div>
        <div className="timelapse-export-grid">
          <FormField label={t('timelapse.exportMode')}><ThemedSelect<TimelapseExportMode> value={exportMode} groups={[{ label: t('timelapse.exportMode'), options: [{ value: 'duration', label: t('timelapse.modeDuration'), description: t('timelapse.modeDurationHint') }, { value: 'speed', label: t('timelapse.modeSpeed'), description: t('timelapse.modeSpeedHint') }] }]} label={t('timelapse.exportMode')} onChange={setExportMode} /></FormField>
          {exportMode === 'duration' ? <FormField label={t('timelapse.duration')}><NumberInput live min={1} max={3600} value={durationSeconds} suffix="s" onValueChange={setDurationSeconds} /></FormField> : <FormField className="timelapse-speed-control" label={t('timelapse.speed')} hint={t('timelapse.speedHint')}><NumberInput live min={1} max={64} value={settings.speed} suffix="x" onValueChange={(speed) => onChange({ speed })} /></FormField>}
        </div>
        <section className="timelapse-output-summary" aria-label={t('timelapse.outputSummary')}>
          <div><span>{t('timelapse.outputSize')}</span><strong>{outputWidth > 0 ? `${outputWidth} x ${outputHeight}` : '-'}</strong></div>
          <div><span>{t('timelapse.capturedFrames')}</span><strong>{settings.snapshots.length.toLocaleString()}</strong></div>
          <div><span>{t('timelapse.speed')}</span><strong>{effectiveSpeed.toFixed(1)}x</strong></div>
          <div><span>{t('timelapse.outputDuration')}</span><strong>{outputDuration}</strong></div>
        </section>
      </div>
      <footer className="timelapse-footer">
        <div className="timelapse-clear-actions">
          {!clearConfirm ? <button type="button" className="quiet-button timelapse-clear" disabled={settings.snapshots.length === 0} onClick={() => { setPreviewPlaying(false); setClearConfirm(true) }}><PixelUtilityIcon kind="clearRecords" />{t('timelapse.clear')}</button> : <><span className="timelapse-clear-confirm-label">{t('timelapse.clearConfirm')}</span><button type="button" className="quiet-button" onClick={() => setClearConfirm(false)}>{t('common.cancel')}</button><button type="button" className="danger-button" onClick={() => { setClearConfirm(false); setPreviewFrame(0); onClear() }}>{t('timelapse.confirmClear')}</button></>}
        </div>
        <div className="timelapse-footer-actions"><button className="quiet-button" onClick={onClose}>{t('common.close')}</button><button className="primary-button" disabled={settings.snapshots.length === 0} onClick={() => { void onExport(format, exportOptions) }}><FileVideo size={15} />{t('timelapse.exportVideo')}</button></div>
      </footer>
    </ModalShell>
  </div>
}
