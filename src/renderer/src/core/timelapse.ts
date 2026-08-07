import type { SpriteDocument, TimelapseQuality, TimelapseSettings, TimelapseSnapshot, TimelapseVideoFormat } from '@shared/types'
import { compositeDocument, createId } from './document'
import { encodePng } from './png'
import { normalizeTimelapseSettings } from './project-metadata'
import { translateCurrent as tr } from './localization'

export const MAX_TIMELAPSE_SNAPSHOTS = 600

export type TimelapseExportMode = 'duration' | 'speed'

export interface TimelapseExportOptions {
  mode: TimelapseExportMode
  durationSeconds: number
}

const qualityMaxDimension: Record<TimelapseQuality, number> = {
  low: 640,
  medium: 1280,
  high: 2400
}

interface TimelapseOutputGeometry {
  width: number
  height: number
  scale: number
  drawWidth: number
  drawHeight: number
}

const timelapseOutputGeometry = (settings: Pick<TimelapseSettings, 'quality' | 'snapshots'>): TimelapseOutputGeometry => {
  const reference = settings.snapshots.reduce(
    (largest, snapshot) => Math.max(snapshot.width, snapshot.height) > Math.max(largest.width, largest.height) ? snapshot : largest,
    { width: 1, height: 1 }
  )
  const scale = Math.max(1, Math.floor(qualityMaxDimension[settings.quality] / Math.max(reference.width, reference.height)))
  const drawWidth = reference.width * scale
  const drawHeight = reference.height * scale
  const evenCeil = (value: number): number => value + (value & 1)
  return { width: evenCeil(drawWidth), height: evenCeil(drawHeight), scale, drawWidth, drawHeight }
}

export const timelapseOutputScale = (settings: Pick<TimelapseSettings, 'quality' | 'snapshots'>): number => timelapseOutputGeometry(settings).scale

export const timelapseOutputDimensions = (settings: Pick<TimelapseSettings, 'quality' | 'snapshots'>): { width: number; height: number } => {
  const { width, height } = timelapseOutputGeometry(settings)
  return { width, height }
}

const scalePixels = (
  pixels: Uint8ClampedArray,
  sourceWidth: number,
  sourceHeight: number,
  maximumDimension: number
): { pixels: Uint8ClampedArray; width: number; height: number } => {
  const ratio = Math.min(1, maximumDimension / Math.max(sourceWidth, sourceHeight))
  const width = Math.max(1, Math.round(sourceWidth * ratio))
  const height = Math.max(1, Math.round(sourceHeight * ratio))
  if (width === sourceWidth && height === sourceHeight) return { pixels, width, height }
  const output = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y += 1) {
    const sourceY = Math.min(sourceHeight - 1, Math.floor(y * sourceHeight / height))
    for (let x = 0; x < width; x += 1) {
      const sourceX = Math.min(sourceWidth - 1, Math.floor(x * sourceWidth / width))
      const sourceOffset = (sourceY * sourceWidth + sourceX) * 4
      output.set(pixels.subarray(sourceOffset, sourceOffset + 4), (y * width + x) * 4)
    }
  }
  return { pixels: output, width, height }
}

const compactSnapshots = (snapshots: TimelapseSnapshot[]): TimelapseSnapshot[] => {
  if (snapshots.length <= MAX_TIMELAPSE_SNAPSHOTS) return snapshots
  const compacted = [snapshots[0]]
  for (let index = 2; index < snapshots.length; index += 2) {
    const current = snapshots[index]
    const skipped = snapshots[index - 1]
    compacted.push({ ...current, elapsedMs: current.elapsedMs + skipped.elapsedMs })
  }
  return compacted
}

export function captureTimelapseSnapshot(document: SpriteDocument, now = Date.now()): void {
  const settings = normalizeTimelapseSettings(document.timelapse, document.timelapse?.snapshots ?? [])
  document.timelapse = settings
  if (!settings.enabled) return
  const scaled = scalePixels(compositeDocument(document), document.width, document.height, qualityMaxDimension[settings.quality])
  const previous = settings.snapshots.at(-1)
  const snapshot: TimelapseSnapshot = {
    id: createId('timelapse'),
    capturedAt: now,
    elapsedMs: previous ? Math.max(1, now - previous.capturedAt) : 0,
    width: scaled.width,
    height: scaled.height,
    data: encodePng(scaled.pixels, scaled.width, scaled.height, true).bytes
  }
  settings.snapshots = compactSnapshots([...settings.snapshots, snapshot])
}

const wait = (duration: number): Promise<void> => new Promise((resolve) => window.setTimeout(resolve, duration))

