import type { SpriteDocument } from '@shared/types'
import { decodeAseprite } from './aseprite'
import { decodePng, exportDocumentImage, type SaveImageKind } from './png'
import { decodeProject, encodeProject } from './project-format'

export type SaveImageDialogFormat = 'png' | 'jpeg' | 'webp' | 'ase' | 'aseprite'

export function fileNameFromPath(filePath: string): string {
  return filePath.split(/[\\/]/).pop() ?? filePath
}

export function fileExtension(filePath: string): string {
  return filePath.split('.').pop()?.toLowerCase() ?? ''
}

export function sanitizeFileStem(name: string, fallback: string): string {
  const stem = name
    .replace(/\.(moonsprite|aseprite|ase|png|jpe?g|webp|svg)$/i, '')
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

export function normalizeSaveDialogPath(filePath: string, format: SaveImageKind): string {
  const extension = saveImageExtension(format)
  const accepted = format === 'jpeg'
    ? /\.(jpg|jpeg)$/i.test(filePath)
    : format === 'ase' || format === 'aseprite'
      ? /\.(ase|aseprite)$/i.test(filePath)
      : filePath.toLowerCase().endsWith(`.${extension}`)
  if (accepted) return filePath
  return /\.(moonsprite|png|jpg|jpeg|webp|svg|ase|aseprite)$/i.test(filePath)
    ? filePath.replace(/\.(moonsprite|png|jpg|jpeg|webp|svg|ase|aseprite)$/i, `.${extension}`)
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

export async function encodeDocumentForPath(document: SpriteDocument, filePath: string, imageFormat: SaveImageKind | null, scalePercent: number): Promise<Uint8Array> {
  const outputFormat = imageFormat ?? saveImageKindForPath(filePath)
  return outputFormat
    ? (await exportDocumentImage(document, scalePercent, outputFormat)).bytes
    : encodeProject(document)
}
