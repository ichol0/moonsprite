import { describe, expect, it } from 'vitest'
import { brushFolderContains, brushFolderParentId, remapBrushFolderId } from './brush-folder-tree'

describe('brush folder tree', () => {
  it('resolves parent folders for root and nested directories', () => {
    expect(brushFolderParentId(null)).toBeNull()
    expect(brushFolderParentId('Characters')).toBeNull()
    expect(brushFolderParentId('Characters/Heroes')).toBe('Characters')
    expect(brushFolderParentId('Characters/Heroes/Bosses')).toBe('Characters/Heroes')
  })

  it('matches only the selected folder and its descendants', () => {
    expect(brushFolderContains('Characters', 'Characters')).toBe(true)
    expect(brushFolderContains('Characters', 'Characters/Heroes')).toBe(true)
    expect(brushFolderContains('Characters', 'Characters-Backup')).toBe(false)
    expect(brushFolderContains('Characters', null)).toBe(false)
  })

  it('remaps a renamed folder together with nested descendants', () => {
    expect(remapBrushFolderId('Characters', 'Characters', 'Actors')).toBe('Actors')
    expect(remapBrushFolderId('Characters/Heroes', 'Characters', 'Actors')).toBe('Actors/Heroes')
    expect(remapBrushFolderId('Props', 'Characters', 'Actors')).toBe('Props')
  })
})
