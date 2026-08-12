import { strFromU8, strToU8, unzipSync, zipSync, type Zippable } from 'fflate'
import { BLEND_MODES, type AnimationFrame, type BlendMode, type ColorMode, type LayerGroup, type LayerMask, type PaletteEntry, type ProjectBrush, type RasterLayer, type RgbaColor, type SpriteDocument, type TimelapseSettings } from '@shared/types'
import { compositeDocument, createCompositePointSampler, createId, createNormalCompositePointSampler, getLayerStorageOrigin, getRasterContentRevision, setLayerStorageOrigin } from './document'
import { createDefaultAnimationTimeline, ensureAnimationDocument, normalizeAnimationTimeline, refreshActiveAnimationFrame, syncActiveAnimationLayers } from './animation'
import { normalizeOutlineSettings } from './outline-settings'
import { normalizeProjectDisplaySettings, normalizeProjectStatistics, normalizeTimelapseSettings } from './project-metadata'
import { MAX_TIMELAPSE_SNAPSHOTS } from './timelapse'
import { encodePng } from './png'
import { translateCurrent as tr } from './localization'
import { normalizePaletteColumns, normalizePaletteSlots } from './palette-layout'
import { normalizeProjectLayerPanelState } from './layer-panel-state'

interface ManifestLayer {
  id: string
  name: string
  displayColor?: RgbaColor
  description?: string
  visible: boolean
  locked: boolean
  opacity: number
  blendMode?: BlendMode
  clippingMask?: boolean
  groupId?: string | null
  width?: number
  height?: number
  offsetX?: number
  offsetY?: number
  dataFile: string
}

interface ManifestMask {
  id: string
  linkedMaskId?: string | null
  width: number
  height: number
  offsetX: number
  offsetY: number
  dataFile: string
}

interface ManifestProjectBrush {
  id: string
  name: string
  width: number
  height: number
  dataFile: string
  colorsFile?: string
  sourceX?: number
  sourceY?: number
}

interface ManifestCel {
  id: string
  layerId: string
  frameId: string
  linkedCelId?: string | null
  opacity?: number
  format?: ColorMode
  width?: number
  height?: number
  offsetX?: number
  offsetY?: number
  dataFile?: string
  mask?: ManifestMask
}

interface ManifestGroupMask {
  groupId: string
  frameId: string
  mask: ManifestMask
}

interface ManifestAnimation {
  frames: AnimationFrame[]
  cels: ManifestCel[]
  groupMasks: ManifestGroupMask[]
  activeFrameId: string
  loop: boolean
}

interface ManifestTimelapseSnapshot {
  id: string
  capturedAt: number
  elapsedMs: number
  width: number
  height: number
  dataFile: string
}

interface ManifestTimelapse extends Omit<TimelapseSettings, 'snapshots'> {
  snapshots: ManifestTimelapseSnapshot[]
}

export const PROJECT_SCHEMA_VERSION = 4

interface ProjectManifest {
  schemaVersion: typeof PROJECT_SCHEMA_VERSION
  app: 'MoonSprite'
  document: Omit<SpriteDocument, 'layers' | 'groups' | 'palette' | 'customBrushes' | 'animation' | 'timelapse' | 'filePath' | 'sourceFilePath' | 'dirty'> & { schemaVersion: typeof PROJECT_SCHEMA_VERSION; layers: ManifestLayer[]; groups: LayerGroup[]; palette: PaletteEntry[]; customBrushes: ManifestProjectBrush[]; animation: ManifestAnimation; timelapse?: ManifestTimelapse }
}

export interface ProjectGalleryMetadata {
  name: string
  width: number
  height: number
  colorMode: ColorMode
  preview: Uint8Array
}

export interface ProjectGalleryReadOptions {
  generateMissingPreview?: boolean
}

const toU8 = (array: Uint8ClampedArray | Uint32Array): Uint8Array =>
  new Uint8Array(array.buffer, array.byteOffset, array.byteLength)

const PROJECT_PREVIEW_MAX_DIMENSION = 512
const LARGE_PROJECT_STORAGE_PIXELS = 32 * 1024 * 1024

type DecodedRasterSurface = RasterLayer | NonNullable<NonNullable<SpriteDocument['animation']>['cels'][number]['surface']>

export const compactProjectRasterStorage = (document: SpriteDocument, minimumStoredPixels = LARGE_PROJECT_STORAGE_PIXELS): void => {
  const surfaces: DecodedRasterSurface[] = [
    ...document.layers,
    ...(document.animation?.cels.flatMap((cel) => cel.surface ? [cel.surface] : []) ?? [])
  ]
  const uniquePixels = new Set(surfaces.map((surface) => surface.pixels))
  const storedPixels = [...uniquePixels].reduce((total, pixels) => total + (pixels instanceof Uint8ClampedArray ? pixels.length / 4 : pixels.length), 0)
  if (storedPixels < minimumStoredPixels) return

  const opaquePaletteIds = new Set(document.palette.filter((entry) => entry.color.a > 0).map((entry) => entry.id))
  const layers = new Set<RasterLayer>(document.layers)
  const surfacesByPixels = new Map<DecodedRasterSurface['pixels'], DecodedRasterSurface[]>()
  for (const surface of surfaces) {
    const entries = surfacesByPixels.get(surface.pixels) ?? []
    entries.push(surface)
    surfacesByPixels.set(surface.pixels, entries)
  }

  for (const entries of surfacesByPixels.values()) {
    const source = entries[0]
    if (entries.some((surface) => surface.format !== source.format || surface.width !== source.width || surface.height !== source.height)) continue
    let minX = source.width
    let minY = source.height
    let maxX = -1
    let maxY = -1
    for (let y = 0; y < source.height; y += 1) {
      let left = 0
      let right = source.width - 1
      if (source.format === 'rgba') {
        const rowOffset = y * source.width * 4
        while (left <= right && source.pixels[rowOffset + left * 4 + 3] === 0) left += 1
        while (right >= left && source.pixels[rowOffset + right * 4 + 3] === 0) right -= 1
      } else {
        const rowOffset = y * source.width
        while (left <= right && !opaquePaletteIds.has(source.pixels[rowOffset + left])) left += 1
        while (right >= left && !opaquePaletteIds.has(source.pixels[rowOffset + right])) right -= 1
      }
      if (right < left) continue
      minX = Math.min(minX, left)
      minY = Math.min(minY, y)
      maxX = Math.max(maxX, right)
      maxY = y
    }

    const empty = maxX < minX || maxY < minY
    const width = empty ? 1 : maxX - minX + 1
    const height = empty ? 1 : maxY - minY + 1
    if (!empty && width * height > source.width * source.height * 0.9) continue
    const pixels = source.format === 'rgba'
      ? new Uint8ClampedArray(width * height * 4)
      : new Uint32Array(width * height)
    if (!empty) {
      for (let y = 0; y < height; y += 1) {
        if (source.format === 'rgba' && pixels instanceof Uint8ClampedArray) {
          const start = ((minY + y) * source.width + minX) * 4
          pixels.set(source.pixels.subarray(start, start + width * 4), y * width * 4)
        } else if (source.format === 'indexed' && pixels instanceof Uint32Array) {
          const start = (minY + y) * source.width + minX
          pixels.set(source.pixels.subarray(start, start + width), y * width)
        }
      }
    }
    for (const surface of entries) {
      const layerStorageOrigin = layers.has(surface as RasterLayer) ? getLayerStorageOrigin(surface as RasterLayer) : null
      surface.width = width
      surface.height = height
      if (!empty) {
        surface.offsetX += minX
        surface.offsetY += minY
        if ('storageOriginX' in surface) surface.storageOriginX = (surface.storageOriginX ?? 0) + minX
        if ('storageOriginY' in surface) surface.storageOriginY = (surface.storageOriginY ?? 0) + minY
        if (layerStorageOrigin) setLayerStorageOrigin(surface as RasterLayer, { x: layerStorageOrigin.x + minX, y: layerStorageOrigin.y + minY })
      }
      if (surface.format === 'rgba' && pixels instanceof Uint8ClampedArray) surface.pixels = pixels
      if (surface.format === 'indexed' && pixels instanceof Uint32Array) surface.pixels = pixels
    }
  }
}

