import { describe, expect, it } from 'vitest'
import {
  EXPORT_PRESETS_STORAGE_KEY,
  LEGACY_EXPORT_PRESETS_STORAGE_KEY,
  RECENT_EXPORT_PATHS_STORAGE_KEY,
  loadExportPresets,
  loadRecentExportPaths,
  parentDirectoryFromPath,
  recordRecentExportPath,
  saveExportPresets,
  withExportFileExtension,
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

describe('export settings persistence', () => {
  it('round-trips every export option including GIF settings and directory', () => {
    const storage = memoryStorage()
    const presets: ExportPreset[] = [
      { presetName: 'Indexed PNG', name: 'sprite.png', format: 'png-auto', scalePercent: 100 },
      { presetName: 'RGBA PNG', name: 'sprite.png', format: 'png-rgba', scalePercent: 200 },
      { presetName: 'JPEG', name: 'sprite.jpg', format: 'jpeg', scalePercent: 300 },
      { presetName: 'WebP', name: 'sprite.webp', format: 'webp', scalePercent: 400 },
      { presetName: 'SVG', name: 'sprite.svg', format: 'svg', scalePercent: 800 },
      {
        presetName: 'GIF preview',
        name: 'walk.gif',
        format: 'gif',
        scalePercent: 400,
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
    expect(withExportFileExtension('', 'webp')).toBe('MoonSprite-export.webp')
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

  it('reports storage write failures', () => {
    const storage = memoryStorage()
    storage.setItem = () => { throw new Error('quota') }
    expect(saveExportPresets([], storage)).toBe(false)
    expect(recordRecentExportPath('D:/exports/sprite.png', storage)).toBe(false)
  })
})
