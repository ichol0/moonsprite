import { beforeEach, describe, expect, it } from 'vitest'
import { createFolderHomeSection, findFolderHomeSection, getHomeSections, HOME_SECTIONS_STORAGE_KEY, reorderHomeSections, saveHomeSections } from './home-sections'

describe('home sections', () => {
  beforeEach(() => localStorage.clear())

  it('repairs missing built-in sections while preserving custom folder order', () => {
    localStorage.setItem(HOME_SECTIONS_STORAGE_KEY, JSON.stringify([
      { kind: 'folder', directoryPath: 'C:\\Art\\Sprites' },
      { kind: 'gallery' }
    ]))

    expect(getHomeSections().map((section) => section.kind)).toEqual(['folder', 'gallery', 'recent', 'recovery'])
  })

  it('normalizes and deduplicates selected folders', () => {
    const folder = createFolderHomeSection('C:\\Art\\Sprites\\')
    const saved = saveHomeSections([
      { id: 'recent', kind: 'recent' },
      folder,
      { ...folder, id: 'duplicate', directoryPath: 'c:/art/sprites' },
      { id: 'gallery', kind: 'gallery' },
      { id: 'recovery', kind: 'recovery' }
    ])

    expect(saved.filter((section) => section.kind === 'folder')).toHaveLength(1)
    expect(findFolderHomeSection(saved, 'C:/ART/SPRITES')?.name).toBe('Sprites')
  })

  it('reorders built-in and custom sections together and persists the result', () => {
    const folder = createFolderHomeSection('D:\\References')
    const reordered = reorderHomeSections([
      { id: 'recent', kind: 'recent' },
      { id: 'gallery', kind: 'gallery' },
      { id: 'recovery', kind: 'recovery' },
      folder
    ], folder.id, 'recent', false)

    saveHomeSections(reordered)
    expect(getHomeSections().map((section) => section.id)).toEqual([folder.id, 'recent', 'gallery', 'recovery'])
  })
})