const encodeProjectPreview = (document: SpriteDocument): Uint8Array => {
  if (document.width <= PROJECT_PREVIEW_MAX_DIMENSION && document.height <= PROJECT_PREVIEW_MAX_DIMENSION) {
    return encodePng(compositeDocument(document), document.width, document.height).bytes
  }
  const scale = Math.min(PROJECT_PREVIEW_MAX_DIMENSION / document.width, PROJECT_PREVIEW_MAX_DIMENSION / document.height)
  const width = Math.max(1, Math.round(document.width * scale))
  const height = Math.max(1, Math.round(document.height * scale))
  const pixels = new Uint8ClampedArray(width * height * 4)
  const sample = createNormalCompositePointSampler(document) ?? createCompositePointSampler(document)
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    const sourceX = Math.min(document.width - 1, Math.floor((x + 0.5) * document.width / width))
    const sourceY = Math.min(document.height - 1, Math.floor((y + 0.5) * document.height / height))
    const color = sample(sourceX, sourceY)
    const offset = (y * width + x) * 4
    pixels[offset] = color.r
    pixels[offset + 1] = color.g
    pixels[offset + 2] = color.b
    pixels[offset + 3] = color.a
  }
  return encodePng(pixels, width, height).bytes
}

const blendModeSet = new Set<string>(BLEND_MODES)
const normalizeBlendMode = (value: unknown): BlendMode => typeof value === 'string' && blendModeSet.has(value) ? value as BlendMode : 'normal'

const normalizeLayerGroups = (source: unknown): LayerGroup[] => {
  if (!Array.isArray(source)) return []
  const groups: LayerGroup[] = []
  const seen = new Set<string>()
  for (const value of source) {
    if (!value || typeof value !== 'object') continue
    const candidate = value as Partial<LayerGroup>
    if (typeof candidate.id !== 'string' || !candidate.id || seen.has(candidate.id)) continue
    seen.add(candidate.id)
    groups.push({
      id: candidate.id,
      name: typeof candidate.name === 'string' && candidate.name ? candidate.name : tr('core.document.group'),
      ...(Number.isFinite(candidate.panelOrder) ? { panelOrder: Number(candidate.panelOrder) } : {}),
      ...(normalizeDisplayColor(candidate.displayColor) ? { displayColor: normalizeDisplayColor(candidate.displayColor)! } : {}),
      ...(typeof candidate.description === 'string' && candidate.description ? { description: candidate.description } : {}),
      ...(candidate.parentGroupId === undefined ? {} : { parentGroupId: typeof candidate.parentGroupId === 'string' ? candidate.parentGroupId : null }),
      visible: candidate.visible !== false,
      locked: candidate.locked === true,
      opacity: Number.isFinite(candidate.opacity) ? Math.max(0, Math.min(1, Number(candidate.opacity))) : 1,
      blendMode: normalizeBlendMode(candidate.blendMode),
      ...(candidate.clippingMask === true ? { clippingMask: true } : {}),
      ...(candidate.cumulativeBlend === true ? { cumulativeBlend: true } : {})
    })
  }
  const groupById = new Map(groups.map((group) => [group.id, group]))
  const originalParents = new Map(groups.map((group) => [group.id, group.parentGroupId]))
  for (const group of groups) {
    const originalParent = group.parentGroupId
    if (!originalParent) continue
    if (!groupById.has(originalParent) || originalParent === group.id) {
      group.parentGroupId = null
      continue
    }
    const visited = new Set([group.id])
    let parentId: string | null | undefined = originalParent
    while (parentId) {
      if (visited.has(parentId)) {
        group.parentGroupId = null
        break
      }
      visited.add(parentId)
      parentId = originalParents.get(parentId)
    }
  }
  return groups
}

const normalizeDisplayColor = (value: unknown): RgbaColor | null => {
  if (!value || typeof value !== 'object') return null
  const color = value as Partial<RgbaColor>
  if (![color.r, color.g, color.b, color.a].every((channel) => typeof channel === 'number' && Number.isFinite(channel))) return null
  return { r: Math.max(0, Math.min(255, Math.round(color.r!))), g: Math.max(0, Math.min(255, Math.round(color.g!))), b: Math.max(0, Math.min(255, Math.round(color.b!))), a: Math.max(0, Math.min(255, Math.round(color.a!))) }
}

