import { describe, expect, it } from 'vitest'
import {
  EXPORT_PRESETS_STORAGE_KEY,
  DOCUMENT_EXPORT_SETTINGS_STORAGE_KEY,
  LEGACY_EXPORT_PRESETS_STORAGE_KEY,
  RECENT_EXPORT_PATHS_STORAGE_KEY,
  loadDocumentExportSettings,
  loadExportPresets,
  loadRecentExportPaths,
  parentDirectoryFromPath,
  recordRecentExportPath,
  saveDocumentExportSettings,
  saveExportPresets,
  withExportFileExtension,
  type DocumentExportSettingsOwner,
  type ExportPreset
} from './export-settings'

function memoryStorage(): Storage {
  const values = new Map<string, string>()
  return {
    get length() { return values.size },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => { values.delete(key) },
    setItem: (key, value) => { values.set(key, value) }
  }
}

const exportOwner = (id: string, filePath: string | null, sourceFilePath?: string): DocumentExportSettingsOwner => ({ id, filePath, sourceFilePath })

describe('export settings persistence', () => {
  it('round-trips every export option including GIF settings and directory', () => {
    const storage = memoryStorage()
    const presets: ExportPreset[] = [
      { presetName: 'Indexed PNG', name: 'sprite.png', format: 'png-auto', scalePercent: 100 },
      { presetName: 'RGBA PNG', name: 'sprite.png', format: 'png-rgba', scalePercent: 200 },
      { presetName: 'JPEG', name: 'sprite.jpg', format: 'jpeg', scalePercent: 300 },
      { presetName: 'WebP', name: 'sprite.webp', format: 'webp', scalePercent: 400 },
      { presetName: 'SVG', name: 'sprite.svg', format: 'svg', scalePercent: 800 },
      { presetName: 'Photoshop', name: 'sprite.psd', format: 'psd', scalePercent: 100 },
      { presetName: 'All frames', name: 'walk.png', format: 'png-rgba', scalePercent: 100, target: 'frames' },
      {
        presetName: 'GIF preview',
        name: 'walk.gif',
        format: 'gif',
        scalePercent: 400,
        target: 'slices',
        sliceId: 'hero',
        directory: 'D:/exports/animation',
        gifFrameRange: 'range',
        gifFrameStart: 2,
        gifFrameEnd: 8,
        gifDirection: 'reverse-ping-pong'
      }
    ]
    expect(saveExportPresets(presets, storage)).toBe(true)
    expect(loadExportPresets(storage)).toEqual(presets)
    expect(JSON.parse(storage.getItem(EXPORT_PRESETS_STORAGE_KEY) ?? '{}').schemaVersion).toBe(2)
  })

  it('migrates legacy presets without discarding supported formats', () => {
    const storage = memoryStorage()
    storage.setItem(LEGACY_EXPORT_PRESETS_STORAGE_KEY, JSON.stringify([
      { presetName: 'Vector', name: 'sprite', format: 'svg', scale: 2 },
      { presetName: 'Animation', name: 'walk.gif', format: 'gif', scalePercent: 300, gifDirection: 'reverse' }
    ]))
    expect(loadExportPresets(storage)).toMatchObject([
      { presetName: 'Vector', name: 'sprite.svg', format: 'svg', scalePercent: 200 },
      { presetName: 'Animation', name: 'walk.gif', format: 'gif', scalePercent: 300, gifDirection: 'reverse' }
    ])
  })

  it('updates export suffixes while retaining the file stem', () => {
    expect(withExportFileExtension('sprite.png', 'jpeg')).toBe('sprite.jpg')
    expect(withExportFileExtension('walk', 'gif')).toBe('walk.gif')
    expect(withExportFileExtension('layered.aseprite', 'psd')).toBe('layered.psd')
    expect(withExportFileExtension('', 'webp')).toBe('MoonSprite-export.webp')
  })

  it('keeps PSD presets and remembered exports on the canvas target', () => {
    const storage = memoryStorage()
    expect(saveExportPresets([{ presetName: 'PSD', name: 'sprite.png', format: 'psd', scalePercent: 200, target: 'frames' }], storage)).toBe(true)
    expect(loadExportPresets(storage)).toEqual([{ presetName: 'PSD', name: 'sprite.psd', format: 'psd', scalePercent: 200 }])

    expect(saveDocumentExportSettings(exportOwner('psd-doc', null), { name: 'sprite.gif', format: 'psd', scalePercent: 100, target: 'slices', sliceId: 'hero' }, storage)).toBe(true)
    expect(loadDocumentExportSettings(exportOwner('psd-doc', null), storage)).toEqual({ name: 'sprite.psd', format: 'psd', scalePercent: 100, target: 'document' })
  })

  it('extracts parent directories from Windows and POSIX paths', () => {
    expect(parentDirectoryFromPath('D:\\MoonSprite\\exports\\sprite.png')).toBe('D:\\MoonSprite\\exports')
    expect(parentDirectoryFromPath('/home/user/exports/sprite.png')).toBe('/home/user/exports')
    expect(parentDirectoryFromPath('C:\\sprite.png')).toBe('C:\\')
  })

  it('keeps recent paths newest-first, deduplicated and capped', () => {
    const storage = memoryStorage()
    for (let index = 0; index < 12; index += 1) {
      expect(recordRecentExportPath(`D:/exports/${index}.png`, storage, new Date(2026, 0, index + 1))).toBe(true)
    }
    expect(recordRecentExportPath('d:/exports/5.png', storage, new Date(2026, 1, 1))).toBe(true)
    const recent = loadRecentExportPaths(storage)
    expect(recent).toHaveLength(10)
    expect(recent[0].filePath).toBe('d:/exports/5.png')
    expect(recent.filter((item) => item.filePath.toLocaleLowerCase() === 'd:/exports/5.png')).toHaveLength(1)
    expect(JSON.parse(storage.getItem(RECENT_EXPORT_PATHS_STORAGE_KEY) ?? '{}').schemaVersion).toBe(1)
  })

  it('restores the last successful export settings for the same document path', () => {
    const storage = memoryStorage()
    const settings = {
      name: 'walk.gif',
      format: 'gif' as const,
      scalePercent: 400,
      target: 'slices' as const,
      sliceId: 'hero',
      directory: 'D:/exports/animation',
      gifFrameRange: 'range' as const,
      gifFrameStart: 2,
      gifFrameEnd: 8,
      gifDirection: 'reverse-ping-pong' as const,
      presetName: 'GIF preview'
    }
    expect(saveDocumentExportSettings(exportOwner('doc-a', 'D:\\projects\\walk.moonsprite'), settings, storage, 10)).toBe(true)
    expect(loadDocumentExportSettings(exportOwner('reopened-doc', 'd:/projects/walk.moonsprite'), storage)).toEqual(settings)
    expect(JSON.parse(storage.getItem(DOCUMENT_EXPORT_SETTINGS_STORAGE_KEY) ?? '{}').schemaVersion).toBe(1)
  })

  it('isolates settings between files while retaining an unsaved document by id', () => {
    const storage = memoryStorage()
    const first = exportOwner('doc-a', null, 'D:/imports/a.png')
    const second = exportOwner('doc-b', null, 'D:/imports/b.png')
    const unsaved = exportOwner('doc-unsaved', null)
    expect(saveDocumentExportSettings(first, { name: 'a.png', format: 'png-rgba', scalePercent: 200, target: 'frames', directory: 'D:/exports/a' }, storage, 10)).toBe(true)
    expect(saveDocumentExportSettings(second, { name: 'b.webp', format: 'webp', scalePercent: 300, target: 'document', directory: 'D:/exports/b' }, storage, 20)).toBe(true)
    expect(saveDocumentExportSettings(unsaved, { name: 'draft.png', format: 'png-auto', scalePercent: 100, target: 'document', directory: 'D:/exports/draft' }, storage, 30)).toBe(true)
    expect(loadDocumentExportSettings(exportOwner('reopened-a', null, 'D:/imports/a.png'), storage)).toMatchObject({ name: 'a.png', format: 'png-rgba', target: 'frames', directory: 'D:/exports/a' })
    expect(loadDocumentExportSettings(exportOwner('reopened-b', null, 'D:/imports/b.png'), storage)).toMatchObject({ name: 'b.webp', format: 'webp', directory: 'D:/exports/b' })
    expect(loadDocumentExportSettings(exportOwner('doc-unsaved', null), storage)).toMatchObject({ name: 'draft.png', directory: 'D:/exports/draft' })
    expect(loadDocumentExportSettings(exportOwner('doc-c', null), storage)).toBeNull()
  })

  it('reports storage write failures', () => {
    const storage = memoryStorage()
    storage.setItem = () => { throw new Error('quota') }
    expect(saveExportPresets([], storage)).toBe(false)
    expect(recordRecentExportPath('D:/exports/sprite.png', storage)).toBe(false)
    expect(saveDocumentExportSettings(exportOwner('doc-a', null), { name: 'sprite.png', format: 'png-auto', scalePercent: 100 }, storage)).toBe(false)
  })
})
