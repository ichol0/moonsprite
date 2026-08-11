import type { RasterLayer, SelectionRect, SpriteDocument } from '@shared/types'
import { animationLayerAtFrame, ensureAnimationDocument } from './animation'
import { getLayer, getLayerMaskOwner, getLayerStorageOrigin, isLayerMask, layerIndexAtStoragePoint, markLayerContentChanged, readLayerPacked, writeLayerPacked, writeLayerPackedRun } from './document'

export interface HistoryEntry {
  label: string
  bytes: number
  undo: () => void
  redo: () => void
  invalidation?: ContentInvalidationHint
}

export type ContentInvalidationHint =
  | { kind: 'full' }
  | { kind: 'region'; frameId?: string; rect: SelectionRect }

const combineInvalidations = (entries: readonly HistoryEntry[]): ContentInvalidationHint | undefined => {
  const invalidations = entries.map((entry) => entry.invalidation)
  if (invalidations.some((invalidation) => !invalidation || invalidation.kind !== 'region')) return undefined
  const regions = invalidations as Array<Extract<ContentInvalidationHint, { kind: 'region' }>>
  const frameId = regions[0]?.frameId
  if (regions.some((region) => region.frameId !== frameId)) return undefined
  const left = Math.min(...regions.map((region) => region.rect.x))
  const top = Math.min(...regions.map((region) => region.rect.y))
  const right = Math.max(...regions.map((region) => region.rect.x + region.rect.width))
  const bottom = Math.max(...regions.map((region) => region.rect.y + region.rect.height))
  return { kind: 'region', frameId, rect: { x: left, y: top, width: right - left, height: bottom - top } }
}

export class HistoryStack {
  private undoEntries: HistoryEntry[] = []
  private redoEntries: HistoryEntry[] = []
  private bytes = 0
  private compoundEntries: HistoryEntry[] | null = null

  constructor(private readonly maxBytes = 256 * 1024 * 1024) {}

  get canUndo(): boolean { return this.undoEntries.length > 0 }
  get canRedo(): boolean { return this.redoEntries.length > 0 }
  get memoryBytes(): number { return this.bytes }

  clear(): void {
    this.undoEntries = []
    this.redoEntries = []
    this.bytes = 0
    this.compoundEntries = null
  }

  push(entry: HistoryEntry): void {
    if (this.compoundEntries) {
      this.compoundEntries.push(entry)
      return
    }
    this.undoEntries.push(entry)
    this.bytes += entry.bytes
    this.redoEntries = []
    while (this.bytes > this.maxBytes && this.undoEntries.length > 1) {
      this.bytes -= this.undoEntries.shift()!.bytes
    }
  }

  beginCompound(): void {
    if (!this.compoundEntries) this.compoundEntries = []
  }

  endCompound(label: string): void {
    const entries = this.compoundEntries
    this.compoundEntries = null
    if (!entries || entries.length === 0) return
    if (entries.length === 1) {
      this.push({ ...entries[0], label })
      return
    }
    this.push({
      label,
      bytes: entries.reduce((sum, entry) => sum + entry.bytes, 0),
      undo: () => { for (let index = entries.length - 1; index >= 0; index -= 1) entries[index].undo() },
      redo: () => { for (const entry of entries) entry.redo() },
      invalidation: combineInvalidations(entries)
    })
  }

  undo(): HistoryEntry | null {
    const entry = this.undoEntries[this.undoEntries.length - 1]
    if (!entry) return null
    entry.undo()
    this.undoEntries.pop()
    this.bytes -= entry.bytes
    this.redoEntries.push(entry)
    return entry
  }

  redo(): HistoryEntry | null {
    const entry = this.redoEntries[this.redoEntries.length - 1]
    if (!entry) return null
    entry.redo()
    this.redoEntries.pop()
    this.undoEntries.push(entry)
    this.bytes += entry.bytes
    return entry
  }
}

export interface PixelEdit {
  layerId: string
  frameId?: string
  before: Map<number, number>
  after: Map<number, number>
  runs?: PixelEditRun[]
  denseRegion?: PixelEditDenseRegion
  dirtyRect?: SelectionRect
}

