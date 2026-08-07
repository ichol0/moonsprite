import { describe, expect, it } from 'vitest'
import { createDocument, createLayer } from './document'
import { colorPanelRenderKey, layersPanelRenderKey, palettePanelRenderKey, previewPanelRenderKey } from './panel-render-keys'

const session = () => ({
  document: createDocument('render keys', 4, 4, 'rgba'),
  primaryColor: { r: 0, g: 0, b: 0, a: 255 },
  secondaryColor: { r: 255, g: 255, b: 255, a: 255 },
  selectedPaletteIds: [] as number[],
  selectedLayerIds: [] as string[],
  selectedGroupId: null as string | null,
  selectedGroupIds: [] as string[],
  collapsedGroupIds: [] as string[],
  animationPlaying: false,
  animationPlaybackRate: 1,
  animationReturnToStart: false,
  revision: 0,
  view: { relativeLuminance: false }
})

describe('panel render keys', () => {
  it('keeps color and palette stable while refreshing layer cel thumbnails after pixel edits', () => {
    const current = session()
    const before = [colorPanelRenderKey(current), palettePanelRenderKey(current), layersPanelRenderKey(current)]
    current.document.layers[0].pixels[0] = 0xff00ffff
    current.revision += 1
    expect([colorPanelRenderKey(current), palettePanelRenderKey(current)]).toEqual(before.slice(0, 2))
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
})
