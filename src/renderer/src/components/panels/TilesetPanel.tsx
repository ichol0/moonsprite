import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type FocusEvent as ReactFocusEvent, type PointerEvent as ReactPointerEvent, type WheelEvent as ReactWheelEvent } from 'react'
import { PixelUtilityIcon } from '@/components/PixelUtilityIcon'
import { SegmentedControl } from '@/components/SegmentedControl'
import { ThemedSelect } from '@/components/ThemedSelect'
import { TilesetTileThumbnail } from '@/components/TilesetTileThumbnail'
import { TILESET_TILE_PREVIEW_EVENT, type TilesetTilePreviewDetail } from '@/components/tileset-preview-events'
import { FloatingDockPreview, PanelResizeHandles, useFloatingPanel } from '@/components/floating-panel'
import type { DockDragProps } from '@/components/workspace-panel-types'
import { repositionTilesetTileSlots, tilesetTileSlots, type TilemapDrawingMode } from '@/core/tilemap'
import { PALETTE_SWATCH_GAP, PALETTE_SWATCH_PIXELS, paletteSlotRange, type PaletteSwatchSize } from '@/core/palette-layout'
import { readStoredString, writeStoredString } from '@/core/panel-preferences'
import { activeTilemapCelTarget, tilemapLayerTilesets } from '@/core/tilemap-document'
import { TILESET_DELETE_COMMAND_EVENT } from '@/core/command-context'
import { useWorkspace, type DocumentSession } from '@/store/workspace'
import { useI18n } from '@/components/I18nProvider'

const TILESET_SWATCH_SIZE_STORAGE_KEY = 'moonsprite.tileset-swatch-size'
const TILESET_SWATCH_SIZE_ORDER: PaletteSwatchSize[] = ['tiny', 'small', 'medium', 'large', 'huge']

interface TileSelectionGesture {
  pointerId: number
  element: HTMLDivElement
  slots: Array<string | null>
  columns: number
  startIndex: number
  lastIndex: number
  active: boolean
  longPressTimer: number | null
}

const tileIdsInSlotRange = (slots: readonly (string | null)[], columns: number, startIndex: number, endIndex: number): string[] => {
  const normalizedColumns = Math.max(1, Math.trunc(columns))
  const range = paletteSlotRange(normalizedColumns, startIndex, endIndex)
  const tileIds: string[] = []
  for (let y = range.top; y <= range.bottom; y += 1) for (let x = range.left; x <= range.right; x += 1) {
    const tileId = slots[y * normalizedColumns + x]
    if (tileId !== null && tileId !== undefined) tileIds.push(tileId)
  }
  return tileIds
}

