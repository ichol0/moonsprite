import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { BookOpen, Check, Combine, Copy, Eye, EyeOff, FileImage, Folder, FolderMinus, FolderOpen, FolderPlus, Grid2X2, Layers2, Lock, LockKeyhole, LockOpen, Minus, Palette, Plus, Save, ScanSearch, Settings2, Square, Trash2, X } from 'lucide-react'
import type { BlendMode, LayerGroup, PaletteEntry, RasterLayer, RgbaColor, StoredPalette } from '@shared/types'
import { createCompositeSampler, getLayerIdsInGroup } from '@/core/document'
import { encodePalettePng, extractPaletteColors, mergePaletteColors } from '@/core/palette'
import { colorEquals, relativeLuminanceColor } from '@/core/raster'
import { useWorkspace, type DocumentSession } from '@/store/workspace'
import { ColorPicker, colorCss, rgbaHex, type ColorPickerConfig, type ColorPickerScheme } from '@/components/ColorPicker'
import { NumberInput } from '@/components/NumberInput'
import { ThemedSelect, type ThemedSelectGroup } from '@/components/ThemedSelect'
import { parseColorPickerConfig, readStoredString, removeStoredValue, saveColorPickerConfig, writeStoredString } from '@/core/panel-preferences'
import { COLOR_SQUARE_ANCHOR_STORAGE_KEY, COLOR_SQUARE_DOCK_STORAGE_KEY, DEFAULT_BOTTOM_WIDTHS, DEFAULT_INSPECTOR_ORDER, DEFAULT_INSPECTOR_SIZES, INSPECTOR_LAYOUT_STORAGE_KEY, MINIMUM_BOTTOM_WIDTHS, MINIMUM_INSPECTOR_SIZES, loadInspectorLayout, moveInspectorPanel, type WorkspacePanelId } from '@/core/panel-layout'
import { PALETTE_SWATCH_PIXELS, paletteColorsEqual, paletteMarkerColor, paletteReorderTarget, reorderPalettePreview, type PaletteSwatchSize } from '@/core/palette-layout'
import { buildLayerPanelTree, resolveLayerPanelDropTarget, type LayerPanelNode } from '@/core/layer-panel-layout'
import { FloatingDockPreview, PanelResizeHandles, panelDockZoneAt, useFloatingPanel } from './floating-panel'
import type { FixedPanelDock, PanelDock } from './floating-panel'

export type { PanelDock } from './floating-panel'
export type { WorkspacePanelId } from '@/core/panel-layout'
const notifyWorkspaceLayoutChanged = (): void => { window.dispatchEvent(new Event('moonsprite-workspace-layout-change')) }
interface DockDragProps {
  docked?: boolean
  onDockDragStart?: (event: React.PointerEvent<HTMLElement>, detach: (clientX: number, clientY: number, continueDrag?: boolean) => void) => void
  onFloatingDock?: (dock: FixedPanelDock) => void
  onRestoreSquare?: (preferBottom?: boolean) => void
}

export function ColorPanel({ session, docked = false, onDockDragStart, onFloatingDock, onRestoreSquare }: { session: DocumentSession } & DockDragProps) {
  const setPrimary = useWorkspace((state) => state.setPrimaryColor)
  const setSecondary = useWorkspace((state) => state.setSecondaryColor)
  const floating = useFloatingPanel(null, false, true, 'moonsprite.color-panel.v1', false, onFloatingDock, docked)
  const schemeButtonRef = useRef<HTMLButtonElement>(null)
  const schemeMenuRef = useRef<HTMLSpanElement>(null)
  const [schemeMenuOpen, setSchemeMenuOpen] = useState(false)
  const [schemeMenuPosition, setSchemeMenuPosition] = useState({ left: 8, top: 8 })
  const hueStepPresets = [
    { value: 0, label: '连续' },
    { value: 6, label: '6 段' },
    { value: 12, label: '12 段' },
    { value: 24, label: '24 段' },
    { value: 36, label: '36 段' }
  ]
  const colorStepPresets = [
    { value: 0, label: '连续' },
    { value: 5, label: '5 级' },
    { value: 9, label: '9 级' },
    { value: 15, label: '15 级' }
  ]
  const hueStepValues = hueStepPresets.map((preset) => preset.value)
  const colorStepValues = colorStepPresets.map((preset) => preset.value)
  const [pickerConfig, setPickerConfig] = useState<ColorPickerConfig>(() => {
    return parseColorPickerConfig(readStoredString('moonsprite.color-picker-config'), readStoredString('moonsprite.color-picker-scheme'), hueStepValues, colorStepValues)
  })
  const schemeOptions: Array<{ value: ColorPickerScheme; label: string }> = [
    { value: 'moon-ring', label: '月环调色盘' },
    { value: 'sv-square', label: '饱和度 / 明度' },
    { value: 'hs-square', label: '色相 / 饱和度' },
    { value: 'wheel', label: '色轮' }
  ]

  useLayoutEffect(() => {
    if (!schemeMenuOpen) return
    const button = schemeButtonRef.current?.getBoundingClientRect()
    const menu = schemeMenuRef.current?.getBoundingClientRect()
    const panel = floating.ref.current?.getBoundingClientRect()
    if (!button || !menu || !panel) return
    const leftOfPanel = panel.left - menu.width - 6
    const rightOfPanel = panel.right + 6
    const left = leftOfPanel >= 8
      ? leftOfPanel
      : rightOfPanel + menu.width <= window.innerWidth - 8
        ? rightOfPanel
        : Math.max(8, Math.min(window.innerWidth - menu.width - 8, button.right - menu.width))
    setSchemeMenuPosition({
      left,
      top: Math.max(8, Math.min(window.innerHeight - menu.height - 8, panel.top))
    })
  }, [schemeMenuOpen])

  useEffect(() => {
    if (!schemeMenuOpen) return
    const close = (event: PointerEvent): void => {
      const target = event.target as Node
      if (!schemeButtonRef.current?.contains(target) && !schemeMenuRef.current?.contains(target)) setSchemeMenuOpen(false)
    }
    window.addEventListener('pointerdown', close, true)
    return () => window.removeEventListener('pointerdown', close, true)
  }, [schemeMenuOpen])

  const updatePickerConfig = (changes: Partial<ColorPickerConfig>): void => {
    setPickerConfig((current) => {
      const next = { ...current, ...changes }
      saveColorPickerConfig(next)
      return next
    })
  }
  const restoreSquare = (): void => {
    const panel = floating.ref.current
    const fieldSlot = panel?.querySelector<HTMLElement>('.color-field-slot')
    if (!panel || !fieldSlot) return
    if (floating.style) {
      const panelBounds = panel.getBoundingClientRect()
      if (onRestoreSquare && panelBounds.top >= window.innerHeight * 0.55 && panelBounds.bottom >= window.innerHeight - 72) {
        onRestoreSquare(true)
        return
      }
      const fieldBounds = fieldSlot.getBoundingClientRect()
      const targetHeight = Math.round(panelBounds.height - fieldBounds.height + fieldBounds.width)
      if (Math.abs(panelBounds.height - targetHeight) <= 1) return
      floating.resizeTo(panelBounds.width, targetHeight)
      return
    }
    onRestoreSquare?.()
  }

  return <><section ref={floating.ref} className={`panel color-panel ${floating.style ? 'floating-panel' : ''}`} style={floating.style} onPointerDown={floating.bringToFront}>
    <header onPointerDown={(event) => floating.style ? floating.startDrag(event) : onDockDragStart?.(event, floating.startDetachedDrag)}><Palette size={15} /><span>颜色</span><span className="panel-actions color-scheme-control" onPointerDown={(event) => event.stopPropagation()}><button type="button" title="将调色盘恢复为正方形" aria-label="将调色盘恢复为正方形" onClick={restoreSquare}><Square size={14} /></button><button ref={schemeButtonRef} type="button" className={schemeMenuOpen ? 'active' : ''} title="更换调色盘样式" aria-label="更换调色盘样式" aria-expanded={schemeMenuOpen} onClick={() => setSchemeMenuOpen((open) => !open)}><Grid2X2 size={14} /></button></span></header>
    <ColorPicker color={session.primaryColor} secondaryColor={session.secondaryColor} onChange={setPrimary} onSecondaryChange={setSecondary} config={pickerConfig} />
    {floating.style && <PanelResizeHandles onResize={floating.startResize} />}
  </section><FloatingDockPreview style={floating.dockPreview} />
  {schemeMenuOpen && createPortal(<span ref={schemeMenuRef} className="color-scheme-popover" role="menu" aria-label="调色盘样式" style={schemeMenuPosition}><span className="color-scheme-options">{schemeOptions.map((option) => <button key={option.value} type="button" role="menuitemradio" aria-checked={pickerConfig.scheme === option.value} className={pickerConfig.scheme === option.value ? 'selected' : ''} onClick={() => updatePickerConfig({ scheme: option.value })}><i className={`color-scheme-preview preview-${option.value}`} aria-hidden="true" /><span>{option.label}</span>{pickerConfig.scheme === option.value && <Check size={13} />}</button>)}</span>{pickerConfig.scheme === 'moon-ring' && <span className="color-scheme-settings"><span className="color-preset-group"><span className="color-preset-label">月环中心</span><span className="color-preset-options"><button type="button" className={pickerConfig.moonField !== 'hsl-triangle' ? 'selected' : ''} onClick={() => updatePickerConfig({ moonField: 'hsv-square' })}>HSV 方形</button><button type="button" className={pickerConfig.moonField === 'hsl-triangle' ? 'selected' : ''} onClick={() => updatePickerConfig({ moonField: 'hsl-triangle' })}>HSL 三角形</button></span></span></span>}<span className="color-scheme-settings"><span className="color-preset-group"><span className="color-preset-label color-setting-tooltip" data-tip="将色相限制到固定分段；连续表示不吸附。">色相吸附</span><span className="color-preset-options">{hueStepPresets.map((preset) => <button key={preset.value} type="button" className={pickerConfig.hueSteps === preset.value ? 'selected' : ''} aria-pressed={pickerConfig.hueSteps === preset.value} onClick={() => updatePickerConfig({ hueSteps: preset.value })}>{preset.label}</button>)}</span></span><span className="color-preset-group"><span className="color-preset-label color-setting-tooltip" data-tip="限制饱和度、明度和透明度的可选级数；栏目缩放后仍可选择同一批颜色。">颜色级数</span><span className="color-preset-options">{colorStepPresets.map((preset) => <button key={preset.value} type="button" className={pickerConfig.colorSteps === preset.value ? 'selected' : ''} aria-pressed={pickerConfig.colorSteps === preset.value} onClick={() => updatePickerConfig({ colorSteps: preset.value })}>{preset.label}</button>)}</span></span></span></span>, document.body)}
  </>
}

