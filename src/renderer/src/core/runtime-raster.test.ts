import { describe, expect, it } from 'vitest'
import type { AnimationCelSurface, RgbaLayer, RuntimeRasterTiles } from '@shared/types'
import { compositeRegion, createDocument, markLayerContentChanged } from './document'
import {
  assignRasterStorage,
  cachedRuntimeRasterVisibleBounds,
  installRuntimeRaster,
  prepareRuntimeRasterMetadata,
  prepareRuntimeRasterDocumentForTransfer,
  rasterStorageIdentity,
  readSurfacePackedLocal,
  readSurfacePackedRegion,
  rehydrateRuntimeRasterDocument,
  runtimeRasterForSurface,
  runtimeRasterResidentBytes,
  runtimeRasterVisibleBounds,
  surfacePixelsMaterialized
} from './runtime-raster'

const rgbaRuntime = (): RuntimeRasterTiles => ({
  kind: 'sparse-tiles-v1',
  format: 'rgba',
  width: 4,
  height: 4,
  tileSize: 2,
  data: new Uint8Array([
    1, 2, 3, 4, 5, 6, 7, 8,
    9, 10, 11, 12, 13, 14, 15, 16
  ]),
  tileOffsets: new Int32Array([1, 0, 0, 0])
})

const rgbaLayer = (): RgbaLayer => ({
  id: 'layer-runtime', name: 'runtime', description: '', visible: true, locked: false,
  opacity: 1, blendMode: 'normal', width: 4, height: 4, offsetX: 0, offsetY: 0,
  format: 'rgba', pixels: new Uint8ClampedArray(4)
})

describe('runtime sparse raster', () => {
  it('reads present and absent tiles without materializing the full surface', () => {
    const layer = rgbaLayer()
    installRuntimeRaster(layer, rgbaRuntime())

    expect(surfacePixelsMaterialized(layer)).toBe(false)
    expect(readSurfacePackedLocal(layer, 0, 0)).toBe(0x04030201)
    expect(readSurfacePackedLocal(layer, 1, 1)).toBe(0x100f0e0d)
    expect(readSurfacePackedLocal(layer, 3, 0)).toBe(0)
    expect(surfacePixelsMaterialized(layer)).toBe(false)
  })

  it('copies a clipped packed region from sparse tiles without materializing the surface', () => {
    const layer = rgbaLayer()
    installRuntimeRaster(layer, rgbaRuntime())

    expect(Array.from(readSurfacePackedRegion(layer, -1, 0, 4, 2))).toEqual([
      0, 0x04030201, 0x08070605, 0,
      0, 0x0c0b0a09, 0x100f0e0d, 0
    ])
    expect(surfacePixelsMaterialized(layer)).toBe(false)
  })

  it('shares runtime storage and materializes only when pixels are requested', () => {
    const layer = rgbaLayer()
    installRuntimeRaster(layer, rgbaRuntime())
    const surface: AnimationCelSurface = { format: 'rgba', width: 4, height: 4, offsetX: 0, offsetY: 0, pixels: new Uint8ClampedArray(4) }
    assignRasterStorage(surface, layer)

    expect(rasterStorageIdentity(surface)).toBe(rasterStorageIdentity(layer))
    expect(surfacePixelsMaterialized(surface)).toBe(false)
    expect(layer.pixels).toHaveLength(64)
    expect(surfacePixelsMaterialized(layer)).toBe(true)
    layer.pixels[0] = 99
    expect(surface.pixels).toBe(layer.pixels)
    expect(readSurfacePackedLocal(surface, 0, 0) & 0xff).toBe(99)
  })

  it('preserves lazy storage through worker transfer preparation and rehydration', () => {
    const document = createDocument('runtime transfer', 4, 4, 'rgba')
    const layer = document.layers[0] as RgbaLayer
    installRuntimeRaster(layer, rgbaRuntime())
    const cel = document.animation!.cels[0]
    cel.surface = { format: 'rgba', width: 4, height: 4, offsetX: 0, offsetY: 0, pixels: new Uint8ClampedArray(4) }
    assignRasterStorage(cel.surface, layer)

    prepareRuntimeRasterDocumentForTransfer(document)
    expect(layer.pixels).toHaveLength(4)
    rehydrateRuntimeRasterDocument(document)

    expect(surfacePixelsMaterialized(layer)).toBe(false)
    expect(runtimeRasterForSurface(cel.surface)).toBe(runtimeRasterForSurface(layer))
    expect(readSurfacePackedLocal(layer, 1, 0)).toBe(0x08070605)
  })

  it('keeps RGBA visible bounds prepared in the worker without materializing pixels', () => {
    const document = createDocument('runtime metadata', 4, 4, 'rgba')
    const layer = document.layers[0] as RgbaLayer
    installRuntimeRaster(layer, rgbaRuntime())
    installRuntimeRaster(document.animation!.cels[0].surface!, runtimeRasterForSurface(layer)!)

    expect(cachedRuntimeRasterVisibleBounds(layer)).toBeUndefined()
    prepareRuntimeRasterMetadata(document)
    expect(runtimeRasterForSurface(layer)?.visibleBounds).toEqual({ x: 0, y: 0, width: 2, height: 2 })
    expect(cachedRuntimeRasterVisibleBounds(layer)).toEqual({ x: 0, y: 0, width: 2, height: 2 })
    expect(surfacePixelsMaterialized(layer)).toBe(false)

    prepareRuntimeRasterDocumentForTransfer(document)
    rehydrateRuntimeRasterDocument(document)
    expect(runtimeRasterVisibleBounds(layer)).toEqual({ x: 0, y: 0, width: 2, height: 2 })
    expect(surfacePixelsMaterialized(layer)).toBe(false)
  })

  it('detaches runtime storage when a layer becomes editable', () => {
    const layer = rgbaLayer()
    installRuntimeRaster(layer, rgbaRuntime())
    markLayerContentChanged(layer)

    expect(runtimeRasterForSurface(layer)).toBeNull()
    expect(layer.pixels).toHaveLength(64)
  })

  it('counts shared sparse payload once instead of full logical surfaces', () => {
    const document = createDocument('resident bytes', 4, 4, 'rgba')
    const layer = document.layers[0] as RgbaLayer
    const runtime = rgbaRuntime()
    installRuntimeRaster(layer, runtime)
    installRuntimeRaster(document.animation!.cels[0].surface!, runtime)

    expect(runtimeRasterResidentBytes(document)).toBe(runtime.data.byteLength + runtime.tileOffsets.byteLength)
  })

  it('composites sparse RGBA pixels without materializing the source layer', () => {
    const document = createDocument('runtime composite', 4, 4, 'rgba')
    const layer = document.layers[0] as RgbaLayer
    installRuntimeRaster(layer, rgbaRuntime())
    installRuntimeRaster(document.animation!.cels[0].surface!, runtimeRasterForSurface(layer)!)

    expect(Array.from(compositeRegion(document, 0, 0, 4, 1))).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 0, 0, 0, 0, 0, 0, 0, 0
    ])
    expect(surfacePixelsMaterialized(layer)).toBe(false)
  })
})
