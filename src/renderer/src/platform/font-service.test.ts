import type { MoonSpriteApi, StoredFont } from '@shared/types'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { deleteTextFont, importSystemTextFont, importTextFont, loadLastTextFontSize, loadSystemFontCatalog, loadTextFontCatalog, recordLastTextFontSize, recordTextFontUsage, resetTextFontServiceForTests, sortTextFontsByUsage } from './font-service'

const systemFont: StoredFont = { id: 'system:Moon Local', family: 'Moon Local', filePath: 'C:/Windows/Fonts/moon.ttf', imported: false }
const importedFont: StoredFont = { id: 'moon.ttf', family: 'Moon Imported', filePath: 'Font/moon.ttf', imported: true }
const bundledFont: StoredFont = { id: 'moonsprite-builtin-silkscreen-regular.ttf', family: 'Silkscreen', filePath: 'Font/moonsprite-builtin-silkscreen-regular.ttf', imported: true }

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

  it('exposes seeded fonts as built-in choices', async () => {
    window.moonSprite = {
      listFonts: vi.fn(async () => ({ directoryPath: 'Font', fonts: [bundledFont] })),
      readBinary: vi.fn(async () => new Uint8Array([1, 2, 3]))
    } as unknown as MoonSpriteApi

    expect(await loadTextFontCatalog()).toContainEqual(expect.objectContaining({ family: 'Silkscreen', source: 'built-in' }))
  })

  it('sorts frequently selected fonts first and persists the counts', () => {
    const fonts = [
      { family: 'Fusion Pixel 10px Prop Zh_hans', source: 'built-in' as const },
      { family: 'Silkscreen', source: 'built-in' as const },
      { family: 'Tiny5', source: 'built-in' as const }
    ]
    recordTextFontUsage('Tiny5')
    recordTextFontUsage('Tiny5')
    recordTextFontUsage('Silkscreen')

    expect(sortTextFontsByUsage(fonts).map((font) => font.family)).toEqual([
      'Tiny5',
      'Silkscreen',
      'Fusion Pixel 10px Prop Zh_hans'
    ])
  })

  it('persists the last text size within supported bounds', () => {
    recordLastTextFontSize(19.4)
    expect(loadLastTextFontSize()).toBe(19)
    recordLastTextFontSize(999)
    expect(loadLastTextFontSize()).toBe(512)
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