export function PalettePanel({ session, docked = false, onDockDragStart, onFloatingDock }: { session: DocumentSession } & DockDragProps) {
  const store = useWorkspace()
  const floating = useFloatingPanel(null, false, true, 'moonsprite.palette-panel.v1', false, onFloatingDock, docked)
  const extractFloating = useFloatingPanel({ x: Math.max(24, window.innerWidth / 2 - 210), y: Math.max(72, window.innerHeight / 2 - 170), width: 420 }, false, false)
  const saveFloating = useFloatingPanel({ x: Math.max(24, window.innerWidth / 2 - 190), y: Math.max(72, window.innerHeight / 2 - 130), width: 380 }, false, false)
  const [paletteActionsOpen, setPaletteActionsOpen] = useState(false)
  const [libraryOpen, setLibraryOpen] = useState(false)
  const [extractOpen, setExtractOpen] = useState(false)
  const [saveOpen, setSaveOpen] = useState(false)
  const [paletteFiles, setPaletteFiles] = useState<StoredPalette[]>([])
  const [paletteDirectory, setPaletteDirectory] = useState('palettes')
  const [paletteLoading, setPaletteLoading] = useState(true)
  const [activePaletteId, setActivePaletteId] = useState<string | null>(() => readStoredString('moonsprite.active-palette-id'))
  const [extractMode, setExtractMode] = useState<'create' | 'replace' | 'append'>('create')
  const [extractLimit, setExtractLimit] = useState(32)
  const [extractName, setExtractName] = useState(`${session.document.name} 色板`)
  const [saveName, setSaveName] = useState(`${session.document.name} 色板`)
  const [operationBusy, setOperationBusy] = useState(false)
  const [paletteContext, setPaletteContext] = useState<{ id: string; x: number; y: number } | null>(null)
  const paletteActionsControlRef = useRef<HTMLSpanElement>(null)
  const libraryControlRef = useRef<HTMLSpanElement>(null)
  const paletteActionsButtonRef = useRef<HTMLButtonElement>(null)
  const libraryButtonRef = useRef<HTMLButtonElement>(null)
  const swatchGridRef = useRef<HTMLDivElement>(null)
  const paletteActionsPopoverRef = useRef<HTMLSpanElement>(null)
  const libraryPopoverRef = useRef<HTMLSpanElement>(null)
  const paletteContextRef = useRef<HTMLSpanElement>(null)
  const [paletteActionsPopoverPosition, setPaletteActionsPopoverPosition] = useState({ left: 8, top: 8 })
  const [libraryPopoverPosition, setLibraryPopoverPosition] = useState({ left: 8, top: 8 })
  const dragRef = useRef<{ ids: number[]; baseOrder: number[]; previewOrder: number[]; clickedId: number; anchorOffset: number; pointerId: number; element: HTMLButtonElement; startX: number; startY: number; moved: boolean; collapseOnClick: boolean; target: { id: number; insertAfter: boolean } | null } | null>(null)
  const [draggingIds, setDraggingIds] = useState<number[]>([])
  const [palettePreviewOrder, setPalettePreviewOrder] = useState<number[] | null>(null)
  const [swatchSize, setSwatchSize] = useState<PaletteSwatchSize>(() => {
    const stored = readStoredString('moonsprite.palette-swatch-size')
    return stored === 'small' || stored === 'large' ? stored : 'medium'
  })
  const ordered = session.document.paletteOrder.map((id) => session.document.palette.find((entry) => entry.id === id)).filter((entry): entry is PaletteEntry => Boolean(entry))
  const displayedOrdered = (palettePreviewOrder ?? session.document.paletteOrder).map((id) => session.document.palette.find((entry) => entry.id === id)).filter((entry): entry is PaletteEntry => Boolean(entry))
  const orderedColors = ordered.map((entry) => ({ ...entry.color }))
  const selectedId = ordered.find((entry) => colorEquals(entry.color, session.primaryColor))?.id ?? null
  const activePalette = paletteFiles.find((palette) => palette.id === activePaletteId) ?? null

  useLayoutEffect(() => {
    const grid = swatchGridRef.current
    if (!grid) return
    for (const entry of displayedOrdered) {
      const swatch = grid.querySelector<HTMLElement>(`[data-palette-id="${entry.id}"]`)
      swatch?.style.setProperty('--swatch-corner-color', paletteMarkerColor(entry.color))
    }
  }, [displayedOrdered, session.revision])

  const refreshPalettes = async (preferredId?: string): Promise<void> => {
    setPaletteLoading(true)
    try {
      const listing = await window.moonSprite.listPalettes()
      setPaletteDirectory(listing.directoryPath)
      setPaletteFiles(listing.palettes)
      const matching = listing.palettes.find((palette) => paletteColorsEqual(palette.colors, orderedColors))
      const candidate = preferredId ?? matching?.id ?? null
      const nextId = candidate && listing.palettes.some((palette) => palette.id === candidate) ? candidate : null
      setActivePaletteId(nextId)
      const nextPalette = listing.palettes.find((palette) => palette.id === nextId)
      if (nextPalette) setSaveName(nextPalette.name)
      if (nextId) writeStoredString('moonsprite.active-palette-id', nextId)
      else removeStoredValue('moonsprite.active-palette-id')
    } catch (error) {
      store.setMessage(error instanceof Error ? error.message : '无法读取本地色板。')
    } finally {
      setPaletteLoading(false)
    }
  }

  useEffect(() => { void refreshPalettes() }, [session.document.id])

  useEffect(() => {
    if (!paletteActionsOpen && !libraryOpen && !paletteContext) return
    const close = (event: PointerEvent): void => {
      const target = event.target as Node
      if (!paletteActionsControlRef.current?.contains(target) && !paletteActionsPopoverRef.current?.contains(target)) setPaletteActionsOpen(false)
      if (!libraryControlRef.current?.contains(target) && !libraryPopoverRef.current?.contains(target) && !paletteContextRef.current?.contains(target)) setLibraryOpen(false)
      if (!paletteContextRef.current?.contains(target)) setPaletteContext(null)
    }
    window.addEventListener('pointerdown', close, true)
    return () => window.removeEventListener('pointerdown', close, true)
  }, [paletteActionsOpen, libraryOpen, paletteContext, paletteFiles.length])

  useLayoutEffect(() => {
    if (!paletteActionsOpen && !libraryOpen) return
    const place = (): void => {
      const position = (button: HTMLButtonElement | null, popover: HTMLSpanElement | null): { left: number; top: number } | null => {
        const trigger = button?.getBoundingClientRect()
        const bounds = popover?.getBoundingClientRect()
        if (!trigger || !bounds) return null
        return {
          left: Math.max(8, Math.min(window.innerWidth - bounds.width - 8, trigger.right - bounds.width)),
          top: Math.max(8, Math.min(window.innerHeight - bounds.height - 8, trigger.bottom + 4))
        }
      }
      const actionsPosition = position(paletteActionsButtonRef.current, paletteActionsPopoverRef.current)
      const libraryPosition = position(libraryButtonRef.current, libraryPopoverRef.current)
      if (actionsPosition) setPaletteActionsPopoverPosition(actionsPosition)
      if (libraryPosition) setLibraryPopoverPosition(libraryPosition)
    }
    place()
    window.addEventListener('resize', place)
    return () => window.removeEventListener('resize', place)
  }, [paletteActionsOpen, libraryOpen])

  const chooseSwatchSize = (value: PaletteSwatchSize): void => {
    setSwatchSize(value)
    writeStoredString('moonsprite.palette-swatch-size', value)
    setPaletteActionsOpen(false)
  }
  const resolvePaletteSlot = (clientX: number, clientY: number): number | null => {
    const grid = swatchGridRef.current
    const gridBounds = grid?.getBoundingClientRect()
    if (!grid || !gridBounds || clientX < gridBounds.left || clientX > gridBounds.right || clientY < gridBounds.top || clientY > gridBounds.bottom) return null
    const swatches = Array.from(grid.querySelectorAll<HTMLElement>('[data-palette-id]'))
    for (let index = 0; index < swatches.length; index += 1) {
      const swatch = swatches[index]
      const bounds = swatch.getBoundingClientRect()
      if (clientX >= bounds.left && clientX <= bounds.right && clientY >= bounds.top && clientY <= bounds.bottom) return index
    }
    return null
  }
  const beginPaletteDrag = (event: React.PointerEvent<HTMLButtonElement>, id: number): void => {
    if (event.button === 2) {
      const color = session.document.palette.find((entry) => entry.id === id)?.color
      if (color) store.setSecondaryColor(color)
      return
    }
    if (event.button !== 0) return
    const additive = event.shiftKey || event.ctrlKey || event.metaKey
    const alreadySelected = session.selectedPaletteIds.includes(id)
    const collapseOnClick = !additive && alreadySelected && session.selectedPaletteIds.length > 1
    const startsFromHandle = !additive && Boolean((event.target as HTMLElement).closest('.swatch-drag-edge'))
    if (additive) store.selectPaletteColor(id, true)
    else if (!alreadySelected || session.selectedPaletteIds.length === 1) store.selectPaletteColor(id)
    if (!startsFromHandle) {
      if (collapseOnClick) store.selectPaletteColor(id)
      return
    }
    const active = useWorkspace.getState().sessions.find((item) => item.document.id === session.document.id)
    const ids = active?.selectedPaletteIds.includes(id) ? [...active.selectedPaletteIds] : [id]
    const baseOrder = [...session.document.paletteOrder]
    const moving = baseOrder.filter((entryId) => ids.includes(entryId))
    dragRef.current = { ids, baseOrder, previewOrder: baseOrder, clickedId: id, anchorOffset: Math.max(0, moving.indexOf(id)), pointerId: event.pointerId, element: event.currentTarget, startX: event.clientX, startY: event.clientY, moved: false, collapseOnClick, target: null }
    event.currentTarget.setPointerCapture(event.pointerId)
  }
  const movePaletteDrag = (event: React.PointerEvent<HTMLButtonElement>): void => {
    const drag = dragRef.current
    if (!drag) return
    if (!drag.moved && Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < 1) return
    if (!drag.moved) {
      drag.moved = true
      setDraggingIds(drag.ids)
    }
    const pointerSlot = resolvePaletteSlot(event.clientX, event.clientY)
    if (pointerSlot === null) return
    const preview = reorderPalettePreview(drag.baseOrder, drag.ids, pointerSlot - drag.anchorOffset)
    if (preview.every((id, index) => id === drag.previewOrder[index])) return
    drag.previewOrder = preview
    drag.target = paletteReorderTarget(drag.baseOrder, drag.ids, preview)
    setPalettePreviewOrder(preview)
  }
  const finishPaletteDrag = (): void => {
    const drag = dragRef.current
    dragRef.current = null
    if (drag?.element.hasPointerCapture(drag.pointerId)) drag.element.releasePointerCapture(drag.pointerId)
    if (drag?.moved && drag.target) useWorkspace.getState().reorderPaletteColors(drag.ids, drag.target.id, drag.target.insertAfter)
    else if (drag?.collapseOnClick) useWorkspace.getState().selectPaletteColor(drag.clickedId)
    setDraggingIds([])
    setPalettePreviewOrder(null)
  }

  useEffect(() => {
    const finishPointer = (event: PointerEvent): void => {
      if (dragRef.current?.pointerId === event.pointerId) finishPaletteDrag()
    }
    const finishOutside = (event: PointerEvent): void => {
      if (event.relatedTarget === null && dragRef.current) finishPaletteDrag()
    }
    const finishBlur = (): void => { if (dragRef.current) finishPaletteDrag() }
    window.addEventListener('pointerup', finishPointer, true)
    window.addEventListener('pointercancel', finishPointer, true)
    window.addEventListener('pointerout', finishOutside, true)
    window.addEventListener('blur', finishBlur)
    return () => {
      window.removeEventListener('pointerup', finishPointer, true)
      window.removeEventListener('pointercancel', finishPointer, true)
      window.removeEventListener('pointerout', finishOutside, true)
      window.removeEventListener('blur', finishBlur)
    }
  }, [])

  const upsertPalette = (palette: StoredPalette): void => {
    setPaletteFiles((current) => {
      const existingIndex = current.findIndex((item) => item.id === palette.id)
      if (existingIndex < 0) return [...current, palette]
      const next = [...current]
      next[existingIndex] = palette
      return next
    })
    setActivePaletteId(palette.id)
    writeStoredString('moonsprite.active-palette-id', palette.id)
  }

  const applyStoredPalette = (palette: StoredPalette): void => {
    store.applyPalette(palette.colors)
    setActivePaletteId(palette.id)
    setSaveName(palette.name)
    writeStoredString('moonsprite.active-palette-id', palette.id)
    setLibraryOpen(false)
  }

  const deleteStoredPalette = async (id: string): Promise<void> => {
    const palette = paletteFiles.find((item) => item.id === id)
    if (!palette || palette.builtIn) { store.setMessage('内置色板不能删除。'); return }
    try {
      await window.moonSprite.deletePalette(id)
      setPaletteFiles((current) => current.filter((item) => item.id !== id))
      if (activePaletteId === id) {
        setActivePaletteId(null)
        removeStoredValue('moonsprite.active-palette-id')
      }
      setPaletteContext(null)
      store.setMessage(`已删除色板“${palette.name}”。`)
    } catch (error) {
      store.setMessage(error instanceof Error ? error.message : '无法删除色板。')
    }
  }

  const openExtractDialog = (): void => {
    setExtractName(`${session.document.name} 色板`)
    setExtractMode('create')
    setExtractOpen(true)
    setLibraryOpen(false)
    setPaletteActionsOpen(false)
  }

  const extractFromImage = async (): Promise<void> => {
    setOperationBusy(true)
    try {
      const colors = extractPaletteColors(session.document, extractLimit)
      if (colors.length === 0) throw new Error('当前图像没有可提取的非透明颜色。')
      if (extractMode === 'create') {
        store.applyPalette(colors)
        setActivePaletteId(null)
        removeStoredValue('moonsprite.active-palette-id')
        const name = extractName.trim() || `${session.document.name} 色板`
        setSaveName(name)
        store.setMessage(`已从图像创建临时色板“${name}”，共 ${colors.length} 色。`)
      } else if (extractMode === 'replace') {
        store.applyPalette(colors)
        store.setMessage(`已替换当前文档调色板，共 ${colors.length} 色。`)
      } else {
        const merged = mergePaletteColors(orderedColors, colors)
        store.applyPalette(merged)
        store.setMessage(`已新增 ${merged.length - orderedColors.length} 种颜色。`)
      }
      setExtractOpen(false)
    } catch (error) {
      store.setMessage(error instanceof Error ? error.message : '无法从图像提取颜色。')
    } finally {
      setOperationBusy(false)
    }
  }

  const openSaveDialog = (): void => {
    setSaveName(activePalette?.name ?? (saveName || `${session.document.name} 色板`))
    setSaveOpen(true)
    setLibraryOpen(false)
    setPaletteActionsOpen(false)
  }

  const savePaletteLocally = async (): Promise<void> => {
    if (orderedColors.length === 0) { store.setMessage('当前调色板没有可保存的颜色。'); return }
    setOperationBusy(true)
    try {
      const saved = await window.moonSprite.savePalette(activePalette && !activePalette.builtIn ? activePalette.id : null, saveName.trim() || `${session.document.name} 色板`, orderedColors)
      upsertPalette(saved)
      setSaveOpen(false)
      store.setMessage(`色板“${saved.name}”已保存到 ${paletteDirectory}`)
    } catch (error) {
      store.setMessage(error instanceof Error ? error.message : '无法保存色板。')
    } finally {
      setOperationBusy(false)
    }
  }

  const savePaletteAsImage = async (): Promise<void> => {
    if (orderedColors.length === 0) { store.setMessage('当前调色板没有可保存的颜色。'); return }
    setOperationBusy(true)
    try {
      const safeName = (saveName.trim() || `${session.document.name} 色板`).replace(/[<>:"/\\|?*]/g, '_')
      const result = await window.moonSprite.savePaletteImage(`${safeName}.png`)
      if (result.canceled || !result.filePath) return
      const encoded = encodePalettePng(orderedColors)
      await window.moonSprite.writeBinaryAtomic(result.filePath, encoded.bytes)
      setSaveOpen(false)
      store.setMessage(`色板图像已保存：${result.filePath}`)
    } catch (error) {
      store.setMessage(error instanceof Error ? error.message : '无法保存色板图像。')
    } finally {
      setOperationBusy(false)
    }
  }

  return <><section ref={floating.ref} className={`panel palette-panel ${floating.style ? 'floating-panel' : ''}`} style={floating.style} onPointerDown={floating.bringToFront}>
    <header onPointerDown={(event) => floating.style ? floating.startDrag(event) : onDockDragStart?.(event, floating.startDetachedDrag)}><Palette size={15} /><span>调色板</span><small>{ordered.length} 色</small><span className="panel-actions palette-actions">
      <span ref={libraryControlRef} className="palette-library-control"><button ref={libraryButtonRef} className={libraryOpen ? 'active' : ''} title="选择本地色板" aria-label="选择本地色板" aria-expanded={libraryOpen} onClick={() => { setLibraryOpen((open) => !open); setPaletteActionsOpen(false) }}><BookOpen size={14} /></button></span>
      <span ref={paletteActionsControlRef} className="palette-actions-control"><button ref={paletteActionsButtonRef} className={paletteActionsOpen ? 'active' : ''} title="调色板操作" aria-label="调色板操作" aria-expanded={paletteActionsOpen} onClick={() => { setPaletteActionsOpen((open) => !open); setLibraryOpen(false) }}><Settings2 size={14} /></button></span>
      <button title="手动加入当前颜色" aria-label="手动加入当前颜色" onClick={() => store.addPaletteColor()}><Plus size={14} /></button><button title="移除选中的调色板颜色" aria-label="移除选中的调色板颜色" disabled={session.selectedPaletteIds.length === 0} onClick={() => store.deletePaletteColors(session.selectedPaletteIds)}><Trash2 size={14} /></button>
    </span></header>
    <div ref={swatchGridRef} className="swatch-grid" style={{ '--swatch-size': `${PALETTE_SWATCH_PIXELS[swatchSize]}px` } as React.CSSProperties}>{displayedOrdered.map((entry) => { const active = session.selectedPaletteIds.includes(entry.id) || entry.id === selectedId; return <button key={entry.id} data-palette-id={entry.id} className={`swatch ${session.selectedPaletteIds.includes(entry.id) ? 'selected' : ''} ${entry.id === selectedId ? 'primary' : ''} ${entry.color.a === 0 ? 'transparent' : ''} ${draggingIds.includes(entry.id) ? 'dragging' : ''}`} title={`${entry.name} ${rgbaHex(entry.color)}`} aria-label={`${entry.name} ${rgbaHex(entry.color)}`} aria-pressed={session.selectedPaletteIds.includes(entry.id)} style={{ '--swatch-color': colorCss(entry.color) } as React.CSSProperties} onContextMenu={(event) => event.preventDefault()} onPointerDown={(event) => beginPaletteDrag(event, entry.id)} onPointerMove={movePaletteDrag} onPointerUp={finishPaletteDrag} onPointerCancel={finishPaletteDrag}>{active && <span className="swatch-drag-edges" aria-hidden="true"><i className="swatch-drag-edge edge-n" /><i className="swatch-drag-edge edge-e" /><i className="swatch-drag-edge edge-s" /><i className="swatch-drag-edge edge-w" /></span>}</button> })}</div>
    {floating.style && <PanelResizeHandles onResize={floating.startResize} />}
  </section>
  <FloatingDockPreview style={floating.dockPreview} />
  {libraryOpen && createPortal(<span ref={libraryPopoverRef} className="palette-library-popover" role="menu" aria-label="本地像素色板" style={libraryPopoverPosition}>{paletteLoading ? <span className="palette-library-state">正在读取色板...</span> : paletteFiles.length === 0 ? <span className="palette-library-state">暂无色板</span> : paletteFiles.map((palette) => <button key={palette.id} type="button" role="menuitem" className={activePaletteId === palette.id ? 'selected' : ''} title={palette.builtIn ? '内置色板，不会写入用户色板文件夹' : '右键删除用户色板'} onClick={() => applyStoredPalette(palette)} onContextMenu={(event) => { event.preventDefault(); if (palette.builtIn) { store.setMessage('内置色板不能删除。'); setPaletteContext(null); return } setPaletteContext({ id: palette.id, x: Math.min(event.clientX, window.innerWidth - 150), y: Math.min(event.clientY, window.innerHeight - 42) }) }}><span className="palette-library-name">{palette.name}{palette.builtIn && <LockKeyhole size={11} aria-label="内置" />}</span><span className="palette-library-swatches" aria-hidden="true">{palette.colors.map((color, index) => <i key={index} style={{ background: colorCss(color) }} />)}</span></button>)}<button type="button" role="menuitem" className="palette-folder-action" onClick={() => { void window.moonSprite.openPaletteFolder(); setLibraryOpen(false) }}><FolderOpen size={14} /><span>打开用户色板文件夹</span></button></span>, document.body)}
  {paletteActionsOpen && createPortal(<span ref={paletteActionsPopoverRef} className="palette-actions-popover" role="menu" aria-label="调色板操作" style={paletteActionsPopoverPosition}><button type="button" role="menuitem" onClick={openExtractDialog}><ScanSearch size={14} /><span>提取颜色</span></button><span className="palette-actions-divider" /><section aria-label="颜色尺寸"><span>颜色尺寸</span><div>{(['small', 'medium', 'large'] as PaletteSwatchSize[]).map((size) => <button key={size} type="button" role="menuitemradio" aria-checked={swatchSize === size} className={swatchSize === size ? 'selected' : ''} title={`${PALETTE_SWATCH_PIXELS[size]} 像素`} onClick={() => chooseSwatchSize(size)}><i style={{ width: Math.round(PALETTE_SWATCH_PIXELS[size] * .45), height: Math.round(PALETTE_SWATCH_PIXELS[size] * .45) }} /><span>{size === 'small' ? '小' : size === 'medium' ? '中' : '大'}</span></button>)}</div></section><span className="palette-actions-divider" /><button type="button" role="menuitem" onClick={openSaveDialog}><Save size={14} /><span>保存色板</span></button></span>, document.body)}
  {paletteContext && createPortal(<span ref={paletteContextRef} className="palette-library-context" role="menu" style={{ left: paletteContext.x, top: paletteContext.y }}><button type="button" role="menuitem" onClick={() => void deleteStoredPalette(paletteContext.id)}><Trash2 size={14} /><span>删除色板</span></button></span>, document.body)}
  {extractOpen && createPortal(<form ref={extractFloating.ref as React.RefObject<HTMLFormElement>} className="palette-operation-dialog" style={extractFloating.style} role="dialog" aria-labelledby="palette-extract-title" onSubmit={(event) => { event.preventDefault(); void extractFromImage() }} onPointerDown={extractFloating.bringToFront}><header onPointerDown={extractFloating.startDrag}><div><span className="eyebrow">PALETTE</span><h2 id="palette-extract-title">从当前图像中提取颜色</h2></div><button type="button" className="icon-button" aria-label="关闭" onClick={() => setExtractOpen(false)}><X size={16} /></button></header><div className="palette-dialog-body"><fieldset><legend>提取方式</legend><label><input type="radio" name="extract-mode" checked={extractMode === 'create'} onChange={() => setExtractMode('create')} /><span><strong>创建新的调色板</strong><small>仅应用到当前文档，不会自动保存到软件</small></span></label><label><input type="radio" name="extract-mode" checked={extractMode === 'replace'} onChange={() => setExtractMode('replace')} /><span><strong>替换当前调色板{activePalette ? `“${activePalette.name}”` : ''}</strong><small>仅替换当前文档，点击保存后才写入文件</small></span></label><label><input type="radio" name="extract-mode" checked={extractMode === 'append'} onChange={() => setExtractMode('append')} /><span><strong>在当前调色板新增颜色</strong><small>保留现有颜色和排列顺序</small></span></label></fieldset><div className="palette-form-grid"><label>数量限制<NumberInput min={1} max={4096} value={extractLimit} onValueChange={setExtractLimit} /></label>{extractMode === 'create' && <label>色板名称<input value={extractName} onChange={(event) => setExtractName(event.target.value)} /></label>}</div></div><footer><button type="button" className="quiet-button" onClick={() => setExtractOpen(false)}>取消</button><button type="submit" className="primary-button" disabled={operationBusy}>{operationBusy ? '正在提取...' : '提取颜色'}</button></footer></form>, document.body)}
  {saveOpen && createPortal(<section ref={saveFloating.ref} className="palette-operation-dialog palette-save-dialog" style={saveFloating.style} role="dialog" aria-labelledby="palette-save-title" onPointerDown={saveFloating.bringToFront}><header onPointerDown={saveFloating.startDrag}><div><span className="eyebrow">PALETTE</span><h2 id="palette-save-title">保存当前调色板</h2></div><button type="button" className="icon-button" aria-label="关闭" onClick={() => setSaveOpen(false)}><X size={16} /></button></header><div className="palette-dialog-body"><label className="palette-name-field">色板名称<input autoFocus value={saveName} onChange={(event) => setSaveName(event.target.value)} /></label><div className="palette-save-summary"><span className="palette-library-swatches" aria-hidden="true">{orderedColors.slice(0, 24).map((color, index) => <i key={index} style={{ background: colorCss(color) }} />)}</span><strong>{orderedColors.length} 色</strong></div><p>软件色板目录：{paletteDirectory}</p></div><footer><button type="button" className="quiet-button" disabled={operationBusy} onClick={() => void savePaletteAsImage()}><FileImage size={15} />保存为 PNG</button><button type="button" className="primary-button" disabled={operationBusy} onClick={() => void savePaletteLocally()}><Save size={15} />保存到软件</button></footer></section>, document.body)}
  </>
}

export function PreviewPanel({ session, onClose, docked = false, onDockDragStart, onFloatingDock, relativeLuminanceInPreview = true }: { session: DocumentSession; onClose: () => void; relativeLuminanceInPreview?: boolean } & DockDragProps) {
  const defaultPosition = { x: Math.max(12, window.innerWidth - 310 - 250 - 16), y: Math.max(46, window.innerHeight - 27 - 260 - 16), width: 250, height: 260 }
  const floating = useFloatingPanel(docked ? null : defaultPosition, false, true, 'moonsprite.preview-panel.v1', true, onFloatingDock, docked)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const panDrag = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null)
  const sourceRef = useRef<{ documentId: string; revision: number; relativeLuminance: boolean; canvas: OffscreenCanvas } | null>(null)
  const baseFitRef = useRef<{ documentId: string; width: number; height: number; scale: number } | null>(null)
  const panFrameRef = useRef<number | null>(null)
  const pendingPanRef = useRef<{ x: number; y: number } | null>(null)
  const showRelativeLuminance = session.view.relativeLuminance && relativeLuminanceInPreview

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    let source = sourceRef.current
    if (!source || source.documentId !== session.document.id || source.revision !== session.revision || source.relativeLuminance !== showRelativeLuminance) {
      const documentWidth = session.document.width
      const documentHeight = session.document.height
      const sourceScale = Math.min(1, 512 / Math.max(documentWidth, documentHeight))
      const width = Math.max(1, Math.round(documentWidth * sourceScale))
      const height = Math.max(1, Math.round(documentHeight * sourceScale))
      const pixels = new Uint8ClampedArray(width * height * 4)
      const sampleComposite = createCompositeSampler(session.document)
      for (let index = 0; index < width * height; index += 1) {
        const offset = index * 4
        const previewX = index % width
        const previewY = Math.floor(index / width)
        const sourceX = Math.min(documentWidth - 1, Math.floor(previewX / sourceScale))
        const sourceY = Math.min(documentHeight - 1, Math.floor(previewY / sourceScale))
        const sampled = sampleComposite(sourceY * documentWidth + sourceX)
        const color = showRelativeLuminance ? relativeLuminanceColor(sampled) : sampled
        const checker = (Math.floor(sourceX / 16) + Math.floor(sourceY / 16)) % 2 === 0 ? 215 : 155
        const alpha = color.a / 255
        pixels[offset] = Math.round(color.r * alpha + checker * (1 - alpha))
        pixels[offset + 1] = Math.round(color.g * alpha + checker * (1 - alpha))
        pixels[offset + 2] = Math.round(color.b * alpha + checker * (1 - alpha))
        pixels[offset + 3] = 255
      }
      const sourceCanvas = new OffscreenCanvas(width, height)
      sourceCanvas.getContext('2d')?.putImageData(new ImageData(pixels, width, height), 0, 0)
      source = { documentId: session.document.id, revision: session.revision, relativeLuminance: showRelativeLuminance, canvas: sourceCanvas }
      sourceRef.current = source
    }
    const draw = (): void => {
      const context = canvas.getContext('2d')
      const bounds = canvas.getBoundingClientRect()
      if (!context || bounds.width < 1 || bounds.height < 1) return
      const dpr = Math.max(1, window.devicePixelRatio || 1)
      const width = Math.max(1, Math.round(bounds.width * dpr))
      const height = Math.max(1, Math.round(bounds.height * dpr))
      if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height }
      context.setTransform(dpr, 0, 0, dpr, 0, 0)
      const displayWidth = bounds.width
      const displayHeight = bounds.height
      context.clearRect(0, 0, displayWidth, displayHeight)
      let baseFit = baseFitRef.current
      if (!baseFit || baseFit.documentId !== session.document.id || baseFit.width !== session.document.width || baseFit.height !== session.document.height) {
        baseFit = { documentId: session.document.id, width: session.document.width, height: session.document.height, scale: Math.min(displayWidth / session.document.width, displayHeight / session.document.height) }
        baseFitRef.current = baseFit
      }
      const scale = baseFit.scale * zoom
      const drawWidth = session.document.width * scale
      const drawHeight = session.document.height * scale
      const originX = (displayWidth - drawWidth) / 2 + pan.x
      const originY = (displayHeight - drawHeight) / 2 + pan.y
      context.fillStyle = '#4a4a51'
      context.fillRect(0, 0, displayWidth, displayHeight)
      context.imageSmoothingEnabled = false
      context.drawImage(source.canvas, originX, originY, drawWidth, drawHeight)
    }
    draw()
    const observer = new ResizeObserver(draw)
    observer.observe(canvas)
    return () => observer.disconnect()
  }, [session.document, session.revision, showRelativeLuminance, zoom, pan])

  useEffect(() => () => {
    if (panFrameRef.current !== null) window.cancelAnimationFrame(panFrameRef.current)
  }, [])

  const schedulePan = (next: { x: number; y: number }): void => {
    pendingPanRef.current = next
    if (panFrameRef.current !== null) return
    panFrameRef.current = window.requestAnimationFrame(() => {
      panFrameRef.current = null
      const pending = pendingPanRef.current
      pendingPanRef.current = null
      if (pending) setPan(pending)
    })
  }

  const adjustZoom = (factor: number): void => setZoom((value) => Math.max(0.25, Math.min(16, value * factor)))
  return <section ref={floating.ref} className={`panel preview-panel ${floating.style ? 'floating-panel' : ''}`} style={floating.style} onPointerDown={floating.bringToFront}>
    <header onPointerDown={(event) => floating.style ? floating.startDrag(event) : onDockDragStart?.(event, floating.startDetachedDrag)}><span>预览</span><small>{Math.round(zoom * 100)}%</small><span className="panel-actions"><button title="缩小预览" aria-label="缩小预览" onClick={() => adjustZoom(0.8)}><Minus size={14} /></button><button title="放大预览" aria-label="放大预览" onClick={() => adjustZoom(1.25)}><Plus size={14} /></button><button title="关闭预览" aria-label="关闭预览" onClick={onClose}><X size={14} /></button></span></header>
    <div className="preview-canvas-wrap" onWheel={(event) => { event.preventDefault(); adjustZoom(event.deltaY < 0 ? 1.15 : 1 / 1.15) }} onPointerDown={(event) => { if (event.button !== 1) return; panDrag.current = { x: event.clientX, y: event.clientY, panX: pan.x, panY: pan.y }; event.currentTarget.setPointerCapture(event.pointerId); event.preventDefault() }} onPointerMove={(event) => { const drag = panDrag.current; if (!drag) return; schedulePan({ x: drag.panX + event.clientX - drag.x, y: drag.panY + event.clientY - drag.y }) }} onPointerUp={(event) => { panDrag.current = null; if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId) }} onPointerCancel={() => { panDrag.current = null }}><canvas ref={canvasRef} aria-label="作品预览" /></div>
    {floating.style && <PanelResizeHandles onResize={floating.startResize} />}
    <FloatingDockPreview style={floating.dockPreview} />
  </section>
}

