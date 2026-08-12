import type { MoonSpriteApi, SpriteDocument, TimelapseVideoFormat } from '@shared/types'
import { checkResourceLimit, checkTypedArrayLimit } from '@/core/resource-policy'
import { decodeDocumentFileAsync, encodeDocumentForPath, joinDirectoryPath, normalizeSaveDialogPath, sanitizeFileStem, saveImageDialogFormat, saveImageExtension, saveImageKindForPath } from '@/core/document-files'
import { exportDocumentImage, type ImageExportKind, type SaveImageKind } from '@/core/png'
import { loadEditorPreferences } from '@/core/file-preferences'
import { translate } from '@/core/localization'
import { exportAnimationGif, type GifDirection } from '@/core/gif'
import { encodeTimelapseVideo, type TimelapseExportOptions } from '@/core/timelapse'
import { normalizeTimelapseSettings } from '@/core/project-metadata'
import { RECENT_EXPORTS_CHANGED_EVENT, recordRecentExportPath } from '@/core/export-settings'
import { acceptProjectSaveBaseline, clearProjectSaveBaseline, encodeProjectAsync, encodeProjectSaveAsync } from '@/core/project-format'

export interface ExportOptions {
  name: string
  format: ImageExportKind
  scalePercent: number
  directory?: string
  gifFrameRange?: 'all' | 'range'
  gifFrameStart?: number
  gifFrameEnd?: number
  gifDirection?: GifDirection
}

function rememberExportPath(filePath: string): void {
  if (!recordRecentExportPath(filePath)) return
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(RECENT_EXPORTS_CHANGED_EVENT))
}

export interface SaveAsOptions {
  name: string
  format: 'moonsprite' | SaveImageKind
  scalePercent: number
}

interface SaveDocumentRequest {
  api: MoonSpriteApi
  documentId: string
  getDocument: () => { document: SpriteDocument; revision: number } | null
  saveAs: boolean
  options?: SaveAsOptions
  preferredImageFormat: SaveImageKind | null
  lifecycle?: FileOperationLifecycle
}

export interface SaveDocumentResult {
  filePath: string
  revision: number
}

export interface FileOperationLifecycle {
  onEncodeStart?: () => void
  onEncodeProgress?: (value: number) => void
  onWriteStart?: () => void
}

export interface OpenDocumentLifecycle {
  onReadStart?: () => void
  onReadProgress?: (bytesRead: number, totalBytes: number) => void
  onDecodeStart?: () => void
  onDecodeProgress?: (value: number) => void
}

const saveOperations = new Map<string, Promise<SaveDocumentResult | null>>()

export function saveDocumentFile(request: SaveDocumentRequest): Promise<SaveDocumentResult | null> {
  const pending = saveOperations.get(request.documentId)
  const operation = (async (): Promise<SaveDocumentResult | null> => {
    if (pending) {
      try { await pending } catch { /* A failed earlier save must not block the queued retry. */ }
    }
    const initial = request.getDocument()
    if (!initial) return null
    const existingFormat = initial.document.filePath
      ? (/\.moonsprite$/i.test(initial.document.filePath) ? 'moonsprite' as const : saveImageKindForPath(initial.document.filePath))
      : null
    const selectedFormat: 'moonsprite' | SaveImageKind = request.options?.format ?? existingFormat ?? request.preferredImageFormat ?? 'moonsprite'
    const imageFormat = selectedFormat === 'moonsprite' ? null : selectedFormat
    const fallbackName = sanitizeFileStem(initial.document.name, 'MoonSprite-export')
    const requestedName = sanitizeFileStem(request.options?.name ?? fallbackName, fallbackName)
    const saveDirectory = loadEditorPreferences().saveDirectory
    let filePath = initial.document.filePath
    if ((!filePath || request.saveAs) && imageFormat) {
      const extension = saveImageExtension(imageFormat)
      const result = await request.api.saveProject(joinDirectoryPath(saveDirectory, `${requestedName}.${extension}`), saveImageDialogFormat(imageFormat))
      if (result.canceled || !result.filePath || !request.getDocument()) return null
      filePath = normalizeSaveDialogPath(result.filePath, imageFormat)
    } else if (!filePath || request.saveAs) {
      const result = await request.api.saveProject(joinDirectoryPath(saveDirectory, `${requestedName}.moonsprite`))
      if (result.canceled || !result.filePath || !request.getDocument()) return null
      filePath = result.filePath.endsWith('.moonsprite') ? result.filePath : `${result.filePath}.moonsprite`
    }
    const source = request.getDocument()
    if (!source || !filePath) return null
    request.lifecycle?.onEncodeStart?.()
    if (!imageFormat) {
      const encoded = await encodeProjectSaveAsync(source.document, { onProgress: request.lifecycle?.onEncodeProgress })
      request.lifecycle?.onWriteStart?.()
      let acceptBaseline = true
      if (encoded.sourcePath && encoded.reusableEntries.length > 0) {
        try {
          await request.api.writeProjectIncremental(filePath, encoded.sourcePath, encoded.data)
        } catch {
          await request.api.writeBinaryAtomic(filePath, await encodeProjectAsync(source.document))
          clearProjectSaveBaseline(source.document)
          acceptBaseline = false
        }
      } else await request.api.writeBinaryAtomic(filePath, encoded.data)
      if (acceptBaseline) acceptProjectSaveBaseline(source.document, filePath, encoded)
    } else {
      const data = await encodeDocumentForPath(source.document, filePath, imageFormat, request.options?.scalePercent ?? 100, request.lifecycle?.onEncodeProgress)
      request.lifecycle?.onWriteStart?.()
      await request.api.writeBinaryAtomic(filePath, data)
    }
    return { filePath, revision: source.revision }
  })()
  saveOperations.set(request.documentId, operation)
  void operation.finally(() => {
    if (saveOperations.get(request.documentId) === operation) saveOperations.delete(request.documentId)
  }).catch(() => undefined)
  return operation
}