const normalizeManifestAnimation = (value: unknown): ManifestAnimation => {
  const normalized = normalizeAnimationTimeline(value)
  const frameIds = new Set(normalized.frames.map((frame) => frame.id))
  const rawCels = value && typeof value === 'object' && Array.isArray((value as { cels?: unknown }).cels)
    ? (value as { cels: unknown[] }).cels
    : []
  return {
    frames: normalized.frames,
    activeFrameId: normalized.activeFrameId,
    loop: normalized.loop,
    cels: normalized.cels.map((cel) => {
      const raw = rawCels.find((candidate) => candidate && typeof candidate === 'object' && (candidate as { id?: unknown }).id === cel.id) as Partial<ManifestCel> | undefined
      const { mask: _runtimeMask, surface: _runtimeSurface, ...normalizedCel } = cel
      return { ...normalizedCel, ...(Number.isFinite(raw?.opacity) ? { opacity: Math.max(0, Math.min(1, Number(raw!.opacity))) } : {}), ...(raw?.format === 'rgba' || raw?.format === 'indexed' ? { format: raw.format } : {}), ...(Number.isSafeInteger(raw?.width) ? { width: raw!.width } : {}), ...(Number.isSafeInteger(raw?.height) ? { height: raw!.height } : {}), ...(Number.isFinite(raw?.offsetX) ? { offsetX: Math.trunc(raw!.offsetX!) } : {}), ...(Number.isFinite(raw?.offsetY) ? { offsetY: Math.trunc(raw!.offsetY!) } : {}), ...(typeof raw?.dataFile === 'string' ? { dataFile: raw.dataFile } : {}), ...(raw?.mask ? { mask: raw.mask } : {}) }
    }),
    groupMasks: value && typeof value === 'object' && Array.isArray((value as { groupMasks?: unknown }).groupMasks)
      ? (value as { groupMasks: unknown[] }).groupMasks.flatMap((item) => {
          if (!item || typeof item !== 'object') return []
          const candidate = item as Partial<ManifestGroupMask>
          return typeof candidate.groupId === 'string' && candidate.groupId && typeof candidate.frameId === 'string' && frameIds.has(candidate.frameId) && candidate.mask
            ? [{ groupId: candidate.groupId, frameId: candidate.frameId, mask: candidate.mask }]
            : []
        })
      : []
  }
}

export interface ProjectEncodeOptions {
  /** Recovery snapshots do not need a gallery preview and can skip its full-canvas composite. */
  includePreview?: boolean
  /** Lower compression trades disk space for a substantially shorter main-thread encode. */
  compressionLevel?: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9
  /** Reports completion of archive preparation and sequential file compression. */
  onProgress?: (value: number) => void
}

interface ProjectArchiveResource {
  path: string
  resource: object
  revision: number | null
}

interface ProjectArchiveBuild {
  files: Record<string, Uint8Array>
  resources: ProjectArchiveResource[]
}

export interface ProjectArchiveReuseEntry {
  path: string
  crc32: number
}

interface ProjectSaveBaseline {
  sourcePath: string
  resources: WeakMap<object, { path: string; crc32: number; revision: number | null }>
}

interface ProjectSaveBaselineCandidate {
  resources: Array<ProjectArchiveResource & { crc32: number }>
}

export interface EncodedProjectSave {
  data: Uint8Array
  sourcePath: string | null
  reusableEntries: ProjectArchiveReuseEntry[]
  baseline: ProjectSaveBaselineCandidate
}

const projectSaveBaselines = new WeakMap<SpriteDocument, ProjectSaveBaseline>()

const createProjectArchiveFiles = (document: SpriteDocument, options: ProjectEncodeOptions = {}): ProjectArchiveBuild => {
  syncActiveAnimationLayers(document)
  const files: Record<string, Uint8Array> = {}
  const resources: ProjectArchiveResource[] = []
  const dataFileByPixels = new Map<object, string>()
  const encodePixels = (preferredFile: string, pixels: Uint8ClampedArray | Uint32Array): string => {
    const existing = dataFileByPixels.get(pixels)
    if (existing) return existing
    files[preferredFile] = toU8(pixels)
    resources.push({ path: preferredFile, resource: pixels, revision: getRasterContentRevision(pixels) })
    dataFileByPixels.set(pixels, preferredFile)
    return preferredFile
  }
  const encodeMask = (mask: LayerMask): ManifestMask => {
    const dataFile = `masks/${mask.id}.rgba`
    files[dataFile] = toU8(mask.pixels)
    resources.push({ path: dataFile, resource: mask.pixels, revision: getRasterContentRevision(mask.pixels) })
    return { id: mask.id, ...(mask.linkedMaskId ? { linkedMaskId: mask.linkedMaskId } : {}), width: mask.width, height: mask.height, offsetX: mask.offsetX, offsetY: mask.offsetY, dataFile }
  }
  const layers: ManifestLayer[] = document.layers.map((layer) => {
    const dataFile = encodePixels(`layers/${layer.id}.${layer.format === 'rgba' ? 'rgba' : 'idx32'}`, layer.pixels)
    return {
      id: layer.id,
      name: layer.name,
      ...(layer.displayColor ? { displayColor: layer.displayColor } : {}),
      ...(layer.description ? { description: layer.description } : {}),
      visible: layer.visible,
      locked: layer.locked,
      opacity: layer.opacity,
      blendMode: layer.blendMode,
      ...(layer.clippingMask === true ? { clippingMask: true } : {}),
      groupId: layer.groupId ?? null,
      width: layer.width,
      height: layer.height,
      offsetX: layer.offsetX,
      offsetY: layer.offsetY,
      dataFile
    }
  })
  const groups: LayerGroup[] = document.groups.map((group) => ({ ...group }))
  const customBrushes: ManifestProjectBrush[] = (document.customBrushes ?? []).map((brush) => {
    const dataFile = `brushes/${brush.id}.gray`
    files[dataFile] = brush.coverage
    const colorsFile = brush.colors && brush.colors.length === brush.width * brush.height ? `brushes/${brush.id}.rgba` : undefined
    if (colorsFile) files[colorsFile] = toU8(brush.colors!)
    return { id: brush.id, name: brush.name, width: brush.width, height: brush.height, dataFile, colorsFile, sourceX: brush.sourceX, sourceY: brush.sourceY }
  })
  const timeline = ensureAnimationDocument(document)
  const animation: ManifestAnimation = {
    frames: timeline.frames.map((frame) => ({ ...frame })),
    activeFrameId: timeline.activeFrameId,
    loop: timeline.loop,
    groupMasks: (timeline.groupMasks ?? []).map((entry) => ({ groupId: entry.groupId, frameId: entry.frameId, mask: encodeMask(entry.mask) })),
    cels: timeline.cels.flatMap((cel) => {
      if (!cel.surface) return []
      const dataFile = cel.linkedCelId ? undefined : encodePixels(`cels/${cel.id}.${cel.surface.format === 'rgba' ? 'rgba' : 'idx32'}`, cel.surface.pixels)
      return [{
        id: cel.id,
        layerId: cel.layerId,
        frameId: cel.frameId,
        ...(cel.linkedCelId ? { linkedCelId: cel.linkedCelId } : {}),
        ...(Number.isFinite(cel.opacity) ? { opacity: cel.opacity } : {}),
        ...(dataFile ? {
          format: cel.surface.format,
          width: cel.surface.width,
          height: cel.surface.height,
          offsetX: cel.surface.offsetX,
          offsetY: cel.surface.offsetY,
          dataFile
        } : {}),
        ...(cel.mask ? { mask: encodeMask(cel.mask) } : {})
      }]
    })
  }
  const timelapseSettings = normalizeTimelapseSettings(document.timelapse, document.timelapse?.snapshots ?? [])
  const timelapse: ManifestTimelapse = {
    enabled: timelapseSettings.enabled,
    quality: timelapseSettings.quality,
    fps: timelapseSettings.fps,
    speed: timelapseSettings.speed,
    snapshots: timelapseSettings.snapshots.map((snapshot) => {
      const dataFile = `timelapse/${snapshot.id}.png`
      files[dataFile] = snapshot.data
      resources.push({ path: dataFile, resource: snapshot.data, revision: null })
      return { id: snapshot.id, capturedAt: snapshot.capturedAt, elapsedMs: snapshot.elapsedMs, width: snapshot.width, height: snapshot.height, dataFile }
    })
  }
  const { schemaVersion: _schemaVersion, layers: _layers, groups: _groups, palette: _palette, customBrushes: _customBrushes, animation: _animation, timelapse: _timelapse, filePath: _filePath, sourceFilePath: _sourceFilePath, dirty: _dirty, ...serializable } = document
  const manifest: ProjectManifest = {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    app: 'MoonSprite',
    document: {
      ...serializable,
      schemaVersion: PROJECT_SCHEMA_VERSION,
      layers,
      groups,
      palette: document.palette.map((entry) => ({ ...entry, color: { ...entry.color } })),
      paletteColumns: normalizePaletteColumns(document.paletteColumns),
      paletteSlots: normalizePaletteSlots(document.palette.map((entry) => entry.id), document.paletteOrder, document.paletteSlots, normalizePaletteColumns(document.paletteColumns)),
      customBrushes,
      animation,
      timelapse
    }
  }
  files['manifest.json'] = strToU8(JSON.stringify(manifest))
  if (options.includePreview !== false) files['preview.png'] = encodeProjectPreview(document)
  return { files, resources }
}