interface LayerFormState { id: string; kind: 'layer' | 'group'; name: string; opacity: number; blendMode: BlendMode; locked: boolean }
interface LayerDragState { ids: string[]; groupId?: string; startX: number; startY: number; moved: boolean; copy: boolean }
type DropTarget = { kind: 'layer'; id: string; insertAfter?: boolean; depth: number } | { kind: 'group'; id: string; depth: number } | { kind: 'above-group'; id: string; insertAfter?: boolean; depth: number } | { kind: 'root' }
interface LayerContextMenu { kind: 'layer' | 'group'; id: string; x: number; y: number }
interface LayerDragGhost { y: number; name: string; count: number }
type LayerTreeNode = LayerPanelNode & ({ kind: 'layer'; layer: RasterLayer } | { kind: 'group'; group: LayerGroup })
const blendOptions: Array<{ value: BlendMode; label: string }> = [
  { value: 'normal', label: '正常' },
  { value: 'darken', label: '变暗' },
  { value: 'multiply', label: '正片叠底' },
  { value: 'color-burn', label: '颜色加深' },
  { value: 'linear-burn', label: '线性加深' },
  { value: 'lighten', label: '变亮' },
  { value: 'screen', label: '滤色' },
  { value: 'color-dodge', label: '颜色减淡' },
  { value: 'linear-dodge', label: '线性减淡（添加）' },
  { value: 'overlay', label: '叠加' },
  { value: 'soft-light', label: '柔光' },
  { value: 'hard-light', label: '强光' },
  { value: 'vivid-light', label: '亮光' },
  { value: 'linear-light', label: '线性光' },
  { value: 'pin-light', label: '点光' },
  { value: 'hard-mix', label: '实色混合' },
  { value: 'difference', label: '差值' },
  { value: 'exclusion', label: '排除' },
  { value: 'subtract', label: '减去' },
  { value: 'divide', label: '划分' },
  { value: 'hue', label: '色相' },
  { value: 'saturation', label: '饱和度' },
  { value: 'color', label: '颜色' },
  { value: 'luminosity', label: '明度' }
]
const blendOptionGroups: Array<ThemedSelectGroup<BlendMode>> = [
  { label: '基础', options: blendOptions.filter((option) => option.value === 'normal') },
  { label: '变暗', options: blendOptions.filter((option) => ['darken', 'multiply', 'color-burn', 'linear-burn'].includes(option.value)) },
  { label: '变亮', options: blendOptions.filter((option) => ['lighten', 'screen', 'color-dodge', 'linear-dodge'].includes(option.value)) },
  { label: '对比', options: blendOptions.filter((option) => ['overlay', 'soft-light', 'hard-light', 'vivid-light', 'linear-light', 'pin-light', 'hard-mix'].includes(option.value)) },
  { label: '比较', options: blendOptions.filter((option) => ['difference', 'exclusion', 'subtract', 'divide'].includes(option.value)) },
  { label: '颜色分量', options: blendOptions.filter((option) => ['hue', 'saturation', 'color', 'luminosity'].includes(option.value)) }
]

