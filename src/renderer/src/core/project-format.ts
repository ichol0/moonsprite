import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { BLEND_MODES, type AnimationFrame, type BlendMode, type ColorMode, type LayerGroup, type LayerMask, type PaletteEntry, type ProjectBrush, type RasterLayer, type RgbaColor, type SpriteDocument, type TimelapseSettings } from '@shared/types'
import { compositeDocument, createId } from './document'
import { createDefaultAnimationTimeline, ensureAnimationDocument, normalizeAnimationTimeline, refreshActiveAnimationFrame, syncActiveAnimationFrame } from './animation'
import { normalizeOutlineSettings } from './outline-settings'
import { normalizeProjectDisplaySettings, normalizeProjectStatistics, normalizeTimelapseSettings } from './project-metadata'
import { MAX_TIMELAPSE_SNAPSHOTS } from './timelapse'
import { encodePng } from './png'
import { translateCurrent as tr } from './localization'
import { normalizePaletteColumns, normalizePaletteSlots } from './palette-layout'

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

const toU8 = (array: Uint8ClampedArray | Uint32Array): Uint8Array =>
  new Uint8Array(array.buffer.slice(array.byteOffset, array.byteOffset + array.byteLength))

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
}

export function encodeProject(document: SpriteDocument, options: ProjectEncodeOptions = {}): Uint8Array {
  syncActiveAnimationFrame(document)
  const files: Record<string, Uint8Array> = {}
  const encodeMask = (mask: LayerMask): ManifestMask => {
    const dataFile = `masks/${mask.id}.rgba`
    files[dataFile] = new Uint8Array(mask.pixels.buffer.slice(mask.pixels.byteOffset, mask.pixels.byteOffset + mask.pixels.byteLength))
    return { id: mask.id, ...(mask.linkedMaskId ? { linkedMaskId: mask.linkedMaskId } : {}), width: mask.width, height: mask.height, offsetX: mask.offsetX, offsetY: mask.offsetY, dataFile }
  }
  const layers: ManifestLayer[] = document.layers.map((layer) => {
    const dataFile = `layers/${layer.id}.${layer.format === 'rgba' ? 'rgba' : 'idx32'}`
    files[dataFile] = toU8(layer.pixels)
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
    files[dataFile] = brush.coverage.slice()
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
      const dataFile = `cels/${cel.id}.${cel.surface.format === 'rgba' ? 'rgba' : 'idx32'}`
      files[dataFile] = toU8(cel.surface.pixels)
      return [{
        id: cel.id,
        layerId: cel.layerId,
        frameId: cel.frameId,
        ...(cel.linkedCelId ? { linkedCelId: cel.linkedCelId } : {}),
        ...(Number.isFinite(cel.opacity) ? { opacity: cel.opacity } : {}),
        format: cel.surface.format,
        width: cel.surface.width,
        height: cel.surface.height,
        offsetX: cel.surface.offsetX,
        offsetY: cel.surface.offsetY,
        dataFile,
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
      files[dataFile] = snapshot.data.slice()
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
  if (options.includePreview !== false) files['preview.png'] = encodePng(compositeDocument(document), document.width, document.height).bytes
  return zipSync(files, { level: options.compressionLevel ?? 6 })
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

export function readProjectGalleryMetadata(input: Uint8Array): ProjectGalleryMetadata {
  let files: Record<string, Uint8Array>
  try {
    files = unzipSync(input)
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
  if (!preview?.byteLength) throw new Error(tr('core.project.missingPreview'))
  return {
    name: source.name || tr('core.document.untitled'),
    width: source.width,
    height: source.height,
    colorMode: source.colorMode,
    preview: preview.slice()
  }
}

export function decodeProject(input: Uint8Array): SpriteDocument {
  let files: Record<string, Uint8Array>
  try {
    files = unzipSync(input)
  } catch {
    throw new Error(tr('core.project.unzip'))
  }
  const manifest = readManifest(files)
  const source = manifest.document
  if (!Number.isSafeInteger(source.width) || !Number.isSafeInteger(source.height) || source.width < 1 || source.height < 1) {
    throw new Error(tr('core.project.invalidCanvasSize'))
  }
  const mode = source.colorMode as ColorMode
  if (mode !== 'rgba' && mode !== 'indexed') throw new Error(tr('core.project.unknownColorMode'))
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
  const layers: RasterLayer[] = source.layers.map((metadata) => {
    const width = Number.isSafeInteger(metadata.width) && metadata.width! > 0 ? metadata.width! : source.width
    const height = Number.isSafeInteger(metadata.height) && metadata.height! > 0 ? metadata.height! : source.height
    const expectedBytes = width * height * 4
    const bytes = files[metadata.dataFile]
    if (!bytes || bytes.byteLength !== expectedBytes) throw new Error(tr('core.project.layerCorrupt', { name: metadata.name }))
    const copied = bytes.slice()
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
    if (mode === 'rgba') {
      return { ...common, format: 'rgba', pixels: new Uint8ClampedArray(copied.buffer) }
    }
    return { ...common, format: 'indexed', pixels: new Uint32Array(copied.buffer) }
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
      return [{ id: snapshot.id, capturedAt: Math.max(0, Math.trunc(Number(snapshot.capturedAt) || 0)), elapsedMs: Math.max(0, Math.trunc(Number(snapshot.elapsedMs) || 0)), width, height, data: data.slice() }]
    })
  const timelapse = normalizeTimelapseSettings(manifestTimelapse, timelapseSnapshots)
  const animation = normalizeAnimationTimeline(source.animation)
  const manifestCels = Array.isArray(source.animation?.cels) ? source.animation.cels : []
  animation.cels = animation.cels.flatMap((cel) => {
    const metadata = manifestCels.find((candidate) => candidate.id === cel.id)
    if (!metadata?.dataFile) return []
    if (metadata.format !== 'rgba' && metadata.format !== 'indexed') throw new Error(tr('core.project.layerCorrupt', { name: cel.id }))
    const width = Number(metadata.width)
    const height = Number(metadata.height)
    if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1) return []
    const bytes = files[metadata.dataFile]
    const expectedBytes = width * height * 4
    if (!bytes || bytes.byteLength !== expectedBytes) throw new Error(tr('core.project.layerCorrupt', { name: cel.id }))
    const copied = bytes.slice()
    const surface = metadata.format === 'rgba'
      ? { format: 'rgba' as const, width, height, offsetX: Math.trunc(metadata.offsetX ?? 0), offsetY: Math.trunc(metadata.offsetY ?? 0), pixels: new Uint8ClampedArray(copied.buffer) }
      : { format: 'indexed' as const, width, height, offsetX: Math.trunc(metadata.offsetX ?? 0), offsetY: Math.trunc(metadata.offsetY ?? 0), pixels: new Uint32Array(copied.buffer) }
    return [{ ...cel, surface, mask: decodeMask(metadata.mask, cel.id) }]
  })
  const manifestGroupMasks = Array.isArray(source.animation?.groupMasks) ? source.animation.groupMasks : []
  const decodedGroupMaskSlots = new Set<string>()
  animation.groupMasks = manifestGroupMasks.flatMap((entry) => {
    if (!entry || typeof entry.groupId !== 'string' || !groupIds.has(entry.groupId) || typeof entry.frameId !== 'string' || !animation.frames.some((frame) => frame.id === entry.frameId)) throw new Error(tr('core.project.layerMaskCorrupt'))
    const slot = `${entry.groupId}\u0000${entry.frameId}`
    if (decodedGroupMaskSlots.has(slot)) throw new Error(tr('core.project.layerMaskCorrupt'))
    decodedGroupMaskSlots.add(slot)
    const mask = decodeMask(entry.mask, entry.groupId, 'group')
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
  ensureAnimationDocument(document)
  refreshActiveAnimationFrame(document)
  return document
}
