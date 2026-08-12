import type { SelectionRect, SpriteDocument, TimelapseQuality, TimelapseSettings, TimelapseSnapshot, TimelapseVideoFormat } from '@shared/types'
import { compositeRegion, createCompositePointSampler, createId, createNormalCompositePointSampler, DocumentCompositeCache } from './document'
import { encodePng } from './png'
import { normalizeTimelapseSettings } from './project-metadata'
import { translateCurrent as tr } from './localization'

export const MAX_TIMELAPSE_SNAPSHOTS = 600

export type TimelapseExportMode = 'duration' | 'speed'

export interface TimelapseExportOptions {
  mode: TimelapseExportMode
  durationSeconds: number
}

export interface TimelapseCaptureInvalidation {
  kind: 'full' | 'region'
  fromRevision: number
  revision: number
  rect?: SelectionRect
}

export interface TimelapseCaptureCache {
  sourceWidth: number
  sourceHeight: number
  width: number
  height: number
  frameId: string | null
  revision: number
  pixels: Uint8ClampedArray | null
  composite: DocumentCompositeCache
}

export interface TimelapseCaptureOptions {
  cache?: TimelapseCaptureCache
  contentRevision?: number
  contentInvalidation?: TimelapseCaptureInvalidation | null
  shouldCommit?: () => boolean
}