export function LayersPanel({ session, docked = false, onDockDragStart, onFloatingDock }: { session: DocumentSession } & DockDragProps) {
  const store = useWorkspace()
  const floating = useFloatingPanel(null, false, true, 'moonsprite.layers-panel.v1', false, onFloatingDock, docked)
  const [form, setForm] = useState<LayerFormState | null>(null)
  const formOriginalRef = useRef<LayerFormState | null>(null)
  const formWasDirtyRef = useRef(false)
  const dragRef = useRef<LayerDragState | null>(null)
  const layerListRef = useRef<HTMLDivElement>(null)
  const [draggingIds, setDraggingIds] = useState<string[]>([])
  const [draggingGroupId, setDraggingGroupId] = useState<string | null>(null)
  const [draggingCopy, setDraggingCopy] = useState(false)
  const [altCopyReady, setAltCopyReady] = useState(false)
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null)
  const dropTargetRef = useRef<DropTarget | null>(null)
  const [dragGhost, setDragGhost] = useState<LayerDragGhost | null>(null)
  const [contextMenu, setContextMenu] = useState<LayerContextMenu | null>(null)
  useEffect(() => {
    const close = (): void => setContextMenu(null)
    window.addEventListener('pointerdown', close)
    window.addEventListener('resize', close)
    return () => { window.removeEventListener('pointerdown', close); window.removeEventListener('resize', close) }
  }, [])
  useEffect(() => {
    const keyDown = (event: KeyboardEvent): void => { if (event.key === 'Alt') setAltCopyReady(true) }
    const keyUp = (event: KeyboardEvent): void => { if (event.key === 'Alt') setAltCopyReady(false) }
    const blur = (): void => setAltCopyReady(false)
    window.addEventListener('keydown', keyDown)
    window.addEventListener('keyup', keyUp)
    window.addEventListener('blur', blur)
    return () => { window.removeEventListener('keydown', keyDown); window.removeEventListener('keyup', keyUp); window.removeEventListener('blur', blur) }
  }, [])
  const layerById = new Map(session.document.layers.map((layer) => [layer.id, layer]))
  const groupById = new Map(session.document.groups.map((group) => [group.id, group]))
  const nodes = buildLayerPanelTree({
    layers: session.document.layers,
    groups: session.document.groups,
    collapsedGroupIds: session.collapsedGroupIds
  }).map((node): LayerTreeNode | null => {
    if (node.kind === 'layer') {
      const layer = layerById.get(node.id)
      return layer ? { ...node, layer } : null
    }
    const group = groupById.get(node.id)
    return group ? { ...node, group } : null
  }).filter((node): node is LayerTreeNode => node !== null)
  const beginProperties = (next: LayerFormState): void => {
    formOriginalRef.current = { ...next }
    formWasDirtyRef.current = session.document.dirty
    setForm(next)
  }
  const editLayer = (layer: RasterLayer): void => beginProperties({ id: layer.id, kind: 'layer', name: layer.name, opacity: Math.round(layer.opacity * 100), blendMode: layer.blendMode, locked: layer.locked })
  const editGroup = (group: LayerGroup): void => beginProperties({ id: group.id, kind: 'group', name: group.name, opacity: Math.round(group.opacity * 100), blendMode: group.blendMode, locked: group.locked })
  const previewProperties = (next: LayerFormState): void => {
    setForm(next)
    store.mutateActive((active) => {
      const target = next.kind === 'group'
        ? active.document.groups.find((group) => group.id === next.id)
        : active.document.layers.find((layer) => layer.id === next.id)
      if (!target) return
      target.name = next.name
      target.opacity = Math.max(0, Math.min(1, next.opacity / 100))
      target.blendMode = next.blendMode
      target.locked = next.locked
      active.document.dirty = true
      active.document.updatedAt = new Date().toISOString()
      active.revision += 1
      active.recoverySuppressed = false
    }, false)
  }
  const closeProperties = (): void => {
    if (!form) return
    const original = formOriginalRef.current
    const committed = { ...form, name: form.name.trim() || original?.name || form.name }
    const changed = Boolean(original) && (original!.name !== committed.name || original!.opacity !== committed.opacity || original!.blendMode !== committed.blendMode || original!.locked !== committed.locked)
    if (original) {
      store.mutateActive((active) => {
        const target = original.kind === 'group'
          ? active.document.groups.find((group) => group.id === original.id)
          : active.document.layers.find((layer) => layer.id === original.id)
        if (target) {
          target.name = original.name
          target.opacity = original.opacity / 100
          target.blendMode = original.blendMode
          target.locked = original.locked
        }
        active.document.dirty = formWasDirtyRef.current
        active.revision += 1
      }, false)
      if (changed) {
        if (committed.kind === 'group') store.setGroupProperties(committed.id, committed.name, committed.opacity / 100, committed.blendMode, committed.locked)
        else store.setLayerPropertiesWithBlend(committed.id, committed.name, committed.opacity / 100, committed.blendMode, committed.locked)
      }
    }
    formOriginalRef.current = null
    setForm(null)
  }
  const beginLayerDrag = (event: React.PointerEvent<HTMLButtonElement>, layerId: string): void => {
    if (event.button !== 0) return
    if (event.shiftKey || session.selectedGroupId || session.selectedLayerIds.length !== 1 || !session.selectedLayerIds.includes(layerId)) store.selectLayer(layerId, event.shiftKey)
    const active = useWorkspace.getState().sessions.find((item) => item.document.id === session.document.id)
    const ids = active?.selectedLayerIds.includes(layerId) ? [...active.selectedLayerIds] : [layerId]
    dragRef.current = { ids, startX: event.clientX, startY: event.clientY, moved: false, copy: event.altKey }
    event.preventDefault()
  }
  const beginGroupDrag = (event: React.PointerEvent<HTMLButtonElement>, groupId: string): void => {
    if (event.button !== 0) return
    store.selectGroup(groupId)
    const ids = getLayerIdsInGroup(session.document, groupId)
    dragRef.current = { ids, groupId, startX: event.clientX, startY: event.clientY, moved: false, copy: false }
    event.preventDefault()
  }
  const resolveDropTarget = (clientX: number, clientY: number, draggedIds: string[], draggedGroupId?: string): DropTarget | null => {
    const list = layerListRef.current
    const listBounds = list?.getBoundingClientRect()
    if (!list || !listBounds || clientX < listBounds.left || clientX > listBounds.right || clientY < listBounds.top || clientY > listBounds.bottom) return null
    const element = [...list.querySelectorAll<HTMLElement>('[data-layer-id], [data-group-id]')]
      .find((row) => {
        const bounds = row.getBoundingClientRect()
        return clientX >= bounds.left && clientX <= bounds.right && clientY >= bounds.top && clientY <= bounds.bottom
      })
    const layerId = element?.dataset.layerId
    const groupId = element?.dataset.groupId
    if (element && (layerId || groupId)) {
      const hit = {
        kind: layerId ? 'layer' as const : 'group' as const,
        id: (layerId ?? groupId)!,
        top: element.getBoundingClientRect().top,
        bottom: element.getBoundingClientRect().bottom,
        pointerY: clientY
      }
      const target = resolveLayerPanelDropTarget({ layers: session.document.layers, groups: session.document.groups, nodes, hit, draggedLayerIds: draggedIds, draggedGroupId })
      if (target) return target
    }
    if (draggedGroupId) return { kind: 'root' }
    const rows = [...list.querySelectorAll<HTMLElement>('[data-layer-id]')].filter((row) => !draggedIds.includes(row.dataset.layerId ?? ''))
    if (rows.length === 0) return { kind: 'root' }
    const first = rows[0].getBoundingClientRect()
    const last = rows.at(-1)!.getBoundingClientRect()
    if (clientY <= first.top) {
      const targetId = rows[0].dataset.layerId!
      const targetNode = nodes.find((node) => node.kind === 'layer' && node.layer.id === targetId)
      return { kind: 'layer', id: targetId, insertAfter: true, depth: targetNode?.depth ?? 0 }
    }
    if (clientY >= last.bottom) return { kind: 'root' }
    return null
  }
  const moveLayerDrag = (clientX: number, clientY: number, altKey: boolean): void => {
    const drag = dragRef.current
    if (!drag) return
    if (!drag.groupId) drag.copy = altKey
    if (!drag.moved && Math.hypot(clientX - drag.startX, clientY - drag.startY) < 4) return
    if (!drag.moved) { drag.moved = true; setDraggingIds(drag.ids); setDraggingGroupId(drag.groupId ?? null) }
    setDraggingCopy(drag.copy)
    const firstDragged = drag.groupId ? session.document.groups.find((group) => group.id === drag.groupId) : session.document.layers.find((layer) => layer.id === drag.ids[0])
    const listBounds = layerListRef.current?.getBoundingClientRect()
    const ghostHeight = 36
    const y = listBounds ? Math.max(0, Math.min(listBounds.height - ghostHeight, clientY - listBounds.top - ghostHeight / 2)) : 0
    setDragGhost({ y, name: firstDragged?.name ?? '图层', count: drag.ids.length })
    const target = resolveDropTarget(clientX, clientY, drag.ids, drag.groupId)
    dropTargetRef.current = target
    setDropTarget(target)
  }
  const finishLayerDrag = (clientX: number, clientY: number): void => {
    const drag = dragRef.current
    const target = drag ? resolveDropTarget(clientX, clientY, drag.ids, drag.groupId) ?? dropTargetRef.current : dropTargetRef.current
    dragRef.current = null
    const compoundCopy = Boolean(drag?.moved && target && drag.copy && !drag.groupId)
    if (compoundCopy) session.history.beginCompound()
    if (drag?.moved && target) {
      if (drag.copy && !drag.groupId) {
        const copies = store.duplicateLayers(drag.ids)
        if (copies.length > 0) drag.ids = copies
      }
      if (target.kind === 'root' && drag.groupId) store.assignGroupToRoot(drag.groupId)
      else if (target.kind === 'root') store.assignLayersToRoot(drag.ids)
      else if (target.kind === 'above-group') {
        if (drag.groupId) store.reorderGroup(drag.groupId, target.id, target.insertAfter)
        else store.assignLayersAboveGroup(drag.ids, target.id)
      }
      else if (drag.groupId && target.kind === 'group') store.assignGroupToGroup(drag.groupId, target.id)
      else if (target.kind === 'group') store.assignLayersToGroup(drag.ids, target.id)
      else if (!drag.ids.includes(target.id)) {
        const targetLayer = session.document.layers.find((layer) => layer.id === target.id)
        if (drag.groupId && targetLayer && !targetLayer.groupId) {
          store.assignGroupToRoot(drag.groupId)
          store.reorderLayers(drag.ids, target.id, target.insertAfter)
        } else {
        const draggedAcrossContainers = targetLayer && drag.ids.some((id) => (session.document.layers.find((layer) => layer.id === id)?.groupId ?? null) !== (targetLayer.groupId ?? null))
        if (targetLayer?.groupId && draggedAcrossContainers) store.assignLayersToGroup(drag.ids, targetLayer.groupId, target.id, target.insertAfter)
        else if (targetLayer && !targetLayer.groupId && draggedAcrossContainers) store.assignLayersToRoot(drag.ids, target.id, target.insertAfter)
        else store.reorderLayers(drag.ids, target.id, target.insertAfter)
        }
      }
    }
    if (compoundCopy) session.history.endCompound('复制并移动图层')
    setDraggingIds([])
    setDraggingGroupId(null)
    setDraggingCopy(false)
    dropTargetRef.current = null
    setDropTarget(null)
    setDragGhost(null)
  }
  useEffect(() => {
    const move = (event: PointerEvent): void => moveLayerDrag(event.clientX, event.clientY, event.altKey)
    const finish = (event: PointerEvent): void => finishLayerDrag(event.clientX, event.clientY)
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', finish)
    window.addEventListener('pointercancel', finish)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', finish)
      window.removeEventListener('pointercancel', finish)
    }
  // Layer and group objects are mutated in place, so the document identity is sufficient here.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.document.id])
  const openLayerContextMenu = (event: React.MouseEvent, kind: 'layer' | 'group', id: string): void => {
    event.preventDefault()
    event.stopPropagation()
    if (kind === 'layer' && !session.selectedLayerIds.includes(id)) store.selectLayer(id)
    if (kind === 'group' && session.selectedGroupId !== id) store.selectGroup(id)
    setContextMenu({ kind, id, x: Math.min(event.clientX, window.innerWidth - 210), y: Math.min(event.clientY, window.innerHeight - 360) })
  }
  const closeContextMenu = (): void => setContextMenu(null)
  const openProperties = (): void => {
    if (!contextMenu) return
    if (contextMenu.kind === 'group') {
      const group = session.document.groups.find((item) => item.id === contextMenu.id)
      if (group) editGroup(group)
    } else {
      const layer = session.document.layers.find((item) => item.id === contextMenu.id)
      if (layer) editLayer(layer)
    }
    closeContextMenu()
  }
  const mergeCurrent = (): void => {
    if (session.selectedGroupId) store.mergeSelectedGroup()
    else if (session.selectedLayerIds.length > 1) store.mergeSelectedLayers()
    else store.mergeActiveLayerDown()
  }
  const mergeCurrentLabel = session.selectedGroupId ? '合并图层组' : session.selectedLayerIds.length > 1 ? '合并所选图层' : '向下合并'

  return <><section ref={floating.ref} className={`panel layers-panel ${floating.style ? 'floating-panel' : ''} ${altCopyReady ? 'layer-alt-copy-ready' : ''} ${draggingCopy ? 'layer-copy-drag' : ''}`} style={floating.style} onPointerDown={floating.bringToFront}>
    <header onPointerDown={(event) => floating.style ? floating.startDrag(event) : onDockDragStart?.(event, floating.startDetachedDrag)}><Layers2 size={15} /><span>图层</span><span className="panel-actions"><button title="新建图层" aria-label="新建图层" onClick={() => void store.addLayer()}><Plus size={14} /></button><button title="新建图层组 Ctrl+G" aria-label="新建图层组" onClick={() => store.createLayerGroup()}><FolderPlus size={14} /></button><button title={mergeCurrentLabel} aria-label={mergeCurrentLabel} onClick={mergeCurrent}><Combine size={14} /></button><button title="解组 Ctrl+Shift+G" aria-label="解组" onClick={() => store.ungroupSelected()}><FolderMinus size={14} /></button><button title="删除图层" aria-label="删除图层" onClick={() => store.deleteActiveLayer()}><Trash2 size={14} /></button></span></header>
    <div ref={layerListRef} className="layer-list" onContextMenu={(event) => { const target = (event.target as HTMLElement).closest<HTMLElement>('[data-layer-id], [data-group-id]'); if (target?.dataset.layerId) openLayerContextMenu(event, 'layer', target.dataset.layerId); else if (target?.dataset.groupId) openLayerContextMenu(event, 'group', target.dataset.groupId) }}>{nodes.map((node) => {
      if (node.kind === 'group') {
        const collapsed = session.collapsedGroupIds.includes(node.group.id)
        const groupIndicator = (dropTarget?.kind === 'group' || dropTarget?.kind === 'above-group') && dropTarget.id === node.group.id
          ? <span className={`layer-drop-indicator ${dropTarget.kind === 'above-group' ? (dropTarget.insertAfter === false ? 'below' : 'above') : 'below inside-group'}`} style={{ left: `${8 + dropTarget.depth * 14}px` }} aria-hidden="true"><i /><b /><i /></span>
          : null
        return <button key={node.group.id} data-group-id={node.group.id} className={`layer-row group-row ${node.group.id === session.selectedGroupId ? 'selected' : ''} ${draggingGroupId === node.group.id ? 'dragging' : ''} ${groupIndicator ? 'group-drop-target' : ''}`} style={{ '--layer-depth': node.depth } as React.CSSProperties} onPointerDown={(event) => beginGroupDrag(event, node.group.id)} onDoubleClick={() => editGroup(node.group)}>{groupIndicator}<span className="layer-visibility" role="button" tabIndex={-1} aria-label={node.group.visible ? '隐藏图层组' : '显示图层组'} onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); store.toggleGroupVisibility(node.group.id) }}>{node.group.visible ? <Eye size={14} /> : <EyeOff size={14} />}</span><span className={`layer-lock-toggle ${node.group.locked ? 'locked' : ''}`} role="button" tabIndex={-1} aria-label={node.group.locked ? '解除图层组锁定' : '锁定图层组'} aria-pressed={node.group.locked} onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); store.setGroupProperties(node.group.id, node.group.name, node.group.opacity, node.group.blendMode, !node.group.locked) }}>{node.group.locked ? <Lock size={14} /> : <LockOpen size={14} />}</span><span className="group-folder" role="button" tabIndex={-1} aria-label={collapsed ? '展开图层组' : '收起图层组'} title={collapsed ? '展开图层组' : '收起图层组'} onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); store.toggleGroupCollapsed(node.group.id) }}>{collapsed ? <Folder size={16} /> : <FolderOpen size={16} />}</span><span className="layer-name"><span>{node.group.name}</span><small>{blendOptions.find((option) => option.value === node.group.blendMode)?.label} · {Math.round(node.group.opacity * 100)}%</small></span></button>
      }
      const selected = session.selectedLayerIds.includes(node.layer.id) && !session.selectedGroupId
      const indicator = dropTarget?.kind === 'layer' && dropTarget.id === node.layer.id
        ? <span className={`layer-drop-indicator ${dropTarget.insertAfter ? 'above' : 'below'}`} style={{ left: `${8 + dropTarget.depth * 14}px` }} aria-hidden="true"><i /><b /><i /></span>
        : null
      return <button key={node.layer.id} data-layer-id={node.layer.id} className={`layer-row ${node.depth > 0 ? 'group-member' : ''} ${selected ? 'selected' : ''} ${draggingIds.includes(node.layer.id) ? 'dragging' : ''}`} style={{ '--layer-depth': node.depth } as React.CSSProperties} onPointerDown={(event) => beginLayerDrag(event, node.layer.id)} onDoubleClick={() => editLayer(node.layer)}>{indicator}<span className="layer-visibility" role="button" tabIndex={-1} aria-label={node.layer.visible ? '隐藏图层' : '显示图层'} onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); store.toggleLayerVisibility(node.layer.id) }}>{node.layer.visible ? <Eye size={14} /> : <EyeOff size={14} />}</span><span className={`layer-lock-toggle ${node.layer.locked ? 'locked' : ''}`} role="button" tabIndex={-1} aria-label={node.layer.locked ? '解除图层锁定' : '锁定图层'} aria-pressed={node.layer.locked} onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); store.setLayerPropertiesWithBlend(node.layer.id, node.layer.name, node.layer.opacity, node.layer.blendMode, !node.layer.locked) }}>{node.layer.locked ? <Lock size={14} /> : <LockOpen size={14} />}</span><span className="layer-name"><span>{node.layer.name}</span><small>{blendOptions.find((option) => option.value === node.layer.blendMode)?.label} · {Math.round(node.layer.opacity * 100)}%</small></span></button>
    })}{dropTarget?.kind === 'root' && <div className="layer-root-drop-target" aria-hidden="true"><span>移到最外层</span></div>}{dragGhost && <div className="layer-drag-ghost" style={{ top: dragGhost.y }}><span>{dragGhost.name}</span>{dragGhost.count > 1 && <small>+{dragGhost.count - 1}</small>}</div>}</div>
    {contextMenu && <div className="layer-context-menu" style={{ left: contextMenu.x, top: contextMenu.y }} role="menu" onPointerDown={(event) => event.stopPropagation()}><button role="menuitem" onClick={() => { void store.addLayer(); closeContextMenu() }}><Plus size={14} />新建图层</button><button role="menuitem" onClick={() => { store.createLayerGroup(); closeContextMenu() }}><FolderPlus size={14} />新建图层组</button>{contextMenu.kind === 'layer' && <><button role="menuitem" onClick={() => { store.duplicateActiveLayer(); closeContextMenu() }}><Copy size={14} />复制图层</button><button role="menuitem" onClick={() => { session.selectedLayerIds.length > 1 ? store.mergeSelectedLayers() : store.mergeActiveLayerDown(); closeContextMenu() }}><Combine size={14} />{session.selectedLayerIds.length > 1 ? '合并所选图层' : '向下合并'}</button></>}{contextMenu.kind === 'group' && <><button role="menuitem" onClick={() => { store.toggleGroupCollapsed(contextMenu.id); closeContextMenu() }}><FolderOpen size={14} />展开/收起图层组</button><button role="menuitem" onClick={() => { store.mergeSelectedGroup(); closeContextMenu() }}><Combine size={14} />合并图层组</button><button role="menuitem" onClick={() => { store.ungroupSelected(); closeContextMenu() }}><FolderMinus size={14} />解组</button></>}<button role="menuitem" onClick={() => { store.mergeVisibleLayers(); closeContextMenu() }}><Layers2 size={14} />合并可见图层</button><button role="menuitem" onClick={openProperties}><Settings2 size={14} />属性</button>{contextMenu.kind === 'layer' && <button role="menuitem" className="danger" onClick={() => { store.deleteActiveLayer(); closeContextMenu() }}><Trash2 size={14} />删除</button>}</div>}
    {form && <div className="modal-backdrop" role="presentation" onPointerDown={(event) => { if (event.target === event.currentTarget) closeProperties() }}><form className="modal layer-modal" onSubmit={(event) => event.preventDefault()}><header><div><span className="eyebrow">{form.kind === 'group' ? 'GROUP PROPERTIES' : 'LAYER PROPERTIES'}</span><h2>{form.kind === 'group' ? '图层组属性' : '图层属性'}</h2></div><button type="button" className="icon-button" aria-label="关闭" onClick={closeProperties}><X size={16} /></button></header><div className="modal-body"><label>名称<input autoFocus value={form.name} onChange={(event) => previewProperties({ ...form, name: event.target.value })} /></label><label>混合模式<ThemedSelect label="混合模式" value={form.blendMode} groups={blendOptionGroups} onChange={(blendMode) => previewProperties({ ...form, blendMode })} /></label><label>不透明度<div className="layer-opacity-control"><input aria-label="不透明度" type="range" min="0" max="100" step="1" value={form.opacity} onChange={(event) => previewProperties({ ...form, opacity: Number(event.target.value) })} /><NumberInput aria-label="不透明度数值" min={0} max={100} value={form.opacity} onValueChange={(opacity) => previewProperties({ ...form, opacity })} /><span>%</span></div></label></div></form></div>}
    {floating.style && <PanelResizeHandles onResize={floating.startResize} />}
  </section>
  <FloatingDockPreview style={floating.dockPreview} />
  </>
}

