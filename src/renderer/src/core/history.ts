import type { RasterLayer, SpriteDocument } from '@shared/types'
import { getLayer, layerIndexAtStoragePoint, layerStoragePoint, readLayerPacked, writeLayerPacked } from './document'

export interface HistoryEntry {
  label: string
  bytes: number
  undo: () => void
  redo: () => void
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
      redo: () => { for (const entry of entries) entry.redo() }
    })
  }

  undo(): void {
    const entry = this.undoEntries[this.undoEntries.length - 1]
    if (!entry) return
    entry.undo()
    this.undoEntries.pop()
    this.bytes -= entry.bytes
    this.redoEntries.push(entry)
  }

  redo(): void {
    const entry = this.redoEntries[this.redoEntries.length - 1]
    if (!entry) return
    entry.redo()
    this.redoEntries.pop()
    this.undoEntries.push(entry)
    this.bytes += entry.bytes
  }
}

export interface PixelEdit {
  layerId: string
  before: Map<number, number>
  after: Map<number, number>
}

export function beginPixelEdit(layerId: string): PixelEdit {
  return { layerId, before: new Map(), after: new Map() }
}

export function recordPixel(document: SpriteDocument, layer: RasterLayer, edit: PixelEdit, index: number, next: number): boolean {
  const current = readLayerPacked(document, layer, index)
  if (current === next) return false
  if (!edit.before.has(index)) edit.before.set(index, current)
  edit.after.set(index, next)
  writeLayerPacked(document, layer, index, next)
  return true
}

export function commitPixelEdit(document: SpriteDocument, edit: PixelEdit, label: string): HistoryEntry | null {
  if (edit.before.size === 0) return null
  const changedIndices = [...edit.before.keys()].filter((index) => (edit.after.get(index) ?? edit.before.get(index)!) !== edit.before.get(index)!)
  if (changedIndices.length === 0) return null
  const layer = getLayer(document, edit.layerId)
  const points = changedIndices.map((index) => layerStoragePoint(layer, index))
  const xs = Int32Array.from(points, (point) => point.x)
  const ys = Int32Array.from(points, (point) => point.y)
  const before = Uint32Array.from(changedIndices, (index) => edit.before.get(index)!)
  const after = Uint32Array.from(changedIndices, (index) => edit.after.get(index) ?? edit.before.get(index)!)
  const apply = (values: Uint32Array): void => {
    const layer = getLayer(document, edit.layerId)
    for (let offset = 0; offset < xs.length; offset += 1) {
      const index = layerIndexAtStoragePoint(layer, xs[offset], ys[offset])
      if (index !== null) writeLayerPacked(document, layer, index, values[offset])
    }
  }
  return {
    label,
    bytes: xs.byteLength + ys.byteLength + before.byteLength + after.byteLength,
    undo: () => apply(before),
    redo: () => apply(after)
  }
}

export function revertPixelEdit(document: SpriteDocument, edit: PixelEdit): void {
  const layer = getLayer(document, edit.layerId)
  for (const [index, value] of edit.before) writeLayerPacked(document, layer, index, value)
}