export interface PreparedTimelapseSnapshot {
  capturedAt: number
  width: number
  height: number
  pixels: Uint8ClampedArray
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

export const createTimelapseCaptureCache = (): TimelapseCaptureCache => ({
  sourceWidth: 0,
  sourceHeight: 0,
  width: 0,
  height: 0,
  frameId: null,
  revision: Number.NaN,
  pixels: null,
  composite: new DocumentCompositeCache()
})

const captureDimensions = (sourceWidth: number, sourceHeight: number, maximumDimension: number): { width: number; height: number } => {
  const ratio = Math.min(1, maximumDimension / Math.max(sourceWidth, sourceHeight))
  const width = Math.max(1, Math.round(sourceWidth * ratio))
  const height = Math.max(1, Math.round(sourceHeight * ratio))
  return { width, height }
}

const compactSnapshots = (snapshots: TimelapseSnapshot[]): TimelapseSnapshot[] => {
  if (snapshots.length <= MAX_TIMELAPSE_SNAPSHOTS) return snapshots
  return snapshots.slice(snapshots.length - MAX_TIMELAPSE_SNAPSHOTS)
}

const targetRangeForSourceRange = (start: number, end: number, sourceSize: number, targetSize: number): { start: number; end: number } => ({
  start: Math.max(0, Math.min(targetSize, Math.ceil(start * targetSize / sourceSize))),
  end: Math.max(0, Math.min(targetSize, Math.ceil(end * targetSize / sourceSize)))
})

const renderScaledRows = (
  document: SpriteDocument,
  output: Uint8ClampedArray,
  outputWidth: number,
  outputHeight: number,
  fromY: number,
  toY: number,
  fromX: number,
  toX: number,
  composite: DocumentCompositeCache,
  revision: number
): void => {
  if (toX <= fromX || toY <= fromY) return
  const sourceLeft = Math.floor(fromX * document.width / outputWidth)
  const sourceRight = Math.min(document.width, Math.floor((toX - 1) * document.width / outputWidth) + 1)
  const sourceTop = Math.floor(fromY * document.height / outputHeight)
  const sourceBottom = Math.min(document.height, Math.floor((toY - 1) * document.height / outputHeight) + 1)
  const sourceWidth = sourceRight - sourceLeft
  const source = compositeRegion(document, sourceLeft, sourceTop, sourceWidth, sourceBottom - sourceTop, composite, revision)
  for (let targetY = fromY; targetY < toY; targetY += 1) {
    const sourceY = Math.min(document.height - 1, Math.floor(targetY * document.height / outputHeight)) - sourceTop
    for (let targetX = fromX; targetX < toX; targetX += 1) {
      const sourceX = Math.min(document.width - 1, Math.floor(targetX * document.width / outputWidth)) - sourceLeft
      const sourceOffset = (sourceY * sourceWidth + sourceX) * 4
      const targetOffset = (targetY * outputWidth + targetX) * 4
      output[targetOffset] = source[sourceOffset]
      output[targetOffset + 1] = source[sourceOffset + 1]
      output[targetOffset + 2] = source[sourceOffset + 2]
      output[targetOffset + 3] = source[sourceOffset + 3]
    }
  }
}

const yieldToMainThread = (): Promise<void> => new Promise((resolve) => globalThis.setTimeout(resolve, 0))

const renderScaledRowsAsync = async (
  document: SpriteDocument,
  output: Uint8ClampedArray,
  outputWidth: number,
  outputHeight: number,
  fromY: number,
  toY: number,
  fromX: number,
  toX: number,
  composite: DocumentCompositeCache,
  revision: number,
  shouldContinue: () => boolean
): Promise<boolean> => {
  const sample = createNormalCompositePointSampler(document) ?? createCompositePointSampler(document)
  for (let targetY = fromY; targetY < toY; targetY += 1) {
    if (!shouldContinue()) return false
    const sourceY = Math.min(document.height - 1, Math.floor(targetY * document.height / outputHeight))
    for (let targetX = fromX; targetX < toX; targetX += 1) {
      const sourceX = Math.min(document.width - 1, Math.floor(targetX * document.width / outputWidth))
      const color = sample(sourceX, sourceY)
      const targetOffset = (targetY * outputWidth + targetX) * 4
      output[targetOffset] = color.r
      output[targetOffset + 1] = color.g
      output[targetOffset + 2] = color.b
      output[targetOffset + 3] = color.a
    }
    if ((targetY - fromY + 1) % 4 === 0) await yieldToMainThread()
  }
  return shouldContinue()
}

const compositeTimelapsePixels = (document: SpriteDocument, maximumDimension: number, options: TimelapseCaptureOptions): { pixels: Uint8ClampedArray; width: number; height: number } => {
  const cache = options.cache
  const revision = options.contentRevision ?? Number.NaN
  const frameId = document.animation?.activeFrameId ?? null
  const { width, height } = captureDimensions(document.width, document.height, maximumDimension)
  if (!cache
    || !cache.pixels
    || cache.sourceWidth !== document.width
    || cache.sourceHeight !== document.height
    || cache.width !== width
    || cache.height !== height
    || cache.frameId !== frameId
    || !Number.isFinite(revision)) {
    const pixels = new Uint8ClampedArray(width * height * 4)
    const composite = cache?.composite ?? new DocumentCompositeCache()
    renderScaledRows(document, pixels, width, height, 0, height, 0, width, composite, revision)
    if (cache) {
      cache.sourceWidth = document.width
      cache.sourceHeight = document.height
      cache.width = width
      cache.height = height
      cache.frameId = frameId
      cache.revision = revision
      cache.pixels = pixels
    }
    return { pixels, width, height }
  }
  const cachedPixels = cache.pixels
  if (cache.revision === revision) return { pixels: cachedPixels, width, height }

  const invalidation = options.contentInvalidation
  const patchRect = invalidation?.kind === 'region'
    && invalidation.fromRevision === cache.revision
    && invalidation.revision === revision
    ? invalidation.rect
    : undefined
  if (!patchRect) {
    renderScaledRows(document, cachedPixels, width, height, 0, height, 0, width, cache.composite, revision)
  } else {
    const left = Math.max(0, Math.floor(patchRect.x))
    const top = Math.max(0, Math.floor(patchRect.y))
    const right = Math.min(document.width, Math.ceil(patchRect.x + patchRect.width))
    const bottom = Math.min(document.height, Math.ceil(patchRect.y + patchRect.height))
    if (right > left && bottom > top) {
      const targetX = targetRangeForSourceRange(left, right, document.width, width)
      const targetY = targetRangeForSourceRange(top, bottom, document.height, height)
      renderScaledRows(document, cachedPixels, width, height, targetY.start, targetY.end, targetX.start, targetX.end, cache.composite, revision)
    }
  }
  cache.revision = revision
  return { pixels: cachedPixels, width, height }
}

const compositeTimelapsePixelsAsync = async (document: SpriteDocument, maximumDimension: number, options: TimelapseCaptureOptions): Promise<{ pixels: Uint8ClampedArray; width: number; height: number } | null> => {
  const cache = options.cache
  const revision = options.contentRevision ?? Number.NaN
  const frameId = document.animation?.activeFrameId ?? null
  const { width, height } = captureDimensions(document.width, document.height, maximumDimension)
  const shouldContinue = options.shouldCommit ?? (() => true)
  if (!cache
    || !cache.pixels
    || cache.sourceWidth !== document.width
    || cache.sourceHeight !== document.height
    || cache.width !== width
    || cache.height !== height
    || cache.frameId !== frameId
    || !Number.isFinite(revision)) {
    const pixels = new Uint8ClampedArray(width * height * 4)
    const composite = cache?.composite ?? new DocumentCompositeCache()
    if (!await renderScaledRowsAsync(document, pixels, width, height, 0, height, 0, width, composite, revision, shouldContinue)) return null
    if (cache) {
      cache.sourceWidth = document.width
      cache.sourceHeight = document.height
      cache.width = width
      cache.height = height
      cache.frameId = frameId
      cache.revision = revision
      cache.pixels = pixels
    }
    return { pixels, width, height }
  }
  const cachedPixels = cache.pixels
  if (cache.revision === revision) return { pixels: cachedPixels, width, height }

  const invalidation = options.contentInvalidation
  const patchRect = invalidation?.kind === 'region'
    && invalidation.fromRevision === cache.revision
    && invalidation.revision === revision
    ? invalidation.rect
    : undefined
  let completed: boolean
  if (!patchRect) completed = await renderScaledRowsAsync(document, cachedPixels, width, height, 0, height, 0, width, cache.composite, revision, shouldContinue)
  else {
    const left = Math.max(0, Math.floor(patchRect.x))
    const top = Math.max(0, Math.floor(patchRect.y))
    const right = Math.min(document.width, Math.ceil(patchRect.x + patchRect.width))
    const bottom = Math.min(document.height, Math.ceil(patchRect.y + patchRect.height))
    if (right > left && bottom > top) {
      const targetX = targetRangeForSourceRange(left, right, document.width, width)
      const targetY = targetRangeForSourceRange(top, bottom, document.height, height)
      completed = await renderScaledRowsAsync(document, cachedPixels, width, height, targetY.start, targetY.end, targetX.start, targetX.end, cache.composite, revision, shouldContinue)
    } else completed = shouldContinue()
  }
  if (!completed) {
    cache.revision = Number.NaN
    cache.pixels = null
    return null
  }
  cache.revision = revision
  return { pixels: cachedPixels, width, height }
}

const appendTimelapseSnapshot = (settings: TimelapseSettings, now: number, width: number, height: number, data: Uint8Array): void => {
  const previous = settings.snapshots.at(-1)
  const snapshot: TimelapseSnapshot = {
    id: createId('timelapse'),
    capturedAt: now,
    elapsedMs: previous ? 1 : 0,
    width,
    height,
    data
  }
  settings.snapshots = compactSnapshots([...settings.snapshots, snapshot])
}

interface TimelapseEncodeWorkerResponse { id: number; data?: Uint8Array; error?: string }
let timelapseEncodeSequence = 0

const encodeTimelapsePngAsync = (pixels: Uint8ClampedArray, width: number, height: number): Promise<Uint8Array> => {
  if (typeof Worker === 'undefined') return Promise.resolve(encodePng(pixels, width, height, true).bytes)
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('../workers/timelapse-encode.worker.ts', import.meta.url), { type: 'module', name: 'moonsprite-timelapse-encode' })
    const id = ++timelapseEncodeSequence
    const transferredPixels = pixels.slice()
    const finish = (): void => worker.terminate()
    worker.onmessage = (event: MessageEvent<TimelapseEncodeWorkerResponse>) => {
      if (event.data.id !== id) return
      finish()
      if (event.data.data) resolve(event.data.data)
      else reject(new Error(event.data.error || 'Timelapse encode failed'))
    }
    worker.onerror = (event) => {
      finish()
      reject(new Error(event.message || 'Timelapse encode worker failed'))
    }
    worker.postMessage({ id, pixels: transferredPixels, width, height }, [transferredPixels.buffer])
  })
}