type InspectorDockTarget =
  | { kind: 'dock'; dock: FixedPanelDock; id?: WorkspacePanelId; insertAfter: boolean }
  | { kind: 'floating' }
type SquareAnchor = 'start' | 'end'

export function InspectorPanels({ session, previewOpen, onClosePreview, panelDocks, leftDockHost, bottomDockHost, onPanelDockChange, relativeLuminanceInPreview = true }: {
  session: DocumentSession
  previewOpen: boolean
  onClosePreview: () => void
  panelDocks: Record<WorkspacePanelId, PanelDock>
  leftDockHost: HTMLElement | null
  bottomDockHost: HTMLElement | null
  onPanelDockChange: (id: WorkspacePanelId, dock: PanelDock) => void
  relativeLuminanceInPreview?: boolean
}) {
  const initialLayout = useMemo(loadInspectorLayout, [])
  const [order, setOrder] = useState<WorkspacePanelId[]>(initialLayout.order)
  const [sizes, setSizes] = useState<Record<WorkspacePanelId, number>>(initialLayout.sizes)
  const [bottomWidths, setBottomWidths] = useState<Record<WorkspacePanelId, number>>(initialLayout.bottomWidths)
  const [colorSquareDock, setColorSquareDock] = useState<FixedPanelDock | null>(() => {
    const stored = readStoredString(COLOR_SQUARE_DOCK_STORAGE_KEY)
    return stored === 'left' || stored === 'right' || stored === 'bottom' ? stored : null
  })
  const [colorSquareAnchor, setColorSquareAnchor] = useState<SquareAnchor>(() => readStoredString(COLOR_SQUARE_ANCHOR_STORAGE_KEY) === 'start' ? 'start' : 'end')
  const [draggingPanel, setDraggingPanel] = useState<WorkspacePanelId | null>(null)
  const [detachPreview, setDetachPreview] = useState<React.CSSProperties | null>(null)
  const [dockDropTarget, setDockDropTarget] = useState<InspectorDockTarget | null>(null)
  const sizesRef = useRef(sizes)
  const bottomWidthsRef = useRef(bottomWidths)
  const orderRef = useRef(order)
  const colorSquareDockRef = useRef<FixedPanelDock | null>(colorSquareDock)
  const detachPreviewRef = useRef<React.CSSProperties | null>(null)
  const dockDropTargetRef = useRef<InspectorDockTarget | null>(null)
  const resizeRef = useRef<{ upper: WorkspacePanelId; dock: 'left' | 'right'; startY: number; startSizes: Record<WorkspacePanelId, number> } | null>(null)
  const bottomResizeRef = useRef<{ leading: WorkspacePanelId; trailing: WorkspacePanelId; startX: number; startWidths: Record<WorkspacePanelId, number> } | null>(null)
  const dockDragRef = useRef<{ id: WorkspacePanelId; startX: number; startY: number; detach: (clientX: number, clientY: number, continueDrag?: boolean) => void; moved: boolean } | null>(null)
  sizesRef.current = sizes
  bottomWidthsRef.current = bottomWidths
  orderRef.current = order
  colorSquareDockRef.current = colorSquareDock
  const dockFor = (id: WorkspacePanelId): PanelDock => panelDocks[id] ?? (id === 'preview' ? 'floating' : 'right')

  const persistLayout = (nextOrder = order, nextSizes = sizesRef.current, nextBottomWidths = bottomWidthsRef.current): void => {
    try {
      writeStoredString(INSPECTOR_LAYOUT_STORAGE_KEY, JSON.stringify({ order: nextOrder, sizes: nextSizes, bottomWidths: nextBottomWidths }))
      notifyWorkspaceLayoutChanged()
    } catch { /* Ignore unavailable renderer storage. */ }
  }
  const setSquareDock = (dock: FixedPanelDock | null, anchor: SquareAnchor = colorSquareAnchor): void => {
    setColorSquareDock(dock)
    if (dock) {
      setColorSquareAnchor(anchor)
      writeStoredString(COLOR_SQUARE_DOCK_STORAGE_KEY, dock)
      writeStoredString(COLOR_SQUARE_ANCHOR_STORAGE_KEY, anchor)
    } else {
      removeStoredValue(COLOR_SQUARE_DOCK_STORAGE_KEY)
      removeStoredValue(COLOR_SQUARE_ANCHOR_STORAGE_KEY)
    }
    notifyWorkspaceLayoutChanged()
  }
  const setDockTarget = (target: InspectorDockTarget | null): void => {
    dockDropTargetRef.current = target
    setDockDropTarget(target)
  }
  useEffect(() => {
    const move = (event: PointerEvent): void => {
      const bottomResize = bottomResizeRef.current
      if (bottomResize) {
        if (Math.abs(event.clientX - bottomResize.startX) > 1 && colorSquareDockRef.current === 'bottom') setSquareDock(null)
        const total = bottomResize.startWidths[bottomResize.leading] + bottomResize.startWidths[bottomResize.trailing]
        const minimumLeading = MINIMUM_BOTTOM_WIDTHS[bottomResize.leading]
        const minimumTrailing = MINIMUM_BOTTOM_WIDTHS[bottomResize.trailing]
        const leading = Math.max(minimumLeading, Math.min(total - minimumTrailing, bottomResize.startWidths[bottomResize.leading] + event.clientX - bottomResize.startX))
        const next = { ...bottomResize.startWidths, [bottomResize.leading]: leading, [bottomResize.trailing]: total - leading }
        bottomWidthsRef.current = next
        setBottomWidths(next)
        return
      }
      const drag = resizeRef.current
      if (drag) {
        if (Math.abs(event.clientY - drag.startY) > 1 && colorSquareDockRef.current === drag.dock) setSquareDock(null)
        const start = drag.startSizes
        const desired = Math.max(MINIMUM_INSPECTOR_SIZES[drag.upper], start[drag.upper] + event.clientY - drag.startY)
        const delta = desired - start[drag.upper]
        const next = { ...start, [drag.upper]: desired }
        const dockOrder = orderRef.current.filter((id) => dockFor(id) === drag.dock && (id !== 'preview' || previewOpen))
        const upperIndex = dockOrder.indexOf(drag.upper)
        const lowerPanels = dockOrder.slice(upperIndex + 1)
        if (delta > 0) {
          let remaining = delta
          for (const id of lowerPanels) {
            const available = Math.max(0, next[id] - MINIMUM_INSPECTOR_SIZES[id])
            const consumed = Math.min(available, remaining)
            next[id] -= consumed
            remaining -= consumed
            if (remaining <= 0) break
          }
        } else if (delta < 0 && lowerPanels[0]) {
          next[lowerPanels[0]] += -delta
        }
        sizesRef.current = next
        setSizes(next)
        return
      }
      const dockDrag = dockDragRef.current
      if (!dockDrag) return
      if (!dockDrag.moved && Math.hypot(event.clientX - dockDrag.startX, event.clientY - dockDrag.startY) < 4) return
      dockDrag.moved = true
      setDraggingPanel(dockDrag.id)
      const zone = panelDockZoneAt(event.clientX, event.clientY)
      if (zone) {
        const slots = [...document.querySelectorAll<HTMLElement>(`[data-panel-dock-zone="${zone.dock}"] [data-inspector-panel-id]`)].filter((slot) => slot.dataset.inspectorPanelId !== dockDrag.id)
        let targetSlot = slots.find((slot) => {
          const bounds = slot.getBoundingClientRect()
          return event.clientX >= bounds.left && event.clientX <= bounds.right && event.clientY >= bounds.top && event.clientY <= bounds.bottom
        })
        if (!targetSlot && slots.length > 0) {
          const pointer = zone.dock === 'bottom' ? event.clientX : event.clientY
          targetSlot = slots.reduce((closest, slot) => {
            const closestBounds = closest.getBoundingClientRect()
            const slotBounds = slot.getBoundingClientRect()
            const closestCenter = zone.dock === 'bottom' ? closestBounds.left + closestBounds.width / 2 : closestBounds.top + closestBounds.height / 2
            const slotCenter = zone.dock === 'bottom' ? slotBounds.left + slotBounds.width / 2 : slotBounds.top + slotBounds.height / 2
            return Math.abs(pointer - slotCenter) < Math.abs(pointer - closestCenter) ? slot : closest
          })
        }
        const target = targetSlot?.dataset.inspectorPanelId as WorkspacePanelId | undefined
        const bounds = targetSlot?.getBoundingClientRect()
        const insertAfter = bounds ? (zone.dock === 'bottom' ? event.clientX >= bounds.left + bounds.width / 2 : event.clientY >= bounds.top + bounds.height / 2) : true
        detachPreviewRef.current = target ? null : zone.preview
        setDetachPreview(target ? null : zone.preview)
        setDockTarget({ kind: 'dock', dock: zone.dock, id: target, insertAfter })
        return
      }
      {
        const source = document.querySelector<HTMLElement>(`[data-inspector-panel-id="${dockDrag.id}"]`)?.getBoundingClientRect()
        const width = source?.width ?? 280
        const height = source?.height ?? sizesRef.current[dockDrag.id]
        const preview = {
          position: 'fixed',
          left: Math.max(0, Math.min(window.innerWidth - Math.min(width, 120), event.clientX - Math.min(80, width / 2))),
          top: Math.max(0, Math.min(window.innerHeight - 32, event.clientY - 16)),
          width,
          height
        } satisfies React.CSSProperties
        detachPreviewRef.current = preview
        setDetachPreview(preview)
        setDockTarget({ kind: 'floating' })
        return
      }
    }
    const up = (event: PointerEvent): void => {
      if (resizeRef.current) persistLayout(orderRef.current, sizesRef.current)
      if (bottomResizeRef.current) persistLayout(orderRef.current, sizesRef.current, bottomWidthsRef.current)
      const dockDrag = dockDragRef.current
      const target = dockDropTargetRef.current
      if (dockDrag?.moved && target?.kind === 'dock') {
        const nextOrder = moveInspectorPanel(orderRef.current, dockDrag.id, target.id, target.insertAfter)
        orderRef.current = nextOrder
        setOrder(nextOrder)
        persistLayout(nextOrder, sizesRef.current)
        onPanelDockChange(dockDrag.id, target.dock)
        if (dockDrag.id === 'color') setSquareDock(null)
      } else if (dockDrag?.moved && target?.kind === 'floating') {
        dockDrag.detach(event.clientX, event.clientY, false)
        onPanelDockChange(dockDrag.id, 'floating')
        if (dockDrag.id === 'color') setSquareDock(null)
      } else if (dockDrag?.moved) persistLayout(orderRef.current, sizesRef.current)
      resizeRef.current = null
      bottomResizeRef.current = null
      dockDragRef.current = null
      detachPreviewRef.current = null
      setDetachPreview(null)
      setDockTarget(null)
      setDraggingPanel(null)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    return () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up) }
  }, [onPanelDockChange, panelDocks, previewOpen])

  const restoreColorSquare = (preferBottom = false): void => {
    const currentDock = dockFor('color')
    const targetDock: FixedPanelDock = preferBottom ? 'bottom' : currentDock === 'left' || currentDock === 'right' || currentDock === 'bottom' ? currentDock : 'bottom'
    // A docked panel keeps its current order. The edge only decides which
    // boundary remains fixed while the square size consumes sibling space.
    const nextOrder = currentDock === targetDock ? orderRef.current : moveInspectorPanel(orderRef.current, 'color')
    const dockOrder = nextOrder.filter((id) => id !== 'preview' || previewOpen).filter((id) => (id === 'color' ? targetDock : dockFor(id)) === targetDock)
    const colorIndex = dockOrder.indexOf('color')
    const anchor: SquareAnchor = colorIndex >= 0 && colorIndex === dockOrder.length - 1 ? 'end' : 'start'
    if (currentDock === targetDock) {
      const currentPanel = document.querySelector<HTMLElement>(`[data-panel-dock-content="${targetDock}"] [data-inspector-panel-id="color"] .color-panel`)
      const currentField = currentPanel?.querySelector<HTMLElement>('.color-field-slot')
      const currentFieldBounds = currentField?.getBoundingClientRect()
      if (currentFieldBounds && Math.abs(currentFieldBounds.width - currentFieldBounds.height) <= 1) {
        // The visible geometry is already correct. Re-locking here would
        // change flex distribution and cause a one-frame layout flash.
        return
      }
    }

    orderRef.current = nextOrder
    setOrder(nextOrder)
    if (targetDock !== currentDock) onPanelDockChange('color', targetDock)
    setSquareDock(null)
    persistLayout(nextOrder, sizesRef.current, bottomWidthsRef.current)

    window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
      const slot = document.querySelector<HTMLElement>(`[data-panel-dock-content="${targetDock}"] [data-inspector-panel-id="color"]`)
      const panel = slot?.querySelector<HTMLElement>('.color-panel')
      const fieldSlot = panel?.querySelector<HTMLElement>('.color-field-slot')
      const host = slot?.closest<HTMLElement>(`[data-panel-dock-content="${targetDock}"]`)
      if (!slot || !panel || !fieldSlot || !host) return
      const panelBounds = panel.getBoundingClientRect()
      const fieldBounds = fieldSlot.getBoundingClientRect()
      const hostBounds = host.getBoundingClientRect()
      const activeSiblings = nextOrder.filter((id) => id !== 'color' && (id !== 'preview' || previewOpen) && dockFor(id) === targetDock)

      if (targetDock === 'bottom') {
        const reservedWidth = activeSiblings.reduce((total, id) => total + MINIMUM_BOTTOM_WIDTHS[id], 0) + activeSiblings.length * 7
        const maximumWidth = Math.max(MINIMUM_BOTTOM_WIDTHS.color, hostBounds.width - reservedWidth)
        const targetWidth = Math.max(MINIMUM_BOTTOM_WIDTHS.color, Math.min(maximumWidth, Math.round(panelBounds.width - fieldBounds.width + fieldBounds.height)))
        const next = { ...bottomWidthsRef.current, color: targetWidth }
        bottomWidthsRef.current = next
        setBottomWidths(next)
        setSquareDock('bottom', anchor)
        persistLayout(nextOrder, sizesRef.current, next)
        return
      }

      const reservedHeight = activeSiblings.reduce((total, id) => total + MINIMUM_INSPECTOR_SIZES[id], 0) + activeSiblings.length * 7
      const maximumHeight = Math.max(MINIMUM_INSPECTOR_SIZES.color, hostBounds.height - reservedHeight)
      const dockOrder = nextOrder.filter((id) => id !== 'preview' || previewOpen).filter((id) => dockFor(id) === targetDock)
      const colorHasFollowingPanel = dockOrder.indexOf('color') < dockOrder.length - 1
      const separatorAllowance = colorHasFollowingPanel ? 7 : 0
      const targetHeight = Math.max(MINIMUM_INSPECTOR_SIZES.color, Math.min(maximumHeight, Math.round(panelBounds.height - fieldBounds.height + fieldBounds.width + separatorAllowance)))
      const next = { ...sizesRef.current, color: targetHeight }
      sizesRef.current = next
      setSizes(next)
      setSquareDock(targetDock, anchor)
      persistLayout(nextOrder, next, bottomWidthsRef.current)
    }))
  }

  const panelFor = (id: WorkspacePanelId, docked: boolean) => {
    const dockProps: DockDragProps = { docked, onFloatingDock: (dock) => onPanelDockChange(id, dock), onDockDragStart: (event, detach) => {
      if (event.button !== 0 || (event.target as HTMLElement).closest('button, input, select')) return
      dockDragRef.current = { id, startX: event.clientX, startY: event.clientY, detach, moved: false }
      event.preventDefault()
    } }
    if (id === 'color') return <ColorPanel session={session} onRestoreSquare={restoreColorSquare} {...dockProps} />
    if (id === 'palette') return <PalettePanel session={session} {...dockProps} />
    if (id === 'layers') return <LayersPanel session={session} {...dockProps} />
    return <PreviewPanel session={session} onClose={onClosePreview} relativeLuminanceInPreview={relativeLuminanceInPreview} {...dockProps} />
  }

  const completeOrder = [...order, ...DEFAULT_INSPECTOR_ORDER.filter((id) => !order.includes(id))]
  const activeOrder = completeOrder.filter((id) => id !== 'preview' || previewOpen)
  const renderDock = (dock: FixedPanelDock) => {
    const dockOrder = activeOrder.filter((id) => dockFor(id) === dock)
    const horizontal = dock === 'bottom'
    const squareIndex = colorSquareDock === dock ? dockOrder.indexOf('color') : -1
    const squareAtStart = colorSquareDock === dock && colorSquareAnchor === 'start' && squareIndex === 0
    const squareAtEnd = colorSquareDock === dock && colorSquareAnchor === 'end' && squareIndex >= 0 && squareIndex === dockOrder.length - 1
    return <div className={horizontal ? 'bottom-panel-stack' : 'inspector-stack'} data-panel-dock-content={dock}>{dockOrder.map((id, index) => {
      const dropPreview = dockDropTarget?.kind === 'dock' && dockDropTarget.dock === dock && dockDropTarget.id === id ? dockDropTarget : null
      const nextId = dockOrder[index + 1]
      const squareLocked = id === 'color' && colorSquareDock === dock
      const fillsSpaceBeforeSquare = colorSquareDock === dock && ((squareAtEnd && index === squareIndex - 1) || (squareAtStart && index === squareIndex + 1))
      return <Fragment key={id}><div className={`${horizontal ? 'bottom-panel-group' : 'inspector-panel-group'} ${draggingPanel === id ? 'dock-dragging' : ''} ${squareLocked ? 'square-locked' : ''}`} data-inspector-panel-id={id} style={horizontal ? { flex: squareLocked ? `0 0 ${bottomWidths[id]}px` : fillsSpaceBeforeSquare ? `1 1 ${bottomWidths[id]}px` : index === dockOrder.length - 1 ? `1 1 ${bottomWidths[id]}px` : `0 1 ${bottomWidths[id]}px`, minWidth: MINIMUM_BOTTOM_WIDTHS[id], '--locked-size': `${bottomWidths[id]}px` } as React.CSSProperties : { flex: squareLocked ? `0 0 ${sizes[id]}px` : fillsSpaceBeforeSquare ? `1 1 ${sizes[id]}px` : index === dockOrder.length - 1 ? `1 1 ${sizes[id]}px` : `0 1 ${sizes[id] + 7}px`, minHeight: MINIMUM_INSPECTOR_SIZES[id] + (index < dockOrder.length - 1 ? 7 : 0), '--locked-size': `${sizes[id]}px` } as React.CSSProperties}>
        <div className="inspector-panel-slot">{panelFor(id, true)}</div>
        {!horizontal && index < dockOrder.length - 1 && <div className="panel-resizer" role="separator" aria-orientation="horizontal" aria-label={`调整${id}面板高度`} onPointerDown={(event) => {
          const measured = { ...sizesRef.current }
          for (const panelSlot of document.querySelectorAll<HTMLElement>(`[data-panel-dock-content="${dock}"] [data-inspector-panel-id]`)) {
            const slotId = panelSlot.dataset.inspectorPanelId as WorkspacePanelId | undefined
            const content = panelSlot.querySelector<HTMLElement>(':scope > .inspector-panel-slot')
            if (slotId && content) measured[slotId] = content.getBoundingClientRect().height
          }
          resizeRef.current = { upper: id, dock, startY: event.clientY, startSizes: measured }
          event.currentTarget.setPointerCapture?.(event.pointerId)
          event.preventDefault()
        }}><span /></div>}
        {dropPreview && <span className={`inspector-drop-indicator ${horizontal ? 'vertical' : ''} ${dropPreview.insertAfter ? 'below' : 'above'}`} aria-hidden="true" />}
      </div>{horizontal && nextId && <div className="bottom-panel-resizer" role="separator" aria-orientation="vertical" aria-label={`调整${id}和${nextId}栏目宽度`} onPointerDown={(event) => {
        const measured = { ...bottomWidthsRef.current }
        for (const slot of document.querySelectorAll<HTMLElement>('[data-panel-dock-content="bottom"] [data-inspector-panel-id]')) {
          const slotId = slot.dataset.inspectorPanelId as WorkspacePanelId | undefined
          if (slotId) measured[slotId] = slot.getBoundingClientRect().width
        }
        bottomResizeRef.current = { leading: id, trailing: nextId, startX: event.clientX, startWidths: measured }
        event.currentTarget.setPointerCapture?.(event.pointerId)
        event.preventDefault()
      }}><span /></div>}</Fragment>
    })}</div>
  }

  return <>
    {renderDock('right')}
    {leftDockHost && createPortal(renderDock('left'), leftDockHost)}
    {bottomDockHost && createPortal(renderDock('bottom'), bottomDockHost)}
    {createPortal(<>{activeOrder.filter((id) => dockFor(id) === 'floating').map((id) => <span className="floating-panel-host" key={id}>{panelFor(id, false)}</span>)}</>, document.body)}
    <FloatingDockPreview style={detachPreview} />
  </>
}