const createProjectZipEntries = (files: Record<string, Uint8Array>): Zippable => {
  const entries: Zippable = {}
  for (const [path, data] of Object.entries(files)) {
    // Timelapse frames are already PNG-compressed. Deflating hundreds of them
    // again adds save latency with negligible size reduction.
    entries[path] = /^timelapse\/.*\.png$/i.test(path) ? [data, { level: 0 }] : data
  }
  return entries
}

export function encodeProject(document: SpriteDocument, options: ProjectEncodeOptions = {}): Uint8Array {
  const { files } = createProjectArchiveFiles(document, options)
  return zipSync(createProjectZipEntries(files), { level: options.compressionLevel ?? 6 })
}

interface ProjectEncodeWorkerResponse {
  id: number
  data?: Uint8Array
  error?: string
}

let projectEncodeWorker: Worker | null = null
let projectEncodeSequence = 0
const pendingProjectEncodes = new Map<number, { resolve: (data: Uint8Array) => void; reject: (error: Error) => void }>()

const resetProjectEncodeWorker = (error: Error): void => {
  projectEncodeWorker?.terminate()
  projectEncodeWorker = null
  for (const request of pendingProjectEncodes.values()) request.reject(error)
  pendingProjectEncodes.clear()
}

const ensureProjectEncodeWorker = (): Worker => {
  if (projectEncodeWorker) return projectEncodeWorker
  const worker = new Worker(new URL('../workers/project-encode.worker.ts', import.meta.url), { type: 'module' })
  worker.onmessage = (event: MessageEvent<ProjectEncodeWorkerResponse>) => {
    const request = pendingProjectEncodes.get(event.data.id)
    if (!request) return
    pendingProjectEncodes.delete(event.data.id)
    if (event.data.data) request.resolve(event.data.data)
    else request.reject(new Error(event.data.error || 'Project encode failed'))
  }
  worker.onerror = (event) => resetProjectEncodeWorker(new Error(event.message || 'Project encode worker failed'))
  projectEncodeWorker = worker
  return worker
}

const encodeArchiveFilesInWorker = (files: Record<string, Uint8Array>, compressionLevel: NonNullable<ProjectEncodeOptions['compressionLevel']>): Promise<Uint8Array> => {
  const entries = createProjectZipEntries(files)
  if (typeof Worker === 'undefined') return Promise.resolve(zipSync(entries, { level: compressionLevel }))
  return new Promise((resolve, reject) => {
    const id = ++projectEncodeSequence
    pendingProjectEncodes.set(id, { resolve, reject })
    try {
      ensureProjectEncodeWorker().postMessage({ id, files: entries, compressionLevel })
    } catch (error) {
      pendingProjectEncodes.delete(id)
      reject(error instanceof Error ? error : new Error(String(error)))
    }
  })
}

export function encodeProjectAsync(document: SpriteDocument, options: ProjectEncodeOptions = {}): Promise<Uint8Array> {
  options.onProgress?.(0)
  const { files } = createProjectArchiveFiles(document, options)
  options.onProgress?.(0.05)
  return encodeArchiveFilesInWorker(files, options.compressionLevel ?? 6).then((data) => {
    options.onProgress?.(1)
    return data
  })
}

const readZipEntryCrcs = (data: Uint8Array): Map<string, number> => {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  let end = data.byteLength - 22
  while (end >= 0 && view.getUint32(end, true) !== 0x06054b50) end -= 1
  if (end < 0) throw new Error(tr('core.project.unzip'))
  const entryCount = view.getUint16(end + 10, true)
  let offset = view.getUint32(end + 16, true)
  const decoder = new TextDecoder()
  const entries = new Map<string, number>()
  for (let index = 0; index < entryCount; index += 1) {
    if (offset + 46 > data.byteLength || view.getUint32(offset, true) !== 0x02014b50) throw new Error(tr('core.project.unzip'))
    const nameLength = view.getUint16(offset + 28, true)
    const extraLength = view.getUint16(offset + 30, true)
    const commentLength = view.getUint16(offset + 32, true)
    const nameEnd = offset + 46 + nameLength
    if (nameEnd > data.byteLength) throw new Error(tr('core.project.unzip'))
    entries.set(decoder.decode(data.subarray(offset + 46, nameEnd)), view.getUint32(offset + 16, true))
    offset = nameEnd + extraLength + commentLength
  }
  return entries
}