const prepareTimelapseCapture = (document: SpriteDocument, options: TimelapseCaptureOptions): { settings: TimelapseSettings; pixels: Uint8ClampedArray; width: number; height: number } | null => {
  const settings = normalizeTimelapseSettings(document.timelapse, document.timelapse?.snapshots ?? [])
  document.timelapse = settings
  if (!settings.enabled) return null
  return { settings, ...compositeTimelapsePixels(document, qualityMaxDimension[settings.quality], options) }
}

export function prepareTimelapseSnapshot(document: SpriteDocument, now = Date.now(), options: TimelapseCaptureOptions = {}): PreparedTimelapseSnapshot | null {
  const capture = prepareTimelapseCapture(document, options)
  return capture ? { capturedAt: now, width: capture.width, height: capture.height, pixels: capture.pixels.slice() } : null
}

export async function commitPreparedTimelapseSnapshot(document: SpriteDocument, snapshot: PreparedTimelapseSnapshot, shouldCommit: () => boolean = () => true): Promise<void> {
  const data = await encodeTimelapsePngAsync(snapshot.pixels, snapshot.width, snapshot.height)
  if (!shouldCommit()) return
  const settings = normalizeTimelapseSettings(document.timelapse, document.timelapse?.snapshots ?? [])
  document.timelapse = settings
  if (!settings.enabled) return
  appendTimelapseSnapshot(settings, snapshot.capturedAt, snapshot.width, snapshot.height, data)
}

