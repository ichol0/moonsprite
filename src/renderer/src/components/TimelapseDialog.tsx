import { useEffect, useMemo, useRef, useState } from 'react'
import { FileVideo, Pause, Play, Trash2, X } from 'lucide-react'
import type { TimelapseQuality, TimelapseSettings, TimelapseSnapshot, TimelapseVideoFormat } from '@shared/types'
import { timelapseFrameDurations, timelapseOutputDimensions, timelapseOutputScale, timelapseSourceDurationMs, type TimelapseExportMode, type TimelapseExportOptions } from '@/core/timelapse'
import { ModalShell } from './ModalShell'
import { NumberInput } from './NumberInput'
import { ThemedSelect } from './ThemedSelect'
import { useI18n } from './I18nProvider'

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
  const [previewPlaying, setPreviewPlaying] = useState(false)
  const [previewFrame, setPreviewFrame] = useState(0)
  const [format, setFormat] = useState<TimelapseVideoFormat>('mp4')
  const [exportMode, setExportMode] = useState<TimelapseExportMode>('duration')
  const [clearConfirm, setClearConfirm] = useState(false)
  const [durationSeconds, setDurationSeconds] = useState(() => Math.max(1, Math.round(timelapseSourceDurationMs(settings) / 1000 / Math.max(1, settings.speed))))
  const snapshot = settings.snapshots[Math.min(previewFrame, Math.max(0, settings.snapshots.length - 1))]
  const exportOptions = useMemo<TimelapseExportOptions>(() => ({ mode: exportMode, durationSeconds }), [durationSeconds, exportMode])
  const frameDurations = timelapseFrameDurations(settings, exportOptions)
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

  useEffect(() => {
    if (previewFrame < settings.snapshots.length) return
    setPreviewFrame(Math.max(0, settings.snapshots.length - 1))
  }, [previewFrame, settings.snapshots.length])

  useEffect(() => {
    if (!previewPlaying || settings.snapshots.length < 2) return
    const timer = window.setTimeout(() => {
      setPreviewFrame((frame) => (frame + 1) % settings.snapshots.length)
    }, frameDurations[previewFrame] ?? 1000 / settings.fps)
    return () => window.clearTimeout(timer)
  }, [frameDurations, previewFrame, previewPlaying, settings.fps, settings.snapshots.length])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const renderEmpty = (): void => {
      canvas.width = 480
      canvas.height = 270
      const context = canvas.getContext('2d')
      if (!context) return
      context.fillStyle = '#171a21'
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
        context.fillStyle = ((x / checkerSize + y / checkerSize) & 1) === 0 ? '#aeb3ba' : '#737983'
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
  }, [snapshot])

  return <div className="modal-backdrop" role="presentation" onPointerDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
    <ModalShell storageKey="timelapse-v2" defaultWidth={640} defaultHeight={525} fitContent={false} minWidth={420} minHeight={420} maxWidth={760} maxHeight={760} className="timelapse-modal" role="dialog" aria-modal="true" aria-labelledby="timelapse-title">
      <header><div><h2 id="timelapse-title">{t('timelapse.title')}</h2></div><button className="icon-button" aria-label={t('common.close')} onClick={onClose}><X size={16} /></button></header>
      <div className="modal-body timelapse-body component-scrollbar">
        <section className="timelapse-preview" aria-label={t('timelapse.preview')}>
          <div className="timelapse-preview-frame"><canvas ref={canvasRef} /></div>
          <div className="timelapse-preview-controls">
            <button type="button" className="icon-button" disabled={settings.snapshots.length < 2} title={previewPlaying ? t('timelapse.pausePreview') : t('timelapse.playPreview')} aria-label={previewPlaying ? t('timelapse.pausePreview') : t('timelapse.playPreview')} onClick={() => setPreviewPlaying((playing) => !playing)}>{previewPlaying ? <Pause size={15} /> : <Play size={15} />}</button>
            <input type="range" min={0} max={Math.max(0, settings.snapshots.length - 1)} value={Math.min(previewFrame, Math.max(0, settings.snapshots.length - 1))} disabled={settings.snapshots.length === 0} aria-label={t('timelapse.previewPosition')} onChange={(event) => { setPreviewPlaying(false); setPreviewFrame(Number(event.target.value)) }} />
            <output>{settings.snapshots.length === 0 ? '0 / 0' : `${previewFrame + 1} / ${settings.snapshots.length}`}</output>
          </div>
        </section>
        <label className="timelapse-toggle"><span>{t('timelapse.recording')}</span><input type="checkbox" checked={settings.enabled} onChange={(event) => onChange({ enabled: event.target.checked })} /></label>
        <div className="timelapse-config-grid">
          <label>{t('timelapse.quality')}<ThemedSelect<TimelapseQuality> value={settings.quality} groups={[{ label: t('timelapse.quality'), options: qualityOptions }]} label={t('timelapse.quality')} onChange={(quality) => onChange({ quality })} /><small>{t('timelapse.qualityHint')}</small></label>
          <label>{t('timelapse.videoFormat')}<ThemedSelect<TimelapseVideoFormat> value={format} groups={[{ label: t('timelapse.videoFormat'), options: [{ value: 'mp4', label: 'MP4' }, { value: 'webm', label: 'WebM' }] }]} label={t('timelapse.videoFormat')} onChange={setFormat} /></label>
        </div>
        <div className="timelapse-export-grid">
          <label>{t('timelapse.exportMode')}<ThemedSelect<TimelapseExportMode> value={exportMode} groups={[{ label: t('timelapse.exportMode'), options: [{ value: 'duration', label: t('timelapse.modeDuration'), description: t('timelapse.modeDurationHint') }, { value: 'speed', label: t('timelapse.modeSpeed'), description: t('timelapse.modeSpeedHint') }] }]} label={t('timelapse.exportMode')} onChange={setExportMode} /></label>
          {exportMode === 'duration' ? <label>{t('timelapse.duration')}<NumberInput live min={1} max={3600} value={durationSeconds} suffix="s" onValueChange={setDurationSeconds} /></label> : <label className="timelapse-speed-control"><span>{t('timelapse.speed')}</span><NumberInput live min={1} max={64} value={settings.speed} suffix="x" onValueChange={(speed) => onChange({ speed })} /><small>{t('timelapse.speedHint')}</small></label>}
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
          {!clearConfirm ? <button type="button" className="quiet-button timelapse-clear" disabled={settings.snapshots.length === 0} onClick={() => { setPreviewPlaying(false); setClearConfirm(true) }}><Trash2 size={15} />{t('timelapse.clear')}</button> : <><span className="timelapse-clear-confirm-label">{t('timelapse.clearConfirm')}</span><button type="button" className="quiet-button" onClick={() => setClearConfirm(false)}>{t('common.cancel')}</button><button type="button" className="danger-button" onClick={() => { setClearConfirm(false); setPreviewFrame(0); onClear() }}>{t('timelapse.confirmClear')}</button></>}
        </div>
        <div className="timelapse-footer-actions"><button className="quiet-button" onClick={onClose}>{t('common.close')}</button><button className="primary-button" disabled={settings.snapshots.length === 0} onClick={() => { void onExport(format, exportOptions) }}><FileVideo size={15} />{t('timelapse.exportVideo')}</button></div>
      </footer>
    </ModalShell>
  </div>
}
