import { describe, expect, it } from 'vitest'
import { normalizeDroppedDocumentPaths } from './document-drop'

describe('document drop paths', () => {
  it('accepts MoonSprite projects from Windows paths and file URLs', () => {
    expect(normalizeDroppedDocumentPaths([
      'D:\\Art\\demo.moonsprite',
      'file:///D:/Art/second.moonsprite'
    ])).toEqual([
      'D:\\Art\\demo.moonsprite',
      'D:\\Art\\second.moonsprite'
    ])
  })

  it('removes unsupported files and duplicate event payloads case-insensitively', () => {
    expect(normalizeDroppedDocumentPaths([
      '"D:\\Art\\Demo.MOONSPRITE"',
      'd:\\art\\demo.moonsprite',
      'D:\\Art\\notes.txt'
    ])).toEqual(['D:\\Art\\Demo.MOONSPRITE'])
  })

  it('accepts the common raster image formats supported by the decoder', () => {
    expect(normalizeDroppedDocumentPaths([
      'D:\\Art\\sprite.png',
      'D:\\Art\\photo.jpg',
      'D:\\Art\\photo.jpeg',
      'D:\\Art\\texture.webp',
      'D:\\Art\\tiles.bmp',
      'D:\\Art\\reference.gif'
    ])).toHaveLength(6)
  })
})