export function captureTimelapseSnapshot(document: SpriteDocument, now = Date.now(), options: TimelapseCaptureOptions = {}): void {
  const capture = prepareTimelapseCapture(document, options)
  if (!capture) return
  appendTimelapseSnapshot(capture.settings, now, capture.width, capture.height, encodePng(capture.pixels, capture.width, capture.height, true).bytes)
}

export async function captureTimelapseSnapshotAsync(document: SpriteDocument, now = Date.now(), options: TimelapseCaptureOptions = {}): Promise<void> {
  const settings = normalizeTimelapseSettings(document.timelapse, document.timelapse?.snapshots ?? [])
  document.timelapse = settings
  if (!settings.enabled) return
  const capture = await compositeTimelapsePixelsAsync(document, qualityMaxDimension[settings.quality], options)
  if (!capture || options.shouldCommit?.() === false) return
  const data = await encodeTimelapsePngAsync(capture.pixels, capture.width, capture.height)
  if (options.shouldCommit?.() === false) return
  appendTimelapseSnapshot(settings, now, capture.width, capture.height, data)
}

const wait = (duration: number): Promise<void> => new Promise((resolve) => window.setTimeout(resolve, duration))

export const timelapseFrameHoldMs = (_snapshot: TimelapseSnapshot, settings: Pick<TimelapseSettings, 'fps' | 'speed'>): number => 1000 / settings.fps / Math.max(1, settings.speed)

export const timelapseSourceDurationMs = (settings: Pick<TimelapseSettings, 'fps' | 'snapshots'>): number => settings.snapshots.length * 1000 / settings.fps

export const timelapseFrameDurations = (
  settings: Pick<TimelapseSettings, 'fps' | 'speed' | 'snapshots'>,
  options: TimelapseExportOptions
): number[] => {
  if (settings.snapshots.length === 0) return []
  const sourceDuration = timelapseSourceDurationMs(settings)
  const outputDuration = options.mode === 'duration'
    ? Math.max(0.1, Math.min(3600, options.durationSeconds)) * 1000
    : sourceDuration / Math.max(1, Math.min(64, settings.speed))
  const frameDuration = outputDuration / settings.snapshots.length
  return settings.snapshots.map(() => frameDuration)
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
