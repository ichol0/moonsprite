import { useEffect, useRef, useState } from 'react'
import { Combine, Copy, Eye, EyeOff, Folder, FolderMinus, FolderOpen, FolderPlus, Layers2, Lock, LockOpen, Plus, Settings2, Trash2, X } from 'lucide-react'
import type { BlendMode, LayerGroup, RasterLayer } from '@shared/types'
import { FloatingDockPreview, PanelResizeHandles, useFloatingPanel } from '@/components/floating-panel'
import { NumberInput } from '@/components/NumberInput'
import { ThemedSelect, type ThemedSelectGroup } from '@/components/ThemedSelect'
import type { DockDragProps } from '@/components/workspace-panel-types'
import { getLayerIdsInGroup } from '@/core/document'
import { buildLayerPanelTree, resolveLayerPanelDropTarget, type LayerPanelNode } from '@/core/layer-panel-layout'
import { useWorkspace, type DocumentSession } from '@/store/workspace'

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
  useEffect(() => {
    const close = (): void => closeProperties()
    window.addEventListener('moonsprite:close-dialog', close)
    return () => window.removeEventListener('moonsprite:close-dialog', close)
  })
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
  useEffect(() => {
    if (!form) return
    const keyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      closeProperties()
    }
    window.addEventListener('keydown', keyDown, true)
    return () => window.removeEventListener('keydown', keyDown, true)
  }, [form])
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
    {form && <div className="modal-backdrop" role="presentation" onPointerDown={(event) => { if (event.target === event.currentTarget) closeProperties() }}><form className="modal layer-modal" onSubmit={(event) => { event.preventDefault(); closeProperties() }} onKeyDown={(event) => { if (event.key !== 'Enter' || event.nativeEvent.isComposing || (event.target as HTMLElement).tagName === 'TEXTAREA') return; event.preventDefault(); event.stopPropagation(); closeProperties() }}><header><div><span className="eyebrow">{form.kind === 'group' ? 'GROUP PROPERTIES' : 'LAYER PROPERTIES'}</span><h2>{form.kind === 'group' ? '图层组属性' : '图层属性'}</h2></div><button type="button" className="icon-button" aria-label="关闭" onClick={closeProperties}><X size={16} /></button></header><div className="modal-body"><label>名称<input autoFocus value={form.name} onChange={(event) => previewProperties({ ...form, name: event.target.value })} /></label><label>混合模式<ThemedSelect label="混合模式" value={form.blendMode} groups={blendOptionGroups} onChange={(blendMode) => previewProperties({ ...form, blendMode })} /></label><label>不透明度<div className="layer-opacity-control"><input aria-label="不透明度" type="range" min="0" max="100" step="1" value={form.opacity} onChange={(event) => previewProperties({ ...form, opacity: Number(event.target.value) })} /><NumberInput aria-label="不透明度数值" min={0} max={100} value={form.opacity} onValueChange={(opacity) => previewProperties({ ...form, opacity })} /><span>%</span></div></label></div></form></div>}
    {floating.style && <PanelResizeHandles onResize={floating.startResize} />}
  </section>
  <FloatingDockPreview style={floating.dockPreview} />
  </>
}