const projectResourceSourcePaths = (document: SpriteDocument, manifest: ProjectManifest): WeakMap<object, string> => {
  const paths = new WeakMap<object, string>()
  const conflicts = new WeakSet<object>()
  const add = (resource: object, path: string | null | undefined): void => {
    if (!path || conflicts.has(resource)) return
    const previous = paths.get(resource)
    if (previous && previous !== path) {
      paths.delete(resource)
      conflicts.add(resource)
      return
    }
    paths.set(resource, path)
  }
  const layerMetadata = new Map(manifest.document.layers.map((layer) => [layer.id, layer]))
  const activeCelFiles = directActiveCelDataFiles(manifest)
  for (const layer of document.layers) {
    const metadata = layerMetadata.get(layer.id)
    add(layer.pixels, activeCelFiles.get(layer.id) ?? metadata?.dataFile)
  }
  const timeline = ensureAnimationDocument(document)
  const celMetadata = new Map(manifest.document.animation.cels.map((cel) => [cel.id, cel]))
  for (const cel of timeline.cels) {
    const metadata = celMetadata.get(cel.id)
    if (cel.surface && metadata?.dataFile) add(cel.surface.pixels, metadata.dataFile)
    if (cel.mask) add(cel.mask.pixels, metadata?.mask?.dataFile)
  }
  const groupMaskMetadata = new Map((manifest.document.animation.groupMasks ?? []).map((entry) => [`${entry.groupId}\u0000${entry.frameId}`, entry]))
  for (const entry of timeline.groupMasks ?? []) add(entry.mask.pixels, groupMaskMetadata.get(`${entry.groupId}\u0000${entry.frameId}`)?.mask.dataFile)
  const snapshotMetadata = new Map((manifest.document.timelapse?.snapshots ?? []).map((snapshot) => [snapshot.id, snapshot]))
  for (const snapshot of document.timelapse?.snapshots ?? []) add(snapshot.data, snapshotMetadata.get(snapshot.id)?.dataFile)
  return paths
}

export function registerProjectSaveBaseline(document: SpriteDocument, sourcePath: string, archive: Uint8Array): boolean {
  let crcs: Map<string, number>
  let manifest: ProjectManifest
  try {
    crcs = readZipEntryCrcs(archive)
    manifest = readManifest(unzipSync(archive, { filter: (file) => file.name === 'manifest.json' }))
  } catch {
    projectSaveBaselines.delete(document)
    return false
  }
  const sourcePaths = projectResourceSourcePaths(document, manifest)
  const resources = new WeakMap<object, { path: string; crc32: number; revision: number | null }>()
  for (const resource of createProjectArchiveFiles(document, { includePreview: false }).resources) {
    if (sourcePaths.get(resource.resource) !== resource.path) continue
    const crc32 = crcs.get(resource.path)
    if (crc32 !== undefined) resources.set(resource.resource, { path: resource.path, crc32, revision: resource.revision })
  }
  projectSaveBaselines.set(document, { sourcePath, resources })
  return true
}

export async function encodeProjectSaveAsync(document: SpriteDocument, options: ProjectEncodeOptions = {}): Promise<EncodedProjectSave> {
  options.onProgress?.(0)
  const { files, resources } = createProjectArchiveFiles(document, options)
  const baseline = projectSaveBaselines.get(document)
  const reusableEntries: ProjectArchiveReuseEntry[] = []
  const reusableCrcs = new Map<string, number>()
  const patchFiles = { ...files }
  if (baseline) for (const resource of resources) {
    const previous = baseline.resources.get(resource.resource)
    if (!previous || previous.path !== resource.path || previous.revision !== resource.revision) continue
    delete patchFiles[resource.path]
    reusableEntries.push({ path: resource.path, crc32: previous.crc32 })
    reusableCrcs.set(resource.path, previous.crc32)
  }
  if (baseline && reusableEntries.length > 0) patchFiles['.moonsprite-save-plan.json'] = strToU8(JSON.stringify({ version: 1, entries: reusableEntries }))
  options.onProgress?.(0.05)
  const compressionLevel = options.compressionLevel ?? 6
  const data = await encodeArchiveFilesInWorker(patchFiles, compressionLevel)
  const patchCrcs = readZipEntryCrcs(data)
  const baselineResources = resources.flatMap((resource) => {
    const crc32 = reusableCrcs.get(resource.path) ?? patchCrcs.get(resource.path)
    return crc32 === undefined ? [] : [{ ...resource, crc32 }]
  })
  options.onProgress?.(1)
  return {
    data,
    sourcePath: baseline?.sourcePath ?? null,
    reusableEntries,
    baseline: { resources: baselineResources }
  }
}

export function acceptProjectSaveBaseline(document: SpriteDocument, filePath: string, encoded: EncodedProjectSave): void {
  const resources = new WeakMap<object, { path: string; crc32: number; revision: number | null }>()
  for (const resource of encoded.baseline.resources) resources.set(resource.resource, { path: resource.path, crc32: resource.crc32, revision: resource.revision })
  projectSaveBaselines.set(document, { sourcePath: filePath, resources })
}

export function clearProjectSaveBaseline(document: SpriteDocument): void {
  projectSaveBaselines.delete(document)
}

export function migrateProjectManifest(input: unknown): ProjectManifest {
  if (!input || typeof input !== 'object') throw new Error(tr('core.project.invalidManifestFormat'))
  const candidate = input as { app?: unknown; schemaVersion?: unknown; document?: Record<string, unknown> }
  if (candidate.app !== 'MoonSprite' || !candidate.document) throw new Error(tr('core.project.unsupportedVersion'))
  if (candidate.schemaVersion === PROJECT_SCHEMA_VERSION && candidate.document.schemaVersion === PROJECT_SCHEMA_VERSION) {
    return {
      ...(candidate as ProjectManifest),
      schemaVersion: PROJECT_SCHEMA_VERSION,
      document: { ...(candidate.document as ProjectManifest['document']), schemaVersion: PROJECT_SCHEMA_VERSION, animation: normalizeManifestAnimation(candidate.document.animation) }
    }
  }
  if ([2, 3].includes(Number(candidate.schemaVersion)) && candidate.document.schemaVersion === candidate.schemaVersion) {
    return {
      ...(candidate as Omit<ProjectManifest, 'schemaVersion' | 'document'>),
      schemaVersion: PROJECT_SCHEMA_VERSION,
      document: { ...(candidate.document as ProjectManifest['document']), schemaVersion: PROJECT_SCHEMA_VERSION, animation: normalizeManifestAnimation(candidate.document.animation) }
    }
  }
  if (candidate.schemaVersion === 1 && candidate.document.schemaVersion === 1) {
    return {
      ...(candidate as Omit<ProjectManifest, 'schemaVersion' | 'document'>),
      schemaVersion: PROJECT_SCHEMA_VERSION,
      document: { ...(candidate.document as ProjectManifest['document']), schemaVersion: PROJECT_SCHEMA_VERSION, animation: normalizeManifestAnimation(createDefaultAnimationTimeline()) }
    }
  }
  throw new Error(tr('core.project.unsupportedVersion'))
}

