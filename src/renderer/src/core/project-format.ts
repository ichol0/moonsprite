import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { BLEND_MODES, type BlendMode, type ColorMode, type LayerGroup, type PaletteEntry, type ProjectBrush, type RasterLayer, type SpriteDocument } from '@shared/types'
import { compositeDocument, createId } from './document'
import { encodePng } from './png'

interface ManifestLayer {
  id: string
  name: string
  visible: boolean
  locked: boolean
  opacity: number
  blendMode?: BlendMode
  groupId?: string | null
  width?: number
  height?: number
  offsetX?: number
  offsetY?: number
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

export const PROJECT_SCHEMA_VERSION = 1

interface ProjectManifest {
  schemaVersion: typeof PROJECT_SCHEMA_VERSION
  app: 'MoonSprite'
  document: Omit<SpriteDocument, 'layers' | 'palette' | 'customBrushes' | 'filePath' | 'sourceFilePath' | 'dirty'> & { layers: ManifestLayer[]; palette: PaletteEntry[]; customBrushes: ManifestProjectBrush[] }
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
      name: typeof candidate.name === 'string' && candidate.name ? candidate.name : '未命名组',
      ...(candidate.parentGroupId === undefined ? {} : { parentGroupId: typeof candidate.parentGroupId === 'string' ? candidate.parentGroupId : null }),
      visible: candidate.visible !== false,
      locked: candidate.locked === true,
      opacity: Number.isFinite(candidate.opacity) ? Math.max(0, Math.min(1, Number(candidate.opacity))) : 1,
      blendMode: normalizeBlendMode(candidate.blendMode)
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

export function encodeProject(document: SpriteDocument): Uint8Array {
  const files: Record<string, Uint8Array> = {}
  const layers: ManifestLayer[] = document.layers.map((layer) => {
    const dataFile = `layers/${layer.id}.${layer.format === 'rgba' ? 'rgba' : 'idx32'}`
    files[dataFile] = toU8(layer.pixels)
    return {
      id: layer.id,
      name: layer.name,
      visible: layer.visible,
      locked: layer.locked,
      opacity: layer.opacity,
      blendMode: layer.blendMode,
      groupId: layer.groupId ?? null,
      width: layer.width,
      height: layer.height,
      offsetX: layer.offsetX,
      offsetY: layer.offsetY,
      dataFile
    }
  })
  const customBrushes: ManifestProjectBrush[] = (document.customBrushes ?? []).map((brush) => {
    const dataFile = `brushes/${brush.id}.gray`
    files[dataFile] = brush.coverage.slice()
    const colorsFile = brush.colors && brush.colors.length === brush.width * brush.height ? `brushes/${brush.id}.rgba` : undefined
    if (colorsFile) files[colorsFile] = toU8(brush.colors!)
    return { id: brush.id, name: brush.name, width: brush.width, height: brush.height, dataFile, colorsFile, sourceX: brush.sourceX, sourceY: brush.sourceY }
  })
  const { layers: _layers, palette: _palette, customBrushes: _customBrushes, filePath: _filePath, sourceFilePath: _sourceFilePath, dirty: _dirty, ...serializable } = document
  const manifest: ProjectManifest = {
    schemaVersion: 1,
    app: 'MoonSprite',
    document: {
      ...serializable,
      layers,
      palette: document.palette.map((entry) => ({ ...entry, color: { ...entry.color } })),
      customBrushes
    }
  }
  files['manifest.json'] = strToU8(JSON.stringify(manifest))
  files['preview.png'] = encodePng(compositeDocument(document), document.width, document.height).bytes
  return zipSync(files, { level: 6 })
}

export function migrateProjectManifest(input: unknown): ProjectManifest {
  if (!input || typeof input !== 'object') throw new Error('manifest.json format is invalid')
  const candidate = input as Partial<ProjectManifest>
  if (candidate.app !== 'MoonSprite' || candidate.schemaVersion !== PROJECT_SCHEMA_VERSION || candidate.document?.schemaVersion !== PROJECT_SCHEMA_VERSION) {
    throw new Error('Unsupported MoonSprite project version')
  }
  return candidate as ProjectManifest
}

function readManifest(files: Record<string, Uint8Array>): ProjectManifest {
  const manifestFile = files['manifest.json']
  if (!manifestFile) throw new Error('工程文件缺少 manifest.json。')
  let manifest: ProjectManifest
  try {
    manifest = migrateProjectManifest(JSON.parse(strFromU8(manifestFile)))
  } catch {
    throw new Error('工程文件的 manifest.json 无法读取。')
  }
  if (manifest.app !== 'MoonSprite' || manifest.schemaVersion !== 1 || manifest.document?.schemaVersion !== 1) {
    throw new Error('该工程版本不受当前 MoonSprite 支持。')
  }
  return manifest
}

export function readProjectGalleryMetadata(input: Uint8Array): ProjectGalleryMetadata {
  let files: Record<string, Uint8Array>
  try {
    files = unzipSync(input)
  } catch {
    throw new Error('无法解压工程文件')
  }
  const manifest = readManifest(files)
  const source = manifest.document
  if (!Number.isSafeInteger(source.width) || !Number.isSafeInteger(source.height) || source.width < 1 || source.height < 1) {
    throw new Error('工程包含无效的画布尺寸')
  }
  if (source.colorMode !== 'rgba' && source.colorMode !== 'indexed') throw new Error('工程包含未知颜色模式')
  const preview = files['preview.png']
  if (!preview?.byteLength) throw new Error('工程缺少预览图')
  return {
    name: source.name || '未命名作品',
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
    throw new Error('无法解压 MoonSprite 工程文件。')
  }
  const manifest = readManifest(files)
  const source = manifest.document
  if (!Number.isSafeInteger(source.width) || !Number.isSafeInteger(source.height) || source.width < 1 || source.height < 1) {
    throw new Error('工程文件包含无效画布尺寸。')
  }
  const mode = source.colorMode as ColorMode
  if (mode !== 'rgba' && mode !== 'indexed') throw new Error('工程文件包含未知颜色模式。')
  const pixels = source.width * source.height
  const layers: RasterLayer[] = source.layers.map((metadata) => {
    const width = Number.isSafeInteger(metadata.width) && metadata.width! > 0 ? metadata.width! : source.width
    const height = Number.isSafeInteger(metadata.height) && metadata.height! > 0 ? metadata.height! : source.height
    const expectedBytes = width * height * 4
    const bytes = files[metadata.dataFile]
    if (!bytes || bytes.byteLength !== expectedBytes) throw new Error(`图层“${metadata.name}”数据损坏或不完整。`)
    const copied = bytes.slice()
    if (mode === 'rgba') {
      return { ...metadata, width, height, offsetX: Number.isFinite(metadata.offsetX) ? Math.trunc(metadata.offsetX!) : 0, offsetY: Number.isFinite(metadata.offsetY) ? Math.trunc(metadata.offsetY!) : 0, blendMode: normalizeBlendMode(metadata.blendMode), format: 'rgba', pixels: new Uint8ClampedArray(copied.buffer) }
    }
    return { ...metadata, width, height, offsetX: Number.isFinite(metadata.offsetX) ? Math.trunc(metadata.offsetX!) : 0, offsetY: Number.isFinite(metadata.offsetY) ? Math.trunc(metadata.offsetY!) : 0, blendMode: normalizeBlendMode(metadata.blendMode), format: 'indexed', pixels: new Uint32Array(copied.buffer) }
  })
  if (layers.length === 0) throw new Error('工程文件不包含图层。')
  const groups = normalizeLayerGroups(source.groups)
  const groupIds = new Set(groups.map((group) => group.id))
  for (const layer of layers) if (layer.groupId && !groupIds.has(layer.groupId)) layer.groupId = null
  const activeLayerId = layers.some((layer) => layer.id === source.activeLayerId) ? source.activeLayerId : layers[0].id
  const customBrushes: ProjectBrush[] = []
  for (const metadata of Array.isArray(source.customBrushes) ? source.customBrushes : []) {
    if (typeof metadata?.id !== 'string' || typeof metadata?.name !== 'string') continue
    if (!Number.isSafeInteger(metadata.width) || !Number.isSafeInteger(metadata.height) || metadata.width < 1 || metadata.height < 1 || metadata.width * metadata.height > 16 * 1024 * 1024) throw new Error(`工程中的自定义笔刷“${metadata.name}”尺寸无效。`)
    const bytes = files[metadata.dataFile]
    if (!bytes || bytes.byteLength !== metadata.width * metadata.height) throw new Error(`自定义笔刷“${metadata.name}”数据损坏或不完整。`)
    let colors: Uint32Array | undefined
    if (metadata.colorsFile) {
      const colorBytes = files[metadata.colorsFile]
      if (colorBytes && colorBytes.byteLength === metadata.width * metadata.height * 4) colors = new Uint32Array(colorBytes.slice().buffer)
    }
    customBrushes.push({ id: metadata.id, name: metadata.name, width: metadata.width, height: metadata.height, coverage: bytes.slice(), colors, sourceX: metadata.sourceX, sourceY: metadata.sourceY })
  }
  return {
    schemaVersion: 1,
    id: createId('doc'),
    name: source.name || '未命名作品',
    width: source.width,
    height: source.height,
    colorMode: mode,
    layers,
    groups,
    activeLayerId,
    palette: Array.isArray(source.palette) ? source.palette : [],
    paletteOrder: Array.isArray(source.paletteOrder) ? source.paletteOrder : [],
    nextColorId: Math.max(1, source.nextColorId ?? 1),
    customBrushes,
    filePath: null,
    dirty: false,
    createdAt: source.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString()
  }
}
