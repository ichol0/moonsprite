import type { MoonSpriteApi, SpriteDocument, TimelapseVideoFormat } from '@shared/types'
import { checkResourceLimit, checkTypedArrayLimit } from '@/core/resource-policy'
import { decodeDocumentFileAsync, directSourceImageSaveTarget, encodeDocumentForPath, encodeDocumentForSourceImage, fileNameFromPath, joinDirectoryPath, normalizeSaveDialogPath, sanitizeFileStem, saveImageDialogFormat, saveImageExtension, saveImageKindForPath, sourceRasterImageKindForPath } from '@/core/document-files'
import { exportDocumentImage, exportDocumentSliceImage, type SaveImageKind } from '@/core/png'
import { sliceExportFileName } from '@/core/slices'
import { loadEditorPreferences } from '@/core/file-preferences'
import { translate } from '@/core/localization'
import { exportAnimationGif } from '@/core/gif'
import { encodeTimelapseVideo, type TimelapseExportOptions } from '@/core/timelapse'
import { normalizeTimelapseSettings } from '@/core/project-metadata'
import { RECENT_EXPORTS_CHANGED_EVENT, parentDirectoryFromPath, recordRecentExportPath, saveDocumentExportSettings, withExportFileExtension, type DocumentExportSettings } from '@/core/export-settings'
import { acceptProjectSaveBaseline, clearProjectSaveBaseline, encodeProjectAsync, encodeProjectSaveAsync } from '@/core/project-format'
import { cloneDocumentForAnimationFrame } from '@/core/animation'

export type ExportOptions = DocumentExportSettings

function rememberExportPath(filePath: string): void {
  if (!recordRecentExportPath(filePath)) return
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(RECENT_EXPORTS_CHANGED_EVENT))
}

function rememberLastDocumentExport(document: SpriteDocument, options: ExportOptions | undefined, actual: Pick<DocumentExportSettings, 'name' | 'format' | 'scalePercent' | 'target' | 'directory'>): void {
  saveDocumentExportSettings(document, {
    ...actual,
    ...(options?.presetName ? { presetName: options.presetName } : {}),
    ...(actual.format === 'gif' ? {
      gifFrameRange: options?.gifFrameRange ?? 'all',
      ...(options?.gifFrameStart !== undefined ? { gifFrameStart: options.gifFrameStart } : {}),
      ...(options?.gifFrameEnd !== undefined ? { gifFrameEnd: options.gifFrameEnd } : {}),
      gifDirection: options?.gifDirection ?? 'forward'
    } : {})
  })
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
  setDocumentFilePath: boolean
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
    const directSourceTarget = !request.saveAs && !request.options ? directSourceImageSaveTarget(initial.document) : null
    if (directSourceTarget) {
      const source = request.getDocument()
      const currentTarget = source ? directSourceImageSaveTarget(source.document) : null
      if (source && currentTarget?.filePath === directSourceTarget.filePath && currentTarget.format === directSourceTarget.format) {
        request.lifecycle?.onEncodeStart?.()
        const data = await encodeDocumentForSourceImage(source.document, currentTarget.format, request.lifecycle?.onEncodeProgress)
        request.lifecycle?.onWriteStart?.()
        await request.api.writeBinaryAtomic(currentTarget.filePath, data)
        return { filePath: currentTarget.filePath, revision: source.revision, setDocumentFilePath: false }
      }
    }
    const importedImageRequiresProject = !request.saveAs
      && !request.options
      && !initial.document.filePath
      && Boolean(sourceRasterImageKindForPath(initial.document.sourceFilePath ?? ''))
    const existingFormat = initial.document.filePath
      ? (/\.moonsprite$/i.test(initial.document.filePath) ? 'moonsprite' as const : saveImageKindForPath(initial.document.filePath))
      : null
    const selectedFormat: 'moonsprite' | SaveImageKind = request.options?.format ?? existingFormat ?? (importedImageRequiresProject ? 'moonsprite' : request.preferredImageFormat) ?? 'moonsprite'
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
    return { filePath, revision: source.revision, setDocumentFilePath: true }
  })()
  saveOperations.set(request.documentId, operation)
  void operation.finally(() => {
    if (saveOperations.get(request.documentId) === operation) saveOperations.delete(request.documentId)
  }).catch(() => undefined)
  return operation
}

