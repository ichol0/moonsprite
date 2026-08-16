import type { SpriteDocument } from '@shared/types'
import { decodeAseprite } from './aseprite'
import { decodePng, exportDocumentImage, type SaveImageKind } from './png'
import { decodeProject, encodeProjectAsync, readProjectExpandedRasterBytes, registerProjectSaveBaseline } from './project-format'
import { browserRasterImageExtensions, decodeBrowserRasterImage } from './raster-image'
import { currentAppLocale } from './localization'
import { canPrepareInitialDocumentComposite, registerInitialDocumentComposite, registerPendingInitialDocumentComposite } from './initial-document-composite'
import { rehydrateRuntimeRasterDocument } from './runtime-raster'
import { exportAnimationGif } from './gif'
import { compositeDocument } from './document'
import { encodeBmp } from './bmp'

export type SaveImageDialogFormat = 'png' | 'jpeg' | 'webp' | 'ase' | 'aseprite'

export function fileNameFromPath(filePath: string): string {
  return filePath.split(/[\\/]/).pop() ?? filePath
}

export function fileExtension(filePath: string): string {
  return filePath.split('.').pop()?.toLowerCase() ?? ''
}

export function joinDirectoryPath(directory: string, fileName: string): string {
  const normalizedDirectory = directory.trim().replace(/[\\/]+$/, '')
  if (!normalizedDirectory) return fileName
  const separator = normalizedDirectory.includes('\\') ? '\\' : '/'
  return `${normalizedDirectory}${separator}${fileName}`
}