export const timelapseFrameHoldMs = (snapshot: TimelapseSnapshot, settings: Pick<TimelapseSettings, 'fps' | 'speed'>): number => {
  const minimumHold = 1000 / settings.fps
  return Math.max(minimumHold, Math.min(1000, snapshot.elapsedMs / settings.speed || minimumHold))
}

export const timelapseSourceDurationMs = (settings: Pick<TimelapseSettings, 'fps' | 'snapshots'>): number => settings.snapshots.reduce(
  (total, snapshot) => total + (snapshot.elapsedMs > 0 ? snapshot.elapsedMs : 1000 / settings.fps),
  0
)

export const timelapseFrameDurations = (
  settings: Pick<TimelapseSettings, 'fps' | 'speed' | 'snapshots'>,
  options: TimelapseExportOptions
): number[] => {
  if (settings.snapshots.length === 0) return []
  const weights = settings.snapshots.map((snapshot) => snapshot.elapsedMs > 0 ? snapshot.elapsedMs : 1000 / settings.fps)
  const sourceDuration = weights.reduce((total, value) => total + value, 0)
  const outputDuration = options.mode === 'duration'
    ? Math.max(0.1, Math.min(3600, options.durationSeconds)) * 1000
    : sourceDuration / Math.max(1, Math.min(64, settings.speed))
  return weights.map((weight) => outputDuration * weight / sourceDuration)
}

const VIDEO_MIME_TYPES: Record<TimelapseVideoFormat, readonly string[]> = {
  mp4: ['video/mp4;codecs=avc1.42E01E', 'video/mp4'],
  webm: ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm']
}

export const resolveTimelapseMimeType = (
  format: TimelapseVideoFormat,
  isSupported: (mimeType: string) => boolean
): string | null => VIDEO_MIME_TYPES[format].find(isSupported) ?? null

const decodeSnapshot = async (snapshot: TimelapseSnapshot): Promise<ImageBitmap> => {
  const buffer = snapshot.data.buffer.slice(snapshot.data.byteOffset, snapshot.data.byteOffset + snapshot.data.byteLength) as ArrayBuffer
  const blob = new Blob([buffer], { type: 'image/png' })
  return createImageBitmap(blob)
}

export async function encodeTimelapseVideo(settings: TimelapseSettings, format: TimelapseVideoFormat, options: TimelapseExportOptions = { mode: 'duration', durationSeconds: 1 }, onProgress?: (value: number) => void): Promise<Uint8Array> {
  if (settings.snapshots.length === 0) throw new Error(tr('timelapse.noFrames'))
  if (typeof MediaRecorder === 'undefined' || typeof HTMLCanvasElement.prototype.captureStream !== 'function' || typeof createImageBitmap !== 'function') {
    throw new Error(tr('timelapse.unsupported'))
  }
  const geometry = timelapseOutputGeometry(settings)
  const { width, height } = geometry
  const canvas = globalThis.document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) throw new Error(tr('timelapse.canvasUnavailable'))
  context.imageSmoothingEnabled = false
  const stream = canvas.captureStream(settings.fps)
  const mimeType = resolveTimelapseMimeType(format, (candidate) => MediaRecorder.isTypeSupported(candidate))
  if (!mimeType) throw new Error(tr('timelapse.formatUnsupported', { format: format.toUpperCase() }))
  const bitrate = settings.quality === 'high' ? 8_000_000 : settings.quality === 'low' ? 1_500_000 : 4_000_000
  const chunks: Blob[] = []
  const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: bitrate })
  recorder.ondataavailable = (event) => { if (event.data.size > 0) chunks.push(event.data) }
  const stopped = new Promise<void>((resolve, reject) => {
    recorder.onstop = () => resolve()
    recorder.onerror = () => reject(new Error(tr('timelapse.exportFailed')))
  })
  recorder.start()
  try {
    const frameDurations = timelapseFrameDurations(settings, options)
    for (const [index, snapshot] of settings.snapshots.entries()) {
      const bitmap = await decodeSnapshot(snapshot)
      context.clearRect(0, 0, width, height)
      const scale = Math.min(geometry.drawWidth / snapshot.width, geometry.drawHeight / snapshot.height)
      const drawWidth = Math.max(1, Math.round(snapshot.width * scale))
      const drawHeight = Math.max(1, Math.round(snapshot.height * scale))
      context.drawImage(bitmap, Math.floor((width - drawWidth) / 2), Math.floor((height - drawHeight) / 2), drawWidth, drawHeight)
      bitmap.close()
      onProgress?.((index + 1) / settings.snapshots.length * 100)
      await wait(frameDurations[index])
    }
  } finally {
    recorder.stop()
    stream.getTracks().forEach((track) => track.stop())
  }
  await stopped
  return new Uint8Array(await new Blob(chunks, { type: mimeType }).arrayBuffer())
}