export async function exportDocumentFile(api: MoonSpriteApi, document: SpriteDocument, options?: ExportOptions, lifecycle?: FileOperationLifecycle): Promise<string | null> {
  const scalePercent = Math.max(1, Math.min(6400, Math.round(options?.scalePercent ?? 100)))
  const resources = await api.getResourceInfo()
  const fallbackName = sanitizeFileStem(document.name, 'MoonSprite-export')
  const requestedName = sanitizeFileStem(options?.name ?? fallbackName, fallbackName)
  const format = options?.format ?? 'png-auto'
  if (options?.target === 'slices') {
    if (format === 'gif') throw new Error(translate(loadEditorPreferences().language, 'file.export.slicesGifUnsupported'))
    const slices = document.slices ?? []
    if (slices.length === 0) throw new Error(translate(loadEditorPreferences().language, 'file.export.noSlices'))
    const directoryResult = await api.chooseDirectory(options.directory?.trim() || loadEditorPreferences().exportDirectory)
    if (directoryResult.canceled || !directoryResult.directoryPath) return null
    lifecycle?.onEncodeStart?.()
    const used = new Set<string>()
    let lastPath = directoryResult.directoryPath
    for (const slice of slices) {
      const width = Math.max(1, Math.round(slice.width * scalePercent / 100))
      const height = Math.max(1, Math.round(slice.height * scalePercent / 100))
      const check = checkResourceLimit(width, height, 1, 'rgba', resources)
      if (!check.allowed) throw new Error(check.reason)
      const output = await exportDocumentSliceImage(document, slice, scalePercent, format)
      const fileName = sliceExportFileName(slice, output.extension, used)
      lastPath = joinDirectoryPath(directoryResult.directoryPath, fileName)
      lifecycle?.onWriteStart?.()
      await api.writeBinaryAtomic(lastPath, output.bytes)
    }
    rememberExportPath(lastPath)
    rememberLastDocumentExport(document, options, {
      name: withExportFileExtension(requestedName, format),
      format,
      scalePercent,
      target: 'slices',
      directory: directoryResult.directoryPath
    })
    return translate(loadEditorPreferences().language, 'file.export.slices', { count: slices.length })
  }
  if (options?.target === 'frames') {
    if (format === 'gif') throw new Error(translate(loadEditorPreferences().language, 'file.export.framesGifUnsupported'))
    const exportWidth = Math.max(1, Math.round(document.width * scalePercent / 100))
    const exportHeight = Math.max(1, Math.round(document.height * scalePercent / 100))
    if (!Number.isSafeInteger(exportWidth) || !Number.isSafeInteger(exportHeight)) throw new Error(translate(loadEditorPreferences().language, 'file.export.safeRange'))
    const check = checkResourceLimit(exportWidth, exportHeight, 1, 'rgba', resources)
    if (!check.allowed) throw new Error(check.reason)
    const directoryResult = await api.chooseDirectory(options.directory?.trim() || loadEditorPreferences().exportDirectory)
    if (directoryResult.canceled || !directoryResult.directoryPath) return null
    const frameIds = document.animation?.frames.map((frame) => frame.id) ?? [null]
    const digits = Math.max(3, String(frameIds.length).length)
    lifecycle?.onEncodeStart?.()
    let lastPath = directoryResult.directoryPath
    for (const [index, frameId] of frameIds.entries()) {
      const frameDocument = frameId ? cloneDocumentForAnimationFrame(document, frameId) : document
      const output = await exportDocumentImage(frameDocument, scalePercent, format)
      const frameNumber = String(index + 1).padStart(digits, '0')
      lastPath = joinDirectoryPath(directoryResult.directoryPath, `${requestedName}-${frameNumber}.${output.extension}`)
      if (index === 0) lifecycle?.onWriteStart?.()
      await api.writeBinaryAtomic(lastPath, output.bytes)
    }
    rememberExportPath(lastPath)
    rememberLastDocumentExport(document, options, {
      name: withExportFileExtension(requestedName, format),
      format,
      scalePercent,
      target: 'frames',
      directory: directoryResult.directoryPath
    })
    return translate(loadEditorPreferences().language, 'file.export.frames', { count: frameIds.length })
  }
  const exportWidth = Math.max(1, Math.round(document.width * scalePercent / 100))
  const exportHeight = Math.max(1, Math.round(document.height * scalePercent / 100))
  if (!Number.isSafeInteger(exportWidth) || !Number.isSafeInteger(exportHeight)) throw new Error(translate(loadEditorPreferences().language, 'file.export.safeRange'))
  const check = checkResourceLimit(exportWidth, exportHeight, 1, 'rgba', resources)
  if (!check.allowed) throw new Error(check.reason)
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
  rememberLastDocumentExport(document, options, {
    name: fileNameFromPath(path),
    format,
    scalePercent,
    target: 'document',
    directory: parentDirectoryFromPath(path)
  })
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
