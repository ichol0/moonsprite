import { describe, expect, it } from 'vitest'
import { createDocument, createLayer } from './document'
import { brushPanelRenderKey, colorPanelRenderKey, layersPanelRenderKey, palettePanelRenderKey, previewPanelRenderKey, tilesetPanelRenderKey } from './panel-render-keys'
import type { TilemapDrawingMode } from './tilemap'
import type { FreeTileDrawingMode } from './free-tile'

const session = () => ({
  document: createDocument('render keys', 4, 4, 'rgba'),
  primaryColor: { r: 0, g: 0, b: 0, a: 255 },
  secondaryColor: { r: 255, g: 255, b: 255, a: 255 },
  selectedPaletteIds: [] as number[],
  selectedTilesetId: null as string | null,
  selectedTileId: null as string | null,
  secondaryTileId: null as string | null,
  selectedFreeTileInstanceId: null as string | null,
  selectedFreeTileInstanceIds: [] as string[],
  freeTileInstanceLayerId: null as string | null,
  tilemapMode: 'create' as TilemapDrawingMode,
  freeTileMode: 'paint' as FreeTileDrawingMode,
  selectedLayerIds: [] as string[],
  selectedGroupId: null as string | null,
  selectedGroupIds: [] as string[],
  collapsedGroupIds: [] as string[],
  animationPlaying: false,
  animationPlaybackRate: 1,
  animationReturnToStart: false,
  activeLayerMaskId: null as string | null,
  layerMaskIsolatedView: false,
  brushImageId: null as string | null,
  revision: 0,
  contentRevision: 0,
  layersPanelRevision: 0,
  view: { relativeLuminance: false }
})

describe('panel render keys', () => {
  it('keeps the layer panel structure stable while refreshing active cel content after pixel edits', () => {
    const current = session()
    const before = [colorPanelRenderKey(current), palettePanelRenderKey(current), layersPanelRenderKey(current)]
    current.document.layers[0].pixels[0] = 0xff00ffff
    current.revision += 1
    current.contentRevision += 1
    expect([colorPanelRenderKey(current), palettePanelRenderKey(current)]).toEqual(before.slice(0, 2))
    expect(layersPanelRenderKey(current)).toBe(before[2])
    current.layersPanelRevision += 1
    expect(layersPanelRenderKey(current)).not.toBe(before[2])
    expect(previewPanelRenderKey(current)).toBe(`${current.document.id}:1:0:0:1:0:1`)
  })

  it('invalidates only keys whose visible panel data changed', () => {
    const current = session()
    const colorBefore = colorPanelRenderKey(current)
    const paletteBefore = palettePanelRenderKey(current)
    const layersBefore = layersPanelRenderKey(current)

    current.primaryColor = { r: 20, g: 40, b: 60, a: 255 }
    expect(colorPanelRenderKey(current)).not.toBe(colorBefore)
    expect(palettePanelRenderKey(current)).not.toBe(paletteBefore)

    current.document.layers.push(createLayer('Second', 4, 4, 'rgba'))
    expect(layersPanelRenderKey(current)).not.toBe(layersBefore)
  })

  it('invalidates the preview for content and luminance changes, not main-view pan', () => {
    const current = session()
    const before = previewPanelRenderKey(current)
    const panned = { ...current, view: { ...current.view, panX: 24, panY: -12 } }
    expect(previewPanelRenderKey(panned)).toBe(before)
    current.view.relativeLuminance = true
    expect(previewPanelRenderKey(current)).not.toBe(before)
  })

  it('invalidates the preview controls when animation playback state changes', () => {
    const current = session()
    const before = previewPanelRenderKey(current)
    current.animationPlaying = true
    expect(previewPanelRenderKey(current)).not.toBe(before)
  })

  it('keeps the layer panel tree stable while playback advances frames', () => {
    const current = session()
    current.animationPlaying = true
    const before = layersPanelRenderKey(current)
    current.document.animation!.activeFrameId = 'playback-frame'
    current.revision += 1
    expect(layersPanelRenderKey(current)).toBe(before)
    current.animationPlaying = false
    expect(layersPanelRenderKey(current)).not.toBe(before)
  })

  it('invalidates the layer panel when a mask enters isolated view', () => {
    const current = session()
    current.activeLayerMaskId = 'mask'
    const before = layersPanelRenderKey(current)
    current.layerMaskIsolatedView = true
    expect(layersPanelRenderKey(current)).not.toBe(before)
  })

  it('invalidates the Tileset panel when its drawing mode changes', () => {
    const current = session()
    const before = tilesetPanelRenderKey(current)
    current.tilemapMode = 'edit'
    expect(tilesetPanelRenderKey(current)).not.toBe(before)
  })

  it('invalidates the shared Tileset panel when its free-tile drawing mode changes', () => {
    const current = session()
    const before = tilesetPanelRenderKey(current)
    current.freeTileMode = 'edit'
    expect(tilesetPanelRenderKey(current)).not.toBe(before)
  })

  it('invalidates the shared Tileset panel when Free Tile instances or their selection change', () => {
    const current = session()
    const before = tilesetPanelRenderKey(current)
    current.selectedFreeTileInstanceId = 'instance-a'
    expect(tilesetPanelRenderKey(current)).not.toBe(before)
    const selected = tilesetPanelRenderKey(current)
    current.contentRevision += 1
    expect(tilesetPanelRenderKey(current)).not.toBe(selected)
  })

  it('invalidates the Layers panel when the Free Tile instance-layer view changes', () => {
    const current = session()
    const before = layersPanelRenderKey(current)
    current.freeTileInstanceLayerId = 'free-layer'
    expect(layersPanelRenderKey(current)).not.toBe(before)
    const opened = layersPanelRenderKey(current)
    current.selectedFreeTileInstanceIds = ['instance-a', 'instance-b']
    expect(layersPanelRenderKey(current)).not.toBe(opened)
  })

  it('invalidates tile-aware panels when the background tile changes', () => {
    const current = session()
    const colorBefore = colorPanelRenderKey(current)
    const tilesetBefore = tilesetPanelRenderKey(current)
    current.secondaryTileId = 'tile-background'
    expect(colorPanelRenderKey(current)).not.toBe(colorBefore)
    expect(tilesetPanelRenderKey(current)).not.toBe(tilesetBefore)
  })

  it('invalidates the Brush Library for active and legacy project brush changes', () => {
    const current = session()
    const before = brushPanelRenderKey(current)
    current.brushImageId = 'local-brush.png'
    expect(brushPanelRenderKey(current)).not.toBe(before)
    const selected = brushPanelRenderKey(current)
    current.document.customBrushes = [{ id: 'legacy', name: 'Legacy', width: 1, height: 1, coverage: Uint8Array.of(255) }]
    expect(brushPanelRenderKey(current)).not.toBe(selected)
  })
})
