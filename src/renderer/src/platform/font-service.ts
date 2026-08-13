import type { StoredFont } from '@shared/types'
import { TEXT_FONT_FAMILIES } from '@/core/text-raster'

const loadedFonts = new Map<string, FontFace>()

export interface TextFontOption {
  id?: string
  family: string
  source: 'built-in' | 'imported' | 'local'
  filePath?: string
}

const registerFont = async (font: StoredFont): Promise<void> => {
  const key = `${font.family}\n${font.filePath}`
  if (loadedFonts.has(key) || typeof FontFace === 'undefined' || !document.fonts) return
  const bytes = await window.moonSprite.readBinary(font.filePath)
  const source = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
  const face = new FontFace(font.family, source)
  await face.load()
  document.fonts.add(face)
  loadedFonts.set(key, face)
}

const asOption = (font: StoredFont): TextFontOption => ({
  id: font.id,
  family: font.family,
  source: font.imported ? 'imported' : 'local',
  filePath: font.filePath
})

const uniqueOptions = (options: TextFontOption[]): TextFontOption[] => {
  const seen = new Set<string>()
  return options.filter((option) => {
    const key = option.family.toLocaleLowerCase()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export async function loadTextFontCatalog(): Promise<TextFontOption[]> {
  const imported = typeof window.moonSprite?.listFonts === 'function' ? (await window.moonSprite.listFonts()).fonts : []
  await Promise.allSettled(imported.map(registerFont))
  return uniqueOptions([
    ...imported.map(asOption),
    ...TEXT_FONT_FAMILIES.map((family) => ({ family, source: 'built-in' as const }))
  ])
}

export async function loadSystemFontCatalog(): Promise<TextFontOption[]> {
  if (typeof window.moonSprite?.listSystemFonts !== 'function') return []
  return uniqueOptions((await window.moonSprite.listSystemFonts()).map(asOption))
}

export async function importTextFont(): Promise<TextFontOption | null> {
  if (typeof window.moonSprite?.importFont !== 'function') return null
  const font = await window.moonSprite.importFont()
  if (!font) return null
  await registerFont(font)
  return asOption(font)
}

export async function importSystemTextFont(font: TextFontOption): Promise<TextFontOption | null> {
  if (!font.id || typeof window.moonSprite?.importSystemFont !== 'function') return null
  const imported = await window.moonSprite.importSystemFont(font.id)
  await registerFont(imported)
  return asOption(imported)
}

export async function deleteTextFont(font: TextFontOption): Promise<void> {
  if (font.source !== 'imported' || !font.id || typeof window.moonSprite?.deleteFont !== 'function') return
  await window.moonSprite.deleteFont(font.id)
  for (const [key, face] of loadedFonts) {
    if (!key.startsWith(`${font.family}\n`)) continue
    document.fonts?.delete?.(face)
    loadedFonts.delete(key)
  }
}

export function resetTextFontServiceForTests(): void {
  loadedFonts.clear()
}