export function sanitizeFileStem(name: string, fallback: string): string {
  const stem = name
    .replace(/\.(moonsprite|aseprite|ase|png|jpe?g|webp|bmp|svg|gif)$/i, '')
    .replace(/[\\/:*?"<>|]/g, '_')
    .trim()
  return stem || fallback
}

export function saveImageExtension(format: SaveImageKind): 'png' | 'jpg' | 'webp' | 'svg' | 'ase' | 'aseprite' {
  if (format === 'jpeg') return 'jpg'
  if (format === 'ase') return 'ase'
  if (format === 'aseprite') return 'aseprite'
  if (format === 'svg') return 'svg'
  if (format === 'webp') return 'webp'
  return 'png'
}

export function saveImageDialogFormat(format: SaveImageKind): SaveImageDialogFormat {
  if (format === 'jpeg') return 'jpeg'
  if (format === 'webp') return 'webp'
  if (format === 'ase') return 'ase'
  if (format === 'aseprite') return 'aseprite'
  return 'png'
}

export function saveImageKindForPath(filePath: string): SaveImageKind | null {
  const suffix = fileExtension(filePath)
  if (suffix === 'png') return 'png-auto'
  if (suffix === 'jpg' || suffix === 'jpeg') return 'jpeg'
  if (suffix === 'webp') return 'webp'
  if (suffix === 'ase') return 'ase'
  if (suffix === 'aseprite') return 'aseprite'
  return null
}

export type SourceRasterImageKind = 'png-auto' | 'jpeg' | 'webp' | 'bmp' | 'gif'

export interface DirectSourceImageSaveTarget {
  filePath: string
  format: SourceRasterImageKind
}

export function sourceRasterImageKindForPath(filePath: string): SourceRasterImageKind | null {
  const suffix = fileExtension(filePath)
  if (suffix === 'png') return 'png-auto'
  if (suffix === 'jpg' || suffix === 'jpeg') return 'jpeg'
  if (suffix === 'webp') return 'webp'
  if (suffix === 'bmp') return 'bmp'
  if (suffix === 'gif') return 'gif'
  return null
}

function hasImageIncompatibleDocumentStructure(document: SpriteDocument): boolean {
  if (document.layers.length !== 1 || document.groups.length > 0) return true
  if ((document.customBrushes?.length ?? 0) > 0 || (document.slices?.length ?? 0) > 0 || (document.timelapse?.snapshots?.length ?? 0) > 0) return true
  const layer = document.layers[0]
  if (layer.kind === 'text' || layer.groupId || layer.clippingMask || layer.layerStyles || layer.background) return true
  const timeline = document.animation
  if (!timeline) return false
  if (timeline.frames.length !== 1 || timeline.cels.length !== 1 || (timeline.groupMasks?.length ?? 0) > 0) return true
  const frame = timeline.frames[0]
  const cel = timeline.cels[0]
  return cel.layerId !== layer.id || cel.frameId !== frame.id || Boolean(cel.linkedCelId || cel.text || cel.mask)
}

export function directSourceImageSaveTarget(document: SpriteDocument): DirectSourceImageSaveTarget | null {
  if (document.filePath || !document.sourceFilePath || hasImageIncompatibleDocumentStructure(document)) return null
  const format = sourceRasterImageKindForPath(document.sourceFilePath)
  return format ? { filePath: document.sourceFilePath, format } : null
}

export async function encodeDocumentForSourceImage(document: SpriteDocument, format: SourceRasterImageKind, onProgress?: (value: number) => void): Promise<Uint8Array> {
  let bytes: Uint8Array
  if (format === 'bmp') bytes = encodeBmp(compositeDocument(document), document.width, document.height)
  else if (format === 'gif') bytes = exportAnimationGif(document, { scalePercent: 100, frameStart: 1, frameEnd: 1, direction: 'forward' }).bytes
  else bytes = (await exportDocumentImage(document, 100, format)).bytes
  onProgress?.(1)
  return bytes
}

export function normalizeSaveDialogPath(filePath: string, format: SaveImageKind): string {
  const extension = saveImageExtension(format)
  const accepted = format === 'jpeg'
    ? /\.(jpg|jpeg)$/i.test(filePath)
    : format === 'ase' || format === 'aseprite'
      ? /\.(ase|aseprite)$/i.test(filePath)
      : filePath.toLowerCase().endsWith(`.${extension}`)
  if (accepted) return filePath
  return /\.(moonsprite|png|jpg|jpeg|webp|bmp|svg|gif|ase|aseprite)$/i.test(filePath)
    ? filePath.replace(/\.(moonsprite|png|jpg|jpeg|webp|bmp|svg|gif|ase|aseprite)$/i, `.${extension}`)
    : `${filePath}.${extension}`
}

export function decodeDocumentFile(data: Uint8Array, filePath: string): SpriteDocument {
  const suffix = fileExtension(filePath)
  const fileName = fileNameFromPath(filePath)
  const document = suffix === 'moonsprite'
    ? decodeProject(data)
    : suffix === 'ase' || suffix === 'aseprite'
      ? decodeAseprite(data, fileName.replace(/\.(aseprite|ase)$/i, ''))
      : decodePng(data, fileName.replace(/\.png$/i, ''))
  document.filePath = suffix === 'moonsprite' ? filePath : null
  document.sourceFilePath = filePath
  document.name = fileName
  return document
}

interface DecodeWorkerResponse {
  id: number
  document?: SpriteDocument
  initialComposite?: Uint8ClampedArray
  completed?: boolean
  error?: string
  progress?: number
}

let decodeRequestSequence = 0
const DIRECT_PROJECT_MAX_ARCHIVE_BYTES = 512 * 1024
const DIRECT_PROJECT_MAX_UNCOMPRESSED_BYTES = 4 * 1024 * 1024
const DIRECT_PROJECT_MAX_ENTRIES = 64
const DIRECT_ASEPRITE_MAX_BYTES = 512 * 1024
const DIRECT_ASEPRITE_MAX_FRAME_PIXELS = 1024 * 1024

interface ZipArchiveStats {
  entries: number
  uncompressedBytes: number
}

const zipArchiveStats = (data: Uint8Array): ZipArchiveStats | null => {
  if (data.byteLength < 22) return null
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  const minimumOffset = Math.max(0, data.byteLength - 65_557)
  let directoryOffset = -1
  let entries = 0
  for (let offset = data.byteLength - 22; offset >= minimumOffset; offset -= 1) {
    if (view.getUint32(offset, true) !== 0x06054b50) continue
    entries = view.getUint16(offset + 10, true)
    directoryOffset = view.getUint32(offset + 16, true)
    break
  }
  if (directoryOffset < 0 || entries === 0 || entries === 0xffff || directoryOffset >= data.byteLength) return null
  let offset = directoryOffset
  let uncompressedBytes = 0
  for (let index = 0; index < entries; index += 1) {
    if (offset + 46 > data.byteLength || view.getUint32(offset, true) !== 0x02014b50) return null
    const size = view.getUint32(offset + 24, true)
    if (size === 0xffffffff) return null
    uncompressedBytes += size
    if (!Number.isSafeInteger(uncompressedBytes)) return null
    const nameLength = view.getUint16(offset + 28, true)
    const extraLength = view.getUint16(offset + 30, true)
    const commentLength = view.getUint16(offset + 32, true)
    offset += 46 + nameLength + extraLength + commentLength
  }
  return { entries, uncompressedBytes }
}

export const shouldDecodeDocumentInWorker = (data: Uint8Array, filePath: string): boolean => {
  const suffix = fileExtension(filePath)
  if (suffix === 'moonsprite') {
    if (data.byteLength > DIRECT_PROJECT_MAX_ARCHIVE_BYTES) return true
    const expandedRasterBytes = readProjectExpandedRasterBytes(data)
    if (expandedRasterBytes === null || expandedRasterBytes > DIRECT_PROJECT_MAX_UNCOMPRESSED_BYTES) return true
    const stats = zipArchiveStats(data)
    return !stats || stats.entries > DIRECT_PROJECT_MAX_ENTRIES || stats.uncompressedBytes > DIRECT_PROJECT_MAX_UNCOMPRESSED_BYTES
  }
  if (suffix === 'ase' || suffix === 'aseprite') {
    if (data.byteLength > DIRECT_ASEPRITE_MAX_BYTES || data.byteLength < 12) return true
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
    const frames = view.getUint16(6, true)
    const width = view.getUint16(8, true)
    const height = view.getUint16(10, true)
    return frames * width * height > DIRECT_ASEPRITE_MAX_FRAME_PIXELS
  }
  return false
}

interface PendingDecodeRequest {
  resolve: (document: SpriteDocument) => void
  reject: (error: Error) => void
  onProgress?: (value: number) => void
  backgroundCompositeFor?: SpriteDocument
  initialCompositeFrameId?: string
}

let sharedDecodeWorker: Worker | null = null
const pendingDecodeRequests = new Map<number, PendingDecodeRequest>()

const resetDecodeWorker = (error?: Error): void => {
  sharedDecodeWorker?.terminate()
  sharedDecodeWorker = null
  if (!error) return
  for (const request of pendingDecodeRequests.values()) request.reject(error)
  pendingDecodeRequests.clear()
}

const ensureDecodeWorker = (): Worker => {
  if (sharedDecodeWorker) return sharedDecodeWorker
  const worker = new Worker(new URL('../workers/document-decode.worker.ts', import.meta.url), { type: 'module', name: 'moonsprite-document-decode' })
  worker.onmessage = (event: MessageEvent<DecodeWorkerResponse>) => {
    const request = pendingDecodeRequests.get(event.data.id)
    if (!request) return
    if (typeof event.data.progress === 'number') {
      request.onProgress?.(event.data.progress)
      return
    }
    pendingDecodeRequests.delete(event.data.id)
    if (event.data.document || (request.backgroundCompositeFor && event.data.completed)) {
      if (event.data.document) rehydrateRuntimeRasterDocument(event.data.document)
      const targetDocument = request.backgroundCompositeFor ?? event.data.document
      if (targetDocument && event.data.initialComposite) registerInitialDocumentComposite(targetDocument, event.data.initialComposite, request.initialCompositeFrameId ?? event.data.document?.animation?.activeFrameId)
      request.resolve(event.data.document ?? request.backgroundCompositeFor!)
    }
    else request.reject(new Error(event.data.error || 'Document decode failed'))
  }
  worker.onerror = (event) => resetDecodeWorker(new Error(event.message || 'Document decode worker failed'))
  sharedDecodeWorker = worker
  return worker
}

export const warmDocumentDecodeWorker = (): void => {
  if (typeof Worker !== 'undefined') ensureDecodeWorker()
}

const decodeDocumentFileInWorker = (data: Uint8Array, filePath: string, onProgress?: (value: number) => void, prepareInitialComposite = true, backgroundCompositeFor?: SpriteDocument, initialCompositeFrameId?: string): Promise<SpriteDocument> => new Promise((resolve, reject) => {
  const worker = ensureDecodeWorker()
  const id = ++decodeRequestSequence
  pendingDecodeRequests.set(id, { resolve, reject, onProgress, backgroundCompositeFor, initialCompositeFrameId })
  const transfer = data.buffer instanceof ArrayBuffer ? [data.buffer] : []
  try {
    worker.postMessage({ id, data, filePath, locale: currentAppLocale(), prepareInitialComposite, reportProgress: Boolean(onProgress), returnDocument: !backgroundCompositeFor }, transfer)
  } catch (error) {
    pendingDecodeRequests.delete(id)
    reject(error instanceof Error ? error : new Error(String(error)))
  }
})

const scheduleBackgroundInitialComposite = (document: SpriteDocument, source: Uint8Array, filePath: string): void => {
  if (!canPrepareInitialDocumentComposite(document.width, document.height)) return
  const frameId = document.animation?.activeFrameId
  const run = (): Promise<void> => decodeDocumentFileInWorker(source, filePath, undefined, true, document, frameId).then(() => undefined)
  const pending = new Promise<void>((resolve) => {
    const start = (): void => { void run().then(resolve, resolve) }
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
      if (typeof window.requestIdleCallback === 'function') window.requestIdleCallback(start)
      else window.setTimeout(start, 250)
    }))
  })
  registerPendingInitialDocumentComposite(document, pending, frameId)
}