export interface PixelEditRun {
  index: number
  length: number
  before: number
  after: number
}

export interface PixelEditDenseRegion {
  x: number
  y: number
  width: number
  height: number
  before: Uint32Array
  after: Uint32Array
  changed: Uint8Array
  count: number
}

export function beginPixelEdit(layerId: string): PixelEdit {
  return { layerId, before: new Map(), after: new Map() }
}

export function preparePixelEdit(document: SpriteDocument, edit: PixelEdit): void {
  if (edit.frameId || !document.animation) return
  const target = getLayer(document, edit.layerId)
  edit.frameId = isLayerMask(target)
    ? getLayerMaskOwner(document, target)?.frameId
    : ensureAnimationDocument(document).activeFrameId
}

/** Records a pixel when the caller already has its current packed value. */
export function recordPixelKnownCurrent(document: SpriteDocument, layer: RasterLayer, edit: PixelEdit, index: number, current: number, next: number): boolean {
  preparePixelEdit(document, edit)
  if (current === next) return false
  if (!edit.dirtyRect) markLayerContentChanged(layer)
  if (!edit.before.has(index)) edit.before.set(index, current)
  edit.after.set(index, next)
  const x = index % layer.width + layer.offsetX
  const y = Math.floor(index / layer.width) + layer.offsetY
  if (!edit.dirtyRect) edit.dirtyRect = { x, y, width: 1, height: 1 }
  else {
    const dirty = edit.dirtyRect
    const left = Math.min(dirty.x, x)
    const top = Math.min(dirty.y, y)
    const right = Math.max(dirty.x + dirty.width, x + 1)
    const bottom = Math.max(dirty.y + dirty.height, y + 1)
    dirty.x = left
    dirty.y = top
    dirty.width = right - left
    dirty.height = bottom - top
  }
  writeLayerPacked(document, layer, index, next)
  return true
}

export function recordPixel(document: SpriteDocument, layer: RasterLayer, edit: PixelEdit, index: number, next: number): boolean {
  const current = readLayerPacked(document, layer, index)
  return recordPixelKnownCurrent(document, layer, edit, index, current, next)
}

