import { describe, expect, it } from 'vitest'
import { createDocument } from './document'
import { decodeDocumentFile, encodeDocumentForPath, fileExtension, fileNameFromPath, joinDirectoryPath, normalizeSaveDialogPath, sanitizeFileStem, saveImageDialogFormat, saveImageKindForPath } from './document-files'
import { encodeProject } from './project-format'

describe('document file rules', () => {
  it('normalizes platform paths and user-entered file names', () => {
    expect(fileNameFromPath('C:\\gallery\\sprite.moonsprite')).toBe('sprite.moonsprite')
    expect(fileExtension('/gallery/sprite.ASEPRITE')).toBe('aseprite')
    expect(sanitizeFileStem('8*8.aseprite', 'untitled')).toBe('8_8')
    expect(sanitizeFileStem('walk.gif', 'untitled')).toBe('walk')
  })

  it('keeps save dialog formats and suffixes consistent', () => {
    expect(saveImageDialogFormat('aseprite')).toBe('aseprite')
    expect(saveImageKindForPath('sprite.jpeg')).toBe('jpeg')
    expect(normalizeSaveDialogPath('sprite.png', 'aseprite')).toBe('sprite.aseprite')
    expect(normalizeSaveDialogPath('sprite.ase', 'aseprite')).toBe('sprite.ase')
  })

  it('joins default directories without changing their platform separator style', () => {
    expect(joinDirectoryPath('', 'sprite.png')).toBe('sprite.png')
    expect(joinDirectoryPath('D:\\MoonSprite\\exports\\', 'sprite.png')).toBe('D:\\MoonSprite\\exports\\sprite.png')
    expect(joinDirectoryPath('/opt/moonsprite/exports/', 'sprite.png')).toBe('/opt/moonsprite/exports/sprite.png')
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
