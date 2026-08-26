import { afterEach, describe, expect, it, vi } from 'vitest'
import { strFromU8, unzipSync, zipSync, type Zippable } from 'fflate'
import { activateAnimationFrame, addBlankAnimationFrame, cloneAnimationCelsForLayer, connectAnimationCels, duplicateAnimationFrame, ensureAnimationDocument, refreshActiveAnimationFrame, resizeAnimationCelsAt, syncActiveAnimationFrame, syncActiveAnimationLayer } from './animation'
import { animationMaskAt, createDocument, createLayer, createLayerMask, duplicateLayer, getActiveLayer, getLayerStorageOrigin, readLayerColorAt, resizeDocumentAt, writeLayerColor } from './document'
import { applySelectionTranslationPreview, captureSelectionTransform, restoreSelectionTranslationPreview } from './tools'
import { acceptProjectSaveBaseline, compactProjectRasterStorage, decodeProject, encodeProject, encodeProjectAsync, encodeProjectSaveAsync, encodeProjectWorkerPayload, PROJECT_SCHEMA_VERSION, migrateProjectManifest, readProjectGalleryMetadata, registerProjectSaveBaseline, type ProjectEncodeWorkerPayload } from './project-format'
import { rasterStorageIdentity, runtimeRasterForSurface, surfacePixelsMaterialized } from './runtime-raster'
import { createDefaultLayerStyles } from './layer-styles'
import { createSolidTileset, createTilemapCelData, createTilesetFromRgba, deleteTilesetTile, renderTilemapSurface, writeTilesetTilePixels } from './tilemap'
import { freeTileSourceRefs, renderFreeTileSurface } from './free-tile'
import { rerenderFreeTileReferences } from './free-tile-document'

const zipCompressionMethods = (data: Uint8Array): Map<string, number> => {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  let eocd = data.byteLength - 22
  while (eocd >= 0 && view.getUint32(eocd, true) !== 0x06054b50) eocd -= 1
  if (eocd < 0) throw new Error('ZIP end record missing')
  const entries = view.getUint16(eocd + 10, true)
  let offset = view.getUint32(eocd + 16, true)
  const decoder = new TextDecoder()
  const methods = new Map<string, number>()
  for (let index = 0; index < entries; index += 1) {
    if (view.getUint32(offset, true) !== 0x02014b50) throw new Error('ZIP central entry missing')
    const nameLength = view.getUint16(offset + 28, true)
    const extraLength = view.getUint16(offset + 30, true)
    const commentLength = view.getUint16(offset + 32, true)
    const name = decoder.decode(data.subarray(offset + 46, offset + 46 + nameLength))
    methods.set(name, view.getUint16(offset + 10, true))
    offset += 46 + nameLength + extraLength + commentLength
  }
  return methods
}

interface TestRasterManifestEntry {
  dataFile: string
  linkedContentId?: string
  dataEncoding?: string
  layerStyles?: unknown
  width?: number
  height?: number
  offsetX?: number
  offsetY?: number
  text?: {
    text: string
    fontFamily: string
    fontSize: number
    lineSpacing: number
    letterSpacing: number
    spacingMode?: 'font' | 'actual'
    antialias: 'pixel' | 'smooth'
    color: { r: number; g: number; b: number; a: number }
    boxWidth?: number
    boxHeight?: number
    styleRuns?: Array<{
      start: number
      end: number
      fontSize?: number
      lineSpacing?: number
      letterSpacing?: number
      color?: { r: number; g: number; b: number; a: number }
    }>
  }
}

interface TestProjectManifest {
  schemaVersion: number
  document: {
    schemaVersion: number
    layers: Array<TestRasterManifestEntry & { id: string; kind?: 'text' | 'tilemap' | 'free-tile'; tilemapTilesetId?: string; freeTileTilesetId?: string; freeTileSetId?: string; freeTileSources?: Array<{ id: string; name?: string; tilesetId: string; offsetX?: number }> }>
    groups?: Array<{ layerStyles?: unknown }>
    tilesets?: Array<{ id: string; dataFile: string; tileSlots?: Array<string | null> }>
    animation: {
      cels: Array<TestRasterManifestEntry & { id: string; layerId: string; frameId: string; tilemap?: { cells: Array<{ index: number; tilesetId: string; tileId: string }> }; freeTiles?: { instances: Array<{ id: string; sourceId?: string; tileId?: string; x: number; y: number; rotation?: number; flipHorizontal?: boolean; flipVertical?: boolean }> } }>
      loopSections?: Array<{ id: string; name: string; startFrameId: string; endFrameId: string; direction: 'forward' | 'reverse'; repeatCount: number | null }>
    }
  }
}

const readTestManifest = (files: Record<string, Uint8Array>): TestProjectManifest => JSON.parse(strFromU8(files['manifest.json'])) as TestProjectManifest

const activeRasterEntry = (files: Record<string, Uint8Array>): TestRasterManifestEntry => {
  const manifest = readTestManifest(files)
  return manifest.document.animation.cels.find((cel) => cel.dataFile) ?? manifest.document.layers[0]
}