export async function exportDocumentFile(api: MoonSpriteApi, document: SpriteDocument, options?: ExportOptions, lifecycle?: FileOperationLifecycle): Promise<string | null> {
  const scalePercent = Math.max(1, Math.min(6400, Math.round(options?.scalePercent ?? 100)))
  const exportWidth = Math.max(1, Math.round(document.width * scalePercent / 100))
  const exportHeight = Math.max(1, Math.round(document.height * scalePercent / 100))
  if (!Number.isSafeInteger(exportWidth) || !Number.isSafeInteger(exportHeight)) throw new Error(translate(loadEditorPreferences().language, 'file.export.safeRange'))
  const resources = await api.getResourceInfo()
  const check = checkResourceLimit(exportWidth, exportHeight, 1, 'rgba', resources)
  if (!check.allowed) throw new Error(check.reason)
  const fallbackName = sanitizeFileStem(document.name, 'MoonSprite-export')
  const requestedName = sanitizeFileStem(options?.name ?? fallbackName, fallbackName)
  const format = options?.format ?? 'png-auto'
  const extension = format === 'gif' ? 'gif' : saveImageExtension(format)
  const dialogFormat = extension === 'jpg' ? 'jpeg' : extension === 'png' ? 'png' : extension === 'svg' ? 'svg' : extension === 'gif' ? 'gif' : 'webp'
  const exportDirectory = options?.directory?.trim() || loadEditorPreferences().exportDirectory
  const result = await api.exportImage(joinDirectoryPath(exportDirectory, `${requestedName}.${extension}`), dialogFormat)
  if (result.canceled || !result.filePath) return null
  lifecycle?.onEncodeStart?.()
  const output = format === 'gif'
    ? { ...exportAnimationGif(document, { scalePercent, frameStart: options?.gifFrameRange === 'range' ? options.gifFrameStart : undefined, frameEnd: options?.gifFrameRange === 'range' ? options.gifFrameEnd : undefined, direction: options?.gifDirection ?? 'forward' }), extension: 'gif' as const, indexed: false }
    : await exportDocumentImage(document, scalePercent, format)
  const path = result.filePath.toLowerCase().endsWith(`.${output.extension}`) ? result.filePath : `${result.filePath}.${output.extension}`
  lifecycle?.onWriteStart?.()
  await api.writeBinaryAtomic(path, output.bytes)
  rememberExportPath(path)
  return output.indexed ? translate(loadEditorPreferences().language, 'file.export.indexed') : translate(loadEditorPreferences().language, 'file.export.image', { extension: output.extension.toUpperCase() })
}

export async function exportTimelapseFile(api: MoonSpriteApi, document: SpriteDocument, format: TimelapseVideoFormat, options: TimelapseExportOptions, lifecycle?: FileOperationLifecycle): Promise<string | null> {
  const settings = normalizeTimelapseSettings(document.timelapse, document.timelapse?.snapshots ?? [])
  const fallbackName = sanitizeFileStem(document.name, 'MoonSprite-timelapse')
  const result = await api.exportImage(joinDirectoryPath(loadEditorPreferences().exportDirectory, `${fallbackName}-timelapse.${format}`), format)
  if (result.canceled || !result.filePath) return null
  lifecycle?.onEncodeStart?.()
  const bytes = await encodeTimelapseVideo(settings, format, options, (value) => lifecycle?.onEncodeProgress?.(value))
  const filePath = result.filePath.toLowerCase().endsWith(`.${format}`) ? result.filePath : `${result.filePath}.${format}`
  lifecycle?.onWriteStart?.()
  await api.writeBinaryAtomic(filePath, bytes)
  rememberExportPath(filePath)
  return translate(loadEditorPreferences().language, 'timelapse.exported', { format: format.toUpperCase() })
}

export async function openDocumentFile(api: MoonSpriteApi, filePath: string, lifecycle?: OpenDocumentLifecycle): Promise<SpriteDocument> {
  lifecycle?.onReadStart?.()
  const bytes = await api.readBinary(filePath, ({ bytesRead, totalBytes }) => lifecycle?.onReadProgress?.(bytesRead, totalBytes))
  lifecycle?.onDecodeStart?.()
  const document = await decodeDocumentFileAsync(bytes, filePath, lifecycle?.onDecodeProgress)
  const check = checkTypedArrayLimit(document.width, document.height, document.layers.length, document.colorMode)
  if (!check.allowed) throw new Error(check.reason)
  return document
}
