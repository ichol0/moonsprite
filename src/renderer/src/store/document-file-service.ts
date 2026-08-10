import type { MoonSpriteApi, SpriteDocument, TimelapseVideoFormat } from '@shared/types'
import { checkResourceLimit, checkTypedArrayLimit } from '@/core/resource-policy'
import { decodeDocumentFileAsync, encodeDocumentForPath, normalizeSaveDialogPath, sanitizeFileStem, saveImageDialogFormat, saveImageExtension, saveImageKindForPath } from '@/core/document-files'
import { exportDocumentImage, type ImageExportKind, type SaveImageKind } from '@/core/png'
import { loadEditorPreferences } from '@/core/file-preferences'
import { translate } from '@/core/localization'
import { exportAnimationGif, type GifDirection } from '@/core/gif'
import { encodeTimelapseVideo, type TimelapseExportOptions } from '@/core/timelapse'
import { normalizeTimelapseSettings } from '@/core/project-metadata'

export interface ExportOptions {
  name: string
  format: ImageExportKind
  scalePercent: number
  gifFrameRange?: 'all' | 'range'
  gifFrameStart?: number
  gifFrameEnd?: number
  gifDirection?: GifDirection
}

export interface SaveAsOptions {
  name: string
  format: 'moonsprite' | SaveImageKind
  scalePercent: number
}

interface SaveDocumentRequest {
  api: MoonSpriteApi
  documentId: string
  getDocument: () => SpriteDocument | null
  saveAs: boolean
  options?: SaveAsOptions
  preferredImageFormat: SaveImageKind | null
  lifecycle?: FileOperationLifecycle
}

export interface FileOperationLifecycle {
  onEncodeStart?: () => void
  onEncodeProgress?: (value: number) => void
  onWriteStart?: () => void
}

const saveOperations = new Map<string, Promise<string | null>>()

export function saveDocumentFile(request: SaveDocumentRequest): Promise<string | null> {
  const pending = saveOperations.get(request.documentId)
  if (pending) return pending
  const operation = (async (): Promise<string | null> => {
    const initial = request.getDocument()
    if (!initial) return null
    const existingFormat = initial.filePath
      ? (/\.moonsprite$/i.test(initial.filePath) ? 'moonsprite' as const : saveImageKindForPath(initial.filePath))
      : null
    const selectedFormat: 'moonsprite' | SaveImageKind = request.options?.format ?? existingFormat ?? request.preferredImageFormat ?? 'moonsprite'
    const imageFormat = selectedFormat === 'moonsprite' ? null : selectedFormat
    const fallbackName = sanitizeFileStem(initial.name, 'MoonSprite-export')
    const requestedName = sanitizeFileStem(request.options?.name ?? fallbackName, fallbackName)
    let filePath = initial.filePath
    if ((!filePath || request.saveAs) && imageFormat) {
      const extension = saveImageExtension(imageFormat)
      const result = await request.api.saveProject(`${requestedName}.${extension}`, saveImageDialogFormat(imageFormat))
      if (result.canceled || !result.filePath || !request.getDocument()) return null
      filePath = normalizeSaveDialogPath(result.filePath, imageFormat)
    } else if (!filePath || request.saveAs) {
      const result = await request.api.saveProject(`${requestedName}.moonsprite`)
      if (result.canceled || !result.filePath || !request.getDocument()) return null
      filePath = result.filePath.endsWith('.moonsprite') ? result.filePath : `${result.filePath}.moonsprite`
    }
    const document = request.getDocument()
    if (!document || !filePath) return null
    request.lifecycle?.onEncodeStart?.()
    const data = await encodeDocumentForPath(document, filePath, imageFormat, request.options?.scalePercent ?? 100)
    request.lifecycle?.onWriteStart?.()
    await request.api.writeBinaryAtomic(filePath, data)
    return filePath
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
  const result = await api.exportImage(`${requestedName}.${extension}`, dialogFormat)
  if (result.canceled || !result.filePath) return null
  lifecycle?.onEncodeStart?.()
  const output = format === 'gif'
    ? { ...exportAnimationGif(document, { scalePercent, frameStart: options?.gifFrameRange === 'range' ? options.gifFrameStart : undefined, frameEnd: options?.gifFrameRange === 'range' ? options.gifFrameEnd : undefined, direction: options?.gifDirection ?? 'forward' }), extension: 'gif' as const, indexed: false }
    : await exportDocumentImage(document, scalePercent, format)
  const path = result.filePath.toLowerCase().endsWith(`.${output.extension}`) ? result.filePath : `${result.filePath}.${output.extension}`
  lifecycle?.onWriteStart?.()
  await api.writeBinaryAtomic(path, output.bytes)
  return output.indexed ? translate(loadEditorPreferences().language, 'file.export.indexed') : translate(loadEditorPreferences().language, 'file.export.image', { extension: output.extension.toUpperCase() })
}

export async function exportTimelapseFile(api: MoonSpriteApi, document: SpriteDocument, format: TimelapseVideoFormat, options: TimelapseExportOptions, lifecycle?: FileOperationLifecycle): Promise<string | null> {
  const settings = normalizeTimelapseSettings(document.timelapse, document.timelapse?.snapshots ?? [])
  const fallbackName = sanitizeFileStem(document.name, 'MoonSprite-timelapse')
  const result = await api.exportImage(`${fallbackName}-timelapse.${format}`, format)
  if (result.canceled || !result.filePath) return null
  lifecycle?.onEncodeStart?.()
  const bytes = await encodeTimelapseVideo(settings, format, options, (value) => lifecycle?.onEncodeProgress?.(value))
  const filePath = result.filePath.toLowerCase().endsWith(`.${format}`) ? result.filePath : `${result.filePath}.${format}`
  lifecycle?.onWriteStart?.()
  await api.writeBinaryAtomic(filePath, bytes)
  return translate(loadEditorPreferences().language, 'timelapse.exported', { format: format.toUpperCase() })
}

export async function openDocumentFile(api: MoonSpriteApi, filePath: string): Promise<SpriteDocument> {
  const document = await decodeDocumentFileAsync(await api.readBinary(filePath), filePath)
  const check = checkTypedArrayLimit(document.width, document.height, document.layers.length, document.colorMode)
  if (!check.allowed) throw new Error(check.reason)
  return document
}