function readManifest(files: Record<string, Uint8Array>): ProjectManifest {
  const manifestFile = files['manifest.json']
  if (!manifestFile) throw new Error(tr('core.project.missingManifest'))
  let manifest: ProjectManifest
  try {
    manifest = migrateProjectManifest(JSON.parse(strFromU8(manifestFile)))
  } catch {
    throw new Error(tr('core.project.manifestUnreadable'))
  }
  if (manifest.app !== 'MoonSprite' || manifest.schemaVersion !== PROJECT_SCHEMA_VERSION || manifest.document?.schemaVersion !== PROJECT_SCHEMA_VERSION) {
    throw new Error(tr('core.project.invalidVersion'))
  }
  return manifest
}

const directActiveCelDataFiles = (manifest: ProjectManifest): Map<string, string> => {
  const source = manifest.document
  if (source.animation.frames.length !== 1) return new Map()
  const activeFrameId = source.animation.activeFrameId
  const activeCels = new Map(source.animation.cels
    .filter((cel) => cel.frameId === activeFrameId && typeof cel.dataFile === 'string' && cel.dataFile)
    .map((cel) => [cel.layerId, cel]))
  const dataFiles = new Map<string, string>()
  for (const layer of source.layers) {
    const cel = activeCels.get(layer.id)
    if (!cel || cel.format !== source.colorMode) continue
    const layerWidth = Number.isSafeInteger(layer.width) && layer.width! > 0 ? layer.width! : source.width
    const layerHeight = Number.isSafeInteger(layer.height) && layer.height! > 0 ? layer.height! : source.height
    if (cel.width !== layerWidth || cel.height !== layerHeight) continue
    if (Math.trunc(cel.offsetX ?? 0) !== Math.trunc(layer.offsetX ?? 0) || Math.trunc(cel.offsetY ?? 0) !== Math.trunc(layer.offsetY ?? 0)) continue
    dataFiles.set(layer.id, cel.dataFile!)
  }
  return dataFiles
}

const requiredProjectDataFiles = (manifest: ProjectManifest, activeCelFiles: ReadonlyMap<string, string>): Set<string> => {
  const source = manifest.document
  const required = new Set<string>(['manifest.json'])
  for (const layer of source.layers) required.add(activeCelFiles.get(layer.id) ?? layer.dataFile)
  for (const brush of source.customBrushes ?? []) {
    required.add(brush.dataFile)
    if (brush.colorsFile) required.add(brush.colorsFile)
  }
  for (const cel of source.animation.cels) {
    if (cel.dataFile) required.add(cel.dataFile)
    if (cel.mask?.dataFile) required.add(cel.mask.dataFile)
  }
  for (const entry of source.animation.groupMasks ?? []) required.add(entry.mask.dataFile)
  for (const snapshot of source.timelapse?.snapshots ?? []) required.add(snapshot.dataFile)
  return required
}

export function readProjectGalleryMetadata(input: Uint8Array, options: ProjectGalleryReadOptions = {}): ProjectGalleryMetadata {
  let files: Record<string, Uint8Array>
  try {
    files = unzipSync(input, { filter: (file) => file.name === 'manifest.json' || file.name === 'preview.png' })
  } catch {
    throw new Error(tr('core.project.galleryUnzip'))
  }
  const manifest = readManifest(files)
  const source = manifest.document
  if (!Number.isSafeInteger(source.width) || !Number.isSafeInteger(source.height) || source.width < 1 || source.height < 1) {
    throw new Error(tr('core.project.galleryCanvasSize'))
  }
  if (source.colorMode !== 'rgba' && source.colorMode !== 'indexed') throw new Error(tr('core.project.galleryColorMode'))
  const preview = files['preview.png']
  if (!preview?.byteLength) {
    if (!options.generateMissingPreview) throw new Error(tr('core.project.missingPreview'))
    const document = decodeProject(input)
    return {
      name: source.name || tr('core.document.untitled'),
      width: source.width,
      height: source.height,
      colorMode: source.colorMode,
      preview: encodeProjectPreview(document)
    }
  }
  return {
    name: source.name || tr('core.document.untitled'),
    width: source.width,
    height: source.height,
    colorMode: source.colorMode,
    preview: preview.slice()
  }
}