export function commitPixelEdit(document: SpriteDocument, edit: PixelEdit, label: string): HistoryEntry | null {
  if (edit.before.size === 0 && !edit.runs?.length && !edit.denseRegion?.count) return null
  const maskTarget = isLayerMask(getLayer(document, edit.layerId))
  const frameId = edit.frameId ?? document.animation?.activeFrameId
  const layerForFrame = (): RasterLayer => maskTarget
    ? getLayer(document, edit.layerId)
    : frameId && document.animation?.activeFrameId !== frameId
    ? animationLayerAtFrame(document, edit.layerId, frameId) ?? getLayer(document, edit.layerId)
    : getLayer(document, edit.layerId)
  const layer = layerForFrame()
  const capacity = edit.before.size
  let xs = new Int32Array(capacity)
  let ys = new Int32Array(capacity)
  let before = new Uint32Array(capacity)
  let after = new Uint32Array(capacity)
  const storageOrigin = getLayerStorageOrigin(layer)
  let count = 0
  for (const [index, beforeValue] of edit.before) {
    const afterValue = edit.after.get(index) ?? beforeValue
    if (afterValue === beforeValue) continue
    xs[count] = index % layer.width + storageOrigin.x
    ys[count] = Math.floor(index / layer.width) + storageOrigin.y
    before[count] = beforeValue
    after[count] = afterValue
    count += 1
  }
  if (count < capacity) {
    xs = xs.slice(0, count)
    ys = ys.slice(0, count)
    before = before.slice(0, count)
    after = after.slice(0, count)
  }
  const runCount = edit.runs?.length ?? 0
  const runXs = new Int32Array(runCount)
  const runYs = new Int32Array(runCount)
  const runLengths = new Uint32Array(runCount)
  const runBefore = new Uint32Array(runCount)
  const runAfter = new Uint32Array(runCount)
  for (let offset = 0; offset < runCount; offset += 1) {
    const run = edit.runs![offset]
    runXs[offset] = run.index % layer.width + storageOrigin.x
    runYs[offset] = Math.floor(run.index / layer.width) + storageOrigin.y
    runLengths[offset] = run.length
    runBefore[offset] = run.before
    runAfter[offset] = run.after
  }
  const denseRegion = edit.denseRegion
  if (count === 0 && runCount === 0 && !denseRegion?.count) return null
  const apply = (values: Uint32Array): void => {
    const layer = layerForFrame()
    if (xs.length > 0) markLayerContentChanged(layer)
    for (let offset = 0; offset < xs.length; offset += 1) {
      const index = layerIndexAtStoragePoint(layer, xs[offset], ys[offset])
      if (index !== null) writeLayerPacked(document, layer, index, values[offset])
    }
  }
  const applyRuns = (values: Uint32Array): void => {
    const layer = layerForFrame()
    if (runCount > 0) markLayerContentChanged(layer)
    for (let offset = 0; offset < runCount; offset += 1) {
      const start = layerIndexAtStoragePoint(layer, runXs[offset], runYs[offset])
      if (start === null) continue
      writeLayerPackedRun(document, layer, start, runLengths[offset], values[offset])
    }
  }
  const applyDenseRegion = (values: Uint32Array): void => {
    if (!denseRegion?.count) return
    const layer = layerForFrame()
    markLayerContentChanged(layer)
    for (let offset = 0; offset < denseRegion.changed.length; offset += 1) {
      if (denseRegion.changed[offset] === 0) continue
      const x = denseRegion.x + offset % denseRegion.width
      const y = denseRegion.y + Math.floor(offset / denseRegion.width)
      const index = layerIndexAtStoragePoint(layer, x, y)
      if (index !== null) writeLayerPacked(document, layer, index, values[offset])
    }
  }
  const denseBytes = denseRegion
    ? denseRegion.before.byteLength + denseRegion.after.byteLength + denseRegion.changed.byteLength
    : 0
  return {
    label,
    bytes: xs.byteLength + ys.byteLength + before.byteLength + after.byteLength + runXs.byteLength + runYs.byteLength + runLengths.byteLength + runBefore.byteLength + runAfter.byteLength + denseBytes,
    undo: () => { applyRuns(runBefore); if (denseRegion) applyDenseRegion(denseRegion.before); apply(before) },
    redo: () => { applyRuns(runAfter); if (denseRegion) applyDenseRegion(denseRegion.after); apply(after) },
    invalidation: edit.dirtyRect ? { kind: 'region', frameId, rect: { ...edit.dirtyRect } } : undefined
  }
}

export function revertPixelEdit(document: SpriteDocument, edit: PixelEdit | null | undefined): void {
  if (!edit) return
  const maskTarget = isLayerMask(getLayer(document, edit.layerId))
  const layer = !maskTarget && edit.frameId && document.animation?.activeFrameId !== edit.frameId
    ? animationLayerAtFrame(document, edit.layerId, edit.frameId) ?? getLayer(document, edit.layerId)
    : getLayer(document, edit.layerId)
  if (edit.before.size > 0 || edit.runs?.length || edit.denseRegion?.count) markLayerContentChanged(layer)
  for (const run of edit.runs ?? []) {
    writeLayerPackedRun(document, layer, run.index, run.length, run.before)
  }
  const denseRegion = edit.denseRegion
  if (denseRegion?.count) for (let offset = 0; offset < denseRegion.changed.length; offset += 1) {
    if (denseRegion.changed[offset] === 0) continue
    const x = denseRegion.x + offset % denseRegion.width
    const y = denseRegion.y + Math.floor(offset / denseRegion.width)
    const index = layerIndexAtStoragePoint(layer, x, y)
    if (index !== null) writeLayerPacked(document, layer, index, denseRegion.before[offset])
  }
  for (const [index, value] of edit.before) writeLayerPacked(document, layer, index, value)
}