export function TilesetPanel({ session, docked = false, onDockDragStart, onPanelContextMenu, onFloatingDock }: { session: DocumentSession } & DockDragProps) {
  const { t } = useI18n()
  const store = useWorkspace.getState()
  const floating = useFloatingPanel(null, false, true, 'moonsprite.tileset-panel.v1', true, onFloatingDock, docked)
  const target = activeTilemapCelTarget(session.document)
  const entries = tilemapLayerTilesets(session.document)
  const tilesets = entries.map((entry) => entry.tileset)
  const selectedTileset = tilesets.find((tileset) => tileset.id === session.selectedTilesetId)
    ?? tilesets.find((tileset) => tileset.id === target?.layer.tilemapTilesetId)
    ?? tilesets[0]
    ?? null
  const selectedTileId = selectedTileset?.tileIds.includes(session.selectedTileId ?? '') ? session.selectedTileId! : selectedTileset?.tileIds[0] ?? null
  const secondaryTileId = selectedTileset?.tileIds.includes(session.secondaryTileId ?? '') ? session.secondaryTileId! : selectedTileset?.tileIds[0] ?? null
  const tileGridRef = useRef<HTMLDivElement>(null)
  const tileDragRef = useRef<{ tilesetId: string; tileIds: string[]; baseSlots: Array<string | null>; anchorTileId: string; columns: number; pointerId: number; element: HTMLDivElement; startX: number; startY: number; moved: boolean; targetIndex: number | null; previewSlots: Array<string | null> } | null>(null)
  const tileSelectionGestureRef = useRef<TileSelectionGesture | null>(null)
  const [tileSelectionIds, setTileSelectionIds] = useState<string[]>([])
  const [tileSelectionAnchorId, setTileSelectionAnchorId] = useState<string | null>(null)
  const [gestureSelectedTileIds, setGestureSelectedTileIds] = useState<string[] | null>(null)
  const [tileGestureRange, setTileGestureRange] = useState<{ left: number; top: number; right: number; bottom: number } | null>(null)
  const [gridCapacity, setGridCapacity] = useState({ columns: 1, rows: 1 })
  const [swatchSize, setSwatchSize] = useState<PaletteSwatchSize>(() => {
    const stored = readStoredString(TILESET_SWATCH_SIZE_STORAGE_KEY)
    return TILESET_SWATCH_SIZE_ORDER.includes(stored as PaletteSwatchSize) ? stored as PaletteSwatchSize : 'medium'
  })
  const [tilePreview, setTilePreview] = useState<{ tilesetId: string; slots: Array<string | null> } | null>(null)
  const [draggingTileIds, setDraggingTileIds] = useState<string[]>([])
  const [dropTargetIndex, setDropTargetIndex] = useState<number | null>(null)
  const [selectionOutlineHovered, setSelectionOutlineHovered] = useState(false)
  const [ctrlHeld, setCtrlHeld] = useState(false)
  const [tilePixelPreview, setTilePixelPreview] = useState<TilesetTilePreviewDetail | null>(null)
  const storedTileSlots = selectedTileset ? tilesetTileSlots(selectedTileset) : []
  const minimumSlotCount = Math.max(gridCapacity.columns * gridCapacity.rows, Math.ceil(storedTileSlots.length / gridCapacity.columns) * gridCapacity.columns)
  const baseTileSlots = [...storedTileSlots, ...new Array<string | null>(Math.max(0, minimumSlotCount - storedTileSlots.length)).fill(null)]
  const displayedTileSlots = selectedTileset && tilePreview?.tilesetId === selectedTileset.id ? tilePreview.slots : baseTileSlots
  const displayedTileIds = displayedTileSlots.filter((tileId): tileId is string => tileId !== null)
  const displayedSelectedTileIds = (gestureSelectedTileIds ?? tileSelectionIds).filter((tileId) => displayedTileIds.includes(tileId))
  const selectedTileIndices = displayedTileSlots.flatMap((tileId, index) => tileId !== null && displayedSelectedTileIds.includes(tileId) ? [index] : [])
  const tileSelectionRange = tileGestureRange ?? (selectedTileIndices.length > 0
    ? selectedTileIndices.slice(1).reduce((range, index) => {
        const point = paletteSlotRange(gridCapacity.columns, index, index)
        return { left: Math.min(range.left, point.left), top: Math.min(range.top, point.top), right: Math.max(range.right, point.right), bottom: Math.max(range.bottom, point.bottom) }
      }, paletteSlotRange(gridCapacity.columns, selectedTileIndices[0], selectedTileIndices[0]))
    : null)
  const modeOptions = [
    { value: 'edit' as const, icon: 'tileModeEdit' as const, label: t('tileset.mode.edit'), description: t('tileset.mode.editDescription') },
    { value: 'create' as const, icon: 'tileModeCreate' as const, label: t('tileset.mode.create'), description: t('tileset.mode.createDescription') },
    { value: 'hybrid' as const, icon: 'tileModeHybrid' as const, label: t('tileset.mode.hybrid'), description: t('tileset.mode.hybridDescription') }
  ]

  const resetTileDrag = (): void => {
    const drag = tileDragRef.current
    tileDragRef.current = null
    if (drag?.element.hasPointerCapture?.(drag.pointerId)) drag.element.releasePointerCapture?.(drag.pointerId)
    setTilePreview(null)
    setDraggingTileIds([])
    setDropTargetIndex(null)
    setSelectionOutlineHovered(false)
  }
  const resetTileSelectionGesture = (): void => {
    const gesture = tileSelectionGestureRef.current
    tileSelectionGestureRef.current = null
    if (gesture?.longPressTimer != null) window.clearTimeout(gesture.longPressTimer)
    if (gesture?.element.hasPointerCapture?.(gesture.pointerId)) gesture.element.releasePointerCapture?.(gesture.pointerId)
    setGestureSelectedTileIds(null)
    setTileGestureRange(null)
  }
  const deleteSelectedTiles = (): void => {
    if (!selectedTileset) return
    const tileIds = displayedSelectedTileIds.length > 0 ? displayedSelectedTileIds : selectedTileId ? [selectedTileId] : []
    if (tileIds.length === 0 || !store.deleteTilesetTiles(selectedTileset.id, tileIds)) return
    resetTileDrag()
    resetTileSelectionGesture()
    setTileSelectionIds([])
    setTileSelectionAnchorId(null)
  }
  useEffect(() => {
    const drag = tileDragRef.current
    tileDragRef.current = null
    if (drag?.element.hasPointerCapture?.(drag.pointerId)) drag.element.releasePointerCapture?.(drag.pointerId)
    const gesture = tileSelectionGestureRef.current
    tileSelectionGestureRef.current = null
    if (gesture?.longPressTimer != null) window.clearTimeout(gesture.longPressTimer)
    if (gesture?.element.hasPointerCapture?.(gesture.pointerId)) gesture.element.releasePointerCapture?.(gesture.pointerId)
    setTilePreview(null)
    setDraggingTileIds([])
    setDropTargetIndex(null)
    setSelectionOutlineHovered(false)
    setTileSelectionIds([])
    setTileSelectionAnchorId(null)
    setGestureSelectedTileIds(null)
    setTileGestureRange(null)
  }, [selectedTileset?.id])
  useEffect(() => () => {
    const drag = tileDragRef.current
    if (drag?.element.hasPointerCapture?.(drag.pointerId)) drag.element.releasePointerCapture?.(drag.pointerId)
    tileDragRef.current = null
    const gesture = tileSelectionGestureRef.current
    if (gesture?.longPressTimer != null) window.clearTimeout(gesture.longPressTimer)
    if (gesture?.element.hasPointerCapture?.(gesture.pointerId)) gesture.element.releasePointerCapture?.(gesture.pointerId)
    tileSelectionGestureRef.current = null
  }, [])
  useLayoutEffect(() => {
    const grid = tileGridRef.current
    if (!grid) return
    const updateCapacity = (): void => {
      if (grid.clientWidth <= 0 || grid.clientHeight <= 0) return
      const styles = window.getComputedStyle(grid)
      const horizontalPadding = (Number.parseFloat(styles.paddingLeft) || 0) + (Number.parseFloat(styles.paddingRight) || 0)
      const verticalPadding = (Number.parseFloat(styles.paddingTop) || 0) + (Number.parseFloat(styles.paddingBottom) || 0)
      const columnGap = Number.parseFloat(styles.columnGap) || PALETTE_SWATCH_GAP
      const rowGap = Number.parseFloat(styles.rowGap) || PALETTE_SWATCH_GAP
      const tileSize = PALETTE_SWATCH_PIXELS[swatchSize]
      const columns = Math.max(1, Math.floor((Math.max(0, grid.clientWidth - horizontalPadding) + columnGap) / (tileSize + columnGap)))
      const rows = Math.max(1, Math.floor((Math.max(0, grid.clientHeight - verticalPadding) + rowGap) / (tileSize + rowGap)))
      setGridCapacity((current) => current.columns === columns && current.rows === rows ? current : { columns, rows })
    }
    updateCapacity()
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(updateCapacity)
    observer?.observe(grid)
    window.addEventListener('resize', updateCapacity)
    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', updateCapacity)
    }
  }, [selectedTileset?.id, swatchSize])
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Control' || event.ctrlKey) setCtrlHeld(true)
    }
    const handleKeyUp = (event: KeyboardEvent): void => {
      if (event.key === 'Control' || !event.ctrlKey) setCtrlHeld(false)
    }
    const handleBlur = (): void => setCtrlHeld(false)
    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('keyup', handleKeyUp)
    window.addEventListener('blur', handleBlur)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
      window.removeEventListener('blur', handleBlur)
    }
  }, [])
  useEffect(() => {
    const updateTilePreview = (event: Event): void => {
      const detail = (event as CustomEvent<TilesetTilePreviewDetail>).detail
      if (!detail || detail.documentId !== session.document.id) return
      setTilePixelPreview((current) => detail.tiles === null
        ? current?.tilesetId === detail.tilesetId ? null : current
        : detail)
    }
    window.addEventListener(TILESET_TILE_PREVIEW_EVENT, updateTilePreview)
    return () => window.removeEventListener(TILESET_TILE_PREVIEW_EVENT, updateTilePreview)
  }, [session.document.id])
  useEffect(() => {
    const panel = floating.ref.current
    if (!panel) return
    const handleDeleteCommand = (): void => deleteSelectedTiles()
    panel.addEventListener(TILESET_DELETE_COMMAND_EVENT, handleDeleteCommand)
    return () => panel.removeEventListener(TILESET_DELETE_COMMAND_EVENT, handleDeleteCommand)
  })

  const tileIndexAt = (clientX: number, clientY: number): number | null => {
    const grid = tileGridRef.current
    if (!grid) return null
    for (const tile of Array.from(grid.querySelectorAll<HTMLElement>('[data-tile-index]'))) {
      const bounds = tile.getBoundingClientRect()
      if (clientX >= bounds.left && clientX <= bounds.right && clientY >= bounds.top && clientY <= bounds.bottom) return Number(tile.dataset.tileIndex)
    }
    return null
  }
  const pointerHitsTileSelectionOutline = (clientX: number, clientY: number): boolean => {
    const outline = tileGridRef.current?.querySelector<HTMLElement>('[data-tileset-selection-outline]')
    if (!outline) return false
    const bounds = outline.getBoundingClientRect()
    if (bounds.width <= 0 || bounds.height <= 0) return false
    const tolerance = 6
    const inside = clientX >= bounds.left - tolerance && clientX <= bounds.right + tolerance && clientY >= bounds.top - tolerance && clientY <= bounds.bottom + tolerance
    return inside && (Math.abs(clientX - bounds.left) <= tolerance || Math.abs(bounds.right - clientX) <= tolerance || Math.abs(clientY - bounds.top) <= tolerance || Math.abs(bounds.bottom - clientY) <= tolerance)
  }
  const nearestSelectedTileId = (clientX: number, clientY: number): string | null => {
    const selected = new Set(displayedSelectedTileIds)
    const elements = Array.from(tileGridRef.current?.querySelectorAll<HTMLElement>('[data-tile-id]') ?? [])
      .filter((element) => selected.has(element.dataset.tileId ?? ''))
    let nearest: { tileId: string; distance: number } | null = null
    for (const element of elements) {
      const bounds = element.getBoundingClientRect()
      const distance = (clientX - (bounds.left + bounds.width / 2)) ** 2 + (clientY - (bounds.top + bounds.height / 2)) ** 2
      const tileId = element.dataset.tileId
      if (tileId && (!nearest || distance < nearest.distance)) nearest = { tileId, distance }
    }
    return nearest?.tileId ?? displayedSelectedTileIds[0] ?? null
  }
  const beginTileOutlineDrag = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0 || event.shiftKey || event.ctrlKey || event.metaKey || !selectedTileset || !pointerHitsTileSelectionOutline(event.clientX, event.clientY)) return
    const anchorTileId = nearestSelectedTileId(event.clientX, event.clientY)
    const grid = tileGridRef.current
    if (!anchorTileId || !grid || displayedSelectedTileIds.length === 0) return
    const baseSlots = [...displayedTileSlots]
    tileDragRef.current = { tilesetId: selectedTileset.id, tileIds: [...displayedSelectedTileIds], baseSlots, anchorTileId, columns: gridCapacity.columns, pointerId: event.pointerId, element: grid, startX: event.clientX, startY: event.clientY, moved: false, targetIndex: null, previewSlots: baseSlots }
    grid.setPointerCapture?.(event.pointerId)
    setSelectionOutlineHovered(true)
    event.preventDefault()
    event.stopPropagation()
  }
  const beginTileSelection = (event: ReactPointerEvent<HTMLButtonElement>, tilesetId: string, tileId: string | null, index: number): void => {
    resetTileSelectionGesture()
    event.currentTarget.focus({ preventScroll: true })
    if (event.button === 2) {
      if (tileId === null) return
      event.preventDefault()
      event.stopPropagation()
      store.setSelectedTile(tilesetId, tileId, 'secondary')
      store.setTilemapMode('paint')
      return
    }
    if (event.button !== 0) return
    if (tileId === null && (event.shiftKey || event.ctrlKey || event.metaKey)) {
      setTileSelectionIds([])
      setTileSelectionAnchorId(null)
      event.preventDefault()
      return
    }
    if (tileId !== null) {
      store.setSelectedTile(tilesetId, tileId, 'primary')
      store.setTilemapMode('paint')
    }
    if (event.shiftKey) {
      const anchorIndex = tileSelectionAnchorId === null ? -1 : displayedTileSlots.indexOf(tileSelectionAnchorId)
      setTileSelectionIds(anchorIndex < 0 ? [tileId!] : tileIdsInSlotRange(displayedTileSlots, gridCapacity.columns, anchorIndex, index))
      setTileSelectionAnchorId(tileId)
    } else if (event.ctrlKey || event.metaKey) {
      const next = tileSelectionIds.includes(tileId!) ? tileSelectionIds.filter((candidate) => candidate !== tileId) : [...tileSelectionIds, tileId!]
      setTileSelectionIds(next)
      setTileSelectionAnchorId(next.includes(tileId!) ? tileId : next.at(-1) ?? null)
    } else {
      setTileSelectionIds(tileId === null ? [] : [tileId])
      setTileSelectionAnchorId(tileId)
      const grid = tileGridRef.current
      if (grid) {
        const gesture: TileSelectionGesture = {
          pointerId: event.pointerId,
          element: grid,
          slots: [...displayedTileSlots],
          columns: gridCapacity.columns,
          startIndex: index,
          lastIndex: index,
          active: false,
          longPressTimer: null
        }
        gesture.longPressTimer = window.setTimeout(() => {
          if (tileSelectionGestureRef.current !== gesture) return
          gesture.active = true
          gesture.longPressTimer = null
          setTileGestureRange(paletteSlotRange(gesture.columns, gesture.startIndex, gesture.lastIndex))
          setGestureSelectedTileIds(tileIdsInSlotRange(gesture.slots, gesture.columns, gesture.startIndex, gesture.lastIndex))
        }, 360)
        tileSelectionGestureRef.current = gesture
        grid.setPointerCapture?.(event.pointerId)
      }
    }
    event.preventDefault()
  }
  const moveTilePointer = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const drag = tileDragRef.current
    if (drag?.pointerId === event.pointerId) {
      if (!drag.moved && Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < 1) return
      if (!drag.moved) {
        drag.moved = true
        setDraggingTileIds(drag.tileIds)
      }
      const targetIndex = tileIndexAt(event.clientX, event.clientY)
      if (targetIndex === null) return
      const previewSlots = repositionTilesetTileSlots(drag.baseSlots, drag.tileIds, targetIndex, drag.anchorTileId, drag.columns)
      drag.targetIndex = targetIndex
      setDropTargetIndex(targetIndex)
      if (previewSlots.length === drag.previewSlots.length && previewSlots.every((tileId, index) => tileId === drag.previewSlots[index])) return
      drag.previewSlots = previewSlots
      setTilePreview({ tilesetId: drag.tilesetId, slots: previewSlots })
      return
    }
    const gesture = tileSelectionGestureRef.current
    if (gesture?.pointerId === event.pointerId) {
      const targetIndex = tileIndexAt(event.clientX, event.clientY)
      if (targetIndex === null || targetIndex === gesture.lastIndex) return
      gesture.lastIndex = targetIndex
      if (!gesture.active) return
      setTileGestureRange(paletteSlotRange(gesture.columns, gesture.startIndex, gesture.lastIndex))
      setGestureSelectedTileIds(tileIdsInSlotRange(gesture.slots, gesture.columns, gesture.startIndex, gesture.lastIndex))
      return
    }
    setSelectionOutlineHovered(pointerHitsTileSelectionOutline(event.clientX, event.clientY))
  }
  const finishTileDrag = (pointerId: number, canceled = false): void => {
    const drag = tileDragRef.current
    if (!drag || drag.pointerId !== pointerId) return
    const changed = drag.previewSlots.length !== drag.baseSlots.length || drag.previewSlots.some((tileId, index) => tileId !== drag.baseSlots[index])
    if (!canceled && drag.moved && drag.targetIndex !== null && changed) store.setTilesetTileSlots(drag.tilesetId, drag.previewSlots)
    resetTileDrag()
  }
  const finishTileSelection = (pointerId: number, canceled = false): void => {
    const gesture = tileSelectionGestureRef.current
    if (!gesture || gesture.pointerId !== pointerId) return
    tileSelectionGestureRef.current = null
    if (gesture.longPressTimer !== null) window.clearTimeout(gesture.longPressTimer)
    if (gesture.element.hasPointerCapture?.(gesture.pointerId)) gesture.element.releasePointerCapture?.(gesture.pointerId)
    if (!canceled && gesture.active) {
      const tileIds = tileIdsInSlotRange(gesture.slots, gesture.columns, gesture.startIndex, gesture.lastIndex)
      const targetTileId = gesture.slots[gesture.lastIndex]
      setTileSelectionIds(tileIds)
      setTileSelectionAnchorId(targetTileId ?? tileIds.at(-1) ?? null)
    }
    setGestureSelectedTileIds(null)
    setTileGestureRange(null)
  }
  const finishTilePointer = (pointerId: number, canceled = false): void => {
    finishTileDrag(pointerId, canceled)
    finishTileSelection(pointerId, canceled)
  }
  const clearTileSelection = (event: ReactFocusEvent<HTMLDivElement>): void => {
    if (event.relatedTarget instanceof Node && floating.ref.current?.contains(event.relatedTarget)) return
    resetTileSelectionGesture()
    setTileSelectionIds([])
    setTileSelectionAnchorId(null)
    setSelectionOutlineHovered(false)
  }
  useEffect(() => {
    const clearSelectionOutside = (event: PointerEvent): void => {
      if (event.target instanceof Node && floating.ref.current?.contains(event.target)) return
      resetTileSelectionGesture()
      setTileSelectionIds([])
      setTileSelectionAnchorId(null)
      setSelectionOutlineHovered(false)
    }
    window.addEventListener('pointerdown', clearSelectionOutside, true)
    return () => window.removeEventListener('pointerdown', clearSelectionOutside, true)
  }, [session.document.id])
  const handleTileWheel = (event: ReactWheelEvent<HTMLDivElement>): void => {
    if (!event.ctrlKey && !event.metaKey) return
    event.preventDefault()
    event.stopPropagation()
    const delta = Math.abs(event.deltaY) >= Math.abs(event.deltaX) ? event.deltaY : event.deltaX
    if (delta === 0) return
    const currentIndex = TILESET_SWATCH_SIZE_ORDER.indexOf(swatchSize)
    const nextIndex = Math.max(0, Math.min(TILESET_SWATCH_SIZE_ORDER.length - 1, currentIndex + (delta < 0 ? 1 : -1)))
    if (nextIndex === currentIndex) return
    const next = TILESET_SWATCH_SIZE_ORDER[nextIndex]
    setSwatchSize(next)
    writeStoredString(TILESET_SWATCH_SIZE_STORAGE_KEY, next)
  }

  return <><section ref={floating.ref} className={`panel tileset-panel ${floating.style ? 'floating-panel' : ''}`} data-command-scope="tileset" style={floating.style} onPointerDown={floating.bringToFront} onContextMenu={onPanelContextMenu}>
    <header aria-label={t('panel.tileset')} onPointerDown={(event) => floating.style ? floating.startDrag(event) : onDockDragStart?.(event, floating.startDetachedDrag)}>
      <strong>{t('panel.tileset')}</strong>
      <span className="panel-actions" onPointerDown={(event) => event.stopPropagation()}>
        <button type="button" className={session.tilemapMode === 'paint' ? 'selected' : ''} aria-pressed={session.tilemapMode === 'paint'} title={t('tileset.mode.paint')} aria-label={t('tileset.mode.paint')} onClick={() => store.setTilemapMode('paint')}><PixelUtilityIcon kind="tilePaint" /></button>
        <button type="button" disabled={!selectedTileset || (!selectedTileId && displayedSelectedTileIds.length === 0) || selectedTileset.tileIds.length <= 1} title={t('tileset.deleteTile')} aria-label={t('tileset.deleteTile')} onClick={deleteSelectedTiles}><PixelUtilityIcon kind="delete" /></button>
      </span>
    </header>
    {selectedTileset ? <div className="tileset-panel-body">
      <div className="tileset-panel-toolbar">
        <ThemedSelect<string> density="compact" value={selectedTileset.id} label={t('toolOptions.tileset')} groups={[{ label: t('toolOptions.tileset'), options: entries.map(({ layer, tileset }) => ({ value: tileset.id, label: layer.name, description: `${tileset.tileWidth} x ${tileset.tileHeight}px` })) }]} onChange={store.setSelectedTileset} />
        <SegmentedControl<TilemapDrawingMode> className="tileset-mode-control" label={t('tileset.mode')} value={session.tilemapMode} options={modeOptions.map((option) => ({
          value: option.value,
          ariaLabel: option.label,
          label: <PixelUtilityIcon kind={option.icon} />,
          description: <><strong>{option.label}</strong><span>{option.description}</span></>
        }))} onChange={store.setTilemapMode} />
      </div>
      <div ref={tileGridRef} className={`swatch-grid tileset-tile-grid component-scrollbar ${selectionOutlineHovered ? 'selection-outline-hovered' : ''}`} role="listbox" aria-multiselectable="true" aria-label={t('toolOptions.tiles')} style={{ '--swatch-size': `${PALETTE_SWATCH_PIXELS[swatchSize]}px`, '--palette-swatch-gap': `${PALETTE_SWATCH_GAP}px` } as CSSProperties} onPointerDownCapture={beginTileOutlineDrag} onPointerMove={moveTilePointer} onPointerLeave={() => { if (!tileDragRef.current && !tileSelectionGestureRef.current) setSelectionOutlineHovered(false) }} onPointerUp={(event) => finishTilePointer(event.pointerId)} onPointerCancel={(event) => finishTilePointer(event.pointerId, true)} onWheel={handleTileWheel} onBlur={clearTileSelection}>
        {displayedTileSlots.map((tileId, index) => {
          const tileNumber = tileId === null ? -1 : selectedTileset.tileIds.indexOf(tileId)
          const primary = tileId !== null && selectedTileId === tileId
          const secondary = tileId !== null && secondaryTileId === tileId
          const selected = tileId !== null && displayedSelectedTileIds.includes(tileId)
          const dragging = tileId !== null && draggingTileIds.includes(tileId)
          const label = tileId === null ? t('tileset.emptySlot', { index: index + 1 }) : `${t('toolOptions.tileIndex', { index: tileNumber })} · ${t('tileset.tileRoleHint')}`
          return <span key={tileId ?? `empty-${index}`} className="palette-swatch-wrap tileset-tile-wrap" data-tile-index={index}><button
              type="button"
              role="option"
              data-tile-id={tileId ?? undefined}
              aria-selected={selected}
              aria-grabbed={dragging}
              aria-label={label}
              className={`swatch palette-slot ${tileId === null ? 'empty' : 'occupied'} tileset-tile ${selected ? 'selected' : ''} ${primary ? 'primary' : ''} ${secondary ? 'secondary' : ''} ${dragging ? 'dragging' : ''} ${dropTargetIndex === index ? 'drop-target' : ''}`.trim()}
              title={label}
              onPointerDown={(event) => beginTileSelection(event, selectedTileset.id, tileId, index)}
              onContextMenu={(event) => event.preventDefault()}
            >{tileId !== null && <><TilesetTileThumbnail tileset={selectedTileset} tileId={tileId} previewPixels={tilePixelPreview?.documentId === session.document.id && tilePixelPreview.tilesetId === selectedTileset.id ? tilePixelPreview.tiles?.get(tileId) : undefined} />{ctrlHeld && <span className="tileset-tile-id">{tileNumber}</span>}</>}</button>
          </span>
        })}
        {tileSelectionRange && <span data-tileset-selection-outline className="palette-selection-box tileset-selection-box" aria-hidden="true" style={{ '--palette-selection-left': tileSelectionRange.left, '--palette-selection-top': tileSelectionRange.top, '--palette-selection-width': tileSelectionRange.right - tileSelectionRange.left + 1, '--palette-selection-height': tileSelectionRange.bottom - tileSelectionRange.top + 1 } as CSSProperties} />}
      </div>
    </div> : <div className="tileset-empty-state">{t('tileset.empty')}</div>}
    {floating.style && <PanelResizeHandles onResize={floating.startResize} />}
  </section><FloatingDockPreview style={floating.dockPreview} /></>
}