export function decodeProject(input: Uint8Array, onProgress?: (value: number) => void): SpriteDocument {
  const reportProgress = (value: number): void => onProgress?.(Math.max(0, Math.min(1, value)))
  reportProgress(0)
  let manifestFiles: Record<string, Uint8Array>
  try {
    manifestFiles = unzipSync(input, { filter: (file) => file.name === 'manifest.json' })
  } catch {
    throw new Error(tr('core.project.unzip'))
  }
  reportProgress(0.12)
  const manifest = readManifest(manifestFiles)
  const activeCelFiles = directActiveCelDataFiles(manifest)
  const requiredFiles = requiredProjectDataFiles(manifest, activeCelFiles)
  let files: Record<string, Uint8Array>
  try {
    files = unzipSync(input, { filter: (file) => requiredFiles.has(file.name) })
  } catch {
    throw new Error(tr('core.project.unzip'))
  }
  reportProgress(0.45)
  const source = manifest.document
  if (!Number.isSafeInteger(source.width) || !Number.isSafeInteger(source.height) || source.width < 1 || source.height < 1) {
    throw new Error(tr('core.project.invalidCanvasSize'))
  }
  const mode = source.colorMode as ColorMode
  if (mode !== 'rgba' && mode !== 'indexed') throw new Error(tr('core.project.unknownColorMode'))
  const rgbaPixelsByFile = new Map<string, Uint8ClampedArray>()
  const indexedPixelsByFile = new Map<string, Uint32Array>()
  const decodePixels = (dataFile: string, format: ColorMode, expectedBytes: number): Uint8ClampedArray | Uint32Array => {
    const bytes = files[dataFile]
    if (!bytes || bytes.byteLength !== expectedBytes) throw new Error(tr('core.project.layerCorrupt', { name: dataFile }))
    if (format === 'rgba') {
      const cached = rgbaPixelsByFile.get(dataFile)
      if (cached) return cached
      const pixels = new Uint8ClampedArray(bytes.buffer, bytes.byteOffset, bytes.byteLength)
      rgbaPixelsByFile.set(dataFile, pixels)
      return pixels
    }
    const cached = indexedPixelsByFile.get(dataFile)
    if (cached) return cached
    const pixels = bytes.byteOffset % 4 === 0
      ? new Uint32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4)
      : new Uint32Array(bytes.slice().buffer)
    indexedPixelsByFile.set(dataFile, pixels)
    return pixels
  }
  const decodedMaskIds = new Set<string>()
  const decodeMask = (metadata: ManifestMask | undefined, ownerId: string, ownerKind: LayerMask['ownerKind'] = 'cel'): LayerMask | undefined => {
    if (!metadata) return undefined
    if (typeof metadata.id !== 'string' || !metadata.id || decodedMaskIds.has(metadata.id) || typeof metadata.dataFile !== 'string' || !metadata.dataFile) throw new Error(tr('core.project.layerMaskCorrupt'))
    const width = Number(metadata.width)
    const height = Number(metadata.height)
    const offsetX = Number(metadata.offsetX)
    const offsetY = Number(metadata.offsetY)
    if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1 || !Number.isFinite(offsetX) || !Number.isFinite(offsetY)) throw new Error(tr('core.project.layerMaskCorrupt'))
    const bytes = files[metadata.dataFile]
    if (!bytes || (bytes.byteLength !== width * height && bytes.byteLength !== width * height * 4)) throw new Error(tr('core.project.layerMaskCorrupt'))
    const maskPixels = new Uint8ClampedArray(width * height * 4)
    if (bytes.byteLength === width * height * 4) {
      maskPixels.set(bytes)
      for (let offset = 0; offset < maskPixels.length; offset += 4) {
        const alpha = maskPixels[offset + 3]
        if (alpha === 0) {
          maskPixels[offset] = 0
          maskPixels[offset + 1] = 0
          maskPixels[offset + 2] = 0
          continue
        }
        if (alpha !== 255 || maskPixels[offset] !== maskPixels[offset + 1] || maskPixels[offset] !== maskPixels[offset + 2]) throw new Error(tr('core.project.layerMaskCorrupt'))
      }
    } else {
      for (let index = 0; index < bytes.length; index += 1) {
        const value = bytes[index]
        maskPixels.set([value, value, value, 255], index * 4)
      }
    }
    decodedMaskIds.add(metadata.id)
    if (metadata.linkedMaskId !== undefined && metadata.linkedMaskId !== null && (typeof metadata.linkedMaskId !== 'string' || !metadata.linkedMaskId)) throw new Error(tr('core.project.layerMaskCorrupt'))
    return { id: metadata.id, name: tr(ownerKind === 'group' ? 'core.document.layerGroupMask' : 'core.document.layerMask'), description: '', visible: true, locked: false, opacity: 1, blendMode: 'normal', width, height, offsetX: Math.trunc(offsetX), offsetY: Math.trunc(offsetY), format: 'rgba', pixels: maskPixels, ownerKind, ownerId, ...(metadata.linkedMaskId ? { linkedMaskId: metadata.linkedMaskId } : {}) }
  }
  const totalItems = Math.max(1,
    source.layers.length
    + (source.customBrushes?.length ?? 0)
    + source.animation.cels.length
    + (source.animation.groupMasks?.length ?? 0)
    + (source.timelapse?.snapshots?.length ?? 0)
  )
  let completedItems = 0
  const reportItem = (): void => {
    completedItems += 1
    reportProgress(0.45 + (completedItems / totalItems) * 0.48)
  }
  const layers: RasterLayer[] = source.layers.map((metadata) => {
    const width = Number.isSafeInteger(metadata.width) && metadata.width! > 0 ? metadata.width! : source.width
    const height = Number.isSafeInteger(metadata.height) && metadata.height! > 0 ? metadata.height! : source.height
    const expectedBytes = width * height * 4
    const pixels = decodePixels(activeCelFiles.get(metadata.id) ?? metadata.dataFile, mode, expectedBytes)
    const common = {
      id: metadata.id,
      name: metadata.name,
      description: typeof metadata.description === 'string' ? metadata.description : '',
      visible: metadata.visible !== false,
      locked: metadata.locked === true,
      opacity: Number.isFinite(metadata.opacity) ? Math.max(0, Math.min(1, Number(metadata.opacity))) : 1,
      blendMode: normalizeBlendMode(metadata.blendMode),
      ...(metadata.clippingMask === true ? { clippingMask: true } : {}),
      groupId: typeof metadata.groupId === 'string' ? metadata.groupId : null,
      ...(normalizeDisplayColor(metadata.displayColor) ? { displayColor: normalizeDisplayColor(metadata.displayColor)! } : {}),
      width,
      height,
      offsetX: Number.isFinite(metadata.offsetX) ? Math.trunc(metadata.offsetX!) : 0,
      offsetY: Number.isFinite(metadata.offsetY) ? Math.trunc(metadata.offsetY!) : 0
    }
    const layer = mode === 'rgba'
      ? { ...common, format: 'rgba' as const, pixels: pixels as Uint8ClampedArray }
      : { ...common, format: 'indexed' as const, pixels: pixels as Uint32Array }
    reportItem()
    return layer
  })
  if (layers.length === 0) throw new Error(tr('core.project.noLayers'))
  const sourceGroups = Array.isArray(source.groups) ? source.groups : []
  const groups = normalizeLayerGroups(sourceGroups)
  const groupIds = new Set(groups.map((group) => group.id))
  for (const layer of layers) if (layer.groupId && !groupIds.has(layer.groupId)) layer.groupId = null
  const activeLayerId = layers.some((layer) => layer.id === source.activeLayerId) ? source.activeLayerId : layers[0].id
  const customBrushes: ProjectBrush[] = []
  for (const metadata of Array.isArray(source.customBrushes) ? source.customBrushes : []) {
    if (typeof metadata?.id !== 'string' || typeof metadata?.name !== 'string') continue
    if (!Number.isSafeInteger(metadata.width) || !Number.isSafeInteger(metadata.height) || metadata.width < 1 || metadata.height < 1 || metadata.width * metadata.height > 16 * 1024 * 1024) throw new Error(tr('core.project.brushInvalidSize', { name: metadata.name }))
    const bytes = files[metadata.dataFile]
    if (!bytes || bytes.byteLength !== metadata.width * metadata.height) throw new Error(tr('core.project.brushCorrupt', { name: metadata.name }))
    let colors: Uint32Array | undefined
    if (metadata.colorsFile) {
      const colorBytes = files[metadata.colorsFile]
      if (colorBytes && colorBytes.byteLength === metadata.width * metadata.height * 4) colors = new Uint32Array(colorBytes.slice().buffer)
    }
    customBrushes.push({ id: metadata.id, name: metadata.name, width: metadata.width, height: metadata.height, coverage: bytes.slice(), colors, sourceX: metadata.sourceX, sourceY: metadata.sourceY })
    reportItem()
  }
  const outlineSettings = normalizeOutlineSettings(source.outlineSettings)
  const displaySettings = normalizeProjectDisplaySettings(source.displaySettings)
  const statistics = normalizeProjectStatistics(source.statistics)
  const manifestTimelapse = source.timelapse && typeof source.timelapse === 'object' ? source.timelapse : undefined
  const timelapseSnapshots = (Array.isArray(manifestTimelapse?.snapshots) ? manifestTimelapse.snapshots : [])
    .slice(0, MAX_TIMELAPSE_SNAPSHOTS)
    .flatMap((snapshot) => {
      if (!snapshot || typeof snapshot.id !== 'string' || typeof snapshot.dataFile !== 'string') return []
      const width = Number(snapshot.width)
      const height = Number(snapshot.height)
      const data = files[snapshot.dataFile]
      if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1 || !data?.byteLength) return []
      reportItem()
      return [{ id: snapshot.id, capturedAt: Math.max(0, Math.trunc(Number(snapshot.capturedAt) || 0)), elapsedMs: Math.max(0, Math.trunc(Number(snapshot.elapsedMs) || 0)), width, height, data: data.slice() }]
    })
  const timelapse = normalizeTimelapseSettings(manifestTimelapse, timelapseSnapshots)
  const animation = normalizeAnimationTimeline(source.animation)
  const manifestCels = Array.isArray(source.animation?.cels) ? source.animation.cels : []
  animation.cels = animation.cels.flatMap((cel) => {
    const metadata = manifestCels.find((candidate) => candidate.id === cel.id)
    if (!metadata) return []
    const mask = decodeMask(metadata.mask, cel.id)
    if (!metadata.dataFile) {
      reportItem()
      return cel.linkedCelId ? [{ ...cel, mask }] : []
    }
    if (metadata.format !== 'rgba' && metadata.format !== 'indexed') throw new Error(tr('core.project.layerCorrupt', { name: cel.id }))
    const width = Number(metadata.width)
    const height = Number(metadata.height)
    if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1) return []
    const expectedBytes = width * height * 4
    const pixels = decodePixels(metadata.dataFile, metadata.format, expectedBytes)
    const surface = metadata.format === 'rgba'
      ? { format: 'rgba' as const, width, height, offsetX: Math.trunc(metadata.offsetX ?? 0), offsetY: Math.trunc(metadata.offsetY ?? 0), pixels: pixels as Uint8ClampedArray }
      : { format: 'indexed' as const, width, height, offsetX: Math.trunc(metadata.offsetX ?? 0), offsetY: Math.trunc(metadata.offsetY ?? 0), pixels: pixels as Uint32Array }
    reportItem()
    return [{ ...cel, surface, mask }]
  })
  const manifestGroupMasks = Array.isArray(source.animation?.groupMasks) ? source.animation.groupMasks : []
  const decodedGroupMaskSlots = new Set<string>()
  animation.groupMasks = manifestGroupMasks.flatMap((entry) => {
    if (!entry || typeof entry.groupId !== 'string' || !groupIds.has(entry.groupId) || typeof entry.frameId !== 'string' || !animation.frames.some((frame) => frame.id === entry.frameId)) throw new Error(tr('core.project.layerMaskCorrupt'))
    const slot = `${entry.groupId}\u0000${entry.frameId}`
    if (decodedGroupMaskSlots.has(slot)) throw new Error(tr('core.project.layerMaskCorrupt'))
    decodedGroupMaskSlots.add(slot)
    const mask = decodeMask(entry.mask, entry.groupId, 'group')
    reportItem()
    return mask ? [{ groupId: entry.groupId, frameId: entry.frameId, mask }] : []
  })
  const decodedMasks = [...animation.cels.flatMap((cel) => cel.mask ? [cel.mask] : []), ...(animation.groupMasks ?? []).map((entry) => entry.mask)]
  const decodedMasksById = new Map(decodedMasks.map((mask) => [mask.id, mask]))
  for (const mask of decodedMasks) {
    if (!mask.linkedMaskId) continue
    const linked = decodedMasksById.get(mask.linkedMaskId)
    if (!linked || linked === mask) throw new Error(tr('core.project.layerMaskCorrupt'))
    const visited = new Set<string>()
    let current: LayerMask | undefined = mask
    while (current?.linkedMaskId) {
      if (visited.has(current.id)) throw new Error(tr('core.project.layerMaskCorrupt'))
      visited.add(current.id)
      current = decodedMasksById.get(current.linkedMaskId)
      if (!current) throw new Error(tr('core.project.layerMaskCorrupt'))
    }
  }
  const palette = Array.isArray(source.palette) ? source.palette : []
  const paletteOrder = Array.isArray(source.paletteOrder)
    ? source.paletteOrder.filter((id): id is number => typeof id === 'number' && Number.isSafeInteger(id))
    : []
  const paletteColumns = normalizePaletteColumns(source.paletteColumns)
  const document: SpriteDocument = {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    id: createId('doc'),
    name: source.name || tr('core.document.untitled'),
    width: source.width,
    height: source.height,
    colorMode: mode,
    layers,
    groups,
    activeLayerId,
    palette,
    paletteOrder,
    paletteColumns,
    paletteSlots: normalizePaletteSlots(palette.map((entry) => entry.id), paletteOrder, Array.isArray(source.paletteSlots) ? source.paletteSlots : undefined, paletteColumns),
    nextColorId: Math.max(1, source.nextColorId ?? 1),
    customBrushes,
    animation,
    ...(outlineSettings ? { outlineSettings } : {}),
    displaySettings,
    statistics,
    timelapse,
    filePath: null,
    dirty: false,
    createdAt: source.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString()
  }
  document.layerPanelState = normalizeProjectLayerPanelState(document, source.layerPanelState)
  rgbaPixelsByFile.clear()
  indexedPixelsByFile.clear()
  for (const name of requiredFiles) if (name !== 'manifest.json') delete files[name]
  compactProjectRasterStorage(document)
  ensureAnimationDocument(document)
  refreshActiveAnimationFrame(document)
  reportProgress(1)
  return document
}
