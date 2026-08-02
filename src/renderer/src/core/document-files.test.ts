import { describe, expect, it } from 'vitest'
import { createDocument } from './document'
import { decodeDocumentFile, encodeDocumentForPath, fileExtension, fileNameFromPath, normalizeSaveDialogPath, sanitizeFileStem, saveImageDialogFormat, saveImageKindForPath } from './document-files'
import { encodeProject } from './project-format'

describe('document file rules', () => {
  it('normalizes platform paths and user-entered file names', () => {
    expect(fileNameFromPath('C:\\gallery\\sprite.moonsprite')).toBe('sprite.moonsprite')
    expect(fileExtension('/gallery/sprite.ASEPRITE')).toBe('aseprite')
    expect(sanitizeFileStem('8*8.aseprite', 'untitled')).toBe('8_8')
  })

  it('keeps save dialog formats and suffixes consistent', () => {
    expect(saveImageDialogFormat('aseprite')).toBe('aseprite')
    expect(saveImageKindForPath('sprite.jpeg')).toBe('jpeg')
    expect(normalizeSaveDialogPath('sprite.png', 'aseprite')).toBe('sprite.aseprite')
    expect(normalizeSaveDialogPath('sprite.ase', 'aseprite')).toBe('sprite.ase')
  })

  it('restores MoonSprite file identity and encodes project saves', async () => {
    const document = createDocument('sprite', 8, 8, 'rgba')
    const path = 'D:\\gallery\\sprite.moonsprite'
    const restored = decodeDocumentFile(encodeProject(document), path)
    expect(restored.filePath).toBe(path)
    expect(restored.sourceFilePath).toBe(path)
    expect(restored.name).toBe('sprite.moonsprite')
    expect(await encodeDocumentForPath(restored, path, null, 100)).toEqual(encodeProject(restored))
  })
})
