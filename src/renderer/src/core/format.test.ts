import { describe, expect, it } from 'vitest'
import { convertDocumentColorMode, createDocument, getActiveLayer, readLayerColor } from './document'
import { decodeProject, encodeProject, readProjectGalleryMetadata } from './project-format'
import { paintSquare } from './tools'
import { beginPixelEdit } from './history'

describe('MoonSprite project format', () => {
  it.each(['rgba', 'indexed'] as const)('round trips %s documents', (mode) => {
    const document = createDocument(`${mode} project`, 6, 5, mode)
    const layer = getActiveLayer(document)
    layer.blendMode = 'screen'
    const edit = beginPixelEdit(layer.id)
    paintSquare(document, layer, edit, 2, 3, 1, { r: 100, g: 20, b: 220, a: 190 })
    const restored = decodeProject(encodeProject(document))
    expect(restored.colorMode).toBe(mode)
    expect(restored.width).toBe(6)
    expect(restored.layers).toHaveLength(1)
    expect(restored.layers[0].blendMode).toBe('screen')
    expect(readLayerColor(restored, restored.layers[0], 3 * 6 + 2)).toEqual({ r: 100, g: 20, b: 220, a: 190 })
  })

  it('stores selection-created brushes inside the project', () => {
    const document = createDocument('project brush', 4, 3, 'rgba')
    document.customBrushes = [{ id: 'project-brush-1', name: '星点', width: 2, height: 2, coverage: new Uint8Array([255, 0, 0, 255]), sourceX: 1, sourceY: 1 }]
    const restored = decodeProject(encodeProject(document))
    expect(restored.customBrushes).toHaveLength(1)
    expect(restored.customBrushes?.[0]).toMatchObject({ id: 'project-brush-1', name: '星点', width: 2, height: 2, sourceX: 1, sourceY: 1 })
    expect(Array.from(restored.customBrushes?.[0].coverage ?? [])).toEqual([255, 0, 0, 255])
  })

  it('round trips the captured colors of selection-created brushes', () => {
    const document = createDocument('colored project brush', 2, 1, 'rgba')
    document.customBrushes = [{
      id: 'project-brush-colors',
      name: 'Colors',
      width: 2,
      height: 1,
      coverage: new Uint8Array([255, 255]),
      colors: new Uint32Array([0xff0000ff, 0xff00ff00]),
      sourceX: 0,
      sourceY: 0
    }]

    const restored = decodeProject(encodeProject(document))

    expect(Array.from(restored.customBrushes?.[0].colors ?? [])).toEqual([0xff0000ff, 0xff00ff00])
  })

  it('converts RGBA to indexed and back without changing colors', () => {
    const document = createDocument('convert', 2, 1, 'rgba')
    const layer = getActiveLayer(document)
    const edit = beginPixelEdit(layer.id)
    paintSquare(document, layer, edit, 0, 0, 1, { r: 12, g: 34, b: 56, a: 255 })
    convertDocumentColorMode(document, 'indexed')
    expect(document.palette.some((entry) => entry.color.r === 12)).toBe(true)
    convertDocumentColorMode(document, 'rgba')
    expect(readLayerColor(document, document.layers[0], 0)).toEqual({ r: 12, g: 34, b: 56, a: 255 })
  })

  it('rejects invalid containers', () => {
    expect(() => decodeProject(new Uint8Array([1, 2, 3]))).toThrow('无法解压')
  })

  it('round trips layer groups and their properties', () => {
    const document = createDocument('groups', 2, 2, 'rgba')
    const layer = getActiveLayer(document)
    layer.groupId = 'group-1'
    document.groups.push({ id: 'group-1', name: '角色', panelOrder: 0.25, displayColor: { r: 12, g: 34, b: 56, a: 255 }, description: '角色说明', visible: true, locked: true, opacity: 0.6, blendMode: 'multiply' })
    const restored = decodeProject(encodeProject(document))
    expect(restored.groups).toEqual([{ id: 'group-1', name: '角色', panelOrder: 0.25, displayColor: { r: 12, g: 34, b: 56, a: 255 }, description: '角色说明', visible: true, locked: true, opacity: 0.6, blendMode: 'multiply' }])
    expect(restored.layers[0].groupId).toBe('group-1')
  })

  it('round trips extended blend modes for layers and groups', () => {
    const document = createDocument('extended blend modes', 2, 2, 'rgba')
    document.layers[0].blendMode = 'soft-light'
    document.layers[0].groupId = 'effects'
    document.groups.push({ id: 'effects', name: 'Effects', visible: true, locked: false, opacity: 0.8, blendMode: 'color-dodge' })

    const restored = decodeProject(encodeProject(document))

    expect(restored.layers[0].blendMode).toBe('soft-light')
    expect(restored.groups[0].blendMode).toBe('color-dodge')
  })

  it('round trips nested layer groups', () => {
    const document = createDocument('nested groups', 2, 2, 'rgba')
    document.groups.push(
      { id: 'parent', name: '父组', parentGroupId: null, visible: true, locked: false, opacity: 1, blendMode: 'normal' },
      { id: 'child', name: '子组', parentGroupId: 'parent', visible: true, locked: false, opacity: 0.75, blendMode: 'screen' }
    )
    document.layers[0].groupId = 'child'

    const restored = decodeProject(encodeProject(document))

    expect(restored.groups.find((group) => group.id === 'child')?.parentGroupId).toBe('parent')
    expect(restored.layers[0].groupId).toBe('child')
  })

  it('moves cyclic group parents and missing layer groups back to the root', () => {
    const document = createDocument('invalid groups', 1, 1, 'rgba')
    document.groups.push(
      { id: 'a', name: 'A', parentGroupId: 'b', visible: true, locked: false, opacity: 1, blendMode: 'normal' },
      { id: 'b', name: 'B', parentGroupId: 'a', visible: true, locked: false, opacity: 1, blendMode: 'normal' }
    )
    document.layers[0].groupId = 'missing'

    const restored = decodeProject(encodeProject(document))

    expect(restored.groups.map((group) => group.parentGroupId)).toEqual([null, null])
    expect(restored.layers[0].groupId).toBeNull()
  })

  it('reads gallery metadata without decoding layer data', () => {
    const document = createDocument('图库作品', 9, 7, 'indexed')
    const metadata = readProjectGalleryMetadata(encodeProject(document))
    expect(metadata).toMatchObject({ name: '图库作品', width: 9, height: 7, colorMode: 'indexed' })
    expect([...metadata.preview.slice(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10])
  })
})
