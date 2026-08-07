import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { BookOpen, FileImage, Folder, FolderOpen, LockKeyhole, Palette, Save, ScanSearch, Settings2, Trash2, UnlockKeyhole, X } from 'lucide-react'
import type { PaletteEntry, StoredPalette } from '@shared/types'
import { colorCss, rgbaHex } from '@/components/ColorPicker'
import { FloatingDockPreview, PanelResizeHandles, useFloatingPanel } from '@/components/floating-panel'
import { NumberInput } from '@/components/NumberInput'
import type { DockDragProps } from '@/components/workspace-panel-types'
import { encodePalettePng, extractPaletteColors, mergePaletteColors } from '@/core/palette'
import { PALETTE_SWATCH_PIXELS, paletteColorRoles, paletteColorsEqual, paletteMarkerColor, paletteReorderTarget, reorderPalettePreview, type PaletteSwatchSize } from '@/core/palette-layout'
import { readStoredString, removeStoredValue, writeStoredString } from '@/core/panel-preferences'
import { colorEquals } from '@/core/raster'
import { builtInPaletteNameKeys } from '@/core/built-in-palettes'
import { useWorkspace, type DocumentSession } from '@/store/workspace'
import { useI18n } from '@/components/I18nProvider'

const PALETTE_SWATCH_SIZE_STORAGE_KEY = 'moonsprite.palette-swatch-size'