describe('project manifest migration boundary', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('accepts the current schema through the migration entry point', () => {
    const manifest = { app: 'MoonSprite', schemaVersion: PROJECT_SCHEMA_VERSION, document: { schemaVersion: PROJECT_SCHEMA_VERSION } }
    expect(migrateProjectManifest(manifest)).toMatchObject({ ...manifest, document: { ...manifest.document, animation: { activeFrameId: 'frame-1' } } })
  })

  it('opens v16 projects saved before linked layers were introduced', () => {
    const files = unzipSync(encodeProject(createDocument('v16 project', 8, 6, 'rgba')))
    const manifest = readTestManifest(files)
    manifest.schemaVersion = 16
    manifest.document.schemaVersion = 16
    files['manifest.json'] = new TextEncoder().encode(JSON.stringify(manifest))

    expect(decodeProject(zipSync(files))).toMatchObject({
      name: 'v16 project',
      width: 8,
      height: 6,
      schemaVersion: PROJECT_SCHEMA_VERSION
    })
  })

  it('round-trips linked layer frame content while preserving independent placement', () => {
    const document = createDocument('linked layer project', 4, 1, 'rgba')
    const source = getActiveLayer(document)
    writeLayerColor(document, source, 0, { r: 255, g: 0, b: 0, a: 255 })
    syncActiveAnimationLayer(document, source.id)
    const secondFrameId = addBlankAnimationFrame(document)
    activateAnimationFrame(document, secondFrameId)
    writeLayerColor(document, source, 0, { r: 0, g: 80, b: 255, a: 255 })
    syncActiveAnimationLayer(document, source.id)
    source.linkedContentId = 'layer-link-roundtrip'
    const linked = duplicateLayer(document, source.id)
    cloneAnimationCelsForLayer(document, source.id, linked)
    linked.offsetX = 3
    syncActiveAnimationLayer(document, linked.id)

    const files = unzipSync(encodeProject(document))
    const manifest = readTestManifest(files)
    const sourceMetadata = manifest.document.layers.find((layer) => layer.id === source.id)!
    const linkedMetadata = manifest.document.layers.find((layer) => layer.id === linked.id)!
    expect(sourceMetadata.linkedContentId).toBe('layer-link-roundtrip')
    expect(linkedMetadata.linkedContentId).toBe(sourceMetadata.linkedContentId)
    expect(linkedMetadata.dataFile).toBe(sourceMetadata.dataFile)
    for (const frame of ensureAnimationDocument(document).frames) {
      const sourceCel = manifest.document.animation.cels.find((cel) => cel.layerId === source.id && cel.frameId === frame.id)!
      const linkedCel = manifest.document.animation.cels.find((cel) => cel.layerId === linked.id && cel.frameId === frame.id)!
      expect(linkedCel.dataFile).toBe(sourceCel.dataFile)
    }

    const reopened = decodeProject(zipSync(files))
    const reopenedSource = reopened.layers.find((layer) => layer.id === source.id)!
    const reopenedLinked = reopened.layers.find((layer) => layer.id === linked.id)!
    expect(reopenedSource.linkedContentId).toBe('layer-link-roundtrip')
    expect(reopenedLinked.linkedContentId).toBe(reopenedSource.linkedContentId)
    expect(reopenedSource.offsetX).toBe(0)
    expect(reopenedLinked.offsetX).toBe(3)
    expect(rasterStorageIdentity(reopenedLinked)).toBe(rasterStorageIdentity(reopenedSource))
    const reopenedTimeline = ensureAnimationDocument(reopened)
    for (const frame of reopenedTimeline.frames) {
      const sourceCel = reopenedTimeline.cels.find((cel) => cel.layerId === source.id && cel.frameId === frame.id)!
      const linkedCel = reopenedTimeline.cels.find((cel) => cel.layerId === linked.id && cel.frameId === frame.id)!
      expect(rasterStorageIdentity(linkedCel.surface!)).toBe(rasterStorageIdentity(sourceCel.surface!))
    }
  })

  it('rejects linked layer groups whose manifest points members at different raster storage', () => {
    const document = createDocument('corrupt linked layer project', 2, 1, 'rgba')
    const source = getActiveLayer(document)
    source.linkedContentId = 'layer-link-corrupt'
    const linked = duplicateLayer(document, source.id)
    cloneAnimationCelsForLayer(document, source.id, linked)
    const files = unzipSync(encodeProject(document))
    const manifest = readTestManifest(files)
    const linkedMetadata = manifest.document.layers.find((layer) => layer.id === linked.id)!
    const linkedCel = manifest.document.animation.cels.find((cel) => cel.layerId === linked.id)!
    const corruptDataFile = 'cels/corrupt-linked-storage.rgba'
    files[corruptDataFile] = files[linkedCel.dataFile].slice()
    linkedMetadata.dataFile = corruptDataFile
    linkedCel.dataFile = corruptDataFile
    files['manifest.json'] = new TextEncoder().encode(JSON.stringify(manifest))

    expect(() => decodeProject(zipSync(files))).toThrow()
  })

  it('round-trips document slices and normalizes invalid persisted entries', () => {
    const document = createDocument('slice project', 16, 12, 'rgba')
    document.slices = [
      { id: 'head', name: 'Head', x: 2, y: 3, width: 5, height: 4 },
      { id: 'edge', name: 'Edge', x: 14, y: 10, width: 9, height: 9 }
    ]
    const reopened = decodeProject(encodeProject(document))
    expect(reopened.slices).toEqual([
      { id: 'head', name: 'Head', x: 2, y: 3, width: 5, height: 4 },
      { id: 'edge', name: 'Edge', x: 14, y: 10, width: 2, height: 2 }
    ])
  })

  it('round-trips named animation loop sections in the current manifest', () => {
    const document = createDocument('loop section project', 2, 2, 'rgba')
    const secondFrameId = addBlankAnimationFrame(document)
    const timeline = ensureAnimationDocument(document)
    timeline.loopSections = [{
      id: 'loop-run',
      name: 'Run',
      startFrameId: timeline.frames[0].id,
      endFrameId: secondFrameId,
      direction: 'reverse',
      repeatCount: 3
    }]

    const files = unzipSync(encodeProject(document))
    expect(readTestManifest(files).document.animation.loopSections).toEqual(timeline.loopSections)
    expect(decodeProject(zipSync(files)).animation?.loopSections).toEqual(timeline.loopSections)
  })

  it('round-trips non-destructive layer styles introduced by v11', () => {
    const document = createDocument('styled layer project', 8, 8, 'rgba')
    const styles = createDefaultLayerStyles()
    styles.enabled = false
    styles.stroke = { ...styles.stroke, enabled: true, color: { r: 10, g: 20, b: 30, a: 255 }, size: 4, position: 'both', kernel: 'horizontal', directions: { nw: false, n: false, ne: false, w: true, e: true, sw: false, s: false, se: false }, smartHue: true, smartHueDarkness: 68 }
    styles.shadow = { ...styles.shadow, enabled: true, color: { r: 0, g: 0, b: 0, a: 128 }, offsetX: -3, offsetY: 5, blur: 2, smartShadow: true, smartShadowDarkness: 62 }
    styles.gradientOverlay = { ...styles.gradientOverlay, enabled: true, dither: 'bayer-4' }
    document.layers[0].layerStyles = styles
    document.layers[0].groupId = 'group'
    document.groups.push({ id: 'group', name: 'Group', parentGroupId: null, visible: true, locked: false, opacity: 1, blendMode: 'normal', layerStyles: styles })

    const files = unzipSync(encodeProject(document))
    const manifest = readTestManifest(files)
    expect(manifest.document.layers[0].layerStyles).toMatchObject({ enabled: false, stroke: { enabled: true, size: 4, position: 'both', kernel: 'horizontal', directions: { w: true, e: true, n: false, s: false }, smartHue: true, smartHueDarkness: 68 }, shadow: { offsetX: -3, offsetY: 5, blur: 2, smartShadow: true, smartShadowDarkness: 62 }, gradientOverlay: { enabled: true, dither: 'bayer-4' } })
    expect(manifest.document.groups?.[0].layerStyles).toMatchObject({ stroke: { enabled: true, position: 'both', kernel: 'horizontal' } })
    const reopened = decodeProject(zipSync(files))
    expect(reopened.layers[0].layerStyles).toEqual(styles)
    expect(reopened.groups[0].layerStyles).toEqual(styles)
    expect(reopened.groups[0].layerStyles).not.toBe(reopened.layers[0].layerStyles)
  })

  it('round-trips background layer metadata in the v12 manifest', () => {
    const document = createDocument('background layer project', 8, 8, 'rgba')
    document.layers[0].background = { mode: 'preset', pattern: 'solid' }

    const reopened = decodeProject(encodeProject(document))

    expect(reopened.layers[0].background).toEqual({ mode: 'preset', pattern: 'solid' })
    expect(reopened.schemaVersion).toBe(PROJECT_SCHEMA_VERSION)
  })

  it('round-trips v13 tilesets and editable tilemap cells', () => {
    const document = createDocument('tilemap project', 4, 2, 'rgba')
    const layer = getActiveLayer(document)
    const cel = ensureAnimationDocument(document).cels[0]
    const tileset = createSolidTileset('tileset-1', 'Solid', 2, 2, { r: 10, g: 20, b: 30, a: 255 }, 'tile-1')
    tileset.tileSlots = [null, null, 'tile-1']
    const tilemap = createTilemapCelData(document.width, document.height, 2, 2)
    tilemap.cells[1] = { tilesetId: tileset.id, tileId: tileset.tileIds[0] }
    document.tilesets = [tileset]
    layer.kind = 'tilemap'
    layer.tilemapTilesetId = tileset.id
    cel.tilemap = tilemap
    cel.surface = renderTilemapSurface(tilemap, document.tilesets, document.colorMode)
    refreshActiveAnimationFrame(document)

    const files = unzipSync(encodeProject(document))
    const manifest = readTestManifest(files)
    expect(manifest.document.layers[0].kind).toBe('tilemap')
    expect(manifest.document.layers[0].tilemapTilesetId).toBe('tileset-1')
    expect(manifest.document.tilesets).toEqual([expect.objectContaining({ id: 'tileset-1', tileSlots: [null, null, 'tile-1'], dataFile: 'tilesets/tileset-1.rgba' })])
    expect(manifest.document.animation.cels[0].tilemap?.cells).toEqual([{ index: 1, tilesetId: 'tileset-1', tileId: 'tile-1' }])

    const reopened = decodeProject(zipSync(files))
    const reopenedCel = ensureAnimationDocument(reopened).cels[0]
    expect(reopened.layers[0].kind).toBe('tilemap')
    expect(reopened.layers[0].tilemapTilesetId).toBe('tileset-1')
    expect(reopened.tilesets?.[0]).toMatchObject({ id: 'tileset-1', tileWidth: 2, tileHeight: 2, tileIds: ['tile-1'], tileSlots: [null, null, 'tile-1'] })
    expect(reopenedCel.tilemap?.cells[1]).toEqual({ tilesetId: 'tileset-1', tileId: 'tile-1' })
    expect(readLayerColorAt(reopened, getActiveLayer(reopened), 2, 0)).toEqual({ r: 10, g: 20, b: 30, a: 255 })
  })

  it('round-trips one Tileset referenced by multiple Tilemap layers', () => {
    const document = createDocument('shared tilemap tileset project', 4, 2, 'rgba')
    const firstLayer = getActiveLayer(document)
    const firstCel = ensureAnimationDocument(document).cels[0]
    const tileset = createSolidTileset('shared-tileset', 'Shared Tiles', 2, 1, { r: 10, g: 20, b: 30, a: 255 }, 'tile-1')
    document.tilesets = [tileset]
    firstLayer.kind = 'tilemap'
    firstLayer.tilemapTilesetId = tileset.id
    const firstTilemap = createTilemapCelData(document.width, document.height, 2, 1)
    firstTilemap.cells[0] = { tilesetId: tileset.id, tileId: tileset.tileIds[0] }
    firstCel.tilemap = firstTilemap
    firstCel.surface = renderTilemapSurface(firstTilemap, document.tilesets, document.colorMode)

    const secondLayer = createLayer('Props', document.width, document.height, document.colorMode)
    secondLayer.kind = 'tilemap'
    secondLayer.tilemapTilesetId = tileset.id
    document.layers.push(secondLayer)
    const secondTilemap = createTilemapCelData(document.width, document.height, 2, 1)
    secondTilemap.cells[1] = { tilesetId: tileset.id, tileId: tileset.tileIds[0] }
    const timeline = ensureAnimationDocument(document)
    const secondCel = timeline.cels.find((cel) => cel.layerId === secondLayer.id && cel.frameId === timeline.activeFrameId)!
    secondCel.tilemap = secondTilemap
    secondCel.surface = renderTilemapSurface(secondTilemap, document.tilesets, document.colorMode)
    refreshActiveAnimationFrame(document)

    const reopened = decodeProject(encodeProject(document))
    const reopenedTimeline = ensureAnimationDocument(reopened)
    expect(reopened.tilesets).toHaveLength(1)
    expect(reopened.layers.filter((layer) => layer.kind === 'tilemap').map((layer) => layer.tilemapTilesetId)).toEqual(['shared-tileset', 'shared-tileset'])
    expect(reopenedTimeline.cels.filter((cel) => cel.tilemap)).toHaveLength(2)
    expect(reopenedTimeline.cels.find((cel) => cel.layerId === secondLayer.id)?.tilemap?.cells[1]).toEqual({ tilesetId: 'shared-tileset', tileId: 'tile-1' })
  })

  it('round-trips overlapping Free Tile instances and keeps source edits reusable', () => {
    const document = createDocument('free tile project', 5, 2, 'rgba')
    const layer = getActiveLayer(document)
    const cel = ensureAnimationDocument(document).cels[0]
    const red = createSolidTileset('free-red', 'Red Source', 1, 1, { r: 255, g: 0, b: 0, a: 255 }, 'red')
    const blue = createSolidTileset('free-blue', 'Blue Source', 1, 1, { r: 0, g: 0, b: 255, a: 255 }, 'blue')
    document.tilesets = [red, blue]
    layer.kind = 'free-tile'
    layer.freeTileSetId = 'free-tile-set'
    layer.freeTileSources = [
      { id: 'source-red', name: 'Red Source', tilesetId: red.id, visible: true, locked: false, opacity: 1, blendMode: 'normal', offsetX: 0, offsetY: 0 },
      { id: 'source-blue', name: 'Blue Source', tilesetId: blue.id, visible: true, locked: false, opacity: 1, blendMode: 'normal', offsetX: 1, offsetY: 0 }
    ]
    cel.freeTiles = { instances: [
      { id: 'instance-red', sourceId: 'source-red', x: 0, y: 1, rotation: 2, flipHorizontal: true },
      { id: 'instance-blue-overlap', sourceId: 'source-blue', x: 0, y: 0 },
      { id: 'instance-blue-copy', sourceId: 'source-blue', x: 2, y: 0 }
    ] }
    cel.surface = renderFreeTileSurface(cel.freeTiles, freeTileSourceRefs(layer.freeTileSources, document.tilesets), document.colorMode, document.width, document.height)
    refreshActiveAnimationFrame(document)

    const files = unzipSync(encodeProject(document))
    const manifest = readTestManifest(files)
    expect(manifest.document.layers[0]).toMatchObject({ kind: 'free-tile', freeTileSetId: 'free-tile-set', freeTileSources: [{ id: 'source-red', tilesetId: 'free-red' }, { id: 'source-blue', tilesetId: 'free-blue' }] })
    expect(manifest.document.layers[0]).not.toHaveProperty('freeTileTilesetId')
    expect(manifest.document.animation.cels[0].freeTiles?.instances).toEqual(cel.freeTiles.instances)

    const reopened = decodeProject(zipSync(files))
    const reopenedCel = ensureAnimationDocument(reopened).cels[0]
    expect(reopened.layers[0]).toMatchObject({ kind: 'free-tile', freeTileSources: [{ id: 'source-red' }, { id: 'source-blue', offsetX: 1 }] })
    expect(reopenedCel.freeTiles?.instances).toEqual(cel.freeTiles.instances.map((instance) => ({
      ...instance,
      visible: instance.visible ?? true,
      locked: instance.locked ?? false
    })))
    expect(readLayerColorAt(reopened, getActiveLayer(reopened), 1, 0)).toEqual({ r: 0, g: 0, b: 255, a: 255 })

    const edited = new Uint8ClampedArray([0, 255, 0, 255])
    expect(writeTilesetTilePixels(reopened.tilesets!.find((tileset) => tileset.id === 'free-blue')!, 'blue', edited)).toBe(true)
    expect(rerenderFreeTileReferences(reopened, 'free-blue', 'blue')).toBe(2)
    expect(readLayerColorAt(reopened, getActiveLayer(reopened), 1, 0)).toEqual({ r: 0, g: 255, b: 0, a: 255 })
    expect(readLayerColorAt(reopened, getActiveLayer(reopened), 3, 0)).toEqual({ r: 0, g: 255, b: 0, a: 255 })
  })

  it('round-trips multiple Free Tile layers that share one source set', () => {
    const document = createDocument('shared free tile project', 4, 2, 'rgba')
    const first = getActiveLayer(document)
    const timeline = ensureAnimationDocument(document)
    const firstCel = timeline.cels[0]
    const tileset = createSolidTileset('shared-free-tileset', 'Shared Source', 1, 1, { r: 255, g: 0, b: 0, a: 255 }, 'shared-tile')
    document.tilesets = [tileset]
    first.kind = 'free-tile'
    first.freeTileSetId = 'shared-free-set'
    first.freeTileSources = [{ id: 'shared-source', name: 'Shared Source', tilesetId: tileset.id, visible: true, locked: false, opacity: 1, blendMode: 'normal', offsetX: 0, offsetY: 0 }]
    firstCel.freeTiles = { instances: [{ id: 'shared-instance-a', sourceId: 'shared-source', x: 0, y: 0 }] }
    firstCel.surface = renderFreeTileSurface(firstCel.freeTiles, freeTileSourceRefs(first.freeTileSources, document.tilesets), document.colorMode, document.width, document.height)

    const second = createLayer('Second Shared Layer', document.width, document.height, document.colorMode)
    second.kind = 'free-tile'
    second.freeTileSetId = first.freeTileSetId
    second.freeTileSources = first.freeTileSources
    document.layers.push(second)
    timeline.cels.push({
      id: 'shared-free-cel-b',
      layerId: second.id,
      frameId: timeline.activeFrameId,
      opacity: second.opacity,
      freeTiles: { instances: [{ id: 'shared-instance-b', sourceId: 'shared-source', x: 2, y: 0 }] },
      surface: renderFreeTileSurface({ instances: [{ id: 'shared-instance-b', sourceId: 'shared-source', x: 2, y: 0 }] }, freeTileSourceRefs(second.freeTileSources, document.tilesets), document.colorMode, document.width, document.height)
    })
    refreshActiveAnimationFrame(document)

    const reopened = decodeProject(encodeProject(document))
    const sharedLayers = reopened.layers.filter((layer) => layer.kind === 'free-tile')
    expect(sharedLayers).toHaveLength(2)
    expect(sharedLayers.map((layer) => layer.freeTileSetId)).toEqual(['shared-free-set', 'shared-free-set'])
    expect(sharedLayers[0].freeTileSources).toBe(sharedLayers[1].freeTileSources)
    expect(sharedLayers.map((layer) => layer.freeTileSources?.[0].id)).toEqual(['shared-source', 'shared-source'])
    expect(reopened.tilesets).toHaveLength(1)

    expect(writeTilesetTilePixels(reopened.tilesets![0], 'shared-tile', new Uint8ClampedArray([0, 255, 0, 255]))).toBe(true)
    expect(rerenderFreeTileReferences(reopened, reopened.tilesets![0].id, 'shared-tile')).toBe(2)
    expect(readLayerColorAt(reopened, sharedLayers[0], 0, 0)).toEqual({ r: 0, g: 255, b: 0, a: 255 })
    expect(readLayerColorAt(reopened, sharedLayers[1], 2, 0)).toEqual({ r: 0, g: 255, b: 0, a: 255 })
  })

  it('migrates v14 multi-tile Free Tile ownership into independent v15 sources', () => {
    const document = createDocument('legacy free tile project', 5, 2, 'rgba')
    const layer = getActiveLayer(document)
    const cel = ensureAnimationDocument(document).cels[0]
    const pixels = new Uint8ClampedArray(4 * 1 * 4)
    pixels.set([255, 0, 0, 255, 255, 0, 0, 255, 0, 0, 255, 255, 0, 0, 255, 255])
    const tileset = createTilesetFromRgba('legacy-free-tileset', 'Legacy Free Tiles', 4, 1, pixels, 2, 1, (index) => `tile-${index}`)
    document.tilesets = [tileset]
    layer.kind = 'tilemap'
    layer.tilemapTilesetId = tileset.id
    const tilemap = createTilemapCelData(document.width, document.height, 2, 1)
    tilemap.cells[0] = { tilesetId: tileset.id, tileId: 'tile-0' }
    tilemap.cells[1] = { tilesetId: tileset.id, tileId: 'tile-1' }
    cel.tilemap = tilemap
    cel.surface = renderTilemapSurface(tilemap, document.tilesets, document.colorMode)
    refreshActiveAnimationFrame(document)

    const files = unzipSync(encodeProject(document))
    const manifest = readTestManifest(files)
    const layerManifest = manifest.document.layers[0]
    layerManifest.kind = 'free-tile'
    layerManifest.freeTileTilesetId = tileset.id
    delete layerManifest.tilemapTilesetId
    const celManifest = manifest.document.animation.cels[0]
    celManifest.freeTiles = { instances: [
      { id: 'legacy-red', tileId: 'tile-0', x: 0, y: 0 },
      { id: 'legacy-blue', tileId: 'tile-1', x: 1, y: 0 }
    ] }
    delete celManifest.tilemap
    manifest.schemaVersion = 14
    manifest.document.schemaVersion = 14
    files['manifest.json'] = new TextEncoder().encode(JSON.stringify(manifest))

    const reopened = decodeProject(zipSync(files))
    const migratedLayer = reopened.layers[0]
    const migratedCel = ensureAnimationDocument(reopened).cels[0]
    expect(migratedLayer).toMatchObject({ kind: 'free-tile' })
    expect(migratedLayer.freeTileSources).toHaveLength(2)
    expect(reopened.tilesets).toHaveLength(2)
    expect(reopened.tilesets?.some((candidate) => candidate.id === tileset.id)).toBe(false)
    expect(migratedCel.freeTiles?.instances).toEqual([
      expect.objectContaining({ id: 'legacy-red', sourceId: migratedLayer.freeTileSources![0].id }),
      expect.objectContaining({ id: 'legacy-blue', sourceId: migratedLayer.freeTileSources![1].id })
    ])
    expect(readLayerColorAt(reopened, getActiveLayer(reopened), 1, 0)).toEqual({ r: 0, g: 0, b: 255, a: 255 })
  })

  it('migrates v17 Free Tile layers into distinct source sets and rejects missing v18 identities', () => {
    const document = createDocument('free tile set migration', 3, 1, 'rgba')
    const timeline = ensureAnimationDocument(document)
    const first = getActiveLayer(document)
    const firstTileset = createSolidTileset('migration-free-a', 'Migration A', 1, 1, { r: 255, g: 0, b: 0, a: 255 }, 'migration-tile-a')
    const secondTileset = createSolidTileset('migration-free-b', 'Migration B', 1, 1, { r: 0, g: 0, b: 255, a: 255 }, 'migration-tile-b')
    document.tilesets = [firstTileset, secondTileset]
    first.kind = 'free-tile'
    first.freeTileSetId = 'migration-set-a'
    first.freeTileSources = [{ id: 'migration-source-a', name: 'Migration A', tilesetId: firstTileset.id, visible: true, locked: false, opacity: 1, blendMode: 'normal', offsetX: 0, offsetY: 0 }]
    timeline.cels[0].freeTiles = { instances: [] }
    timeline.cels[0].surface = renderFreeTileSurface({ instances: [] }, freeTileSourceRefs(first.freeTileSources, document.tilesets), document.colorMode, document.width, document.height)

    const second = createLayer('Migration B', document.width, document.height, document.colorMode)
    second.kind = 'free-tile'
    second.freeTileSetId = 'migration-set-b'
    second.freeTileSources = [{ id: 'migration-source-b', name: 'Migration B', tilesetId: secondTileset.id, visible: true, locked: false, opacity: 1, blendMode: 'normal', offsetX: 0, offsetY: 0 }]
    document.layers.push(second)
    timeline.cels.push({
      id: 'migration-free-cel-b',
      layerId: second.id,
      frameId: timeline.activeFrameId,
      opacity: second.opacity,
      freeTiles: { instances: [] },
      surface: renderFreeTileSurface({ instances: [] }, freeTileSourceRefs(second.freeTileSources, document.tilesets), document.colorMode, document.width, document.height)
    })
    refreshActiveAnimationFrame(document)

    const legacyFiles = unzipSync(encodeProject(document))
    const legacyManifest = readTestManifest(legacyFiles)
    legacyManifest.schemaVersion = 17
    legacyManifest.document.schemaVersion = 17
    for (const layer of legacyManifest.document.layers) delete layer.freeTileSetId
    legacyFiles['manifest.json'] = new TextEncoder().encode(JSON.stringify(legacyManifest))
    const migrated = decodeProject(zipSync(legacyFiles))
    const migratedSetIds = migrated.layers.filter((layer) => layer.kind === 'free-tile').map((layer) => layer.freeTileSetId)
    expect(migratedSetIds).toHaveLength(2)
    expect(migratedSetIds.every(Boolean)).toBe(true)
    expect(new Set(migratedSetIds).size).toBe(2)

    const invalidFiles = unzipSync(encodeProject(document))
    const invalidManifest = readTestManifest(invalidFiles)
    invalidManifest.document.layers.find((layer) => layer.kind === 'free-tile')!.freeTileSetId = ''
    invalidFiles['manifest.json'] = new TextEncoder().encode(JSON.stringify(invalidManifest))
    expect(() => decodeProject(zipSync(invalidFiles))).toThrow()
  })

  it('rejects corrupt Free Tile instances and invalid shared-set ownership', () => {
    const createFreeTileProject = () => {
      const document = createDocument('free tile validation', 2, 2, 'rgba')
      const layer = getActiveLayer(document)
      const cel = ensureAnimationDocument(document).cels[0]
      const tileset = createSolidTileset('free-tileset', 'Free Tiles', 1, 1, { r: 255, g: 0, b: 0, a: 255 }, 'tile-1')
      document.tilesets = [tileset]
      layer.kind = 'free-tile'
      layer.freeTileSetId = 'free-set-a'
      layer.freeTileSources = [{ id: 'source-1', name: 'Free Tiles', tilesetId: tileset.id, visible: true, locked: false, opacity: 1, blendMode: 'normal', offsetX: 0, offsetY: 0 }]
      cel.freeTiles = { instances: [
        { id: 'instance-1', sourceId: 'source-1', x: 0, y: 0 },
        { id: 'instance-2', sourceId: 'source-1', x: 1, y: 0 }
      ] }
      cel.surface = renderFreeTileSurface(cel.freeTiles, freeTileSourceRefs(layer.freeTileSources, document.tilesets), document.colorMode, document.width, document.height)
      refreshActiveAnimationFrame(document)
      return document
    }

    for (const corrupt of [
      (manifest: TestProjectManifest) => { manifest.document.animation.cels[0].freeTiles!.instances[1].id = 'instance-1' },
      (manifest: TestProjectManifest) => { manifest.document.animation.cels[0].freeTiles!.instances[0].sourceId = 'missing' },
      (manifest: TestProjectManifest) => { manifest.document.animation.cels[0].freeTiles!.instances[0].tileId = 'tile-1' },
      (manifest: TestProjectManifest) => { manifest.document.animation.cels[0].freeTiles!.instances[0].rotation = 4 }
    ]) {
      const files = unzipSync(encodeProject(createFreeTileProject()))
      const manifest = readTestManifest(files)
      corrupt(manifest)
      files['manifest.json'] = new TextEncoder().encode(JSON.stringify(manifest))
      expect(() => decodeProject(zipSync(files))).toThrow()
    }

    const invalidSetFiles = unzipSync(encodeProject(createFreeTileProject()))
    const invalidSetManifest = readTestManifest(invalidSetFiles)
    const firstLayer = invalidSetManifest.document.layers[0]
    const firstCel = invalidSetManifest.document.animation.cels[0]
    invalidSetManifest.document.layers.push({ ...firstLayer, id: 'second-free-layer', freeTileSetId: 'free-set-b' })
    invalidSetManifest.document.animation.cels.push({ ...firstCel, id: 'second-free-cel', layerId: 'second-free-layer', freeTiles: { instances: [] } })
    invalidSetFiles['manifest.json'] = new TextEncoder().encode(JSON.stringify(invalidSetManifest))
    expect(() => decodeProject(zipSync(invalidSetFiles))).toThrow()

    const mismatchedSetFiles = unzipSync(encodeProject(createFreeTileProject()))
    const mismatchedSetManifest = readTestManifest(mismatchedSetFiles)
    const canonicalLayer = mismatchedSetManifest.document.layers[0]
    const canonicalCel = mismatchedSetManifest.document.animation.cels[0]
    mismatchedSetManifest.document.layers.push({
      ...canonicalLayer,
      id: 'mismatched-free-layer',
      freeTileSources: canonicalLayer.freeTileSources!.map((source) => ({ ...source, offsetX: (source.offsetX ?? 0) + 1 }))
    })
    mismatchedSetManifest.document.animation.cels.push({ ...canonicalCel, id: 'mismatched-free-cel', layerId: 'mismatched-free-layer', freeTiles: { instances: [] } })
    mismatchedSetFiles['manifest.json'] = new TextEncoder().encode(JSON.stringify(mismatchedSetManifest))
    expect(() => decodeProject(zipSync(mismatchedSetFiles))).toThrow()

    const sharedAcrossKinds = createFreeTileProject()
    const sharedTileset = sharedAcrossKinds.tilesets![0]
    const tilemapLayer = createLayer('Tilemap Owner', sharedAcrossKinds.width, sharedAcrossKinds.height, sharedAcrossKinds.colorMode)
    tilemapLayer.kind = 'tilemap'
    tilemapLayer.tilemapTilesetId = sharedTileset.id
    sharedAcrossKinds.layers.push(tilemapLayer)
    const tilemap = createTilemapCelData(sharedAcrossKinds.width, sharedAcrossKinds.height, 1, 1)
    ensureAnimationDocument(sharedAcrossKinds).cels.push({
      id: 'shared-tilemap-cel',
      layerId: tilemapLayer.id,
      frameId: ensureAnimationDocument(sharedAcrossKinds).activeFrameId,
      opacity: tilemapLayer.opacity,
      tilemap,
      surface: renderTilemapSurface(tilemap, sharedAcrossKinds.tilesets!, sharedAcrossKinds.colorMode)
    })
    expect(() => decodeProject(encodeProject(sharedAcrossKinds))).toThrow()
  })

  it('round-trips a tileset whose sheet has spare trailing capacity', () => {
    const document = createDocument('sparse tileset project', 2, 2, 'rgba')
    const source = new Uint8ClampedArray(4 * 2 * 4)
    source.fill(255)
    const full = createTilesetFromRgba('tileset-sparse', 'Sparse', 4, 2, source, 2, 2, (index) => `tile-${index + 1}`)
    const sparse = deleteTilesetTile(full, 'tile-1')!
    expect(sparse.tileIds).toEqual(['tile-2'])
    expect(sparse.columns * sparse.rows).toBe(2)
    document.tilesets = [sparse]

    const reopened = decodeProject(encodeProject(document))
    expect(reopened.tilesets?.[0]).toMatchObject({ columns: 2, rows: 1, tileIds: ['tile-2'] })
  })

  it('opens earlier v13 Tilesets without explicit layout slots as compact rows', () => {
    const document = createDocument('legacy tileset layout', 2, 2, 'rgba')
    document.tilesets = [createSolidTileset('tileset-legacy', 'Legacy', 1, 1, { r: 20, g: 40, b: 60, a: 255 }, 'tile-1')]
    const files = unzipSync(encodeProject(document))
    const manifest = readTestManifest(files)
    delete manifest.document.tilesets![0].tileSlots
    files['manifest.json'] = new TextEncoder().encode(JSON.stringify(manifest))

    expect(decodeProject(zipSync(files)).tilesets?.[0].tileSlots).toEqual(['tile-1'])
  })

  it('migrates v12 projects with an empty tileset collection', () => {
    const migrated = migrateProjectManifest({
      app: 'MoonSprite',
      schemaVersion: 12,
      document: { schemaVersion: 12, width: 4, height: 4, layers: [], animation: { frames: [], cels: [] } }
    })
    expect(migrated).toMatchObject({
      schemaVersion: PROJECT_SCHEMA_VERSION,
      sourceSchemaVersion: 12,
      document: { schemaVersion: PROJECT_SCHEMA_VERSION, tilesets: [] }
    })
  })

  it('does not invent Free Tile metadata while migrating v13 projects', () => {
    const migrated = migrateProjectManifest({
      app: 'MoonSprite',
      schemaVersion: 13,
      document: {
        schemaVersion: 13,
        width: 2,
        height: 2,
        layers: [{ id: 'layer', kind: 'free-tile', freeTileTilesetId: 'tileset' }],
        tilesets: [],
        animation: { frames: [{ id: 'frame-1', duration: 100 }], activeFrameId: 'frame-1', cels: [{ id: 'cel', layerId: 'layer', frameId: 'frame-1', freeTiles: { instances: [] } }] }
      }
    })
    expect(migrated.document.layers[0]).not.toMatchObject({ kind: 'free-tile' })
    expect(migrated.document.animation.cels[0]).not.toHaveProperty('freeTiles')
  })

  it('rejects tilemap cells that reference a missing tile', () => {
    const document = createDocument('broken tilemap project', 2, 2, 'rgba')
    const layer = getActiveLayer(document)
    const cel = ensureAnimationDocument(document).cels[0]
    const tileset = createSolidTileset('tileset-1', 'Solid', 2, 2, { r: 255, g: 0, b: 0, a: 255 }, 'tile-1')
    const tilemap = createTilemapCelData(2, 2, 2, 2)
    tilemap.cells[0] = { tilesetId: 'tileset-1', tileId: 'tile-1' }
    document.tilesets = [tileset]
    layer.kind = 'tilemap'
    cel.tilemap = tilemap
    cel.surface = renderTilemapSurface(tilemap, document.tilesets, document.colorMode)
    refreshActiveAnimationFrame(document)
    const files = unzipSync(encodeProject(document))
    const manifest = readTestManifest(files)
    manifest.document.animation.cels[0].tilemap!.cells[0].tileId = 'missing'
    files['manifest.json'] = new TextEncoder().encode(JSON.stringify(manifest))

    expect(() => decodeProject(zipSync(files))).toThrow()
  })

  it('rejects Tileset layouts that omit or duplicate stable tile IDs', () => {
    const document = createDocument('broken tileset layout', 2, 2, 'rgba')
    document.tilesets = [createSolidTileset('tileset-1', 'Solid', 1, 1, { r: 255, g: 0, b: 0, a: 255 }, 'tile-1')]
    const files = unzipSync(encodeProject(document))
    const manifest = readTestManifest(files)
    manifest.document.tilesets![0].tileSlots = [null, null]
    files['manifest.json'] = new TextEncoder().encode(JSON.stringify(manifest))

    expect(() => decodeProject(zipSync(files))).toThrow()
  })

  it('keeps v11 layer styles without accepting future background metadata', () => {
    const styles = createDefaultLayerStyles()
    styles.stroke.enabled = true
    delete (styles as { enabled?: boolean }).enabled
    const migrated = migrateProjectManifest({
      app: 'MoonSprite',
      schemaVersion: 11,
      document: {
        schemaVersion: 11,
        width: 8,
        height: 8,
        layers: [{ id: 'layer-1', dataFile: 'layers/layer-1.rgba', layerStyles: styles, background: { mode: 'canvas' } }],
        groups: [],
        animation: { frames: [], cels: [] }
      }
    })

    expect(migrated.document.layers[0].layerStyles).toMatchObject({ enabled: true, stroke: { enabled: true } })
    expect(migrated.document.layers[0].background).toBeUndefined()
  })

  it('migrates the v1 single-frame document into the animation-ready schema', () => {
    expect(migrateProjectManifest({ app: 'MoonSprite', schemaVersion: 1, document: { schemaVersion: 1 } })).toMatchObject({ schemaVersion: PROJECT_SCHEMA_VERSION, document: { schemaVersion: PROJECT_SCHEMA_VERSION, animation: { frames: [{ id: 'frame-1', duration: 100 }] } } })
  })

  it('migrates v2 projects to the layer-mask schema without inventing masks', () => {
    const migrated = migrateProjectManifest({ app: 'MoonSprite', schemaVersion: 2, document: { schemaVersion: 2, groups: [], animation: { frames: [{ id: 'frame-1', duration: 100 }], cels: [], activeFrameId: 'frame-1', loop: true } } })
    expect(migrated).toMatchObject({ schemaVersion: PROJECT_SCHEMA_VERSION, document: { schemaVersion: PROJECT_SCHEMA_VERSION, groups: [] } })
  })

  it('migrates v5 projects with sparse rasters and no slices to the current schema', () => {
    const migrated = migrateProjectManifest({
      app: 'MoonSprite',
      schemaVersion: 5,
      document: { schemaVersion: 5, width: 16, height: 12, layers: [], animation: { frames: [], cels: [] } }
    })
    expect(migrated).toMatchObject({ schemaVersion: PROJECT_SCHEMA_VERSION, sourceSchemaVersion: 5, document: { schemaVersion: PROJECT_SCHEMA_VERSION, slices: [] } })
  })

  it('migrates v6 projects without inventing editable text metadata', () => {
    const migrated = migrateProjectManifest({
      app: 'MoonSprite',
      schemaVersion: 6,
      document: { schemaVersion: 6, width: 16, height: 12, layers: [], animation: { frames: [], cels: [] }, slices: [] }
    })
    expect(migrated).toMatchObject({ schemaVersion: PROJECT_SCHEMA_VERSION, sourceSchemaVersion: 6, document: { schemaVersion: PROJECT_SCHEMA_VERSION, slices: [] } })
  })

  it('migrates v7 editable text without inventing local style runs', () => {
    const migrated = migrateProjectManifest({
      app: 'MoonSprite',
      schemaVersion: 7,
      document: { schemaVersion: 7, width: 16, height: 12, layers: [], animation: { frames: [], cels: [] }, slices: [] }
    })
    expect(migrated).toMatchObject({ schemaVersion: PROJECT_SCHEMA_VERSION, sourceSchemaVersion: 7, document: { schemaVersion: PROJECT_SCHEMA_VERSION } })
  })

  it('migrates v8 styled text without inventing a text box', () => {
    const migrated = migrateProjectManifest({
      app: 'MoonSprite',
      schemaVersion: 8,
      document: { schemaVersion: 8, width: 16, height: 12, layers: [], animation: { frames: [], cels: [] }, slices: [] }
    })
    expect(migrated).toMatchObject({ schemaVersion: PROJECT_SCHEMA_VERSION, sourceSchemaVersion: 8, document: { schemaVersion: PROJECT_SCHEMA_VERSION } })
  })

  it('migrates v9 text-box projects without changing their color mode', () => {
    const migrated = migrateProjectManifest({
      app: 'MoonSprite',
      schemaVersion: 9,
      document: { schemaVersion: 9, colorMode: 'indexed', width: 16, height: 12, layers: [], animation: { frames: [], cels: [] }, slices: [] }
    })
    expect(migrated).toMatchObject({ schemaVersion: PROJECT_SCHEMA_VERSION, sourceSchemaVersion: 9, document: { schemaVersion: PROJECT_SCHEMA_VERSION, colorMode: 'indexed' } })
  })

  it('migrates v10 color-mode projects without inventing layer styles', () => {
    const migrated = migrateProjectManifest({
      app: 'MoonSprite',
      schemaVersion: 10,
      document: {
        schemaVersion: 10,
        colorMode: 'grayscale',
        width: 16,
        height: 12,
        layers: [{ id: 'layer-1', dataFile: 'layers/layer-1.rgba', layerStyles: { stroke: { enabled: true } } }],
        groups: [{ id: 'group-1', layerStyles: { stroke: { enabled: true } } }],
        animation: { frames: [], cels: [] },
        slices: []
      }
    })
    expect(migrated).toMatchObject({ schemaVersion: PROJECT_SCHEMA_VERSION, sourceSchemaVersion: 10, document: { schemaVersion: PROJECT_SCHEMA_VERSION, colorMode: 'grayscale' } })
    expect(migrated.document.layers[0].layerStyles).toBeUndefined()
    expect(migrated.document.groups[0].layerStyles).toBeUndefined()
  })

  it('migrates v15 projects without inventing or trusting loop sections', () => {
    const migrated = migrateProjectManifest({
      app: 'MoonSprite',
      schemaVersion: 15,
      document: {
        schemaVersion: 15,
        width: 2,
        height: 2,
        layers: [],
        animation: {
          frames: [{ id: 'frame-1', duration: 100 }, { id: 'frame-2', duration: 100 }],
          cels: [],
          activeFrameId: 'frame-1',
          loop: true,
          loopSections: [{ id: 'future-field', name: 'Ignore', startFrameId: 'frame-1', endFrameId: 'frame-2', direction: 'reverse', repeatCount: 2 }]
        }
      }
    })

    expect(migrated.document.animation.loopSections).toEqual([])
  })

  it('does not trust linked-layer metadata from v16 projects', () => {
    const migrated = migrateProjectManifest({
      app: 'MoonSprite',
      schemaVersion: 16,
      document: {
        schemaVersion: 16,
        width: 1,
        height: 1,
        layers: [{ id: 'layer-1', name: 'Layer', linkedContentId: 'future-link', dataFile: 'layers/layer-1.rgba' }],
        animation: { frames: [], cels: [] }
      }
    })

    expect(migrated.document.layers[0].linkedContentId).toBeUndefined()
  })

  it('migrates v4 raster resources as raw data', () => {
    const migrated = migrateProjectManifest({
      app: 'MoonSprite',
      schemaVersion: 4,
      document: {
        schemaVersion: 4,
        layers: [{ id: 'layer-1', dataFile: 'layers/layer-1.rgba' }],
        animation: { frames: [{ id: 'frame-1', duration: 100 }], activeFrameId: 'frame-1', loop: true, cels: [{ id: 'cel-1', layerId: 'layer-1', frameId: 'frame-1', dataFile: 'cels/cel-1.rgba' }] }
      }
    })

    expect(migrated.document.layers[0].dataEncoding).toBe('raw')
    expect(migrated.document.animation.cels[0].dataEncoding).toBe('raw')
  })

  it('rejects unknown versions without guessing their fields', () => {
    expect(() => migrateProjectManifest({ app: 'MoonSprite', schemaVersion: PROJECT_SCHEMA_VERSION + 1, document: { schemaVersion: PROJECT_SCHEMA_VERSION + 1 } })).toThrow()
    expect(() => migrateProjectManifest({ app: 'Other', schemaVersion: 1, document: { schemaVersion: 1 } })).toThrow()
  })

  it('rejects unknown v5 raster encodings instead of guessing raw data', () => {
    expect(() => migrateProjectManifest({
      app: 'MoonSprite',
      schemaVersion: 5,
      document: { schemaVersion: 5, layers: [{ dataFile: 'layers/unknown', dataEncoding: 'future-tiles' }] }
    })).toThrow()
    expect(() => migrateProjectManifest({
      app: 'MoonSprite',
      schemaVersion: 5,
      document: { schemaVersion: 5, animation: { cels: [{ dataFile: 'cels/unknown', dataEncoding: 'future-tiles' }] } }
    })).toThrow()
  })

  it('round-trips editable text layer and cel metadata with the rendered surface', () => {
    const document = createDocument('editable text', 8, 8, 'rgba')
    const layer = getActiveLayer(document)
    const cel = ensureAnimationDocument(document).cels[0]
    layer.kind = 'text'
    cel.text = {
      text: 'Moon\nSprite',
      fontFamily: 'Consolas',
      fontSize: 18,
      lineSpacing: 3,
      letterSpacing: 1,
      spacingMode: 'actual',
      antialias: 'smooth',
      color: { r: 12, g: 34, b: 56, a: 200 },
      styleRuns: [
        { start: 0, end: 4, fontSize: 24, letterSpacing: 0, color: { r: 255, g: 0, b: 0, a: 255 } },
        { start: 5, end: 11, lineSpacing: 2, color: { r: 0, g: 0, b: 255, a: 255 } }
      ],
      originX: 3,
      originY: 4,
      boxWidth: 7,
      boxHeight: 6,
      transforms: [{ source: { x: 3, y: 4, width: 4, height: 2 }, target: { x: 2, y: 3, width: 8, height: 4 }, angle: 45, shear: { axis: 'x', edge: 'n', amount: 2 } }]
    }
    layer.offsetX = 3
    layer.offsetY = 4
    cel.surface!.offsetX = 3
    cel.surface!.offsetY = 4
    cel.surface!.pixels.set([12, 34, 56, 200])

    const archive = encodeProject(document)
    const manifest = readTestManifest(unzipSync(archive))
    const restored = decodeProject(archive)
    const restoredCel = ensureAnimationDocument(restored).cels[0]

    expect(manifest.document.layers[0].kind).toBe('text')
    expect(manifest.document.animation.cels[0].text).toEqual(cel.text)
    expect(getActiveLayer(restored).kind).toBe('text')
    expect(restoredCel.text).toEqual(cel.text)
    expect(restoredCel.surface).toMatchObject({ offsetX: 3, offsetY: 4 })
    expect(restoredCel.surface?.pixels.slice(0, 4)).toEqual(new Uint8ClampedArray([12, 34, 56, 200]))
  })

  it('round-trips sparse RGBA bytes exactly, including transparent RGB values', () => {
    const document = createDocument('sparse rgba', 128, 128, 'rgba')
    const pixels = getActiveLayer(document).pixels as Uint8ClampedArray
    pixels.set([17, 34, 51, 0], 4)
    pixels.set([255, 0, 128, 255], ((80 * 128) + 96) * 4)

    const files = unzipSync(encodeProject(document))
    const entry = activeRasterEntry(files)
    const restored = decodeProject(zipSync(files))

    expect(entry.dataEncoding).toBe('sparse-tiles-v1')
    expect(entry.dataFile).toMatch(/\.tiles$/)
    expect(getActiveLayer(restored).pixels).toEqual(pixels)
  })

  it('round-trips sparse indexed pixels and empty surfaces', () => {
    const indexed = createDocument('sparse indexed', 128, 128, 'indexed')
    const indexedPixels = getActiveLayer(indexed).pixels as Uint32Array
    indexedPixels[65 * 128 + 66] = 2
    const indexedFiles = unzipSync(encodeProject(indexed))
    const emptyFiles = unzipSync(encodeProject(createDocument('empty sparse', 128, 128, 'rgba')))

    const restoredIndexed = decodeProject(zipSync(indexedFiles))
    const restoredIndexedLayer = getActiveLayer(restoredIndexed)
    expect(activeRasterEntry(indexedFiles).dataEncoding).toBe('sparse-tiles-v1')
    expect(runtimeRasterForSurface(restoredIndexedLayer)).not.toBeNull()
    expect(surfacePixelsMaterialized(restoredIndexedLayer)).toBe(false)
    expect(restoredIndexedLayer).toMatchObject({ width: 128, height: 128, offsetX: 0, offsetY: 0 })
    expect(getLayerStorageOrigin(restoredIndexedLayer)).toEqual({ x: 0, y: 0 })
    expect((restoredIndexedLayer.pixels as Uint32Array)[65 * 128 + 66]).toBe(2)
    expect(activeRasterEntry(emptyFiles).dataEncoding).toBe('sparse-tiles-v1')
    expect(emptyFiles[activeRasterEntry(emptyFiles).dataFile].byteLength).toBe(24)
    const restoredEmptyLayer = getActiveLayer(decodeProject(zipSync(emptyFiles)))
    expect(restoredEmptyLayer).toMatchObject({ width: 128, height: 128, offsetX: 0, offsetY: 0 })
    expect(Array.from(restoredEmptyLayer.pixels).every((value) => value === 0)).toBe(true)
  })

  it('reuses an unchanged lazy sparse resource without materializing it', async () => {
    const document = createDocument('lazy sparse reuse', 128, 128, 'rgba')
    writeLayerColor(document, getActiveLayer(document), 65 * 128 + 66, { r: 20, g: 40, b: 60, a: 255 })
    const archive = encodeProject(document)
    const restored = decodeProject(archive)
    const layer = getActiveLayer(restored)
    const sourceEntry = activeRasterEntry(unzipSync(archive))

    registerProjectSaveBaseline(restored, 'D:/gallery/lazy-sparse-reuse.moonsprite', archive)
    const encoded = await encodeProjectSaveAsync(restored)
    const patch = unzipSync(encoded.data)
    const plan = JSON.parse(strFromU8(patch['.moonsprite-save-plan.json'])) as { entries: Array<{ path: string }> }

    expect(surfacePixelsMaterialized(layer)).toBe(false)
    expect(patch[sourceEntry.dataFile]).toBeUndefined()
    expect(plan.entries.map((entry) => entry.path)).toContain(sourceEntry.dataFile)
  })

  it('keeps dense small raster resources in raw form', () => {
    const document = createDocument('dense raw', 2, 2, 'rgba')
    ;(getActiveLayer(document).pixels as Uint8ClampedArray).fill(255)
    const files = unzipSync(encodeProject(document))
    const entry = activeRasterEntry(files)

    expect(entry.dataEncoding).toBe('raw')
    expect(entry.dataFile).not.toMatch(/\.tiles$/)
    expect(files[entry.dataFile]).toHaveLength(16)
  })

  it('rejects malformed sparse raster containers', () => {
    const document = createDocument('corrupt sparse', 128, 128, 'rgba')
    const pixels = getActiveLayer(document).pixels as Uint8ClampedArray
    pixels[3] = 255
    pixels[(70 * 128 + 70) * 4 + 3] = 255
    const original = unzipSync(encodeProject(document))
    const dataFile = activeRasterEntry(original).dataFile
    const corruptions: Array<(bytes: Uint8Array) => Uint8Array> = [
      (bytes) => { new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).setUint32(0, 0, true); return bytes },
      (bytes) => { new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).setUint32(8, 127, true); return bytes },
      (bytes) => { const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength); view.setUint32(40, 0, true); view.setUint32(44, 0, true); return bytes },
      (bytes) => { new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).setUint32(24, 128, true); return bytes },
      (bytes) => bytes.subarray(0, bytes.byteLength - 1)
    ]

    for (const corrupt of corruptions) {
      const files = { ...original, [dataFile]: corrupt(original[dataFile].slice()) }
      expect(() => decodeProject(zipSync(files))).toThrow()
    }
  })

  it('round-trips project-owned outline settings', () => {
    const document = createDocument('outline settings', 2, 2, 'rgba')
    document.outlineSettings = {
      color: { r: 10, g: 20, b: 30, a: 255 },
      thickness: 3,
      position: 'inside',
      kernel: 'square',
      directions: { nw: true, n: false, ne: true, w: true, e: true, sw: false, s: true, se: false },
      smartHue: true,
      smartHueDarkness: 32,
      previewEnabled: false
    }

    expect(decodeProject(encodeProject(document)).outlineSettings).toEqual(document.outlineSettings)
  })

  it('migrates legacy outline settings without smart hue fields', () => {
    const document = createDocument('legacy outline settings', 2, 2, 'rgba')
    ;(document as unknown as { outlineSettings: unknown }).outlineSettings = {
      color: { r: 10, g: 20, b: 30, a: 255 },
      thickness: 2,
      position: 'outside',
      kernel: 'round',
      directions: { nw: false, n: true, ne: false, w: true, e: true, sw: false, s: true, se: false },
      previewEnabled: true
    }

    expect(decodeProject(encodeProject(document)).outlineSettings).toMatchObject({ smartHue: false, smartHueDarkness: 45 })
  })

  it('round-trips normalized layer panel context without keeping stale ids', () => {
    const document = createDocument('layer panel state', 2, 2, 'rgba')
    const activeLayerId = document.activeLayerId
    document.groups.push({ id: 'group-1', name: 'Group', parentGroupId: null, visible: false, locked: true, opacity: 1, blendMode: 'normal' })
    document.layerPanelState = {
      activeLayerId,
      selectedLayerIds: [activeLayerId, 'missing-layer'],
      selectedGroupIds: ['group-1', 'missing-group'],
      selectedGroupId: 'group-1',
      layerSelectionAnchorId: 'missing-layer',
      collapsedGroupIds: ['group-1', 'missing-group']
    }

    const restored = decodeProject(encodeProject(document))

    expect(restored.layerPanelState).toEqual({
      activeLayerId,
      selectedLayerIds: [activeLayerId],
      selectedGroupIds: ['group-1'],
      selectedGroupId: 'group-1',
      layerSelectionAnchorId: 'group-1',
      collapsedGroupIds: ['group-1']
    })
    expect(restored.groups[0]).toMatchObject({ visible: false, locked: true })
  })

  it('round-trips fixed palette slots including empty positions', () => {
    const document = createDocument('palette slots', 2, 2, 'rgba')
    document.paletteColumns = 16
    document.paletteSlots = new Array(64).fill(null)
    document.paletteSlots[9] = document.paletteOrder[0]
    document.paletteSlots[23] = document.paletteOrder[1]

    const restored = decodeProject(encodeProject(document))

    expect(restored.paletteColumns).toBe(16)
    expect(restored.paletteSlots).toHaveLength(64)
    expect(restored.paletteSlots?.[9]).toBe(document.paletteOrder[0])
    expect(restored.paletteSlots?.[23]).toBe(document.paletteOrder[1])
    expect(restored.paletteOrder).toEqual(document.paletteOrder)
  })

  it('round-trips project display settings, statistics, and timelapse assets', () => {
    const document = createDocument('project metadata', 2, 2, 'rgba')
    document.displaySettings = { showPixelGrid: true, showGrid: true, grid: { x: 3, y: 4, width: 12, height: 18 } }
    document.statistics = { strokeCount: 42, operationCount: 68, drawingTimeMs: 123_456 }
    document.timelapse = {
      enabled: true,
      quality: 'high',
      fps: 24,
      speed: 16,
      mode: 'smart',
      snapshots: [{ id: 'timelapse-1000', capturedAt: 1000, elapsedMs: 0, width: 2, height: 2, data: new Uint8Array([137, 80, 78, 71]) }]
    }

    const encoded = encodeProject(document)
    const restored = decodeProject(encoded)
    const methods = zipCompressionMethods(encoded)

    expect(restored.displaySettings).toEqual(document.displaySettings)
    expect(restored.statistics).toEqual(document.statistics)
    expect(restored.timelapse).toMatchObject({ enabled: true, quality: 'high', fps: 24, speed: 16, mode: 'smart' })
    expect(restored.timelapse?.snapshots[0]).toMatchObject({ id: 'timelapse-1000', capturedAt: 1000, elapsedMs: 0, width: 2, height: 2 })
    expect(Array.from(restored.timelapse?.snapshots[0].data ?? [])).toEqual([137, 80, 78, 71])
    expect(methods.get('timelapse/timelapse-1000.png')).toBe(0)
    expect(methods.get(`layers/${document.layers[0].id}.rgba`)).toBe(8)
  })

  it('round-trips the complete timelapse history beyond 600 snapshots', () => {
    const document = createDocument('unbounded timelapse project', 1, 1, 'rgba')
    document.timelapse = {
      enabled: true,
      quality: 'low',
      fps: 12,
      speed: 8,
      snapshots: Array.from({ length: 601 }, (_, index) => ({
        id: `snapshot-${index}`,
        capturedAt: index,
        elapsedMs: index,
        width: 1,
        height: 1,
        data: new Uint8Array([137, 80, 78, 71])
      }))
    }

    const restored = decodeProject(encodeProject(document))

    expect(restored.timelapse?.snapshots).toHaveLength(601)
    expect(restored.timelapse?.snapshots[0].id).toBe('snapshot-0')
    expect(restored.timelapse?.snapshots.at(-1)?.id).toBe('snapshot-600')
  })

  it('keeps stored timelapse PNGs as zero-copy archive views', async () => {
    const document = createDocument('zero-copy timelapse', 2, 2, 'rgba')
    document.timelapse!.snapshots = [{ id: 'snapshot-stored', capturedAt: 1, elapsedMs: 0, width: 2, height: 2, data: new Uint8Array([137, 80, 78, 71]) }]

    const archive = encodeProject(document)
    const restored = decodeProject(archive)
    const snapshot = restored.timelapse!.snapshots[0]

    expect(snapshot.data.buffer).toBe(archive.buffer)
    expect(Array.from(snapshot.data)).toEqual([137, 80, 78, 71])

    registerProjectSaveBaseline(restored, 'D:/gallery/zero-copy-timelapse.moonsprite', archive)
    writeLayerColor(restored, getActiveLayer(restored), 0, { r: 255, g: 0, b: 0, a: 255 })
    const incremental = await encodeProjectSaveAsync(restored)
    const patch = unzipSync(incremental.data)
    const plan = JSON.parse(strFromU8(patch['.moonsprite-save-plan.json'])) as { entries: Array<{ path: string }> }
    expect(patch['timelapse/snapshot-stored.png']).toBeUndefined()
    expect(plan.entries.map((entry) => entry.path)).toContain('timelapse/snapshot-stored.png')
  })

  it('still decodes legacy deflated timelapse PNG entries', () => {
    const document = createDocument('deflated timelapse', 2, 2, 'rgba')
    document.timelapse!.snapshots = [{ id: 'snapshot-deflated', capturedAt: 1, elapsedMs: 0, width: 2, height: 2, data: new Uint8Array([137, 80, 78, 71]) }]
    const files = unzipSync(encodeProject(document))
    const archive = zipSync(files, { level: 6 })

    const restored = decodeProject(archive)

    expect(Array.from(restored.timelapse!.snapshots[0].data)).toEqual([137, 80, 78, 71])
    expect(restored.timelapse!.snapshots[0].data.buffer).not.toBe(archive.buffer)
  })

  it('round-trips independent cel pixels and frame durations', () => {
    const document = createDocument('animated', 2, 2, 'rgba')
    getActiveLayer(document).pixels[3] = 255
    const second = duplicateAnimationFrame(document)
    getActiveLayer(document).pixels[3] = 64
    getActiveLayer(document).opacity = 0.4
    ensureAnimationDocument(document).frames[1].duration = 240
    syncActiveAnimationFrame(document)

    const restored = decodeProject(encodeProject(document))
    expect(restored.animation?.frames.map((frame) => frame.duration)).toEqual([100, 240])
    expect(restored.animation?.activeFrameId).toBe(second)
    expect(getActiveLayer(restored).pixels[3]).toBe(64)
    expect(getActiveLayer(restored).opacity).toBeCloseTo(0.4)
    activateAnimationFrame(restored, 'frame-1')
    expect(getActiveLayer(restored).pixels[3]).toBe(255)
    expect(getActiveLayer(restored).opacity).toBeCloseTo(1)
  })

  it('stores shared active and linked cel pixels only once', () => {
    const document = createDocument('deduplicated animation', 2, 1, 'rgba')
    getActiveLayer(document).pixels.set([255, 0, 0, 255, 0, 0, 0, 0])
    const timeline = ensureAnimationDocument(document)
    const secondFrameId = duplicateAnimationFrame(document)
    const first = timeline.cels.find((cel) => cel.frameId === timeline.frames[0].id)!
    const second = timeline.cels.find((cel) => cel.frameId === secondFrameId)!
    connectAnimationCels(document, [first.id, second.id])

    const files = unzipSync(encodeProject(document))
    const manifest = JSON.parse(strFromU8(files['manifest.json'])) as { document: { animation: { cels: Array<{ id: string; linkedCelId?: string; dataFile?: string }> } } }
    const storedCels = manifest.document.animation.cels
    const linked = storedCels.find((cel) => cel.id === second.id)!
    const pixelFiles = Object.keys(files).filter((name) => name.startsWith('layers/') || name.startsWith('cels/'))

    expect(linked).toMatchObject({ linkedCelId: first.id })
    expect(linked.dataFile).toBeUndefined()
    expect(pixelFiles).toHaveLength(1)

    const restored = decodeProject(zipSync(files))
    const restoredTimeline = ensureAnimationDocument(restored)
    const restoredFirst = restoredTimeline.cels.find((cel) => cel.id === first.id)!
    const restoredSecond = restoredTimeline.cels.find((cel) => cel.id === second.id)!
    expect(restoredSecond.linkedCelId).toBe(restoredFirst.id)
    expect(restoredSecond.surface).toBe(restoredFirst.surface)
    expect(restored.layers[0].pixels).toBe(restoredFirst.surface?.pixels)
  })

  it('round-trips the async archive and reports monotonic progress', async () => {
    const document = createDocument('async archive', 320, 256, 'rgba')
    writeLayerColor(document, getActiveLayer(document), 42, { r: 25, g: 50, b: 75, a: 255 })
    const progress: number[] = []

    const restored = decodeProject(await encodeProjectAsync(document, { onProgress: (value) => progress.push(value) }))

    expect(readLayerColorAt(restored, getActiveLayer(restored), 42, 0)).toEqual({ r: 25, g: 50, b: 75, a: 255 })
    expect(progress[0]).toBe(0)
    expect(progress.at(-1)).toBe(1)
    expect(progress.every((value, index) => index === 0 || value >= progress[index - 1])).toBe(true)
  })

  it('encodes only the changed cel and reuses unchanged compressed project blocks', async () => {
    const document = createDocument('incremental cel save', 4, 4, 'rgba')
    const secondFrameId = duplicateAnimationFrame(document)
    activateAnimationFrame(document, 'frame-1')
    document.timelapse!.snapshots = [{ id: 'snapshot-1', capturedAt: 1, elapsedMs: 0, width: 1, height: 1, data: new Uint8Array([137, 80, 78, 71]) }]
    const initial = encodeProject(document)
    registerProjectSaveBaseline(document, 'D:/gallery/incremental.moonsprite', initial)
    const initialFiles = unzipSync(initial)
    const initialManifest = JSON.parse(strFromU8(initialFiles['manifest.json'])) as { document: { animation: { cels: Array<{ frameId: string; dataFile?: string }> } } }
    const firstDataFile = initialManifest.document.animation.cels.find((cel) => cel.frameId === 'frame-1')!.dataFile!
    const secondDataFile = initialManifest.document.animation.cels.find((cel) => cel.frameId === secondFrameId)!.dataFile!

    writeLayerColor(document, getActiveLayer(document), 0, { r: 255, g: 0, b: 0, a: 255 })
    const encoded = await encodeProjectSaveAsync(document)
    const patch = unzipSync(encoded.data)
    const changedDataFile = readTestManifest(patch).document.animation.cels.find((cel) => cel.dataFile && cel.dataFile !== secondDataFile)!.dataFile
    const plan = JSON.parse(strFromU8(patch['.moonsprite-save-plan.json'])) as { entries: Array<{ path: string }> }

    expect(changedDataFile).not.toBe(firstDataFile)
    expect(patch[changedDataFile]).toBeDefined()
    expect(patch[firstDataFile]).toBeUndefined()
    expect(patch[secondDataFile]).toBeUndefined()
    expect(patch['timelapse/snapshot-1.png']).toBeUndefined()
    expect(plan.entries.map((entry) => entry.path)).toEqual(expect.arrayContaining([secondDataFile, 'timelapse/snapshot-1.png']))
    expect(encoded.sourcePath).toBe('D:/gallery/incremental.moonsprite')
  })

  it('reuses unchanged sparse raster blocks after opening a v5 project', async () => {
    const document = createDocument('incremental sparse save', 128, 128, 'rgba')
    writeLayerColor(document, getActiveLayer(document), 0, { r: 255, g: 0, b: 0, a: 255 })
    const archive = encodeProject(document)
    const restored = decodeProject(archive)
    const sourceEntry = activeRasterEntry(unzipSync(archive))
    const dataFile = sourceEntry.dataFile

    registerProjectSaveBaseline(restored, 'D:/gallery/incremental-sparse.moonsprite', archive)
    const encoded = await encodeProjectSaveAsync(restored)
    const patch = unzipSync(encoded.data)
    const plan = JSON.parse(strFromU8(patch['.moonsprite-save-plan.json'])) as { entries: Array<{ path: string }> }

    expect(dataFile).toMatch(/\.tiles$/)
    expect(patch[dataFile]).toBeUndefined()
    expect(plan.entries.map((entry) => entry.path)).toContain(dataFile)
    expect(activeRasterEntry(patch)).toMatchObject(sourceEntry)
  })

  it('persists canvas expansion offsets instead of reusing stale incremental raster geometry', async () => {
    const document = createDocument('expanded canvas save', 32, 32, 'rgba')
    writeLayerColor(document, getActiveLayer(document), 15 * 32 + 15, { r: 120, g: 70, b: 80, a: 255 })
    const archive = encodeProject(document)
    const restored = decodeProject(archive)
    registerProjectSaveBaseline(restored, 'D:/gallery/expanded-canvas-save.moonsprite', archive)

    resizeDocumentAt(restored, 96, 96, 32, 32)
    resizeAnimationCelsAt(restored, 32, 32, false, 32, 32)
    const encoded = await encodeProjectSaveAsync(restored)
    const patch = unzipSync(encoded.data)
    const savedEntry = activeRasterEntry(patch)
    const plan = patch['.moonsprite-save-plan.json']
      ? JSON.parse(strFromU8(patch['.moonsprite-save-plan.json'])) as { entries: Array<{ path: string }> }
      : { entries: [] }
    const sourceFiles = unzipSync(archive)
    const mergedFiles: Zippable = { ...patch }
    delete mergedFiles['.moonsprite-save-plan.json']
    for (const entry of plan.entries) mergedFiles[entry.path] = sourceFiles[entry.path]
    const reopened = decodeProject(zipSync(mergedFiles))

    expect(savedEntry).toMatchObject({ width: 32, height: 32, offsetX: 32, offsetY: 32 })
    expect(getActiveLayer(reopened)).toMatchObject({ width: 32, height: 32, offsetX: 32, offsetY: 32 })
    expect(readLayerColorAt(reopened, getActiveLayer(reopened), 47, 47)).toEqual({ r: 120, g: 70, b: 80, a: 255 })
    expect(readLayerColorAt(reopened, getActiveLayer(reopened), 15, 15).a).toBe(0)
  })

  it('keeps v5 sparse raster storage lazy while migrating document metadata to v6', () => {
    const document = createDocument('v5 sparse migration', 128, 128, 'rgba')
    writeLayerColor(document, getActiveLayer(document), 65 * 128 + 66, { r: 255, g: 0, b: 0, a: 255 })
    const files = unzipSync(encodeProject(document))
    const manifest = readTestManifest(files)
    manifest.schemaVersion = 5
    manifest.document.schemaVersion = 5
    delete (manifest.document as TestProjectManifest['document'] & { slices?: unknown }).slices
    files['manifest.json'] = new TextEncoder().encode(JSON.stringify(manifest))

    const restored = decodeProject(zipSync(files))
    const layer = getActiveLayer(restored)

    expect(restored.schemaVersion).toBe(PROJECT_SCHEMA_VERSION)
    expect(restored.slices).toEqual([])
    expect(runtimeRasterForSurface(layer)).not.toBeNull()
    expect(surfacePixelsMaterialized(layer)).toBe(false)
    expect(readLayerColorAt(restored, layer, 66, 65)).toEqual({ r: 255, g: 0, b: 0, a: 255 })
    expect(surfacePixelsMaterialized(layer)).toBe(false)
  })

  it('writes compact raster geometry only after a restored v5 surface changes', async () => {
    const document = createDocument('changed compact sparse save', 128, 128, 'rgba')
    writeLayerColor(document, getActiveLayer(document), 65 * 128 + 66, { r: 255, g: 0, b: 0, a: 255 })
    const archive = encodeProject(document)
    const restored = decodeProject(archive)
    const layer = getActiveLayer(restored)

    registerProjectSaveBaseline(restored, 'D:/gallery/changed-compact-sparse.moonsprite', archive)
    writeLayerColor(restored, layer, 1 * layer.width + 3, { r: 0, g: 0, b: 255, a: 255 })
    const encoded = await encodeProjectSaveAsync(restored)
    const patch = unzipSync(encoded.data)
    const savedEntry = activeRasterEntry(patch)
    const reopened = decodeProject(encoded.data)

    expect(savedEntry).toMatchObject({ width: 128, height: 128, offsetX: 0, offsetY: 0 })
    expect(['raw', 'sparse-tiles-v1']).toContain(savedEntry.dataEncoding)
    expect(patch[savedEntry.dataFile]).toBeDefined()
    expect(readLayerColorAt(reopened, getActiveLayer(reopened), 66, 65)).toEqual({ r: 255, g: 0, b: 0, a: 255 })
    expect(readLayerColorAt(reopened, getActiveLayer(reopened), 3, 1)).toEqual({ r: 0, g: 0, b: 255, a: 255 })
  })

  it('rewrites legacy v4 raw resources as v5 sparse resources on first save', async () => {
    const document = createDocument('legacy v4 migration', 128, 128, 'rgba')
    writeLayerColor(document, getActiveLayer(document), 0, { r: 255, g: 0, b: 0, a: 255 })
    const files = unzipSync(encodeProject(document))
    const manifest = readTestManifest(files)
    const rasterEntries = [...manifest.document.layers, ...manifest.document.animation.cels.filter((cel) => cel.dataFile)]
    const rawPixels = new Uint8Array(128 * 128 * 4)
    rawPixels.set([255, 0, 0, 255], 0)
    const migratedFiles = new Map<string, string>()
    for (const entry of rasterEntries) {
      const sparseFile = entry.dataFile
      let rawFile = migratedFiles.get(sparseFile)
      if (!rawFile) {
        rawFile = sparseFile.replace(/\.tiles$/, '')
        migratedFiles.set(sparseFile, rawFile)
        delete files[sparseFile]
        files[rawFile] = rawPixels.slice()
      }
      entry.dataFile = rawFile
      delete entry.dataEncoding
    }
    manifest.schemaVersion = 4
    manifest.document.schemaVersion = 4
    files['manifest.json'] = new TextEncoder().encode(JSON.stringify(manifest))
    const legacyArchive = zipSync(files)
    const restored = decodeProject(legacyArchive)

    registerProjectSaveBaseline(restored, 'D:/gallery/legacy-v4.moonsprite', legacyArchive)
    const encoded = await encodeProjectSaveAsync(restored)
    const patch = unzipSync(encoded.data)
    const savedManifest = readTestManifest(patch)
    const savedFile = activeRasterEntry(patch).dataFile

    expect(savedManifest.schemaVersion).toBe(PROJECT_SCHEMA_VERSION)
    expect(savedManifest.document.schemaVersion).toBe(PROJECT_SCHEMA_VERSION)
    expect(savedFile).toMatch(/\.tiles$/)
    expect(patch[savedFile]).toBeDefined()
  })

  it('does not reuse a cel restored after an incremental save captured a floating preview', async () => {
    const document = createDocument('incremental floating preview', 4, 1, 'rgba')
    const layer = getActiveLayer(document)
    writeLayerColor(document, layer, 0, { r: 255, g: 0, b: 0, a: 255 })
    const initial = encodeProject(document)
    const filePath = 'D:/gallery/floating-preview.moonsprite'
    registerProjectSaveBaseline(document, filePath, initial)
    const initialFiles = unzipSync(initial)
    const manifest = JSON.parse(strFromU8(initialFiles['manifest.json'])) as { document: { animation: { cels: Array<{ dataFile?: string }> } } }
    const dataFile = manifest.document.animation.cels[0].dataFile!
    const selection = { x: 0, y: 0, width: 1, height: 1 }
    const source = captureSelectionTransform(document, selection)!
    const preview = applySelectionTranslationPreview(document, source, { ...selection, x: 2 })
    const previewSave = await encodeProjectSaveAsync(document)
    acceptProjectSaveBaseline(document, filePath, previewSave)

    restoreSelectionTranslationPreview(document, preview)
    const restoredSave = await encodeProjectSaveAsync(document)
    const restoredPatch = unzipSync(restoredSave.data)

    expect(restoredPatch[dataFile]).toBeDefined()
  })

  it('reuses one project encode worker without detaching document pixels', async () => {
    const workers: FakeEncodeWorker[] = []
    class FakeEncodeWorker {
      onmessage: ((event: MessageEvent) => void) | null = null
      onerror: ((event: ErrorEvent) => void) | null = null
      constructor() { workers.push(this) }
      postMessage(message: { id: number; payload: ProjectEncodeWorkerPayload }): void {
        const result = encodeProjectWorkerPayload(structuredClone(message.payload))
        this.onmessage?.({ data: { id: message.id, result } } as MessageEvent)
      }
      terminate(): void {}
    }
    vi.stubGlobal('Worker', FakeEncodeWorker)
    const first = createDocument('first worker save', 16, 16, 'rgba')
    const second = createDocument('second worker save', 16, 16, 'rgba')
    const firstPixels = first.layers[0].pixels

    expect(decodeProject(await encodeProjectAsync(first)).name).toBe('first worker save')
    expect(decodeProject(await encodeProjectAsync(second)).name).toBe('second worker save')
    expect(workers).toHaveLength(1)
    expect(first.layers[0].pixels).toBe(firstPixels)
    expect(firstPixels.byteLength).toBeGreaterThan(0)
  })

  it('skips the redundant layer copy in legacy single-frame archives', async () => {
    const document = createDocument('legacy duplicate', 2, 1, 'rgba')
    document.layers[0].pixels.set([255, 0, 0, 255, 0, 0, 0, 0])
    const files = unzipSync(encodeProject(document))
    const manifest = JSON.parse(strFromU8(files['manifest.json'])) as {
      document: {
        layers: Array<{ dataFile: string }>
        animation: { cels: Array<{ dataFile?: string }> }
      }
    }
    const celFile = manifest.document.animation.cels[0].dataFile!
    manifest.document.layers[0].dataFile = 'layers/legacy-duplicate.rgba'
    files['layers/legacy-duplicate.rgba'] = new Uint8Array([0, 255, 0, 255, 0, 0, 0, 0])
    files['manifest.json'] = new TextEncoder().encode(JSON.stringify(manifest))

    const legacyArchive = zipSync(files)
    const restored = decodeProject(legacyArchive)

    expect(Array.from(restored.layers[0].pixels)).toEqual(Array.from(files[celFile]))
    expect(restored.layers[0].pixels).toBe(restored.animation?.cels[0].surface?.pixels)

    registerProjectSaveBaseline(restored, 'D:/gallery/legacy-duplicate.moonsprite', legacyArchive)
    const incremental = await encodeProjectSaveAsync(restored)
    const patch = unzipSync(incremental.data)
    const plan = JSON.parse(strFromU8(patch['.moonsprite-save-plan.json'])) as { entries: Array<{ path: string }> }
    expect(plan.entries.map((entry) => entry.path)).toContain(celFile)
    expect(plan.entries.map((entry) => entry.path)).not.toContain('layers/legacy-duplicate.rgba')
  })

  it('compacts transparent margins while preserving shared active cel coordinates', () => {
    const document = createDocument('sparse project', 8, 6, 'rgba')
    const layer = getActiveLayer(document)
    writeLayerColor(document, layer, 2 * layer.width + 3, { r: 255, g: 0, b: 0, a: 255 })
    writeLayerColor(document, layer, 3 * layer.width + 4, { r: 0, g: 0, b: 255, a: 255 })

    compactProjectRasterStorage(document, 0)

    expect(layer).toMatchObject({ width: 2, height: 2, offsetX: 3, offsetY: 2 })
    expect(getLayerStorageOrigin(layer)).toEqual({ x: 3, y: 2 })
    expect(layer.pixels).toBe(document.animation?.cels[0].surface?.pixels)
    expect(readLayerColorAt(document, layer, 3, 2)).toEqual({ r: 255, g: 0, b: 0, a: 255 })
    expect(readLayerColorAt(document, layer, 4, 3)).toEqual({ r: 0, g: 0, b: 255, a: 255 })

    const restored = decodeProject(encodeProject(document))
    expect(getActiveLayer(restored)).toMatchObject({ width: 2, height: 2, offsetX: 3, offsetY: 2 })
    expect(readLayerColorAt(restored, getActiveLayer(restored), 4, 3)).toEqual({ r: 0, g: 0, b: 255, a: 255 })
  })

  it('limits gallery previews for large projects to thumbnail dimensions', () => {
    const files = unzipSync(encodeProject(createDocument('large preview', 1024, 512, 'rgba')))
    const preview = files['preview.png']
    const view = new DataView(preview.buffer, preview.byteOffset, preview.byteLength)
    expect(view.getUint32(16)).toBe(512)
    expect(view.getUint32(20)).toBe(256)
  })

  it('generates a bounded gallery preview when the archive omitted preview.png', () => {
    const document = createDocument('generated preview', 1024, 512, 'rgba')
    writeLayerColor(document, document.layers[0], 0, { r: 255, g: 0, b: 0, a: 255 })
    const archive = encodeProject(document, { includePreview: false, compressionLevel: 1 })

    expect(() => readProjectGalleryMetadata(archive)).toThrow()
    const metadata = readProjectGalleryMetadata(archive, { generateMissingPreview: true })
    const view = new DataView(metadata.preview.buffer, metadata.preview.byteOffset, metadata.preview.byteLength)

    expect(metadata).toMatchObject({ name: 'generated preview', width: 1024, height: 512, colorMode: 'rgba' })
    expect([...metadata.preview.slice(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10])
    expect(view.getUint32(16)).toBe(512)
    expect(view.getUint32(20)).toBe(256)
  })

  it('round-trips transparent cell masks with independent ownership', () => {
    const document = createDocument('cell masks', 2, 1, 'rgba')
    const firstCel = ensureAnimationDocument(document).cels[0]
    firstCel.mask = createLayerMask(firstCel.id, 2, 1)
    writeLayerColor(document, firstCel.mask, 0, { r: 32, g: 32, b: 32, a: 255 })
    const secondFrameId = duplicateAnimationFrame(document)
    const secondCel = ensureAnimationDocument(document).cels.find((cel) => cel.frameId === secondFrameId)!
    writeLayerColor(document, secondCel.mask!, 1, { r: 96, g: 96, b: 96, a: 255 })

    const restored = decodeProject(encodeProject(document))
    const restoredTimeline = ensureAnimationDocument(restored)
    const restoredFirst = restoredTimeline.cels.find((cel) => cel.frameId === restoredTimeline.frames[0].id)!
    const restoredSecond = restoredTimeline.cels.find((cel) => cel.frameId === restoredTimeline.frames[1].id)!

    expect(restoredFirst.mask).toMatchObject({ ownerKind: 'cel', ownerId: restoredFirst.id, format: 'rgba' })
    expect(restoredFirst.mask?.pixels).toEqual(new Uint8ClampedArray([32, 32, 32, 255, 0, 0, 0, 0]))
    expect(restoredSecond.mask).toMatchObject({ ownerKind: 'cel', ownerId: restoredSecond.id, format: 'rgba' })
    expect(restoredSecond.mask?.pixels).toEqual(new Uint8ClampedArray([32, 32, 32, 255, 96, 96, 96, 255]))
    expect(restored.layers[0]).not.toHaveProperty('dataFile')
  })

  it('migrates v3 projects and round-trips frame-specific layer-group masks', () => {
    expect(migrateProjectManifest({ app: 'MoonSprite', schemaVersion: 3, document: { schemaVersion: 3 } })).toMatchObject({ schemaVersion: PROJECT_SCHEMA_VERSION, document: { schemaVersion: PROJECT_SCHEMA_VERSION } })
    const document = createDocument('group masks', 1, 1, 'rgba')
    const group = { id: 'group-1', name: 'Group', visible: true, locked: false, opacity: 1, blendMode: 'normal' as const }
    document.groups.push(group)
    document.layers[0].groupId = group.id
    const timeline = ensureAnimationDocument(document)
    const mask = createLayerMask(group.id, 1, 1, 'group')
    writeLayerColor(document, mask, 0, { r: 96, g: 96, b: 96, a: 255 })
    timeline.groupMasks = [{ groupId: group.id, frameId: timeline.activeFrameId, mask }]

    const restored = decodeProject(encodeProject(document))
    const restoredMask = ensureAnimationDocument(restored).groupMasks?.[0]
    expect(restoredMask).toMatchObject({ groupId: group.id, frameId: timeline.activeFrameId, mask: { ownerKind: 'group', ownerId: group.id } })
    expect(restoredMask?.mask.pixels).toEqual(new Uint8ClampedArray([96, 96, 96, 255]))
  })

  it('round-trips independent layer-mask links', () => {
    const document = createDocument('linked masks', 1, 1, 'rgba')
    const timeline = ensureAnimationDocument(document)
    const firstFrameId = timeline.activeFrameId
    const secondFrameId = addBlankAnimationFrame(document)
    const first = timeline.cels.find((cel) => cel.frameId === firstFrameId)!
    const second = timeline.cels.find((cel) => cel.frameId === secondFrameId)!
    first.mask = createLayerMask(first.id, 1, 1)
    first.mask.pixels.set([72, 72, 72, 255])
    second.mask = createLayerMask(second.id, 1, 1)
    second.mask.linkedMaskId = first.mask.id

    const restored = decodeProject(encodeProject(document))
    const restoredTimeline = ensureAnimationDocument(restored)
    const restoredFirst = restoredTimeline.cels.find((cel) => cel.frameId === firstFrameId)!
    const restoredSecond = restoredTimeline.cels.find((cel) => cel.frameId === secondFrameId)!

    expect(restoredSecond.mask?.linkedMaskId).toBe(restoredFirst.mask?.id)
    expect(animationMaskAt(restoredTimeline, restored.activeLayerId, secondFrameId)?.pixels[0]).toBe(72)
  })

  it('rejects missing or corrupt cell-mask data', () => {
    const document = createDocument('corrupt mask', 1, 1, 'rgba')
    const cel = ensureAnimationDocument(document).cels[0]
    cel.mask = createLayerMask(cel.id, 1, 1)
    const files = unzipSync(encodeProject(document))
    const maskFile = Object.keys(files).find((name) => name.startsWith('masks/'))!
    files[maskFile] = new Uint8Array(0)

    expect(() => decodeProject(zipSync(files))).toThrow('图层蒙版')
  })
})
