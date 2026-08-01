import type { MoonSpriteApi, SpriteDocument } from '@shared/types'
import { checkResourceLimit } from '@/core/resource-policy'
import { decodeDocumentFile, encodeDocumentForPath, normalizeSaveDialogPath, sanitizeFileStem, saveImageDialogFormat, saveImageExtension, saveImageKindForPath } from '@/core/document-files'
import { exportDocumentImage, type ImageExportKind, type SaveImageKind } from '@/core/png'

export interface ExportOptions {
  name: string
  format: ImageExportKind
  scalePercent: number
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
    const data = await encodeDocumentForPath(document, filePath, imageFormat, request.options?.scalePercent ?? 100)
    await request.api.writeBinaryAtomic(filePath, data)
    return filePath
  })()
  saveOperations.set(request.documentId, operation)
  void operation.finally(() => {
    if (saveOperations.get(request.documentId) === operation) saveOperations.delete(request.documentId)
  }).catch(() => undefined)
  return operation
}

export async function exportDocumentFile(api: MoonSpriteApi, document: SpriteDocument, options?: ExportOptions): Promise<string | null> {
  const scalePercent = Math.max(1, Math.min(6400, Math.round(options?.scalePercent ?? 100)))
  const exportWidth = Math.max(1, Math.round(document.width * scalePercent / 100))
  const exportHeight = Math.max(1, Math.round(document.height * scalePercent / 100))
  if (!Number.isSafeInteger(exportWidth) || !Number.isSafeInteger(exportHeight)) throw new Error('导出尺寸超出安全范围。')
  const resources = await api.getResourceInfo()
  const check = checkResourceLimit(exportWidth, exportHeight, 1, 'rgba', resources)
  if (!check.allowed) throw new Error(check.reason)
  const fallbackName = sanitizeFileStem(document.name, 'MoonSprite-export')
  const requestedName = sanitizeFileStem(options?.name ?? fallbackName, fallbackName)
  const output = await exportDocumentImage(document, scalePercent, options?.format ?? 'png-auto')
  const dialogFormat = output.extension === 'jpg' ? 'jpeg' : output.extension === 'png' ? 'png' : output.extension === 'svg' ? 'svg' : 'webp'
  const result = await api.exportImage(`${requestedName}.${output.extension}`, dialogFormat)
  if (result.canceled || !result.filePath) return null
  const path = result.filePath.toLowerCase().endsWith(`.${output.extension}`) ? result.filePath : `${result.filePath}.${output.extension}`
  await api.writeBinaryAtomic(path, output.bytes)
  return output.indexed ? '已导出索引 PNG。' : `已导出 ${output.extension.toUpperCase()} 图像。`
}

export async function openDocumentFile(api: MoonSpriteApi, filePath: string): Promise<SpriteDocument> {
  const document = decodeDocumentFile(await api.readBinary(filePath), filePath)
  const resources = await api.getResourceInfo()
  const check = checkResourceLimit(document.width, document.height, document.layers.length, document.colorMode, resources)
  if (!check.allowed) throw new Error(check.reason)
  return document
}