export function PalettePanel({ session, docked = false, onDockDragStart, onPanelContextMenu, onFloatingDock }: { session: DocumentSession } & DockDragProps) {
  const { t } = useI18n()
  const store = useWorkspace.getState()
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
  const [extractName, setExtractName] = useState(() => t('palette.defaultName', { name: session.document.name }))
  const [saveName, setSaveName] = useState(() => t('palette.defaultName', { name: session.document.name }))
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
  const [focusedSwatchId, setFocusedSwatchId] = useState<number | null>(null)
  const [paletteEditLocked, setPaletteEditLocked] = useState(() => readStoredString('moonsprite.palette-edit-locked') !== 'false')
  const [palettePreviewOrder, setPalettePreviewOrder] = useState<number[] | null>(null)
  const [swatchSize, setSwatchSize] = useState<PaletteSwatchSize>(() => {
    const stored = readStoredString(PALETTE_SWATCH_SIZE_STORAGE_KEY)
    return stored === 'small' || stored === 'large' ? stored : 'medium'
  })
  const ordered = session.document.paletteOrder.map((id) => session.document.palette.find((entry) => entry.id === id)).filter((entry): entry is PaletteEntry => Boolean(entry))
  const displayedOrdered = (palettePreviewOrder ?? session.document.paletteOrder).map((id) => session.document.palette.find((entry) => entry.id === id)).filter((entry): entry is PaletteEntry => Boolean(entry))
  const orderedColors = ordered.map((entry) => ({ ...entry.color }))
  const activePalette = paletteFiles.find((palette) => palette.id === activePaletteId) ?? null
  const paletteDisplayName = (palette: StoredPalette): string => {
    const nameKey = palette.builtIn ? builtInPaletteNameKeys[palette.id] : undefined
    return nameKey ? t(nameKey) : palette.name
  }

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
      if (nextPalette) setSaveName(paletteDisplayName(nextPalette))
      if (nextId) writeStoredString('moonsprite.active-palette-id', nextId)
      else removeStoredValue('moonsprite.active-palette-id')
    } catch (error) {
      store.setMessage(error instanceof Error ? error.message : t('palette.readFailed'))
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
    writeStoredString(PALETTE_SWATCH_SIZE_STORAGE_KEY, value)
    setPaletteActionsOpen(false)
  }
  const togglePaletteEditLock = (): void => {
    setPaletteEditLocked((current) => {
      const next = !current
      writeStoredString('moonsprite.palette-edit-locked', String(next))
      return next
    })
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
      if (color) {
        event.currentTarget.focus({ preventScroll: true })
        setFocusedSwatchId(id)
        store.selectSecondaryPaletteColor(id)
      }
      return
    }
    if (event.button !== 0) return
    event.currentTarget.focus({ preventScroll: true })
    setFocusedSwatchId(id)
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

  useEffect(() => {
    const close = (event: Event): void => {
      const target = (event as CustomEvent<{ target?: string }>).detail?.target
      if (target && target !== 'palette') return
      if (saveOpen) setSaveOpen(false)
      else if (extractOpen) setExtractOpen(false)
      else if (paletteContext) setPaletteContext(null)
      else if (libraryOpen) setLibraryOpen(false)
      else if (paletteActionsOpen) setPaletteActionsOpen(false)
    }
    window.addEventListener('moonsprite:close-dialog', close)
    return () => window.removeEventListener('moonsprite:close-dialog', close)
  }, [extractOpen, libraryOpen, paletteActionsOpen, paletteContext, saveOpen])

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
    setSaveName(paletteDisplayName(palette))
    writeStoredString('moonsprite.active-palette-id', palette.id)
    setLibraryOpen(false)
  }

  const deleteStoredPalette = async (id: string): Promise<void> => {
    const palette = paletteFiles.find((item) => item.id === id)
    if (!palette || palette.builtIn) { store.setMessage(t('palette.builtInDeleteBlocked')); return }
    try {
      await window.moonSprite.deletePalette(id)
      setPaletteFiles((current) => current.filter((item) => item.id !== id))
      if (activePaletteId === id) {
        setActivePaletteId(null)
        removeStoredValue('moonsprite.active-palette-id')
      }
      setPaletteContext(null)
      store.setMessage(t('palette.deleted', { name: palette.name }))
    } catch (error) {
      store.setMessage(error instanceof Error ? error.message : t('palette.deleteFailed'))
    }
  }

  const openExtractDialog = (): void => {
    setExtractName(t('palette.defaultName', { name: session.document.name }))
    setExtractMode('create')
    setExtractOpen(true)
    setLibraryOpen(false)
    setPaletteActionsOpen(false)
  }

  const extractFromImage = async (): Promise<void> => {
    setOperationBusy(true)
    try {
      const colors = extractPaletteColors(session.document, extractLimit)
      if (colors.length === 0) throw new Error(t('palette.noOpaqueColors'))
      if (extractMode === 'create') {
        store.applyPalette(colors)
        setActivePaletteId(null)
        removeStoredValue('moonsprite.active-palette-id')
        const name = extractName.trim() || t('palette.defaultName', { name: session.document.name })
        setSaveName(name)
        store.setMessage(t('palette.createdTemporary', { name, count: colors.length }))
      } else if (extractMode === 'replace') {
        store.applyPalette(colors)
        store.setMessage(t('palette.replaced', { count: colors.length }))
      } else {
        const merged = mergePaletteColors(orderedColors, colors)
        store.applyPalette(merged)
        store.setMessage(t('palette.appended', { count: merged.length - orderedColors.length }))
      }
      setExtractOpen(false)
    } catch (error) {
      store.setMessage(error instanceof Error ? error.message : t('palette.extractFailed'))
    } finally {
      setOperationBusy(false)
    }
  }

  const openSaveDialog = (): void => {
    setSaveName(activePalette ? paletteDisplayName(activePalette) : (saveName || t('palette.defaultName', { name: session.document.name })))
    setSaveOpen(true)
    setLibraryOpen(false)
    setPaletteActionsOpen(false)
  }

  const savePaletteLocally = async (): Promise<void> => {
    if (orderedColors.length === 0) { store.setMessage(t('palette.noColorsToSave')); return }
    setOperationBusy(true)
    try {
      const saved = await window.moonSprite.savePalette(activePalette && !activePalette.builtIn ? activePalette.id : null, saveName.trim() || t('palette.defaultName', { name: session.document.name }), orderedColors)
      upsertPalette(saved)
      setSaveOpen(false)
      store.setMessage(t('palette.saved', { name: saved.name, directory: paletteDirectory }))
    } catch (error) {
      store.setMessage(error instanceof Error ? error.message : t('palette.saveFailed'))
    } finally {
      setOperationBusy(false)
    }
  }

  const savePaletteAsImage = async (): Promise<void> => {
    if (orderedColors.length === 0) { store.setMessage(t('palette.noColorsToSave')); return }
    setOperationBusy(true)
    try {
      const safeName = (saveName.trim() || t('palette.defaultName', { name: session.document.name })).replace(/[<>:"/\\|?*]/g, '_')
      const result = await window.moonSprite.savePaletteImage(`${safeName}.png`)
      if (result.canceled || !result.filePath) return
      const encoded = encodePalettePng(orderedColors)
      await window.moonSprite.writeBinaryAtomic(result.filePath, encoded.bytes)
      setSaveOpen(false)
      store.setMessage(t('palette.imageSaved', { path: result.filePath }))
    } catch (error) {
      store.setMessage(error instanceof Error ? error.message : t('palette.imageSaveFailed'))
    } finally {
      setOperationBusy(false)
    }
  }

  return <><section ref={floating.ref} className={`panel palette-panel ${floating.style ? 'floating-panel' : ''}`} data-command-scope="palette" style={floating.style} onPointerDown={floating.bringToFront} onContextMenu={onPanelContextMenu}>
    <header onPointerDown={(event) => floating.style ? floating.startDrag(event) : onDockDragStart?.(event, floating.startDetachedDrag)}><Palette size={15} /><span>{t('panel.palette')}</span><small>{t('palette.colorCount', { count: ordered.length })}</small><span className="panel-actions palette-actions">
      <span ref={libraryControlRef} className="palette-library-control"><button ref={libraryButtonRef} className={libraryOpen ? 'active' : ''} title={t('palette.chooseLocal')} aria-label={t('palette.chooseLocal')} aria-expanded={libraryOpen} onClick={() => { setLibraryOpen((open) => !open); setPaletteActionsOpen(false) }}><BookOpen size={14} /></button></span>
      <span ref={paletteActionsControlRef} className="palette-actions-control"><button ref={paletteActionsButtonRef} className={paletteActionsOpen ? 'active' : ''} title={t('palette.actions')} aria-label={t('palette.actions')} aria-expanded={paletteActionsOpen} onClick={() => { setPaletteActionsOpen((open) => !open); setLibraryOpen(false) }}><Settings2 size={14} /></button></span>
      <button className={paletteEditLocked ? '' : 'active'} title={t(paletteEditLocked ? 'palette.unlockEditing' : 'palette.lockEditing')} aria-label={t(paletteEditLocked ? 'palette.unlockEditing' : 'palette.lockEditing')} aria-pressed={!paletteEditLocked} onClick={togglePaletteEditLock}>{paletteEditLocked ? <LockKeyhole size={14} /> : <UnlockKeyhole size={14} />}</button>
    </span></header>
    <div ref={swatchGridRef} className="swatch-grid" style={{ '--swatch-size': `${PALETTE_SWATCH_PIXELS[swatchSize]}px` } as React.CSSProperties}>{displayedOrdered.map((entry) => { const roles = paletteColorRoles(entry.color, session.primaryColor, session.secondaryColor); const active = session.selectedPaletteIds.includes(entry.id) || roles.primary || roles.secondary; const roleLabel = [roles.primary ? t('palette.foreground') : '', roles.secondary ? t('palette.background') : ''].filter(Boolean).join(t('palette.roleSeparator')); return <span key={entry.id} className="palette-swatch-wrap"><button data-palette-id={entry.id} className={`swatch ${focusedSwatchId === entry.id ? 'focused' : ''} ${roles.primary ? 'primary' : ''} ${roles.secondary ? 'secondary' : ''} ${entry.color.a === 0 ? 'transparent' : ''} ${draggingIds.includes(entry.id) ? 'dragging' : ''}`} title={`${entry.name} ${rgbaHex(entry.color)}${roleLabel ? ` · ${roleLabel}` : ''}`} aria-label={`${entry.name} ${rgbaHex(entry.color)}${roleLabel ? ` ${roleLabel}` : ''}`} aria-pressed={session.selectedPaletteIds.includes(entry.id)} style={{ '--swatch-color': colorCss(entry.color) } as React.CSSProperties} onContextMenu={(event) => event.preventDefault()} onPointerDown={(event) => beginPaletteDrag(event, entry.id)} onBlur={() => setFocusedSwatchId((current) => current === entry.id ? null : current)} onPointerMove={movePaletteDrag} onPointerUp={finishPaletteDrag} onPointerCancel={finishPaletteDrag}>{active && <span className="swatch-drag-edges" aria-hidden="true"><i className="swatch-drag-edge edge-n" /><i className="swatch-drag-edge edge-e" /><i className="swatch-drag-edge edge-s" /><i className="swatch-drag-edge edge-w" /></span>}</button></span> })}</div>
    {floating.style && <PanelResizeHandles onResize={floating.startResize} />}
  </section>
  <FloatingDockPreview style={floating.dockPreview} />
  {libraryOpen && createPortal(<span ref={libraryPopoverRef} className="palette-library-popover" role="menu" aria-label={t('palette.localPalettes')} style={libraryPopoverPosition}>{paletteLoading ? <span className="palette-library-state">{t('palette.loading')}</span> : paletteFiles.length === 0 ? <span className="palette-library-state">{t('palette.empty')}</span> : paletteFiles.map((palette) => <button key={palette.id} type="button" role="menuitem" className={activePaletteId === palette.id ? 'selected' : ''} title={t(palette.builtIn ? 'palette.builtInHint' : 'palette.userDeleteHint')} onClick={() => applyStoredPalette(palette)} onContextMenu={(event) => { event.preventDefault(); if (palette.builtIn) { store.setMessage(t('palette.builtInDeleteBlocked')); setPaletteContext(null); return } setPaletteContext({ id: palette.id, x: Math.min(event.clientX, window.innerWidth - 150), y: Math.min(event.clientY, window.innerHeight - 42) }) }}><span className="palette-library-name">{paletteDisplayName(palette)}{palette.builtIn && <LockKeyhole size={11} aria-label={t('palette.builtIn')} />}</span><span className="palette-library-swatches" aria-hidden="true">{palette.colors.map((color, index) => <i key={index} style={{ background: colorCss(color) }} />)}</span></button>)}<button type="button" role="menuitem" className="palette-folder-action" onClick={() => { void window.moonSprite.openPaletteFolder(); setLibraryOpen(false) }}><FolderOpen size={14} /><span>{t('palette.openUserFolder')}</span></button></span>, document.body)}
  {paletteActionsOpen && createPortal(<span ref={paletteActionsPopoverRef} className="palette-actions-popover" role="menu" aria-label={t('palette.actions')} style={paletteActionsPopoverPosition}><button type="button" role="menuitem" onClick={openExtractDialog}><ScanSearch size={14} /><span>{t('palette.extractColors')}</span></button><span className="palette-actions-divider" /><section aria-label={t('palette.swatchSize')}><span>{t('palette.swatchSize')}</span><div>{(['small', 'medium', 'large'] as PaletteSwatchSize[]).map((size) => <button key={size} type="button" role="menuitemradio" aria-checked={swatchSize === size} className={swatchSize === size ? 'selected' : ''} title={t('palette.pixels', { count: PALETTE_SWATCH_PIXELS[size] })} onClick={() => chooseSwatchSize(size)}><i style={{ width: Math.round(PALETTE_SWATCH_PIXELS[size] * .45), height: Math.round(PALETTE_SWATCH_PIXELS[size] * .45) }} /><span>{t(size === 'small' ? 'palette.size.small' : size === 'medium' ? 'palette.size.medium' : 'palette.size.large')}</span></button>)}</div></section><span className="palette-actions-divider" /><button type="button" role="menuitem" onClick={openSaveDialog}><Save size={14} /><span>{t('palette.savePalette')}</span></button></span>, document.body)}
  {paletteContext && createPortal(<span ref={paletteContextRef} className="palette-library-context" role="menu" style={{ left: paletteContext.x, top: paletteContext.y }}><button type="button" role="menuitem" onClick={() => void deleteStoredPalette(paletteContext.id)}><Trash2 size={14} /><span>{t('palette.deletePalette')}</span></button></span>, document.body)}
  {extractOpen && createPortal(<form ref={extractFloating.ref as React.RefObject<HTMLFormElement>} className="palette-operation-dialog" style={extractFloating.style} role="dialog" aria-labelledby="palette-extract-title" onSubmit={(event) => { event.preventDefault(); void extractFromImage() }} onPointerDown={extractFloating.bringToFront}><header onPointerDown={extractFloating.startDrag}><div><span className="eyebrow">PALETTE</span><h2 id="palette-extract-title">{t('palette.extractTitle')}</h2></div><button type="button" className="icon-button" aria-label={t('common.close')} onClick={() => setExtractOpen(false)}><X size={16} /></button></header><div className="palette-dialog-body"><fieldset><legend>{t('palette.extractMethod')}</legend><label><input type="radio" name="extract-mode" checked={extractMode === 'create'} onChange={() => setExtractMode('create')} /><span><strong>{t('palette.extract.create')}</strong><small>{t('palette.extract.createHint')}</small></span></label><label><input type="radio" name="extract-mode" checked={extractMode === 'replace'} onChange={() => setExtractMode('replace')} /><span><strong>{t('palette.extract.replace', { name: activePalette ? `“${paletteDisplayName(activePalette)}”` : '' })}</strong><small>{t('palette.extract.replaceHint')}</small></span></label><label><input type="radio" name="extract-mode" checked={extractMode === 'append'} onChange={() => setExtractMode('append')} /><span><strong>{t('palette.extract.append')}</strong><small>{t('palette.extract.appendHint')}</small></span></label></fieldset><div className="palette-form-grid"><label>{t('palette.extract.limit')}<NumberInput min={1} max={4096} value={extractLimit} onValueChange={setExtractLimit} /></label>{extractMode === 'create' && <label>{t('palette.name')}<input value={extractName} onChange={(event) => setExtractName(event.target.value)} /></label>}</div></div><footer><button type="button" className="quiet-button" onClick={() => setExtractOpen(false)}>{t('common.cancel')}</button><button type="submit" className="primary-button" disabled={operationBusy}>{operationBusy ? t('palette.extracting') : t('palette.extractColors')}</button></footer></form>, document.body)}
  {saveOpen && createPortal(<section ref={saveFloating.ref} className="palette-operation-dialog palette-save-dialog" style={saveFloating.style} role="dialog" aria-labelledby="palette-save-title" onPointerDown={saveFloating.bringToFront}><header onPointerDown={saveFloating.startDrag}><div><span className="eyebrow">PALETTE</span><h2 id="palette-save-title">{t('palette.saveTitle')}</h2></div><button type="button" className="icon-button" aria-label={t('common.close')} onClick={() => setSaveOpen(false)}><X size={16} /></button></header><div className="palette-dialog-body"><label className="palette-name-field">{t('palette.name')}<input autoFocus value={saveName} onChange={(event) => setSaveName(event.target.value)} /></label><div className="palette-save-summary"><span className="palette-library-swatches" aria-hidden="true">{orderedColors.slice(0, 24).map((color, index) => <i key={index} style={{ background: colorCss(color) }} />)}</span><strong>{t('palette.colorCount', { count: orderedColors.length })}</strong></div><p>{t('palette.directory', { directory: paletteDirectory })}</p></div><footer><button type="button" className="quiet-button" disabled={operationBusy} onClick={() => void savePaletteAsImage()}><FileImage size={15} />{t('palette.savePng')}</button><button type="button" className="primary-button" disabled={operationBusy} onClick={() => void savePaletteLocally()}><Save size={15} />{t('palette.saveToApp')}</button></footer></section>, document.body)}
  </>
}