export async function decodeDocumentFileAsync(data: Uint8Array, filePath: string, onProgress?: (value: number) => void): Promise<SpriteDocument> {
  const suffix = fileExtension(filePath)
  if ((suffix === 'moonsprite' || suffix === 'ase' || suffix === 'aseprite') && typeof Worker !== 'undefined' && shouldDecodeDocumentInWorker(data, filePath)) {
    const source = suffix === 'moonsprite' ? data.slice() : null
    const document = await decodeDocumentFileInWorker(data, filePath, onProgress, false)
    if (source) registerProjectSaveBaseline(document, filePath, source)
    if (source) scheduleBackgroundInitialComposite(document, source, filePath)
    return document
  }
  if (!browserRasterImageExtensions.includes(suffix as (typeof browserRasterImageExtensions)[number])) {
    const fileName = fileNameFromPath(filePath)
    const document = suffix === 'moonsprite'
      ? decodeProject(data, onProgress)
      : suffix === 'ase' || suffix === 'aseprite'
        ? decodeAseprite(data, fileName.replace(/\.(aseprite|ase)$/i, ''), onProgress)
        : decodePng(data, fileName.replace(/\.png$/i, ''))
    onProgress?.(1)
    document.filePath = suffix === 'moonsprite' ? filePath : null
    document.sourceFilePath = filePath
    document.name = fileName
    if (suffix === 'moonsprite') registerProjectSaveBaseline(document, filePath, data)
    return document
  }
  const fileName = fileNameFromPath(filePath)
  const mimeType = suffix === 'jpg' || suffix === 'jpeg' ? 'image/jpeg' : `image/${suffix}`
  const document = await decodeBrowserRasterImage(data, fileName.replace(/\.(jpe?g|webp|bmp|gif)$/i, ''), mimeType)
  onProgress?.(1)
  document.filePath = null
  document.sourceFilePath = filePath
  document.name = fileName
  return document
}

export async function encodeDocumentForPath(document: SpriteDocument, filePath: string, imageFormat: SaveImageKind | null, scalePercent: number, onProgress?: (value: number) => void): Promise<Uint8Array> {
  const outputFormat = imageFormat ?? saveImageKindForPath(filePath)
  return outputFormat
    ? (await exportDocumentImage(document, scalePercent, outputFormat)).bytes
    : encodeProjectAsync(document, { onProgress })
}
