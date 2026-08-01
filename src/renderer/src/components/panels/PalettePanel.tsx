import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { BookOpen, FileImage, Folder, FolderOpen, LockKeyhole, Palette, Plus, Save, ScanSearch, Settings2, Trash2, X } from 'lucide-react'
import type { PaletteEntry, StoredPalette } from '@shared/types'
import { colorCss, rgbaHex } from '@/components/ColorPicker'
import { FloatingDockPreview, PanelResizeHandles, useFloatingPanel } from '@/components/floating-panel'
import { NumberInput } from '@/components/NumberInput'
import type { DockDragProps } from '@/components/workspace-panel-types'
import { encodePalettePng, extractPaletteColors, mergePaletteColors } from '@/core/palette'
import { PALETTE_SWATCH_PIXELS, paletteColorsEqual, paletteMarkerColor, paletteReorderTarget, reorderPalettePreview, type PaletteSwatchSize } from '@/core/palette-layout'
import { readStoredString, removeStoredValue, writeStoredString } from '@/core/panel-preferences'
import { colorEquals } from '@/core/raster'
import { useWorkspace, type DocumentSession } from '@/store/workspace'

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


