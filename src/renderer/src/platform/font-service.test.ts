import type { MoonSpriteApi, StoredFont } from '@shared/types'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { deleteTextFont, importSystemTextFont, importTextFont, loadSystemFontCatalog, loadTextFontCatalog, resetTextFontServiceForTests } from './font-service'

const systemFont: StoredFont = { id: 'system:Moon Local', family: 'Moon Local', filePath: 'C:/Windows/Fonts/moon.ttf', imported: false }
const importedFont: StoredFont = { id: 'moon.ttf', family: 'Moon Imported', filePath: 'Font/moon.ttf', imported: true }

beforeEach(() => {
  localStorage.clear()
  resetTextFontServiceForTests()
  Object.defineProperty(document, 'fonts', { configurable: true, value: { add: vi.fn(), delete: vi.fn() } })
  vi.stubGlobal('FontFace', class {
    constructor(public family: string, public source: ArrayBuffer) {}
    async load() { return this }
  })
})

describe('font service', () => {
  it('reads installed system fonts without registering every font eagerly', async () => {
    const readBinary = vi.fn(async () => new Uint8Array([1, 2, 3]))
    window.moonSprite = {
      listSystemFonts: vi.fn(async () => [systemFont]),
      listFonts: vi.fn(async () => ({ directoryPath: 'Font', fonts: [] })),
      readBinary
    } as unknown as MoonSpriteApi

    expect(await loadSystemFontCatalog()).toContainEqual(expect.objectContaining({ family: 'Moon Local', source: 'local' }))
    expect(readBinary).not.toHaveBeenCalled()
  })

  it('registers a selected font file imported into MoonSprite', async () => {
    window.moonSprite = {
      importFont: vi.fn(async () => importedFont),
      listFonts: vi.fn(async () => ({ directoryPath: 'Font', fonts: [importedFont] })),
      readBinary: vi.fn(async () => new Uint8Array([1, 2, 3]))
    } as unknown as MoonSpriteApi

    expect(await importTextFont()).toMatchObject({ family: 'Moon Imported', source: 'imported' })
    expect(await loadTextFontCatalog()).toContainEqual(expect.objectContaining({ family: 'Moon Imported', source: 'imported' }))
  })

  it('keeps imported fonts visible when their family matches a built-in font', async () => {
    const importedArial: StoredFont = { id: 'arial.ttf', family: 'Arial', filePath: 'Font/arial.ttf', imported: true }
    window.moonSprite = {
      listFonts: vi.fn(async () => ({ directoryPath: 'Font', fonts: [importedArial] })),
      readBinary: vi.fn(async () => new Uint8Array([1, 2, 3]))
    } as unknown as MoonSpriteApi

    expect(await loadTextFontCatalog()).toContainEqual(expect.objectContaining({ family: 'Arial', source: 'imported' }))
  })

  it('copies a selected system font into the persistent font library', async () => {
    const importSystemFont = vi.fn(async () => importedFont)
    window.moonSprite = {
      importSystemFont,
      readBinary: vi.fn(async () => new Uint8Array([1, 2, 3]))
    } as unknown as MoonSpriteApi

    expect(await importSystemTextFont({ id: systemFont.id, family: systemFont.family, source: 'local', filePath: systemFont.filePath })).toMatchObject({ family: 'Moon Imported', source: 'imported' })
    expect(importSystemFont).toHaveBeenCalledWith(systemFont.id)
  })

  it('deletes only imported fonts and unregisters their loaded face', async () => {
    const deleteFont = vi.fn(async () => {})
    window.moonSprite = {
      importFont: vi.fn(async () => importedFont),
      listFonts: vi.fn(async () => ({ directoryPath: 'Font', fonts: [importedFont] })),
      readBinary: vi.fn(async () => new Uint8Array([1, 2, 3])),
      deleteFont
    } as unknown as MoonSpriteApi
    const option = await importTextFont()
    await deleteTextFont(option!)
    expect(deleteFont).toHaveBeenCalledWith('moon.ttf')
    expect(document.fonts.delete).toHaveBeenCalledOnce()
  })
})
