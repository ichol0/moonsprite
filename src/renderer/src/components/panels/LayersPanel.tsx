import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Clock3, FilePlus2, Layers2, Link2 } from 'lucide-react'
import type { AnimationCel, AnimationCelSurface, BlendMode, LayerGroup, PaletteEntry, RasterLayer, RgbaColor } from '@shared/types'
import { FloatingDockPreview, PanelResizeHandles, useFloatingPanel } from '@/components/floating-panel'
import { ColorValueControl } from '@/components/ColorValueControl'
import { ModalShell } from '@/components/ModalShell'
import { NumberInput } from '@/components/NumberInput'
import { TextAreaInput } from '@/components/TextAreaInput'
import { ThemedSelect, type ThemedSelectGroup } from '@/components/ThemedSelect'
import { Tooltip } from '@/components/Tooltip'
import type { DockDragProps } from '@/components/workspace-panel-types'
import { getDescendantGroupIds, getGroupLockingAncestor, getLayerIdsInGroup, getLayerLockingGroup, isGroupEffectivelyLocked, isLayerEffectivelyLocked } from '@/core/document'
import { buildLayerPanelTree, getLayerPanelAncestorGroupIds, layerPanelRevealScrollTop, resolveLayerPanelDropTarget, resolveLayerPanelEdgeDropTarget, type LayerPanelNode } from '@/core/layer-panel-layout'
import { DEFAULT_ONION_SKIN_PREFERENCES, loadEditorPreferences, saveEditorPreferences, type OnionSkinPreferences } from '@/core/file-preferences'
import { animationCelHasContent, animationCelKey, createAnimationCelLookup, ensureAnimationDocument, parseAnimationCelKey } from '@/core/animation'
import { renderAnimationCelThumbnailPixels } from '@/core/animation-thumbnail'
import { DEFAULT_SHORTCUTS, loadShortcuts, type ShortcutId } from '@/core/shortcuts'
import { useWorkspace, type DocumentSession } from '@/store/workspace'
import { useI18n } from '@/components/I18nProvider'
import { AnimationPlaybackMenu } from '@/components/AnimationPlaybackMenu'
import { PlaybackPixelIcon } from '@/components/PlaybackPixelIcon'
import { PixelUtilityIcon, type PixelUtilityIconKind } from '@/components/PixelUtilityIcon'
import { LAYER_PANEL_REVEAL_EVENT, type LayerPanelRevealDetail } from '@/components/layer-panel-reveal'

interface LayerFormTarget { id: string; kind: 'layer' | 'group' }
type BatchProperty = 'name' | 'opacity' | 'blendMode' | 'displayColor' | 'description'
interface LayerFormState { id: string; kind: 'layer' | 'group'; targets: LayerFormTarget[]; batchChanges: BatchProperty[]; name: string; opacity: number; blendMode: BlendMode; locked: boolean; displayColor: RgbaColor | null; description: string }
interface LayerPropertySnapshot extends LayerFormTarget { name: string; opacity: number; blendMode: BlendMode; locked: boolean; displayColor: RgbaColor | null; description: string }
interface LayerDragState { ids: string[]; groupIds: string[]; groupId?: string; row: LayerFormTarget; preserveSelection: boolean; selectedLayerIds: string[]; selectedGroupIds: string[]; wholeGroupSelection: boolean; startX: number; startY: number; moved: boolean; copy: boolean }
type DropTarget = { kind: 'layer'; id: string; insertAfter?: boolean; depth: number } | { kind: 'group'; id: string; depth: number } | { kind: 'above-group'; id: string; insertAfter?: boolean; depth: number } | { kind: 'edge'; edge: 'top' | 'bottom'; offset?: number }
interface LayerContextMenu { kind: 'layer' | 'group'; id: string; x: number; y: number }
function LayerContextMenuItem({ icon, label, shortcut, onClick, danger = false }: { icon: PixelUtilityIconKind; label: ReactNode; shortcut?: ReactNode; onClick: () => void; danger?: boolean }) {
  return <button role="menuitem" className={danger ? 'danger' : undefined} onClick={onClick}><span className="layer-context-icon"><PixelUtilityIcon kind={icon} /></span><span className="layer-context-label">{label}</span>{shortcut}</button>
}
type AnimationContextMenu = { kind: 'playback'; x: number; y: number } | { kind: 'frame'; frameId: string; x: number; y: number } | { kind: 'cel'; layerId: string; frameId: string; x: number; y: number }
type LayerDisplayDensity = 'compact' | 'normal' | 'detailed' | 'expanded' | 'large' | 'huge'
interface LayerDragGhost { y: number; items?: Array<{ id: string; kind: 'layer' | 'group'; name: string }>; name?: string; count: number }
type AnimationPointerDrag =
  | { kind: 'frame'; sourceFrameId: string; frameIds: string[]; preserveSelection: boolean; startX: number; startY: number; moved: boolean; canMove: boolean; pendingSelection: boolean; longPressed: boolean; longPressTimer: number | null; lastSelectionTarget: string }
  | { kind: 'cel'; sourceAnchorKey: string; cellKeys: string[]; preserveSelection: boolean; startX: number; startY: number; moved: boolean; canMove: boolean; pendingSelection: boolean; longPressed: boolean; longPressTimer: number | null; lastSelectionTarget: string }
type AnimationGestureSelection = { kind: 'frame'; ids: string[] } | { kind: 'cel'; keys: string[] }
type LayerTreeNode = LayerPanelNode & ({ kind: 'layer'; layer: RasterLayer } | { kind: 'group'; group: LayerGroup })
const defaultLayerDisplayColor: RgbaColor = { r: 41, g: 121, b: 255, a: 255 }
const layerLabelWidthKey = 'moonsprite.layers.label-width'
const layerDensityKey = 'moonsprite.layers.display-density'
const layerLabelWidthLimits = { min: 140, max: 2_000 }
const layerDensityOrder: LayerDisplayDensity[] = ['compact', 'normal', 'detailed', 'expanded', 'large', 'huge']
const layerDensityLabelKeys = {
  compact: 'layers.density.compact',
  normal: 'layers.density.normal',
  detailed: 'layers.density.detailed',
  expanded: 'layers.density.expanded',
  large: 'layers.density.large',
  huge: 'layers.density.huge'
} as const
const clampLayerLabelWidth = (value: number): number => Math.max(layerLabelWidthLimits.min, Math.min(layerLabelWidthLimits.max, Math.round(value)))
const loadLayerLabelWidth = (): number => clampLayerLabelWidth(Number(localStorage.getItem(layerLabelWidthKey)) || 190)
const loadLayerDensity = (): LayerDisplayDensity => {
  const value = localStorage.getItem(layerDensityKey)
  return layerDensityOrder.includes(value as LayerDisplayDensity) ? value as LayerDisplayDensity : 'normal'
}
type CelPixelBuffer = AnimationCelSurface['pixels']
const celContentCache = new WeakMap<CelPixelBuffer, Map<string, { revision: number; value: boolean }>>()
const celThumbnailCache = new WeakMap<CelPixelBuffer, Map<string, { revision: number; pixels: Uint8ClampedArray }>>()
const paletteVisibilityKey = (palette: readonly PaletteEntry[]): string => palette.map((entry) => `${entry.id}:${entry.color.a}`).join(',')
const paletteRenderKey = (palette: readonly PaletteEntry[]): string => palette.map((entry) => `${entry.id}:${entry.color.r},${entry.color.g},${entry.color.b},${entry.color.a}`).join('|')
const cachedCelHasContent = (cel: AnimationCel | null, palette: readonly PaletteEntry[], revision = 0): boolean => {
  const surface = cel?.surface
  if (!surface) return false
  const key = surface.format === 'rgba' ? 'rgba' : paletteVisibilityKey(palette)
  const entries = celContentCache.get(surface.pixels) ?? new Map<string, { revision: number; value: boolean }>()
  const cached = entries.get(key)
  if (cached && (revision === 0 || cached.revision === revision)) return cached.value
  const value = animationCelHasContent(cel, palette)
  entries.set(key, { revision, value })
  celContentCache.set(surface.pixels, entries)
  return value
}
function CelThumbnail({ cel, palette, revision, documentWidth, documentHeight, thumbnailSize }: { cel: AnimationCel; palette: readonly PaletteEntry[]; revision: number; documentWidth: number; documentHeight: number; thumbnailSize: number }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const canvas = ref.current
    const surface = cel.surface
    if (!canvas || !surface) return
    if (typeof navigator !== 'undefined' && /jsdom/i.test(navigator.userAgent)) return
    try {
      const context = canvas.getContext('2d')
      if (!context) return
      const key = `${documentWidth}:${documentHeight}:${canvas.width}:${surface.width}:${surface.height}:${surface.offsetX}:${surface.offsetY}:${cel.opacity ?? 1}:${surface.format === 'rgba' ? 'rgba' : paletteRenderKey(palette)}`
      const entries = celThumbnailCache.get(surface.pixels) ?? new Map<string, { revision: number; pixels: Uint8ClampedArray }>()
      const cached = entries.get(key)
      const pixels = cached && (revision === 0 || cached.revision === revision)
        ? cached.pixels
        : renderAnimationCelThumbnailPixels(documentWidth, documentHeight, canvas.width, surface, palette, cel.opacity ?? 1)
      if (!cached || pixels !== cached.pixels) {
        entries.set(key, { revision, pixels })
        celThumbnailCache.set(surface.pixels, entries)
      }
      const image = context.createImageData(canvas.width, canvas.height)
      image.data.set(pixels)
      context.putImageData(image, 0, 0)
    } catch {
      // Canvas rendering is unavailable in a few test and recovery environments.
    }
  }, [cel, palette, revision, documentWidth, documentHeight, thumbnailSize])
  return <span className="cel-thumbnail" aria-hidden="true"><canvas ref={ref} width={thumbnailSize} height={thumbnailSize} /></span>
}
function ActiveCelContent({ documentId, cel, palette, revision, documentWidth, documentHeight, thumbnailSize, showThumbnail }: {
  documentId: string
  cel: AnimationCel
  palette: readonly PaletteEntry[]
  revision: number
  documentWidth: number
  documentHeight: number
  thumbnailSize: number
  showThumbnail: boolean
}) {
  const liveRevision = useWorkspace((state) => state.sessions.find((item) => item.document.id === documentId)?.contentRevision ?? revision)
  const liveSession = useWorkspace.getState().sessions.find((item) => item.document.id === documentId)
  const livePalette = liveSession?.document.palette ?? palette
  const hasContent = cachedCelHasContent(cel, livePalette, liveRevision)
  if (!hasContent) return null
  return showThumbnail
    ? <CelThumbnail cel={cel} palette={livePalette} revision={liveRevision} documentWidth={liveSession?.document.width ?? documentWidth} documentHeight={liveSession?.document.height ?? documentHeight} thumbnailSize={thumbnailSize} />
    : <span className="cel-content-marker" />
}
function ActiveFrameSync({ documentId, frameIds, containerRef }: {
  documentId: string
  frameIds: readonly string[]
  containerRef: { current: HTMLDivElement | null }
}) {
  const { t } = useI18n()
  const activeFrameId = useWorkspace((state) => state.sessions.find((item) => item.document.id === documentId)?.document.animation?.activeFrameId ?? frameIds[0] ?? '')
  const activeFrameIndex = Math.max(0, frameIds.indexOf(activeFrameId))
  const previousFrameIndexRef = useRef(activeFrameIndex)
  useLayoutEffect(() => {
    const root = containerRef.current
    if (!root) return
    const updateColumn = (frameIndex: number, active: boolean): void => {
      const header = root.querySelector<HTMLElement>(`.layer-animation-frame-header[data-frame-index="${frameIndex}"]`)
      header?.classList.toggle('active', active)
      for (const cell of root.querySelectorAll<HTMLElement>(`.layer-animation-cel[data-frame-index="${frameIndex}"]`)) {
        cell.classList.toggle('active-frame', active)
        cell.classList.toggle('current-cel', active && cell.classList.contains('selected-layer'))
      }
    }
    const previousFrameIndex = previousFrameIndexRef.current
    if (previousFrameIndex !== activeFrameIndex) updateColumn(previousFrameIndex, false)
    updateColumn(activeFrameIndex, true)
    previousFrameIndexRef.current = activeFrameIndex
  }, [activeFrameId, activeFrameIndex, containerRef])
  return <span>{t('timeline.frameNumber', { number: activeFrameIndex + 1 })}</span>
}
const sameColor = (left: RgbaColor | null, right: RgbaColor | null): boolean => left === null || right === null
  ? left === right
  : left.r === right.r && left.g === right.g && left.b === right.b && left.a === right.a
const cloneFormState = (value: LayerFormState): LayerFormState => ({ ...value, targets: value.targets.map((target) => ({ ...target })), batchChanges: [...value.batchChanges], displayColor: value.displayColor ? { ...value.displayColor } : null })
const selectedRowsForDrag = (session: DocumentSession): { ids: string[]; groupIds: string[] } => {
  const selectedGroups = new Set(session.selectedGroupIds.length > 0 ? session.selectedGroupIds : session.selectedGroupId ? [session.selectedGroupId] : [])
  const groupIds = [...selectedGroups].filter((groupId) => !session.document.groups.some((candidate) => selectedGroups.has(candidate.id) && getDescendantGroupIds(session.document, candidate.id).includes(groupId)))
  const coveredGroups = new Set<string>()
  for (const groupId of groupIds) {
    coveredGroups.add(groupId)
    for (const descendantId of getDescendantGroupIds(session.document, groupId)) coveredGroups.add(descendantId)
  }
  const ids = session.selectedLayerIds.filter((layerId) => {
    const layer = session.document.layers.find((candidate) => candidate.id === layerId)
    return Boolean(layer && (!layer.groupId || !coveredGroups.has(layer.groupId)))
  })
  return { ids, groupIds }
}
const selectedRowsForProperties = (session: DocumentSession): LayerFormTarget[] => {
  const selectedGroupIds = session.selectedGroupIds.length > 0
    ? session.selectedGroupIds
    : session.selectedGroupId ? [session.selectedGroupId] : []
  const groupIds = [...new Set(selectedGroupIds)].filter((id) => session.document.groups.some((group) => group.id === id))
  const layerIds = [...new Set(session.selectedLayerIds)].filter((id) => session.document.layers.some((layer) => layer.id === id))
  return [
    ...groupIds.map((id) => ({ id, kind: 'group' as const })),
    ...layerIds.map((id) => ({ id, kind: 'layer' as const }))
  ]
}
export function LayersPanel({ session, docked = false, onDockDragStart, onPanelContextMenu, onFloatingDock }: { session: DocumentSession } & DockDragProps) {
  const { t } = useI18n()
  const blendOptions: Array<{ value: BlendMode; label: string }> = [
    { value: 'normal', label: t('blend.normal') }, { value: 'darken', label: t('blend.darken') }, { value: 'multiply', label: t('blend.multiply') },
    { value: 'color-burn', label: t('blend.colorBurn') }, { value: 'linear-burn', label: t('blend.linearBurn') }, { value: 'lighten', label: t('blend.lighten') },
    { value: 'screen', label: t('blend.screen') }, { value: 'color-dodge', label: t('blend.colorDodge') }, { value: 'linear-dodge', label: t('blend.linearDodge') },
    { value: 'overlay', label: t('blend.overlay') }, { value: 'soft-light', label: t('blend.softLight') }, { value: 'hard-light', label: t('blend.hardLight') },
    { value: 'vivid-light', label: t('blend.vividLight') }, { value: 'linear-light', label: t('blend.linearLight') }, { value: 'pin-light', label: t('blend.pinLight') },
    { value: 'hard-mix', label: t('blend.hardMix') }, { value: 'difference', label: t('blend.difference') }, { value: 'exclusion', label: t('blend.exclusion') },
    { value: 'subtract', label: t('blend.subtract') }, { value: 'divide', label: t('blend.divide') }, { value: 'hue', label: t('blend.hue') },
    { value: 'saturation', label: t('blend.saturation') }, { value: 'color', label: t('blend.color') }, { value: 'luminosity', label: t('blend.luminosity') }
  ]
  const blendOptionGroups: Array<ThemedSelectGroup<BlendMode>> = [
    { label: t('blend.group.basic'), options: blendOptions.filter((option) => option.value === 'normal') },
    { label: t('blend.group.darken'), options: blendOptions.filter((option) => ['darken', 'multiply', 'color-burn', 'linear-burn'].includes(option.value)) },
    { label: t('blend.group.lighten'), options: blendOptions.filter((option) => ['lighten', 'screen', 'color-dodge', 'linear-dodge'].includes(option.value)) },
    { label: t('blend.group.contrast'), options: blendOptions.filter((option) => ['overlay', 'soft-light', 'hard-light', 'vivid-light', 'linear-light', 'pin-light', 'hard-mix'].includes(option.value)) },
    { label: t('blend.group.compare'), options: blendOptions.filter((option) => ['difference', 'exclusion', 'subtract', 'divide'].includes(option.value)) },
    { label: t('blend.group.components'), options: blendOptions.filter((option) => ['hue', 'saturation', 'color', 'luminosity'].includes(option.value)) }
  ]
  const store = useWorkspace.getState()
  const timeline = ensureAnimationDocument(session.document)
  const celLookup = createAnimationCelLookup(timeline)
  const currentCelHasContent = (layerId: string, frameId: string): boolean => {
    const liveSession = useWorkspace.getState().sessions.find((item) => item.document.id === session.document.id)
    if (!liveSession) return false
    const liveTimeline = ensureAnimationDocument(liveSession.document)
    const liveLookup = createAnimationCelLookup(liveTimeline)
    const cel = liveLookup.at(layerId, frameId)
    return cachedCelHasContent(liveLookup.resolve(cel), liveSession.document.palette, frameId === liveTimeline.activeFrameId ? liveSession.contentRevision : 0)
  }
  const activeFrameIndex = Math.max(0, timeline.frames.findIndex((frame) => frame.id === timeline.activeFrameId))
  const floating = useFloatingPanel(null, false, true, 'moonsprite.layers-panel.v1', false, onFloatingDock, docked)
  const [form, setForm] = useState<LayerFormState | null>(null)
  const [layerDisplayColorPresets, setLayerDisplayColorPresets] = useState(() => loadEditorPreferences().layerDisplayColorPresets)
  const [shortcuts, setShortcuts] = useState(() => loadShortcuts())
  const shortcutHint = (...ids: ShortcutId[]) => {
    const value = ids.map((id) => shortcuts[id] ?? DEFAULT_SHORTCUTS[id]).filter(Boolean).join(' / ')
    return value ? <kbd aria-hidden="true">{value}</kbd> : null
  }
  const formOriginalRef = useRef<LayerFormState | null>(null)
  const formOriginalTargetsRef = useRef<LayerPropertySnapshot[]>([])
  const formWasDirtyRef = useRef(false)
  const pendingPropertyPreviewRef = useRef<LayerFormState | null>(null)
  const propertyPreviewTimerRef = useRef<number | null>(null)
  const dragRef = useRef<LayerDragState | null>(null)
  const layerListRef = useRef<HTMLDivElement>(null)
  const revealSequenceRef = useRef(0)
  const [layerRevealRequest, setLayerRevealRequest] = useState<{ layerId: string; sequence: number } | null>(null)
  const [draggingIds, setDraggingIds] = useState<string[]>([])
  const [draggingGroupId, setDraggingGroupId] = useState<string | null>(null)
  const [draggingCopy, setDraggingCopy] = useState(false)
  const [altCopyReady, setAltCopyReady] = useState(false)
  const altCopyReadyRef = useRef(false)
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null)
  const dropTargetRef = useRef<DropTarget | null>(null)
  const [dragGhost, setDragGhost] = useState<LayerDragGhost | null>(null)
  const animationPointerDragRef = useRef<AnimationPointerDrag | null>(null)
  const [animationGestureSelection, setAnimationGestureSelection] = useState<AnimationGestureSelection | null>(null)
  const suppressAnimationClickRef = useRef(false)
  const [draggingAnimationFrameIds, setDraggingAnimationFrameIds] = useState<string[]>([])
  const [draggingAnimationCellKeys, setDraggingAnimationCellKeys] = useState<string[]>([])
  const [animationCelDropTargetKey, setAnimationCelDropTargetKey] = useState<string | null>(null)
  const animationCelDropTargetKeyRef = useRef<string | null>(null)
  const animationFrameDropTargetRef = useRef<{ frameId: string; insertAfter: boolean } | null>(null)
  const [animationFrameDropTarget, setAnimationFrameDropTarget] = useState<{ frameId: string; insertAfter: boolean } | null>(null)
  const [contextMenu, setContextMenu] = useState<LayerContextMenu | null>(null)
  const [animationMenu, setAnimationMenu] = useState<AnimationContextMenu | null>(null)
  const animationMenuRef = useRef<HTMLDivElement>(null)
  const [animationMenuPosition, setAnimationMenuPosition] = useState({ left: 8, top: 8 })
  const [frameProperties, setFrameProperties] = useState<{ frameId: string; duration: number } | null>(null)
  const [celProperties, setCelProperties] = useState<{ layerId: string; frameId: string; opacity: number } | null>(null)
  const [layerSettingsOpen, setLayerSettingsOpen] = useState(false)
  const [layerSettings, setLayerSettings] = useState<{ density: LayerDisplayDensity; onionSkin: OnionSkinPreferences }>({ density: loadLayerDensity(), onionSkin: loadEditorPreferences().onionSkin })
  const [layerSettingsSlider, setLayerSettingsSlider] = useState<'previousOpacity' | 'nextOpacity' | null>(null)
  const [layerLabelWidth, setLayerLabelWidth] = useState(loadLayerLabelWidth)
  const [layerDensity, setLayerDensity] = useState<LayerDisplayDensity>(loadLayerDensity)
  const showLinkedCelVisuals = layerDensityOrder.indexOf(layerDensity) < layerDensityOrder.indexOf('detailed')
  const animationItemDragging = draggingAnimationFrameIds.length > 0 || draggingAnimationCellKeys.length > 0
  useEffect(() => {
    const revealLayer = (event: Event): void => {
      const detail = (event as CustomEvent<LayerPanelRevealDetail>).detail
      if (detail.documentId !== session.document.id) return
      const liveSession = useWorkspace.getState().sessions.find((item) => item.document.id === detail.documentId)
      const layer = liveSession?.document.layers.find((candidate) => candidate.id === detail.layerId)
      if (!liveSession || !layer) return
      const ancestorIds = new Set(getLayerPanelAncestorGroupIds(liveSession.document.groups, layer.groupId))
      if (liveSession.collapsedGroupIds.some((id) => ancestorIds.has(id))) {
        store.mutateActive((active) => {
          if (active.document.id !== detail.documentId) return
          active.collapsedGroupIds = active.collapsedGroupIds.filter((id) => !ancestorIds.has(id))
        }, false)
      }
      revealSequenceRef.current += 1
      setLayerRevealRequest({ layerId: detail.layerId, sequence: revealSequenceRef.current })
    }
    window.addEventListener(LAYER_PANEL_REVEAL_EVENT, revealLayer)
    return () => window.removeEventListener(LAYER_PANEL_REVEAL_EVENT, revealLayer)
  }, [session.document.id, store])

  useLayoutEffect(() => {
    if (!layerRevealRequest) return
    const list = layerListRef.current
    if (!list) return
    const row = Array.from(list.querySelectorAll<HTMLElement>('[data-layer-id]'))
      .find((candidate) => candidate.dataset.layerId === layerRevealRequest.layerId)
    if (!row) return
    const listBounds = list.getBoundingClientRect()
    const rowBounds = row.getBoundingClientRect()
    const stickyHeaderHeight = Number.parseFloat(getComputedStyle(list).getPropertyValue('--animation-header-height')) || 34
    list.scrollTop = layerPanelRevealScrollTop({
      scrollTop: list.scrollTop,
      viewportTop: listBounds.top,
      viewportHeight: list.clientHeight || listBounds.height,
      stickyHeaderHeight,
      rowTop: rowBounds.top,
      rowHeight: rowBounds.height
    })
  }, [layerRevealRequest])

  useLayoutEffect(() => {
    if (!animationMenu || animationMenu.kind === 'playback') return
    const menu = animationMenuRef.current
    if (!menu) return
    const place = (): void => {
      const bounds = menu.getBoundingClientRect()
      setAnimationMenuPosition({
        left: Math.max(8, Math.min(animationMenu.x, window.innerWidth - bounds.width - 8)),
        top: Math.max(8, Math.min(animationMenu.y, window.innerHeight - bounds.height - 8))
      })
    }
    place()
    window.addEventListener('resize', place)
    return () => window.removeEventListener('resize', place)
  }, [animationMenu])
  const frameRange = (anchorId: string, targetId: string): string[] => {
    const anchorIndex = timeline.frames.findIndex((frame) => frame.id === anchorId)
    const targetIndex = timeline.frames.findIndex((frame) => frame.id === targetId)
    if (anchorIndex < 0 || targetIndex < 0) return [anchorId]
    const [from, to] = anchorIndex <= targetIndex ? [anchorIndex, targetIndex] : [targetIndex, anchorIndex]
    return timeline.frames.slice(from, to + 1).map((frame) => frame.id)
  }
  const cellRange = (anchorKey: string, targetKey: string): string[] => {
    const anchor = parseAnimationCelKey(anchorKey)
    const target = parseAnimationCelKey(targetKey)
    if (!anchor || !target) return [anchorKey]
    const anchorFrame = timeline.frames.findIndex((frame) => frame.id === anchor.frameId)
    const targetFrame = timeline.frames.findIndex((frame) => frame.id === target.frameId)
    const anchorLayer = session.document.layers.findIndex((layer) => layer.id === anchor.layerId)
    const targetLayer = session.document.layers.findIndex((layer) => layer.id === target.layerId)
    if (anchorFrame < 0 || targetFrame < 0 || anchorLayer < 0 || targetLayer < 0) return [anchorKey]
    const [fromFrame, toFrame] = anchorFrame <= targetFrame ? [anchorFrame, targetFrame] : [targetFrame, anchorFrame]
    const [fromLayer, toLayer] = anchorLayer <= targetLayer ? [anchorLayer, targetLayer] : [targetLayer, anchorLayer]
    const keys: string[] = []
    for (const layer of session.document.layers.slice(fromLayer, toLayer + 1)) for (const frame of timeline.frames.slice(fromFrame, toFrame + 1)) keys.push(animationCelKey(layer.id, frame.id))
    return keys
  }
  const openLayerSettings = (): void => {
    setLayerSettings({ density: layerDensity, onionSkin: loadEditorPreferences().onionSkin })
    setLayerSettingsSlider(null)
    setLayerSettingsOpen(true)
  }
  const applyLayerSettings = (next: { density: LayerDisplayDensity; onionSkin: OnionSkinPreferences }): void => {
    setLayerSettings(next)
    setLayerDensity(next.density)
    localStorage.setItem(layerDensityKey, next.density)
    saveEditorPreferences({ ...loadEditorPreferences(), onionSkin: next.onionSkin })
    window.dispatchEvent(new Event('moonsprite:preferences-changed'))
  }
  const saveLayerSettings = (): void => {
    applyLayerSettings(layerSettings)
    setLayerSettingsOpen(false)
  }
  const resetLayerSettings = (): void => applyLayerSettings({
    density: 'normal',
    onionSkin: {
      ...DEFAULT_ONION_SKIN_PREFERENCES,
      previousColor: { ...DEFAULT_ONION_SKIN_PREFERENCES.previousColor },
      nextColor: { ...DEFAULT_ONION_SKIN_PREFERENCES.nextColor }
    }
  })
  const toggleOnionSkin = (): void => {
    const current = loadEditorPreferences().onionSkin
    applyLayerSettings({ density: layerDensity, onionSkin: { ...current, enabled: !current.enabled } })
  }
  const selectAnimationFrame = (frameId: string, mode: 'replace' | 'toggle' | 'range' = 'replace'): void => {
    store.setAnimationPlaying(false)
    store.selectAnimationFrame(frameId, mode)
  }
  const selectAnimationEdge = (edge: 'first' | 'last'): void => {
    const frame = edge === 'first' ? timeline.frames[0] : timeline.frames.at(-1)
    if (frame) selectAnimationFrame(frame.id)
  }
  const selectAnimationStep = (delta: number): void => {
    const index = Math.max(0, Math.min(timeline.frames.length - 1, activeFrameIndex + delta))
    selectAnimationFrame(timeline.frames[index].id)
  }
  const setStoredLayerLabelWidth = (value: number): void => {
    const next = clampLayerLabelWidth(value)
    setLayerLabelWidth(next)
    localStorage.setItem(layerLabelWidthKey, String(next))
  }
  const beginLayerLabelResize = (event: React.PointerEvent<HTMLElement>): void => {
    if (event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    document.body.classList.add('layer-column-resizing')
    const startX = event.clientX
    const startWidth = layerLabelWidth
    const move = (moveEvent: PointerEvent): void => setStoredLayerLabelWidth(startWidth + moveEvent.clientX - startX)
    const end = (): void => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', end)
      window.removeEventListener('pointercancel', end)
      document.body.classList.remove('layer-column-resizing')
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', end)
    window.addEventListener('pointercancel', end)
  }
  const changeLayerDensity = (direction: -1 | 1): void => {
    setLayerDensity((current) => {
      const index = layerDensityOrder.indexOf(current)
      const next = layerDensityOrder[Math.max(0, Math.min(layerDensityOrder.length - 1, index + direction))]
      localStorage.setItem(layerDensityKey, next)
      return next
    })
  }
  const handleLayerPanelWheel = (event: React.WheelEvent<HTMLElement>): void => {
    if (event.altKey && (event.deltaX !== 0 || event.deltaY !== 0)) {
      event.preventDefault()
      event.stopPropagation()
      if (layerListRef.current) layerListRef.current.scrollLeft += event.deltaX || event.deltaY
      return
    }
    if (!event.ctrlKey || event.deltaY === 0) return
    event.preventDefault()
    event.stopPropagation()
    changeLayerDensity(event.deltaY < 0 ? 1 : -1)
  }
  const openAnimationMenu = (event: React.MouseEvent<HTMLElement>, menu: AnimationContextMenu): void => {
    event.preventDefault()
    event.stopPropagation()
    setContextMenu(null)
    setAnimationMenuPosition({ left: event.clientX, top: event.clientY })
    setAnimationMenu(menu)
  }
  const openFrameMenu = (event: React.MouseEvent<HTMLElement>, frameId: string): void => {
    if (!session.selectedAnimationFrameIds.includes(frameId)) selectAnimationFrame(frameId)
    openAnimationMenu(event, { kind: 'frame', frameId, x: event.clientX, y: event.clientY })
  }
  const useFrameMenuTarget = (action: () => void): void => {
    if (animationMenu?.kind !== 'frame') return
    if (ensureAnimationDocument(session.document).activeFrameId !== animationMenu.frameId) store.setActiveAnimationFrame(animationMenu.frameId)
    action()
    setAnimationMenu(null)
  }
  const openFrameProperties = (): void => useFrameMenuTarget(() => {
    const frame = ensureAnimationDocument(session.document).frames.find((candidate) => candidate.id === ensureAnimationDocument(session.document).activeFrameId)
    if (frame) setFrameProperties({ frameId: frame.id, duration: frame.duration })
  })
  const openFramePropertiesFor = (frameId: string): void => {
    const frame = ensureAnimationDocument(session.document).frames.find((candidate) => candidate.id === frameId)
    if (!frame) return
    if (ensureAnimationDocument(session.document).activeFrameId !== frameId) store.setActiveAnimationFrame(frameId)
    setFrameProperties({ frameId: frame.id, duration: frame.duration })
    setAnimationMenu(null)
  }
  const saveFrameProperties = (): void => {
    if (!frameProperties) return
    if (ensureAnimationDocument(session.document).activeFrameId !== frameProperties.frameId) store.setActiveAnimationFrame(frameProperties.frameId)
    store.setActiveAnimationFrameDuration(frameProperties.duration)
    setFrameProperties(null)
  }
  const openCelProperties = (layerId: string, frameId: string): void => {
    const cel = celLookup.at(layerId, frameId)
    if (!currentCelHasContent(layerId, frameId)) return
    store.selectAnimationCell(animationCelKey(layerId, frameId))
    setCelProperties({ layerId, frameId, opacity: Math.round((cel?.opacity ?? 1) * 100) })
    setAnimationMenu(null)
  }
  const saveCelProperties = (): void => {
    if (!celProperties) return
    store.setAnimationCelOpacity(celProperties.layerId, celProperties.frameId, celProperties.opacity / 100)
    setCelProperties(null)
  }
  const openCelMenu = (event: React.MouseEvent<HTMLElement>, layerId: string, frameId: string): void => {
    const key = animationCelKey(layerId, frameId)
    if (!session.selectedAnimationCellKeys.includes(key)) store.selectAnimationCell(key)
    openAnimationMenu(event, { kind: 'cel', layerId, frameId, x: event.clientX, y: event.clientY })
  }
  const pointerHitsSelectionOutline = (event: React.PointerEvent<HTMLElement>, selector: string): boolean => {
    const outline = layerListRef.current?.querySelector<HTMLElement>(selector)
    if (!outline) return false
    const bounds = outline.getBoundingClientRect()
    if (bounds.width <= 0 || bounds.height <= 0) return false
    const inset = 6
    const inside = event.clientX >= bounds.left && event.clientX <= bounds.right && event.clientY >= bounds.top && event.clientY <= bounds.bottom
    return inside && (event.clientX - bounds.left <= inset || bounds.right - event.clientX <= inset || event.clientY - bounds.top <= inset || bounds.bottom - event.clientY <= inset)
  }
  const cancelAnimationPointerDrag = (): void => {
    const drag = animationPointerDragRef.current
    if (drag && drag.longPressTimer !== null) window.clearTimeout(drag.longPressTimer)
    animationPointerDragRef.current = null
    animationFrameDropTargetRef.current = null
    animationCelDropTargetKeyRef.current = null
    setAnimationFrameDropTarget(null)
    setAnimationCelDropTargetKey(null)
    setDraggingAnimationFrameIds([])
    setDraggingAnimationCellKeys([])
    setAnimationGestureSelection(null)
  }
  const beginAnimationFrameDrag = (event: React.PointerEvent<HTMLElement>, frameId: string): void => {
    if (event.button !== 0) return
    const selected = session.selectedAnimationFrameIds.includes(frameId)
    const preserveSelection = event.shiftKey || event.ctrlKey
    if (preserveSelection) {
      cancelAnimationPointerDrag()
      selectAnimationFrame(frameId, event.shiftKey ? 'range' : 'toggle')
      event.preventDefault()
      return
    }
    const canMove = selected && pointerHitsSelectionOutline(event, `[data-animation-frame-selection~="${frameId}"]`)
    const active = useWorkspace.getState().sessions.find((item) => item.document.id === session.document.id)
    const drag: AnimationPointerDrag = {
      kind: 'frame',
      sourceFrameId: frameId,
      frameIds: canMove ? [...(active?.selectedAnimationFrameIds ?? [frameId])] : [frameId],
      preserveSelection,
      startX: event.clientX,
      startY: event.clientY,
      moved: false,
      canMove,
      pendingSelection: !canMove && !selected,
      longPressed: false,
      longPressTimer: null,
      lastSelectionTarget: frameId
    }
    setAnimationGestureSelection(null)
    if (!canMove) drag.longPressTimer = window.setTimeout(() => {
      if (drag.pendingSelection) selectAnimationFrame(frameId, 'toggle')
      drag.pendingSelection = false
      drag.longPressed = true
      drag.longPressTimer = null
    }, 360)
    animationPointerDragRef.current = drag
    event.preventDefault()
  }
  const beginAnimationCelDrag = (event: React.PointerEvent<HTMLButtonElement>, layerId: string, frameId: string): void => {
    if (event.button !== 0) return
    if (session.selectedAnimationFrameIds.includes(frameId) && pointerHitsSelectionOutline(event, `[data-animation-frame-selection~="${frameId}"]`)) {
      beginAnimationFrameDrag(event, frameId)
      return
    }
    const key = animationCelKey(layerId, frameId)
    const selected = session.selectedAnimationCellKeys.includes(key)
    const preserveSelection = event.shiftKey || event.ctrlKey
    if (preserveSelection) {
      cancelAnimationPointerDrag()
      store.selectAnimationCell(key, event.shiftKey ? 'range' : 'toggle')
      event.preventDefault()
      return
    }
    const canMove = selected && currentCelHasContent(layerId, frameId) && pointerHitsSelectionOutline(event, '[data-animation-cel-selection]')
    const active = useWorkspace.getState().sessions.find((item) => item.document.id === session.document.id)
    const drag: AnimationPointerDrag = {
      kind: 'cel',
      sourceAnchorKey: key,
      cellKeys: canMove ? [...(active?.selectedAnimationCellKeys ?? [key])] : [key],
      preserveSelection,
      startX: event.clientX,
      startY: event.clientY,
      moved: false,
      canMove,
      pendingSelection: !canMove && !selected,
      longPressed: false,
      longPressTimer: null,
      lastSelectionTarget: key
    }
    setAnimationGestureSelection(null)
    if (!canMove) drag.longPressTimer = window.setTimeout(() => {
      if (drag.pendingSelection) store.selectAnimationCell(key, 'toggle')
      drag.pendingSelection = false
      drag.longPressed = true
      drag.longPressTimer = null
    }, 360)
    animationPointerDragRef.current = drag
    event.preventDefault()
  }
  const pointerTargetElement = (event: PointerEvent): Element | null => {
    const pointed = typeof document.elementFromPoint === 'function' ? document.elementFromPoint(event.clientX, event.clientY) : null
    const animationTarget = pointed?.closest('[data-animation-frame-id], [data-animation-cel-key]')
    if (animationTarget) return animationTarget
    return event.target instanceof Element ? event.target : pointed
  }
  const animationFrameTarget = (target: Element | null): { frameId: string; element: HTMLElement } | null => {
    const header = target?.closest<HTMLElement>('[data-animation-frame-id]')
    if (header?.dataset.animationFrameId) return { frameId: header.dataset.animationFrameId, element: header }
    const cell = target?.closest<HTMLElement>('[data-animation-cel-key]')
    const parsed = cell?.dataset.animationCelKey ? parseAnimationCelKey(cell.dataset.animationCelKey) : null
    return cell && parsed ? { frameId: parsed.frameId, element: cell } : null
  }
  const updateAnimationItemCursor = (event: React.PointerEvent<HTMLElement>, frameId: string, cellKey?: string): void => {
    const frameMove = session.selectedAnimationFrameIds.includes(frameId) && pointerHitsSelectionOutline(event, `[data-animation-frame-selection~="${frameId}"]`)
    const parsed = cellKey ? parseAnimationCelKey(cellKey) : null
    const cellMove = Boolean(parsed && currentCelHasContent(parsed.layerId, parsed.frameId) && session.selectedAnimationCellKeys.includes(cellKey!) && pointerHitsSelectionOutline(event, '[data-animation-cel-selection]'))
    event.currentTarget.style.cursor = frameMove || cellMove ? 'var(--cursor-move)' : ''
  }
  const moveAnimationPointerDrag = (event: PointerEvent): void => {
    const drag = animationPointerDragRef.current
    if (!drag) return
    if (!drag.canMove) {
      const target = pointerTargetElement(event)
      if (drag.kind === 'frame') {
        const frameId = animationFrameTarget(target)?.frameId
        if (frameId && Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) >= 4 && frameId !== drag.lastSelectionTarget) {
          if (drag.longPressTimer !== null) window.clearTimeout(drag.longPressTimer)
          drag.longPressTimer = null
          drag.longPressed = true
          drag.pendingSelection = false
          drag.lastSelectionTarget = frameId
          setAnimationGestureSelection({ kind: 'frame', ids: frameRange(drag.sourceFrameId, frameId) })
        }
      } else {
        const key = target?.closest<HTMLElement>('[data-animation-cel-key]')?.dataset.animationCelKey
        if (key && Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) >= 4 && key !== drag.lastSelectionTarget) {
          if (drag.longPressTimer !== null) window.clearTimeout(drag.longPressTimer)
          drag.longPressTimer = null
          drag.longPressed = true
          drag.pendingSelection = false
          drag.lastSelectionTarget = key
          setAnimationGestureSelection({ kind: 'cel', keys: cellRange(drag.sourceAnchorKey, key) })
        }
      }
      return
    }
    if (!drag.moved && Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < 4) return
    if (!drag.moved) {
      drag.moved = true
      if (drag.kind === 'frame') setDraggingAnimationFrameIds(drag.frameIds)
      else setDraggingAnimationCellKeys(drag.cellKeys)
    }
    const list = layerListRef.current
    if (list) {
      const bounds = list.getBoundingClientRect()
      if (event.clientX > bounds.right - 30) list.scrollLeft += 18
      else if (event.clientX < bounds.left + 30) list.scrollLeft -= 18
    }
    const pointed = typeof document.elementFromPoint === 'function' ? document.elementFromPoint(event.clientX, event.clientY) : null
    const target = pointed?.closest('[data-animation-frame-id], [data-animation-cel-key]') ? pointed : pointerTargetElement(event)
    if (drag.kind === 'frame') {
      if (target?.closest('.layer-animation-corner')) {
        animationFrameDropTargetRef.current = null
        setAnimationFrameDropTarget(null)
        return
      }
      const frameTarget = animationFrameTarget(target)
      if (!frameTarget) {
        animationFrameDropTargetRef.current = null
        setAnimationFrameDropTarget(null)
        return
      }
      const { frameId, element } = frameTarget
      const bounds = element.getBoundingClientRect()
      const next = { frameId, insertAfter: event.clientX >= bounds.left + bounds.width / 2 }
      animationFrameDropTargetRef.current = next
      setAnimationFrameDropTarget(next)
      return
    }
    const cell = target?.closest<HTMLElement>('[data-animation-cel-key]')
    const key = cell?.dataset.animationCelKey ?? null
    animationCelDropTargetKeyRef.current = key
    setAnimationCelDropTargetKey(key)
  }
  const finishAnimationPointerDrag = (): void => {
    const drag = animationPointerDragRef.current
    if (!drag) return
    if (drag.longPressTimer !== null) window.clearTimeout(drag.longPressTimer)
    if (drag.moved) {
      if (drag.kind === 'frame' && animationFrameDropTargetRef.current) {
        store.moveSelectedAnimationFrames(animationFrameDropTargetRef.current.frameId, animationFrameDropTargetRef.current.insertAfter)
      } else if (drag.kind === 'cel' && animationCelDropTargetKeyRef.current) {
        const targetKey = animationCelDropTargetKeyRef.current
        const target = targetKey.lastIndexOf(':')
        if (target > 0) store.moveSelectedAnimationCels(targetKey.slice(0, target), targetKey.slice(target + 1), drag.sourceAnchorKey)
      }
      suppressAnimationClickRef.current = true
      window.setTimeout(() => { suppressAnimationClickRef.current = false }, 0)
    } else if (drag.longPressed) {
      if (drag.kind === 'frame') {
        const active = useWorkspace.getState().sessions.find((item) => item.document.id === session.document.id)
        if (!active?.selectedAnimationFrameIds.includes(drag.sourceFrameId)) store.selectAnimationFrame(drag.sourceFrameId, 'replace')
        if (drag.lastSelectionTarget !== drag.sourceFrameId) store.selectAnimationFrame(drag.lastSelectionTarget, 'range')
      } else {
        const active = useWorkspace.getState().sessions.find((item) => item.document.id === session.document.id)
        if (!active?.selectedAnimationCellKeys.includes(drag.sourceAnchorKey)) store.selectAnimationCell(drag.sourceAnchorKey, 'replace')
        if (drag.lastSelectionTarget !== drag.sourceAnchorKey) store.selectAnimationCell(drag.lastSelectionTarget, 'range')
      }
    } else if (!drag.preserveSelection) {
      if (drag.kind === 'frame') selectAnimationFrame(drag.sourceFrameId)
      else store.selectAnimationCell(drag.sourceAnchorKey)
    }
    animationPointerDragRef.current = null
    animationFrameDropTargetRef.current = null
    animationCelDropTargetKeyRef.current = null
    setAnimationFrameDropTarget(null)
    setAnimationCelDropTargetKey(null)
    setDraggingAnimationFrameIds([])
    setDraggingAnimationCellKeys([])
    setAnimationGestureSelection(null)
  }
  const clearTransientLayerDrag = (): void => {
    dragRef.current = null
    setDraggingIds([])
    setDraggingGroupId(null)
    setDraggingCopy(false)
    dropTargetRef.current = null
    setDropTarget(null)
    setDragGhost(null)
  }
  useEffect(() => {
    document.body.classList.toggle('animation-item-dragging', animationItemDragging)
    return () => { document.body.classList.remove('animation-item-dragging') }
  }, [animationItemDragging])
  useEffect(() => () => { document.body.classList.remove('layer-column-resizing') }, [])
  useEffect(() => {
    const clearOutsideSelection = (event: PointerEvent): void => {
      const target = event.target instanceof Element ? event.target : null
      if (target?.closest('[data-animation-frame-id], [data-animation-cel-key], .animation-context-menu, .frame-properties-modal, .cel-properties-modal')) return
      const active = useWorkspace.getState().sessions.find((item) => item.document.id === session.document.id)
      if (active && (active.selectedAnimationFrameIds.length > 0 || active.selectedAnimationCellKeys.length > 0)) {
        setAnimationGestureSelection(null)
        store.clearAnimationSelection()
      }
    }
    window.addEventListener('pointerdown', clearOutsideSelection, true)
    return () => window.removeEventListener('pointerdown', clearOutsideSelection, true)
  }, [session.document.id, store])
  useEffect(() => {
    const closeMenus = (): void => { setContextMenu(null); setAnimationMenu(null); setAnimationFrameDropTarget(null) }
    const keyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      closeMenus()
      setFrameProperties(null)
      setCelProperties(null)
    }
    window.addEventListener('pointerdown', closeMenus)
    window.addEventListener('resize', closeMenus)
    window.addEventListener('keydown', keyDown)
    return () => { window.removeEventListener('pointerdown', closeMenus); window.removeEventListener('resize', closeMenus); window.removeEventListener('keydown', keyDown) }
  }, [])
  useEffect(() => {
    const refreshPresets = (): void => setLayerDisplayColorPresets(loadEditorPreferences().layerDisplayColorPresets)
    window.addEventListener('moonsprite:preferences-changed', refreshPresets)
    return () => window.removeEventListener('moonsprite:preferences-changed', refreshPresets)
  }, [])
  useEffect(() => {
    const refreshShortcuts = (): void => setShortcuts(loadShortcuts())
    window.addEventListener('moonsprite:shortcuts-changed', refreshShortcuts)
    return () => window.removeEventListener('moonsprite:shortcuts-changed', refreshShortcuts)
  }, [])
  useEffect(() => {
    const syncAltCopy = (active: boolean): void => {
      if (altCopyReadyRef.current === active) return
      altCopyReadyRef.current = active
      setAltCopyReady(active)
    }
    const keyDown = (event: KeyboardEvent): void => { if (event.key === 'Alt') syncAltCopy(true) }
    const keyUp = (event: KeyboardEvent): void => { if (event.key === 'Alt') syncAltCopy(false) }
    const pointerMove = (event: PointerEvent): void => { syncAltCopy(event.altKey) }
    const blur = (): void => {
      syncAltCopy(false)
      clearTransientLayerDrag()
    }
    altCopyReadyRef.current = false
    setAltCopyReady(false)
    clearTransientLayerDrag()
    window.addEventListener('keydown', keyDown)
    window.addEventListener('keyup', keyUp)
    window.addEventListener('pointermove', pointerMove)
    window.addEventListener('blur', blur)
    return () => { window.removeEventListener('keydown', keyDown); window.removeEventListener('keyup', keyUp); window.removeEventListener('pointermove', pointerMove); window.removeEventListener('blur', blur) }
  }, [])
  useEffect(() => {
    const close = (event: Event): void => {
      const target = (event as CustomEvent<{ target?: string }>).detail?.target
      if (!target || target === 'layers') {
        closeProperties()
         setFrameProperties(null)
         setCelProperties(null)
        setLayerSettingsOpen(false)
        setAnimationMenu(null)
      }
    }
    window.addEventListener('moonsprite:close-dialog', close)
    return () => window.removeEventListener('moonsprite:close-dialog', close)
  })
  const layerById = new Map(session.document.layers.map((layer) => [layer.id, layer]))
  const groupById = new Map(session.document.groups.map((group) => [group.id, group]))
  const effectiveDisplayColor = (target: RasterLayer | LayerGroup, kind: 'layer' | 'group'): RgbaColor | undefined => {
    let groupId = kind === 'group' ? target.id : (target as RasterLayer).groupId ?? null
    const visited = new Set<string>()
    const ancestry: LayerGroup[] = []
    while (groupId && !visited.has(groupId)) {
      visited.add(groupId)
      const group = groupById.get(groupId)
      if (!group) break
      ancestry.push(group)
      groupId = group.parentGroupId ?? null
    }
    for (let index = ancestry.length - 1; index >= 0; index -= 1) {
      if (ancestry[index].displayColor) return ancestry[index].displayColor
    }
    return kind === 'layer' ? (target as RasterLayer).displayColor : undefined
  }
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
  const renderedFrameIds = animationGestureSelection
    ? animationGestureSelection.kind === 'frame' ? animationGestureSelection.ids : []
    : session.selectedAnimationFrameIds
  const renderedCellKeys = animationGestureSelection
    ? animationGestureSelection.kind === 'cel' ? animationGestureSelection.keys : []
    : session.selectedAnimationCellKeys
  const selectedFrameIndexes = timeline.frames
    .map((frame, index) => renderedFrameIds.includes(frame.id) ? index : -1)
    .filter((index) => index >= 0)
  const selectedFrameIndexSet = new Set(selectedFrameIndexes)
  const selectedFrameRanges = selectedFrameIndexes.reduce<Array<{ start: number; span: number }>>((ranges, index) => {
    const previous = ranges.at(-1)
    if (previous && index === previous.start + previous.span) previous.span += 1
    else ranges.push({ start: index, span: 1 })
    return ranges
  }, [])
  const selectedCelPositions = nodes.flatMap((node, row) => node.kind === 'layer'
    ? timeline.frames.flatMap((frame, column) => renderedCellKeys.includes(animationCelKey(node.layer.id, frame.id)) ? [{ row, column }] : [])
    : [])
  const selectedCelRow = selectedCelPositions.length > 0 ? Math.min(...selectedCelPositions.map((position) => position.row)) : -1
  const selectedCelColumn = selectedCelPositions.length > 0 ? Math.min(...selectedCelPositions.map((position) => position.column)) : -1
  const selectedCelRowSpan = selectedCelPositions.length > 0 ? Math.max(...selectedCelPositions.map((position) => position.row)) - selectedCelRow + 1 : 0
  const selectedCelColumnSpan = selectedCelPositions.length > 0 ? Math.max(...selectedCelPositions.map((position) => position.column)) - selectedCelColumn + 1 : 0
  const linkedCelGroups = nodes.flatMap((node, row) => {
    if (node.kind !== 'layer') return []
    const bySource = new Map<string, number[]>()
    timeline.frames.forEach((frame, frameIndex) => {
      const cel = celLookup.at(node.layer.id, frame.id)
      const source = celLookup.resolve(cel)
      if (!source) return
      const indexes = bySource.get(source.id) ?? []
      indexes.push(frameIndex)
      bySource.set(source.id, indexes)
    })
    return [...bySource.entries()]
      .filter(([, frameIndexes]) => frameIndexes.length > 1)
       .map(([sourceId, frameIndexes]) => ({
         layerId: node.layer.id,
         row,
         sourceId,
         frameIndexes,
         layerSelected: session.selectedLayerIds.includes(node.layer.id) && !session.selectedGroupId
      }))
  })
  const renderedCellKeySet = new Set(renderedCellKeys)
  const selectedLinkedCelGroups = new Set(linkedCelGroups
    .filter((group) => group.frameIndexes.some((frameIndex) => renderedCellKeySet.has(animationCelKey(group.layerId, timeline.frames[frameIndex].id))))
    .map((group) => `${group.layerId}:${group.sourceId}`))
  const highlightedLinkedCelGroups = new Set([
    ...selectedLinkedCelGroups,
    ...linkedCelGroups
      .filter((group) => group.layerSelected && group.frameIndexes.includes(activeFrameIndex))
      .map((group) => `${group.layerId}:${group.sourceId}`)
  ])
  const linkedCelBridgeEndKeys = new Set(linkedCelGroups.flatMap((group) => {
    if (!highlightedLinkedCelGroups.has(`${group.layerId}:${group.sourceId}`)) return []
    return group.frameIndexes.flatMap((frameIndex, index) => {
      const nextFrameIndex = group.frameIndexes[index + 1]
      return nextFrameIndex > frameIndex + 1
        ? [animationCelKey(group.layerId, timeline.frames[frameIndex].id)]
        : []
    })
  }))
  const linkedCelBlocks = linkedCelGroups.flatMap((group) => {
    const blocks: Array<{ key: string; groupKey: string; row: number; start: number; span: number; selected: boolean; layerSelected: boolean }> = []
    const groupKey = `${group.layerId}:${group.sourceId}`
    let start = group.frameIndexes[0]
    let previous = start
    for (let index = 1; index <= group.frameIndexes.length; index += 1) {
      const current = group.frameIndexes[index]
      if (current === previous + 1) {
        previous = current
        continue
      }
      const span = previous - start + 1
      blocks.push({ key: `${group.layerId}:${group.sourceId}:${start}`, groupKey, row: group.row, start, span, selected: highlightedLinkedCelGroups.has(groupKey), layerSelected: group.layerSelected })
      start = current
      previous = current
    }
    return blocks
  })
  const linkedCelConnectors = linkedCelGroups.flatMap((group) => {
    const groupKey = `${group.layerId}:${group.sourceId}`
    if (!highlightedLinkedCelGroups.has(groupKey)) return []
    return group.frameIndexes.flatMap((frameIndex, index) => {
      const nextFrameIndex = group.frameIndexes[index + 1]
      return nextFrameIndex > frameIndex + 1
        ? [{ key: `${group.layerId}:${group.sourceId}:${frameIndex}-${nextFrameIndex}`, groupKey, row: group.row, start: frameIndex, end: nextFrameIndex, selected: highlightedLinkedCelGroups.has(groupKey), layerSelected: group.layerSelected }]
        : []
    })
  })
  // Membership and adjacency are separate visual states: an isolated cel in a
  // linked group still needs to sit above the bridge layer so its thumbnail is
  // visible at enlarged densities.
  const linkedCelMemberKeys = new Set(linkedCelGroups.flatMap((group) =>
    group.frameIndexes.map((frameIndex) => animationCelKey(group.layerId, timeline.frames[frameIndex].id))
  ))
  const selectedAnimationLayerRows = nodes.flatMap((node, row) =>
    node.kind === 'layer' && session.selectedLayerIds.includes(node.layer.id) && !session.selectedGroupId ? [row] : []
  )
  const beginProperties = (next: LayerFormState): void => {
    formOriginalRef.current = cloneFormState(next)
    formOriginalTargetsRef.current = next.targets.flatMap((target): LayerPropertySnapshot[] => {
      const source = target.kind === 'group' ? groupById.get(target.id) : layerById.get(target.id)
      return source ? [{ ...target, name: source.name, opacity: source.opacity, blendMode: source.blendMode, locked: source.locked, displayColor: source.displayColor ? { ...source.displayColor } : null, description: source.description ?? '' }] : []
    })
    formWasDirtyRef.current = session.document.dirty
    setForm(next)
  }
  const editLayer = (layer: RasterLayer): void => beginProperties({ id: layer.id, kind: 'layer', targets: [{ id: layer.id, kind: 'layer' }], batchChanges: [], name: layer.name, opacity: Math.round(layer.opacity * 100), blendMode: layer.blendMode, locked: layer.locked, displayColor: layer.displayColor ? { ...layer.displayColor } : null, description: layer.description ?? '' })
  const editGroup = (group: LayerGroup): void => beginProperties({ id: group.id, kind: 'group', targets: [{ id: group.id, kind: 'group' }], batchChanges: [], name: group.name, opacity: Math.round(group.opacity * 100), blendMode: group.blendMode, locked: group.locked, displayColor: group.displayColor ? { ...group.displayColor } : null, description: group.description ?? '' })
  const editSelectedRows = (): void => {
    const targets = selectedRowsForProperties(session)
    if (targets.length <= 1) return
    const first = targets[0]
    const source = first.kind === 'group' ? session.document.groups.find((group) => group.id === first.id) : session.document.layers.find((layer) => layer.id === first.id)
    if (!source) return
    beginProperties({ id: first.id, kind: first.kind, targets, batchChanges: [], name: source.name, opacity: Math.round(source.opacity * 100), blendMode: source.blendMode, locked: source.locked, displayColor: source.displayColor ? { ...source.displayColor } : null, description: source.description ?? '' })
  }
  const applyPropertyPreview = (next: LayerFormState): void => {
    store.mutateActive((active) => {
      const changes = next.targets.length > 1 ? new Set(next.batchChanges) : new Set<BatchProperty>(['name', 'opacity', 'blendMode', 'displayColor', 'description'])
      for (const formTarget of next.targets) {
        const target = formTarget.kind === 'group'
          ? active.document.groups.find((group) => group.id === formTarget.id)
          : active.document.layers.find((layer) => layer.id === formTarget.id)
        if (!target) continue
        if (changes.has('name')) target.name = next.name
        const visualLocked = formTarget.kind === 'group'
          ? isGroupEffectivelyLocked(active.document, target as LayerGroup)
          : isLayerEffectivelyLocked(active.document, target as RasterLayer)
        if (!visualLocked) {
          if (changes.has('opacity')) target.opacity = Math.max(0, Math.min(1, next.opacity / 100))
          if (changes.has('blendMode')) target.blendMode = next.blendMode
        }
        if (next.targets.length === 1) target.locked = next.locked
        if (changes.has('displayColor')) {
          if (next.displayColor) target.displayColor = { ...next.displayColor }
          else delete target.displayColor
        }
        if (changes.has('description')) target.description = next.description
      }
      active.document.dirty = true
      active.document.updatedAt = new Date().toISOString()
      active.revision += 1
      active.contentRevision += 1
      active.layersPanelRevision += 1
      active.recoverySuppressed = false
    }, false)
  }
  const flushPropertyPreview = (): LayerFormState | null => {
    if (propertyPreviewTimerRef.current !== null) window.clearTimeout(propertyPreviewTimerRef.current)
    propertyPreviewTimerRef.current = null
    const pending = pendingPropertyPreviewRef.current
    pendingPropertyPreviewRef.current = null
    if (pending) applyPropertyPreview(pending)
    return pending
  }
  const previewProperties = (next: LayerFormState, batchProperty?: BatchProperty): void => {
    if (next.targets.length > 1 && batchProperty && !next.batchChanges.includes(batchProperty)) next = { ...next, batchChanges: [...next.batchChanges, batchProperty] }
    setForm(next)
    if (next.targets.length === 1 || batchProperty === 'displayColor' || batchProperty === 'blendMode') {
      flushPropertyPreview()
      applyPropertyPreview(next)
      return
    }
    pendingPropertyPreviewRef.current = next
    if (propertyPreviewTimerRef.current !== null) window.clearTimeout(propertyPreviewTimerRef.current)
    propertyPreviewTimerRef.current = window.setTimeout(() => { flushPropertyPreview() }, 40)
  }
  const closeProperties = (): void => {
    const closingForm = flushPropertyPreview() ?? form
    if (!closingForm) return
    const original = formOriginalRef.current
    if (closingForm.targets.length > 1) {
      const originals = formOriginalTargetsRef.current
      if (closingForm.batchChanges.length === 0) {
        formOriginalRef.current = null
        formOriginalTargetsRef.current = []
        setForm(null)
        return
      }
      store.mutateActive((active) => {
        for (const snapshot of originals) {
          const target = snapshot.kind === 'group'
            ? active.document.groups.find((group) => group.id === snapshot.id)
            : active.document.layers.find((layer) => layer.id === snapshot.id)
          if (!target) continue
          target.name = snapshot.name
          target.opacity = snapshot.opacity
          target.blendMode = snapshot.blendMode
          target.locked = snapshot.locked
          if (snapshot.displayColor) target.displayColor = { ...snapshot.displayColor }
          else delete target.displayColor
          target.description = snapshot.description
        }
        active.document.dirty = formWasDirtyRef.current
        active.revision += 1
        active.contentRevision += 1
        active.layersPanelRevision += 1
      }, false)
      const committedName = closingForm.name.trim()
      const committedDescription = closingForm.description.trim()
      session.history.beginCompound()
      for (const snapshot of originals) {
        if (snapshot.kind === 'group') {
          const group = session.document.groups.find((candidate) => candidate.id === snapshot.id)
          if (group) {
            const visualLocked = isGroupEffectivelyLocked(session.document, group)
            const name = closingForm.batchChanges.includes('name') && committedName ? committedName : snapshot.name
            const opacity = closingForm.batchChanges.includes('opacity') && !visualLocked ? closingForm.opacity / 100 : snapshot.opacity
            const blendMode = closingForm.batchChanges.includes('blendMode') && !visualLocked ? closingForm.blendMode : snapshot.blendMode
            const displayColor = closingForm.batchChanges.includes('displayColor') ? closingForm.displayColor : snapshot.displayColor
            const description = closingForm.batchChanges.includes('description') ? committedDescription : snapshot.description
            if (snapshot.name === name && snapshot.opacity === opacity && snapshot.blendMode === blendMode && sameColor(snapshot.displayColor, displayColor) && snapshot.description === description) continue
            store.setGroupProperties(group.id, name, opacity, blendMode, snapshot.locked, displayColor, description)
          }
        } else {
          const layer = session.document.layers.find((candidate) => candidate.id === snapshot.id)
          if (layer) {
            const visualLocked = isLayerEffectivelyLocked(session.document, layer)
            const name = closingForm.batchChanges.includes('name') && committedName ? committedName : snapshot.name
            const opacity = closingForm.batchChanges.includes('opacity') && !visualLocked ? closingForm.opacity / 100 : snapshot.opacity
            const blendMode = closingForm.batchChanges.includes('blendMode') && !visualLocked ? closingForm.blendMode : snapshot.blendMode
            const displayColor = closingForm.batchChanges.includes('displayColor') ? closingForm.displayColor : snapshot.displayColor
            const description = closingForm.batchChanges.includes('description') ? committedDescription : snapshot.description
            if (snapshot.name === name && snapshot.opacity === opacity && snapshot.blendMode === blendMode && sameColor(snapshot.displayColor, displayColor) && snapshot.description === description) continue
            store.setLayerPropertiesWithBlend(layer.id, name, opacity, blendMode, snapshot.locked, displayColor, description)
          }
        }
      }
      session.history.endCompound(t('layers.multipleProperties'))
      formOriginalRef.current = null
      formOriginalTargetsRef.current = []
      setForm(null)
      return
    }
    const committed = { ...closingForm, name: closingForm.name.trim() || original?.name || closingForm.name, description: closingForm.description.trim() }
    const changed = Boolean(original) && (original!.name !== committed.name || original!.opacity !== committed.opacity || original!.blendMode !== committed.blendMode || original!.locked !== committed.locked || original!.description !== committed.description || !sameColor(original!.displayColor, committed.displayColor))
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
          if (original.displayColor) target.displayColor = { ...original.displayColor }
          else delete target.displayColor
          target.description = original.description
        }
        active.document.dirty = formWasDirtyRef.current
        active.revision += 1
        active.contentRevision += 1
        active.layersPanelRevision += 1
      }, false)
      if (changed) {
        if (committed.kind === 'group') store.setGroupProperties(committed.id, committed.name, committed.opacity / 100, committed.blendMode, committed.locked, committed.displayColor, committed.description)
        else store.setLayerPropertiesWithBlend(committed.id, committed.name, committed.opacity / 100, committed.blendMode, committed.locked, committed.displayColor, committed.description)
      }
    }
    formOriginalRef.current = null
    formOriginalTargetsRef.current = []
    setForm(null)
  }
  useEffect(() => () => {
    if (propertyPreviewTimerRef.current !== null) window.clearTimeout(propertyPreviewTimerRef.current)
  }, [])
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
    store.clearAnimationSelection()
    if (event.ctrlKey) store.selectLayer(layerId, 'toggle')
    else if (event.shiftKey) store.selectLayer(layerId, 'range')
    else if (session.selectedGroupId || !session.selectedLayerIds.includes(layerId)) store.selectLayer(layerId)
    const active = useWorkspace.getState().sessions.find((item) => item.document.id === session.document.id)
    const rows = active ? selectedRowsForDrag(active) : { ids: [layerId], groupIds: [] }
    const ids = rows.ids.includes(layerId) ? rows.ids : [layerId]
    const groupIds = rows.ids.includes(layerId) ? rows.groupIds : []
    if (ids.some((id) => { const layer = session.document.layers.find((candidate) => candidate.id === id); return Boolean(layer && isLayerEffectivelyLocked(session.document, layer)) })) return
    if (groupIds.some((id) => { const group = session.document.groups.find((candidate) => candidate.id === id); return Boolean(group && isGroupEffectivelyLocked(session.document, group)) })) return
    dragRef.current = { ids, groupIds, groupId: groupIds.length === 1 && ids.length === 0 ? groupIds[0] : undefined, row: { id: layerId, kind: 'layer' }, preserveSelection: event.ctrlKey || event.shiftKey, selectedLayerIds: [...(active?.selectedLayerIds ?? ids)], selectedGroupIds: [...(active?.selectedGroupIds ?? groupIds)], wholeGroupSelection: Boolean(active?.selectedGroupId), startX: event.clientX, startY: event.clientY, moved: false, copy: event.altKey }
    event.preventDefault()
  }
  const beginGroupDrag = (event: React.PointerEvent<HTMLButtonElement>, groupId: string): void => {
    if (event.button !== 0) return
    store.clearAnimationSelection()
    if (event.ctrlKey) store.selectGroup(groupId, 'toggle')
    else if (event.shiftKey) store.selectGroup(groupId, 'range')
    else if (!session.selectedGroupIds.includes(groupId)) store.selectGroup(groupId)
    const active = useWorkspace.getState().sessions.find((item) => item.document.id === session.document.id)
    const rows = active ? selectedRowsForDrag(active) : { ids: [], groupIds: [groupId] }
    const ids = rows.groupIds.includes(groupId) ? rows.ids : []
    const groupIds = rows.groupIds.includes(groupId) ? rows.groupIds : [groupId]
    const allGroupIds = new Set(groupIds.flatMap((id) => [id, ...getDescendantGroupIds(session.document, id)]))
    const allLayerIds = new Set([...ids, ...groupIds.flatMap((id) => getLayerIdsInGroup(session.document, id))])
    if (session.document.groups.some((group) => allGroupIds.has(group.id) && isGroupEffectivelyLocked(session.document, group)) || session.document.layers.some((layer) => allLayerIds.has(layer.id) && isLayerEffectivelyLocked(session.document, layer))) return
    dragRef.current = { ids, groupIds, groupId: groupIds.length === 1 && ids.length === 0 ? groupIds[0] : undefined, row: { id: groupId, kind: 'group' }, preserveSelection: event.ctrlKey || event.shiftKey, selectedLayerIds: [...(active?.selectedLayerIds ?? ids)], selectedGroupIds: [...(active?.selectedGroupIds ?? groupIds)], wholeGroupSelection: Boolean(active?.selectedGroupId), startX: event.clientX, startY: event.clientY, moved: false, copy: event.altKey }
    event.preventDefault()
  }
  const resolveDropTarget = (clientX: number, clientY: number, draggedIds: string[], draggedGroupIds: string[], copying = false): DropTarget | null => {
    const list = layerListRef.current
    const listBounds = list?.getBoundingClientRect()
    if (!list || !listBounds) return null
    if (clientX < listBounds.left || clientX > listBounds.right) return null
    const allRows = [...list.querySelectorAll<HTMLElement>('[data-layer-id], [data-group-id]')]
    const measuredRows = allRows.map((row) => ({ row, bounds: row.getBoundingClientRect() })).filter(({ bounds }) => bounds.height > 0).sort((left, right) => left.bounds.top - right.bounds.top)
    const firstVisibleBounds = measuredRows[0]?.bounds
    const lastVisibleBounds = measuredRows.at(-1)?.bounds
    if (firstVisibleBounds && clientY <= firstVisibleBounds.top) return { kind: 'edge', edge: 'top' }
    if (lastVisibleBounds && clientY >= lastVisibleBounds.bottom) return { kind: 'edge', edge: 'bottom' }
    const element = allRows
      .find((row) => {
        const bounds = row.getBoundingClientRect()
        return clientX >= bounds.left && clientX <= bounds.right && clientY >= bounds.top && clientY <= bounds.bottom
      })
    const layerId = element?.dataset.layerId
    const groupId = element?.dataset.groupId
    if (element && (layerId || groupId)) {
      const elementBounds = element.getBoundingClientRect()
      if (groupId) {
        const group = session.document.groups.find((candidate) => candidate.id === groupId)
        const nodeIndex = nodes.findIndex((node) => node.kind === 'group' && node.id === groupId)
        const hasFollowingRootNode = nodes.slice(nodeIndex + 1).some((node) => node.depth === 0)
        const draggedFromTarget = draggedIds.some((id) => session.document.layers.find((layer) => layer.id === id)?.groupId === groupId)
          || draggedGroupIds.some((id) => {
            const draggedGroup = session.document.groups.find((candidate) => candidate.id === id)
            return id === groupId || draggedGroup?.parentGroupId === groupId
          })
        const lowerEdge = Math.min(8, (elementBounds.bottom - elementBounds.top) * 0.2)
        if (!group?.parentGroupId && !hasFollowingRootNode && !draggedFromTarget && clientY >= elementBounds.bottom - lowerEdge) return { kind: 'edge', edge: 'bottom' }
      }
      const hit = {
        kind: layerId ? 'layer' as const : 'group' as const,
        id: (layerId ?? groupId)!,
        top: elementBounds.top,
        bottom: elementBounds.bottom,
        pointerY: clientY
      }
      const draggedGroupId = draggedGroupIds.length === 1 && draggedIds.length === 0 ? draggedGroupIds[0] : undefined
      const target = resolveLayerPanelDropTarget({ layers: session.document.layers, groups: session.document.groups, nodes, hit, draggedLayerIds: draggedIds, draggedGroupId, copying })
      if (target) return target
    }
    const edgeTarget = resolveLayerPanelEdgeDropTarget(clientY, listBounds.top, listBounds.bottom)
    if (edgeTarget) return edgeTarget
    const rows = allRows.filter((row) => !draggedIds.includes(row.dataset.layerId ?? '') && !draggedGroupIds.includes(row.dataset.groupId ?? ''))
    if (rows.length === 0) return null
    const first = rows[0].getBoundingClientRect()
    const last = rows.at(-1)!.getBoundingClientRect()
    if (clientY <= first.top) {
      return { kind: 'edge', edge: 'top' }
    }
    if (clientY >= last.bottom) return { kind: 'edge', edge: 'bottom' }
    return null
  }
  const dropTargetBlockedByGroups = (target: DropTarget, groupIds: readonly string[]): boolean => {
    if (groupIds.length === 0 || target.kind === 'edge') return false
    const blockedTargets = new Set(groupIds.flatMap((id) => [id, ...getDescendantGroupIds(session.document, id)]))
    if (target.kind === 'group' || target.kind === 'above-group') return blockedTargets.has(target.id)
    const targetLayer = session.document.layers.find((layer) => layer.id === target.id)
    return Boolean(targetLayer?.groupId && blockedTargets.has(targetLayer.groupId))
  }
  const moveLayerDrag = (clientX: number, clientY: number, altKey: boolean): void => {
    const drag = dragRef.current
    if (!drag) return
    drag.copy = altKey
    if (!drag.moved && Math.hypot(clientX - drag.startX, clientY - drag.startY) < 4) return
    if (!drag.moved) { drag.moved = true; setDraggingIds(drag.ids); setDraggingGroupId(drag.groupId ?? null) }
    setDraggingCopy(drag.copy)
    const draggedLayerIds = new Set(drag.wholeGroupSelection ? [] : drag.selectedLayerIds)
    const draggedGroupIds = new Set(drag.selectedGroupIds)
    const items = nodes.flatMap((node): NonNullable<LayerDragGhost['items']> => {
      if (node.kind === 'group' && draggedGroupIds.has(node.id)) return [{ id: node.id, kind: 'group', name: node.group.name }]
      if (node.kind === 'layer' && draggedLayerIds.has(node.id)) return [{ id: node.id, kind: 'layer', name: node.layer.name }]
      return []
    })
    const listBounds = layerListRef.current?.getBoundingClientRect()
    const selectedCount = drag.wholeGroupSelection
      ? Math.max(1, drag.selectedGroupIds.length)
      : new Set([...drag.selectedLayerIds.map((id) => `layer:${id}`), ...drag.selectedGroupIds.map((id) => `group:${id}`)]).size
    const count = Math.max(items.length, selectedCount)
    const ghostHeight = Math.min(4, Math.max(1, items.length)) * 27 + (count > Math.min(4, items.length) ? 20 : 0)
    const y = listBounds ? Math.max(0, Math.min(listBounds.height - ghostHeight, clientY - listBounds.top - ghostHeight / 2)) : 0
    setDragGhost({ y, items: items.length > 0 ? items : [{ id: drag.row.id, kind: drag.row.kind, name: t('layers.fallbackName') }], count })
    let target = resolveDropTarget(clientX, clientY, drag.ids, drag.groupIds, drag.copy)
    if (target && dropTargetBlockedByGroups(target, drag.groupIds)) target = null
    dropTargetRef.current = target
    if (target?.kind === 'edge' && layerListRef.current) {
      const list = layerListRef.current
      const rows = [...list.querySelectorAll<HTMLElement>('[data-layer-id], [data-group-id]')]
      const measuredRows = rows.map((row) => ({ row, bounds: row.getBoundingClientRect() })).filter(({ bounds }) => bounds.height > 0).sort((left, right) => left.bounds.top - right.bounds.top)
      const measuredAnchor = target.edge === 'top' ? measuredRows[0] : measuredRows.at(-1)
      const listBounds = list.getBoundingClientRect()
      const rowBounds = measuredAnchor?.bounds
      setDropTarget({ ...target, offset: rowBounds ? (target.edge === 'top' ? rowBounds.top : rowBounds.bottom) - listBounds.top + list.scrollTop : 0 })
    } else setDropTarget(target)
  }
  const finishLayerDrag = (clientX: number, clientY: number): void => {
    const drag = dragRef.current
    let target = drag ? resolveDropTarget(clientX, clientY, drag.ids, drag.groupIds, drag.copy) : dropTargetRef.current
    if (drag && target && dropTargetBlockedByGroups(target, drag.groupIds)) target = null
    dragRef.current = null
    const compound = Boolean(drag?.moved && target && drag.copy)
    if (compound) session.history.beginCompound()
    if (drag?.moved && target) {
      if (drag.copy) {
        const copies = store.duplicateSelectedLayerRows()
        drag.ids = copies.layerIds
        drag.groupIds = copies.groupIds
        drag.groupId = drag.groupIds.length === 1 && drag.ids.length === 0 ? drag.groupIds[0] : undefined
      }
      if (target.kind === 'edge') store.moveLayerRows(drag.ids, drag.groupIds, { kind: 'edge', edge: target.edge })
      else if (target.kind === 'group') store.moveLayerRows(drag.ids, drag.groupIds, { kind: 'group', id: target.id })
      else if (target.kind === 'above-group') store.moveLayerRows(drag.ids, drag.groupIds, { kind: 'row', rowKind: 'group', id: target.id, position: target.insertAfter === false ? 'below' : 'above' })
      else store.moveLayerRows(drag.ids, drag.groupIds, { kind: 'row', rowKind: 'layer', id: target.id, position: target.insertAfter ? 'above' : 'below' })
      if (!drag.copy) {
        if (drag.wholeGroupSelection && drag.selectedGroupIds.length === 1) store.selectGroup(drag.selectedGroupIds[0])
        else store.selectLayerRows(drag.selectedLayerIds, drag.selectedGroupIds)
      }
    }
    if (drag && !drag.moved && !drag.preserveSelection) {
      if (drag.row.kind === 'group') store.selectGroup(drag.row.id)
      else store.selectLayer(drag.row.id)
    }
    if (compound) session.history.endCompound(t('layers.copyMoveHistory'))
    setDraggingIds([])
    setDraggingGroupId(null)
    setDraggingCopy(false)
    dropTargetRef.current = null
    setDropTarget(null)
    setDragGhost(null)
  }
  useEffect(() => {
    const move = (event: PointerEvent): void => { moveLayerDrag(event.clientX, event.clientY, event.altKey); moveAnimationPointerDrag(event) }
    const finish = (event: PointerEvent): void => { finishLayerDrag(event.clientX, event.clientY); finishAnimationPointerDrag() }
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
    store.clearAnimationSelection()
    if (kind === 'layer' && (session.selectedGroupId || !session.selectedLayerIds.includes(id))) store.selectLayer(id)
    if (kind === 'group' && !session.selectedGroupIds.includes(id)) store.selectGroup(id)
    setContextMenu({ kind, id, x: Math.min(event.clientX, window.innerWidth - 210), y: Math.min(event.clientY, window.innerHeight - 360) })
  }
  const closeContextMenu = (): void => setContextMenu(null)
  const duplicateContextSelection = (): void => {
    store.duplicateSelectedLayerRows()
    closeContextMenu()
  }
  const deleteContextSelection = (): void => {
    store.deleteSelectedLayers()
    closeContextMenu()
  }
  const openProperties = (): void => {
    if (!contextMenu) return
    const selectedRows = selectedRowsForProperties(session)
    if (selectedRows.length > 1) {
      editSelectedRows()
      closeContextMenu()
      return
    }
    if (contextMenu.kind === 'group') {
      const group = session.document.groups.find((item) => item.id === contextMenu.id)
      if (group) editGroup(group)
    } else {
      const layer = session.document.layers.find((item) => item.id === contextMenu.id)
      if (layer) editLayer(layer)
    }
    closeContextMenu()
  }
  const singleFormTargetLocked = Boolean(form && form.targets.length === 1 && (form.kind === 'group'
    ? session.document.groups.some((group) => group.id === form.id && isGroupEffectivelyLocked(session.document, group))
    : session.document.layers.some((layer) => layer.id === form.id && isLayerEffectivelyLocked(session.document, layer))))
  const dragGhostItems = dragGhost?.items ?? (dragGhost ? [{ id: 'legacy', kind: 'layer' as const, name: dragGhost.name ?? t('layers.fallbackName') }] : [])
  const hiddenDragGhostCount = dragGhost ? Math.max(0, dragGhost.count - Math.min(4, dragGhostItems.length)) : 0
  const animationMenuCel = animationMenu?.kind === 'cel' ? celLookup.at(animationMenu.layerId, animationMenu.frameId) : null
  const animationMenuCelHasContent = cachedCelHasContent(celLookup.resolve(animationMenuCel), session.document.palette, animationMenu?.kind === 'cel' && animationMenu.frameId === timeline.activeFrameId ? session.contentRevision : 0)
  const selectedAnimationCelsCanLink = animationMenu?.kind === 'cel' && (() => {
    const selected = new Set(session.selectedAnimationCellKeys)
    const targets = timeline.cels.filter((cel) => selected.has(animationCelKey(cel.layerId, cel.frameId)))
    if (targets.length < 2 || !targets.some((cel) => cachedCelHasContent(celLookup.resolve(cel), session.document.palette, cel.frameId === timeline.activeFrameId ? session.contentRevision : 0))) return false
    const counts = new Map<string, number>()
    for (const cel of targets) counts.set(cel.layerId, (counts.get(cel.layerId) ?? 0) + 1)
    return [...counts.values()].some((count) => count > 1)
  })()
  const selectedAnimationCelsCanUnlink = animationMenu?.kind === 'cel' && (() => {
    const selected = new Set(session.selectedAnimationCellKeys)
    return timeline.cels.some((cel) => {
      if (!selected.has(animationCelKey(cel.layerId, cel.frameId))) return false
      const source = celLookup.resolve(cel)
      return Boolean(cel.linkedCelId) || Boolean(source && timeline.cels.some((candidate) => candidate.id !== source.id && celLookup.resolve(candidate)?.id === source.id))
    })
  })()
  return <><section ref={floating.ref} className={`panel layers-panel layer-density-${layerDensity} ${session.animationPlaying ? 'animation-playing' : ''} ${animationItemDragging ? 'animation-item-dragging' : ''} ${floating.style ? 'floating-panel' : ''} ${altCopyReady ? 'layer-alt-copy-ready' : ''} ${draggingCopy ? 'layer-copy-drag' : ''}`} data-command-scope="layers" style={floating.style} onPointerDown={floating.bringToFront} onWheel={handleLayerPanelWheel} onContextMenu={onPanelContextMenu}>
    <header onPointerDown={(event) => floating.style ? floating.startDrag(event) : onDockDragStart?.(event, floating.startDetachedDrag)}><div className="layer-animation-toolbar" onPointerDown={(event) => event.stopPropagation()}><span className="layer-animation-playback">
        <button type="button" title={t('timeline.firstFrame')} aria-label={t('timeline.firstFrame')} onClick={() => selectAnimationEdge('first')}><PlaybackPixelIcon kind="first" /></button>
        <button type="button" title={t('timeline.previousFrame')} aria-label={t('timeline.previousFrame')} onClick={() => selectAnimationStep(-1)}><PlaybackPixelIcon kind="previous" /></button>
        <button type="button" className={session.animationPlaying ? 'active' : ''} title={session.animationPlaying ? t('timeline.pause') : t('timeline.play')} aria-label={session.animationPlaying ? t('timeline.pause') : t('timeline.play')} onClick={() => store.setAnimationPlaying(!session.animationPlaying)} onContextMenu={(event) => openAnimationMenu(event, { kind: 'playback', x: event.clientX, y: event.clientY })}><PlaybackPixelIcon kind={session.animationPlaying ? 'pause' : 'play'} /></button>
        <button type="button" title={t('timeline.nextFrame')} aria-label={t('timeline.nextFrame')} onClick={() => selectAnimationStep(1)}><PlaybackPixelIcon kind="next" /></button>
        <button type="button" title={t('timeline.lastFrame')} aria-label={t('timeline.lastFrame')} onClick={() => selectAnimationEdge('last')}><PlaybackPixelIcon kind="last" /></button>
      </span><span className="layer-animation-edit">
        <button type="button" className={layerSettings.onionSkin.enabled ? 'active' : ''} title={t('layers.onionSkinEnabled')} aria-label={t('layers.onionSkinEnabled')} aria-pressed={layerSettings.onionSkin.enabled} onClick={toggleOnionSkin}><PixelUtilityIcon kind="onion" /></button>
        <button type="button" title={t('timeline.addFrame')} aria-label={t('timeline.addFrame')} onClick={() => store.duplicateAnimationFrame()}><PixelUtilityIcon kind="plus" /></button>
        <button type="button" title={t('timeline.deleteFrame')} aria-label={t('timeline.deleteFrame')} disabled={timeline.frames.length <= 1} onClick={() => store.deleteSelectedAnimationItems()}><PixelUtilityIcon kind="delete" /></button>
      </span></div><span className="panel-actions" onPointerDown={(event) => event.stopPropagation()}><button title={t('layers.new')} aria-label={t('layers.new')} onClick={() => void store.addLayer()}><PixelUtilityIcon kind="plus" /></button><button title={t('layers.newGroupShortcut')} aria-label={t('layers.newGroup')} onClick={() => store.createLayerGroup()}><PixelUtilityIcon kind="newFolder" /></button><button title={t('layers.deleteSelected')} aria-label={t('layers.deleteSelected')} onClick={() => store.deleteSelectedLayers()}><PixelUtilityIcon kind="delete" /></button><button title={t('layers.settings')} aria-label={t('layers.settings')} onClick={openLayerSettings}><PixelUtilityIcon kind="properties" /></button></span></header>
    <div ref={layerListRef} className="layer-list layer-animation-list component-scrollbar" style={{ '--layer-frame-count': timeline.frames.length, '--layer-label-width': `${layerLabelWidth}px` } as CSSProperties} onPointerDown={(event) => { if (event.target === event.currentTarget) { store.clearLayerSelection(); store.clearAnimationSelection() } }} onContextMenu={(event) => { const target = (event.target as HTMLElement).closest<HTMLElement>('[data-layer-id], [data-group-id]'); if (target?.dataset.layerId) openLayerContextMenu(event, 'layer', target.dataset.layerId); else if (target?.dataset.groupId) openLayerContextMenu(event, 'group', target.dataset.groupId) }}><div className="layer-animation-tree"><div className="layer-animation-corner"><ActiveFrameSync documentId={session.document.id} frameIds={timeline.frames.map((frame) => frame.id)} containerRef={layerListRef} /></div><span className="layer-animation-column-resizer" role="separator" aria-label={t('timeline.resizeLayerArea')} aria-orientation="vertical" aria-valuemin={layerLabelWidthLimits.min} aria-valuemax={layerLabelWidthLimits.max} aria-valuenow={layerLabelWidth} tabIndex={0} onPointerDown={beginLayerLabelResize} onKeyDown={(event) => { if (event.key === 'ArrowLeft') { event.preventDefault(); setStoredLayerLabelWidth(layerLabelWidth - 12) } else if (event.key === 'ArrowRight') { event.preventDefault(); setStoredLayerLabelWidth(layerLabelWidth + 12) } }} />{nodes.map((node) => {
      if (node.kind === 'group') {
        const collapsed = session.collapsedGroupIds.includes(node.group.id)
        const lockingAncestor = getGroupLockingAncestor(session.document, node.group)
        const groupInsideTarget = dropTarget?.kind === 'group' && dropTarget.id === node.group.id
        const groupIndicator = dropTarget?.kind === 'above-group' && dropTarget.id === node.group.id
            ? <span className={`layer-drop-indicator ${dropTarget.insertAfter === false ? 'below' : 'above'}`} style={{ left: `${8 + node.depth * 14}px` }} aria-hidden="true"><i /><b /><i /></span>
            : null
        const displayColor = effectiveDisplayColor(node.group, 'group')
        return <button key={node.group.id} data-group-id={node.group.id} className={`layer-row group-row ${session.selectedGroupIds.includes(node.group.id) ? 'selected' : ''} ${draggingGroupId === node.group.id ? 'dragging' : ''} ${groupInsideTarget ? 'group-drop-target' : ''}`} style={{ '--layer-depth': node.depth } as React.CSSProperties} onPointerDown={(event) => beginGroupDrag(event, node.group.id)} onDoubleClick={() => editGroup(node.group)}>{groupIndicator}{displayColor && <span className="layer-color-stripe" style={{ backgroundColor: `rgba(${displayColor.r}, ${displayColor.g}, ${displayColor.b}, ${displayColor.a / 255})` }} aria-hidden="true" />}<span className="layer-visibility" role="button" tabIndex={-1} aria-label={t(node.group.visible ? 'layers.hideGroup' : 'layers.showGroup')} onPointerDown={(event) => event.stopPropagation()} onDoubleClick={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); store.toggleGroupVisibility(node.group.id) }}>{node.group.visible ? <PixelUtilityIcon kind="eye" /> : <PixelUtilityIcon kind="eyeOff" />}</span><span className={`layer-lock-toggle ${node.group.locked || lockingAncestor ? 'locked' : ''}`} role="button" tabIndex={-1} title={lockingAncestor ? t('layers.lockedByGroup', { name: lockingAncestor.name }) : undefined} aria-label={lockingAncestor ? t('layers.lockedByGroup', { name: lockingAncestor.name }) : t(node.group.locked ? 'layers.unlockGroup' : 'layers.lockGroup')} aria-disabled={Boolean(lockingAncestor)} aria-pressed={node.group.locked || Boolean(lockingAncestor)} onPointerDown={(event) => event.stopPropagation()} onDoubleClick={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); if (lockingAncestor) store.setMessage(t('layers.lockedByGroup', { name: lockingAncestor.name })); else store.setGroupProperties(node.group.id, node.group.name, node.group.opacity, node.group.blendMode, !node.group.locked, node.group.displayColor, node.group.description) }}>{node.group.locked || lockingAncestor ? <PixelUtilityIcon kind="lock" /> : <PixelUtilityIcon kind="unlock" />}</span><span className="group-folder" role="button" tabIndex={-1} aria-label={t(collapsed ? 'layers.expandGroup' : 'layers.collapseGroup')} title={t(collapsed ? 'layers.expandGroup' : 'layers.collapseGroup')} onPointerDown={(event) => event.stopPropagation()} onDoubleClick={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); store.toggleGroupCollapsed(node.group.id) }}>{collapsed ? <PixelUtilityIcon kind="folder" /> : <PixelUtilityIcon kind="folderOpen" />}</span><Tooltip className="layer-name" content={node.group.description?.trim()}><span>{node.group.name}</span><small>{blendOptions.find((option) => option.value === node.group.blendMode)?.label} · {Math.round(node.group.opacity * 100)}%</small></Tooltip></button>
      }
      const selected = session.selectedLayerIds.includes(node.layer.id) && !session.selectedGroupId
      const lockingGroup = getLayerLockingGroup(session.document, node.layer)
      const displayColor = effectiveDisplayColor(node.layer, 'layer')
      const indicator = dropTarget?.kind === 'layer' && dropTarget.id === node.layer.id
        ? <span className={`layer-drop-indicator ${dropTarget.insertAfter ? 'above' : 'below'}`} style={{ left: `${8 + node.depth * 14}px` }} aria-hidden="true"><i /><b /><i /></span>
        : null
      return <button key={node.layer.id} data-layer-id={node.layer.id} className={`layer-row ${node.depth > 0 ? 'group-member' : ''} ${selected ? 'selected' : ''} ${draggingIds.includes(node.layer.id) ? 'dragging' : ''}`} style={{ '--layer-depth': node.depth } as React.CSSProperties} onPointerDown={(event) => beginLayerDrag(event, node.layer.id)} onDoubleClick={() => editLayer(node.layer)}>{indicator}{displayColor && <span className="layer-color-stripe" style={{ backgroundColor: `rgba(${displayColor.r}, ${displayColor.g}, ${displayColor.b}, ${displayColor.a / 255})` }} aria-hidden="true" />}<span className="layer-visibility" role="button" tabIndex={-1} aria-label={t(node.layer.visible ? 'layers.hideLayer' : 'layers.showLayer')} onPointerDown={(event) => event.stopPropagation()} onDoubleClick={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); store.toggleLayerVisibility(node.layer.id) }}>{node.layer.visible ? <PixelUtilityIcon kind="eye" /> : <PixelUtilityIcon kind="eyeOff" />}</span><span className={`layer-lock-toggle ${node.layer.locked || lockingGroup ? 'locked' : ''}`} role="button" tabIndex={-1} title={lockingGroup ? t('layers.lockedByGroup', { name: lockingGroup.name }) : undefined} aria-label={lockingGroup ? t('layers.lockedByGroup', { name: lockingGroup.name }) : t(node.layer.locked ? 'layers.unlockLayer' : 'layers.lockLayer')} aria-disabled={Boolean(lockingGroup)} aria-pressed={node.layer.locked || Boolean(lockingGroup)} onPointerDown={(event) => event.stopPropagation()} onDoubleClick={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); if (lockingGroup) store.setMessage(t('layers.lockedByGroup', { name: lockingGroup.name })); else store.setLayerPropertiesWithBlend(node.layer.id, node.layer.name, node.layer.opacity, node.layer.blendMode, !node.layer.locked, node.layer.displayColor, node.layer.description) }}>{node.layer.locked || lockingGroup ? <PixelUtilityIcon kind="lock" /> : <PixelUtilityIcon kind="unlock" />}</span><Tooltip className="layer-name" content={node.layer.description?.trim()}><span>{node.layer.name}</span><small>{blendOptions.find((option) => option.value === node.layer.blendMode)?.label} · {Math.round(node.layer.opacity * 100)}%</small></Tooltip></button>
    })}</div><div className="layer-animation-grid">{selectedAnimationLayerRows.map((row) => <span key={`selected-layer-row-${row}`} data-animation-selected-layer-row className="animation-selected-layer-row" style={{ '--animation-row-index': row } as CSSProperties} aria-hidden="true" />)}{showLinkedCelVisuals && linkedCelBlocks.map((block) => <span key={block.key} data-linked-cel-block data-frame-index={block.start} data-frame-span={block.span} className={`animation-linked-cel-block ${block.selected ? 'selected' : ''} ${block.layerSelected ? 'layer-selected' : ''}`} style={{ '--animation-row-index': block.row, '--animation-frame-index': block.start, '--animation-frame-span': block.span } as CSSProperties} aria-hidden="true" />)}{showLinkedCelVisuals && linkedCelConnectors.map((connector) => <span key={connector.key} data-linked-cel-connector data-start-frame-index={connector.start} data-end-frame-index={connector.end} className={`animation-linked-cel-connector ${connector.selected ? 'selected' : ''} ${connector.layerSelected ? 'layer-selected' : ''}`} style={{ '--animation-row-index': connector.row, '--animation-link-start': connector.start, '--animation-link-end': connector.end } as CSSProperties} aria-hidden="true" />)}{!session.animationPlaying && selectedFrameRanges.map((range) => <span key={`${range.start}-${range.span}`} data-animation-frame-selection={timeline.frames.slice(range.start, range.start + range.span).map((frame) => frame.id).join(' ')} className="animation-frame-selection-column" style={{ '--animation-frame-index': range.start, '--animation-frame-span': range.span } as CSSProperties} aria-hidden="true" />)}{!session.animationPlaying && selectedCelPositions.length > 0 && <span data-animation-cel-selection className="animation-cel-selection-box" style={{ '--animation-frame-index': selectedCelColumn, '--animation-frame-span': selectedCelColumnSpan, '--animation-row-index': selectedCelRow, '--animation-row-span': selectedCelRowSpan } as CSSProperties} aria-hidden="true" />}{animationFrameDropTarget && timeline.frames.findIndex((frame) => frame.id === animationFrameDropTarget.frameId) >= 0 && <span className="animation-frame-drop-line" style={{ '--animation-frame-drop-index': timeline.frames.findIndex((frame) => frame.id === animationFrameDropTarget.frameId) + (animationFrameDropTarget.insertAfter ? 1 : 0) } as CSSProperties} aria-hidden="true" />}{timeline.frames.map((frame, index) => {
      const frameSelected = !session.animationPlaying && selectedFrameIndexSet.has(index)
      return <button type="button" data-animation-frame-id={frame.id} data-frame-index={index} key={`header-${frame.id}`} className={`layer-animation-frame-header ${frame.id === timeline.activeFrameId ? 'active' : ''} ${frameSelected ? 'selected-animation-frame' : ''} ${draggingAnimationFrameIds.includes(frame.id) ? 'dragging' : ''}`} aria-label={t('timeline.frameNumber', { number: index + 1 })} title={`${t('timeline.frameNumber', { number: index + 1 })} · ${frame.duration} ms`} onPointerDown={(event) => beginAnimationFrameDrag(event, frame.id)} onPointerMove={(event) => updateAnimationItemCursor(event, frame.id)} onPointerLeave={(event) => { event.currentTarget.style.cursor = '' }} onClick={(event) => { if (suppressAnimationClickRef.current) { event.preventDefault(); event.stopPropagation(); return } if (event.detail === 0) selectAnimationFrame(frame.id, event.shiftKey ? 'range' : event.ctrlKey ? 'toggle' : 'replace') }} onDoubleClick={() => openFramePropertiesFor(frame.id)} onContextMenu={(event) => openFrameMenu(event, frame.id)}><strong>{index + 1}</strong><small>{frame.duration}</small></button>
    })}{nodes.flatMap((node) => timeline.frames.map((frame, index) => {
      const active = frame.id === timeline.activeFrameId
      if (node.kind === 'group') return <button type="button" key={`${node.id}-${frame.id}`} data-frame-index={index} className={`layer-animation-cel group ${active ? 'active-frame' : ''}`} title={t('timeline.frameNumber', { number: index + 1 })} onClick={() => selectAnimationFrame(frame.id)} />
      const selected = session.selectedLayerIds.includes(node.layer.id) && !session.selectedGroupId
      const cel = celLookup.at(node.layer.id, frame.id)
      const resolvedCel = celLookup.resolve(cel)
      const contentRevision = active && selected ? session.contentRevision : 0
      const hasContent = cachedCelHasContent(resolvedCel, session.document.palette, contentRevision)
      const key = animationCelKey(node.layer.id, frame.id)
      const resolvedId = resolvedCel?.id ?? null
      const previousCel = index > 0 ? celLookup.at(node.layer.id, timeline.frames[index - 1].id) : null
      const nextCel = index + 1 < timeline.frames.length ? celLookup.at(node.layer.id, timeline.frames[index + 1].id) : null
      const previousResolvedId = celLookup.resolve(previousCel)?.id ?? null
      const nextResolvedId = celLookup.resolve(nextCel)?.id ?? null
      const linkedWithPrevious = Boolean(resolvedId && previousResolvedId === resolvedId && (cel?.linkedCelId || previousCel?.linkedCelId))
      const linkedWithNext = Boolean(resolvedId && nextResolvedId === resolvedId && (cel?.linkedCelId || nextCel?.linkedCelId))
      const linkedCelMember = showLinkedCelVisuals && linkedCelMemberKeys.has(key)
      const linkedCelBridgeEnd = showLinkedCelVisuals && linkedCelBridgeEndKeys.has(key)
      const linkedCelEnd = showLinkedCelVisuals && linkedWithPrevious && !linkedWithNext && !linkedCelBridgeEnd
      const cellSelected = !session.animationPlaying && renderedCellKeys.includes(key)
      const showThumbnail = layerDensityOrder.indexOf(layerDensity) >= layerDensityOrder.indexOf('detailed')
      const thumbnailSize = layerDensity === 'detailed'
        ? 46
        : layerDensity === 'expanded'
          ? 64
          : layerDensity === 'large'
            ? 88
            : 120
      return <button type="button" data-animation-cel-key={key} data-frame-index={index} key={`${node.id}-${frame.id}`} className={`layer-animation-cel ${cel ? 'has-cel' : ''} ${active ? 'active-frame' : ''} ${!session.animationPlaying && renderedFrameIds.includes(frame.id) ? 'selected-animation-frame' : ''} ${selected ? 'selected-layer' : ''} ${active && selected ? 'current-cel' : ''} ${cellSelected ? 'selected-cel' : ''} ${linkedCelMember ? 'linked-cel-member' : ''} ${showLinkedCelVisuals && (linkedWithPrevious || linkedWithNext) ? 'linked-cel' : ''} ${showLinkedCelVisuals && linkedWithPrevious ? 'linked-cel-previous' : ''} ${showLinkedCelVisuals && linkedWithNext ? 'linked-cel-next' : ''} ${linkedCelEnd ? 'linked-cel-end' : ''} ${linkedCelBridgeEnd ? 'linked-cel-bridge-end' : ''} ${draggingAnimationFrameIds.includes(frame.id) || draggingAnimationCellKeys.includes(key) ? 'dragging' : ''} ${animationCelDropTargetKey === key ? 'drop-target' : ''}`} aria-label={t('timeline.celAtFrame', { number: index + 1 })} title={`${node.layer.name} · ${t('timeline.frameNumber', { number: index + 1 })}`} onPointerDown={(event) => beginAnimationCelDrag(event, node.layer.id, frame.id)} onPointerMove={(event) => updateAnimationItemCursor(event, frame.id, key)} onPointerLeave={(event) => { event.currentTarget.style.cursor = '' }} onClick={(event) => { if (suppressAnimationClickRef.current) { event.preventDefault(); event.stopPropagation(); return } if (event.detail === 0) store.selectAnimationCell(key, event.shiftKey ? 'range' : event.ctrlKey ? 'toggle' : 'replace') }} onDoubleClick={() => openCelProperties(node.layer.id, frame.id)} onContextMenu={(event) => openCelMenu(event, node.layer.id, frame.id)}>{active && selected && resolvedCel ? <ActiveCelContent documentId={session.document.id} cel={resolvedCel} palette={session.document.palette} revision={contentRevision} documentWidth={session.document.width} documentHeight={session.document.height} thumbnailSize={thumbnailSize} showThumbnail={showThumbnail} /> : hasContent && (showThumbnail && resolvedCel ? <CelThumbnail cel={resolvedCel} palette={session.document.palette} revision={contentRevision} documentWidth={session.document.width} documentHeight={session.document.height} thumbnailSize={thumbnailSize} /> : <span className="cel-content-marker" />)}</button>
    }))}</div>{dropTarget?.kind === 'edge' && <div className={`layer-edge-drop-indicator ${dropTarget.edge}`} style={{ top: dropTarget.offset ?? 0 }} aria-hidden="true"><i /><b /><i /></div>}{dragGhost && <div className="layer-drag-ghost" style={{ top: dragGhost.y }}>{dragGhostItems.slice(0, 4).map((item) => <span key={`${item.kind}-${item.id}`}>{item.kind === 'group' ? <PixelUtilityIcon kind="folder" /> : <Layers2 size={13} />}<b>{item.name}</b></span>)}{hiddenDragGhostCount > 0 && <small>+{hiddenDragGhostCount}</small>}</div>}</div>
    {contextMenu && <div className="layer-context-menu" style={{ left: contextMenu.x, top: contextMenu.y }} role="menu" onPointerDown={(event) => event.stopPropagation()}>
      <LayerContextMenuItem icon="plus" label={t('layers.new')} shortcut={shortcutHint('newLayer')} onClick={() => { void store.addLayer(); closeContextMenu() }} />
      <LayerContextMenuItem icon="newFolder" label={t('layers.newGroup')} shortcut={shortcutHint('createLayerGroup')} onClick={() => { store.createLayerGroup(); closeContextMenu() }} />
      <LayerContextMenuItem icon="copy" label={t('layers.duplicate')} shortcut={shortcutHint('duplicateLayer')} onClick={duplicateContextSelection} />
      {contextMenu.kind === 'layer' && <LayerContextMenuItem icon="mergeDown" label={t(session.selectedLayerIds.length > 1 ? 'app.menu.layer.mergeSelected' : 'app.menu.layer.mergeDown')} shortcut={shortcutHint(session.selectedLayerIds.length > 1 ? 'mergeSelectedLayers' : 'mergeLayerDown')} onClick={() => { session.selectedLayerIds.length > 1 ? store.mergeSelectedLayers() : store.mergeActiveLayerDown(); closeContextMenu() }} />}
      {contextMenu.kind === 'group' && <>
        <LayerContextMenuItem icon="folderOpen" label={t('layers.expandCollapseGroup')} onClick={() => { store.toggleGroupCollapsed(contextMenu.id); closeContextMenu() }} />
        <LayerContextMenuItem icon="mergeDown" label={t('app.menu.layer.mergeGroup')} shortcut={shortcutHint('mergeLayerGroup')} onClick={() => { store.mergeSelectedGroup(); closeContextMenu() }} />
        <LayerContextMenuItem icon="ungroupFolder" label={t('app.menu.layer.ungroup')} shortcut={shortcutHint('ungroupLayers')} onClick={() => { store.ungroupSelected(); closeContextMenu() }} />
      </>}
      <LayerContextMenuItem icon="mergeVisible" label={t('app.menu.layer.mergeVisible')} shortcut={shortcutHint('mergeVisibleLayers')} onClick={() => { store.mergeVisibleLayers(); closeContextMenu() }} />
      <LayerContextMenuItem icon="properties" label={t('layers.properties')} onClick={openProperties} />
      <LayerContextMenuItem icon="delete" label={t('common.delete')} shortcut={shortcutHint('deleteLayer')} onClick={deleteContextSelection} danger />
    </div>}
    {animationMenu?.kind === 'playback' && <AnimationPlaybackMenu session={session} x={animationMenu.x} y={animationMenu.y} onClose={() => setAnimationMenu(null)} />}
    {animationMenu && animationMenu.kind !== 'playback' && createPortal(<div ref={animationMenuRef} className="context-menu animation-context-menu" role="menu" aria-label={t(animationMenu.kind === 'frame' ? 'timeline.frameMenu' : 'timeline.celMenu')} style={animationMenuPosition} onPointerDown={(event) => event.stopPropagation()} onContextMenu={(event) => event.preventDefault()}>
      {animationMenu.kind === 'frame' ? <>
        <button className="context-menu-item" type="button" role="menuitem" onClick={openFrameProperties}><Clock3 size={15} /><span>{t('timeline.frameProperties')}</span></button>
        <span className="context-menu-divider" />
        <button className="context-menu-item" type="button" role="menuitem" onClick={() => { store.copySelectedAnimationFrames(); setAnimationMenu(null) }}><PixelUtilityIcon kind="copy" /><span>{t('timeline.copyFrame')}</span>{shortcutHint('copy')}</button>
        <button className="context-menu-item" type="button" role="menuitem" disabled={!session.animationFrameClipboard.length} onClick={() => { store.pasteAnimationFrames(); setAnimationMenu(null) }}><FilePlus2 size={15} /><span>{t('timeline.pasteFrame')}</span>{shortcutHint('paste')}</button>
        <span className="context-menu-divider" />
        <button className="context-menu-item" type="button" role="menuitem" onClick={() => useFrameMenuTarget(() => store.duplicateAnimationFrame())}><PixelUtilityIcon kind="copy" /><span>{t('timeline.addFrame')}</span>{shortcutHint('addAnimationFrame')}</button>
        <button className="context-menu-item" type="button" role="menuitem" onClick={() => useFrameMenuTarget(() => store.addAnimationFrame())}><FilePlus2 size={15} /><span>{t('timeline.addBlankFrame')}</span>{shortcutHint('addBlankAnimationFrame')}</button>
        <button className="context-menu-item danger" type="button" role="menuitem" disabled={timeline.frames.length <= 1} onClick={() => useFrameMenuTarget(() => store.deleteSelectedAnimationItems())}><PixelUtilityIcon kind="delete" /><span>{t('timeline.deleteFrame')}</span>{shortcutHint('deleteAnimationFrame', 'deleteLayer')}</button>
      </> : <>
        <button className="context-menu-item" type="button" role="menuitem" disabled={!animationMenuCelHasContent} onClick={() => openCelProperties(animationMenu.layerId, animationMenu.frameId)}><Clock3 size={15} /><span>{t('timeline.celProperties')}</span></button>
        <span className="context-menu-divider" />
        <button className="context-menu-item" type="button" role="menuitem" disabled={!animationMenuCelHasContent} onClick={() => { store.copySelectedAnimationCels(); setAnimationMenu(null) }}><PixelUtilityIcon kind="copy" /><span>{t('timeline.copyCel')}</span>{shortcutHint('copy', 'copyAnimationCel')}</button>
        <button className="context-menu-item" type="button" role="menuitem" disabled={!session.animationCellClipboard.length} onClick={() => { store.pasteAnimationCels(); setAnimationMenu(null) }}><FilePlus2 size={15} /><span>{t('timeline.pasteCel')}</span>{shortcutHint('paste')}</button>
        <button className="context-menu-item" type="button" role="menuitem" disabled={!selectedAnimationCelsCanLink} onClick={() => { store.connectSelectedAnimationCels(); setAnimationMenu(null) }}><Link2 size={15} /><span>{t('timeline.connectCel')}</span></button>
        <button className="context-menu-item" type="button" role="menuitem" disabled={!selectedAnimationCelsCanUnlink} onClick={() => { store.disconnectSelectedAnimationCels(); setAnimationMenu(null) }}><Link2 size={15} /><span>{t('timeline.disconnectCel')}</span></button>
        <button className="context-menu-item danger" type="button" role="menuitem" disabled={!animationMenuCelHasContent} onClick={() => { store.deleteSelectedAnimationItems(); setAnimationMenu(null) }}><PixelUtilityIcon kind="delete" /><span>{t('timeline.deleteCel')}</span>{shortcutHint('deleteAnimationFrame', 'deleteLayer')}</button>
      </>}
    </div>, document.body)}
    {frameProperties && <div className="modal-backdrop" role="presentation" onPointerDown={(event) => { if (event.target === event.currentTarget) setFrameProperties(null) }}>
      <ModalShell as="form" storageKey="animation-frame-properties" defaultWidth={340} defaultHeight={224} minWidth={300} minHeight={210} maxWidth={440} maxHeight={300} className="layer-modal frame-properties-modal" onSubmit={(event) => { event.preventDefault(); saveFrameProperties() }}>
        <header><div><span className="eyebrow">FRAME PROPERTIES</span><h2>{t('timeline.framePropertiesNumbered', { number: timeline.frames.findIndex((frame) => frame.id === frameProperties.frameId) + 1 })}</h2></div><button type="button" className="icon-button" aria-label={t('common.close')} onClick={() => setFrameProperties(null)}><PixelUtilityIcon kind="close" /></button></header>
        <div className="modal-body"><label>{t('timeline.duration')}<NumberInput autoFocus onFocus={(event) => event.currentTarget.select()} aria-label={t('timeline.duration')} value={frameProperties.duration} min={1} max={60_000} step={10} suffix="ms" onValueChange={(duration) => setFrameProperties({ ...frameProperties, duration })} /></label></div>
        <footer><button type="button" className="quiet-button" onClick={() => setFrameProperties(null)}>{t('common.cancel')}</button><button type="submit" className="primary-button">{t('common.save')}</button></footer>
      </ModalShell>
    </div>}
    {celProperties && <div className="modal-backdrop" role="presentation" onPointerDown={(event) => { if (event.target === event.currentTarget) setCelProperties(null) }}>
      <ModalShell as="form" storageKey="animation-cel-properties" defaultWidth={340} defaultHeight={224} minWidth={300} minHeight={210} maxWidth={440} maxHeight={300} className="layer-modal frame-properties-modal" onSubmit={(event) => { event.preventDefault(); saveCelProperties() }}>
        <header><div><span className="eyebrow">CEL PROPERTIES</span><h2>{t('timeline.celPropertiesNumbered', { number: timeline.frames.findIndex((frame) => frame.id === celProperties.frameId) + 1 })}</h2></div><button type="button" className="icon-button" aria-label={t('common.close')} onClick={() => setCelProperties(null)}><PixelUtilityIcon kind="close" /></button></header>
        <div className="modal-body"><label>{t('layers.opacity')}<div className="layer-opacity-control"><input aria-label={t('layers.opacity')} type="range" min="0" max="100" step="1" value={celProperties.opacity} onChange={(event) => setCelProperties({ ...celProperties, opacity: Number(event.target.value) })} /><NumberInput autoFocus aria-label={t('layers.opacityValue')} value={celProperties.opacity} min={0} max={100} onValueChange={(opacity) => setCelProperties({ ...celProperties, opacity })} /><span>%</span></div></label></div>
        <footer><button type="button" className="quiet-button" onClick={() => setCelProperties(null)}>{t('common.cancel')}</button><button type="submit" className="primary-button">{t('common.save')}</button></footer>
      </ModalShell>
    </div>}
    {layerSettingsOpen && <div className="modal-backdrop" role="presentation" onPointerDown={(event) => { if (event.target === event.currentTarget) setLayerSettingsOpen(false) }}>
      <ModalShell as="form" storageKey="layer-settings-layout-v11" defaultWidth={360} defaultHeight={530} minWidth={340} minHeight={470} maxWidth={420} maxHeight={700} className="layer-modal layer-settings-modal" onSubmit={(event) => { event.preventDefault(); saveLayerSettings() }}>
        <header><div><h2>{t('layers.settings')}</h2></div><button type="button" className="icon-button" aria-label={t('common.close')} onClick={() => setLayerSettingsOpen(false)}><PixelUtilityIcon kind="close" /></button></header>
        <div className="modal-body" onPointerDown={(event) => { if (!(event.target as Element).closest('.layer-setting-percent')) setLayerSettingsSlider(null) }}>
          <section className="layer-settings-density"><strong>{t('layers.thumbnailSize')}</strong><div><input aria-label={t('layers.thumbnailSize')} type="range" min={0} max={layerDensityOrder.length - 1} step={1} value={layerDensityOrder.indexOf(layerSettings.density)} onChange={(event) => applyLayerSettings({ ...layerSettings, density: layerDensityOrder[Number(event.target.value)] })} /><output>{t(layerDensityLabelKeys[layerSettings.density])}</output></div></section>
          <fieldset className="layer-settings-onion"><legend>{t('layers.onionSkin')}</legend><label className="preference-toggle outline-preview-toggle layer-onion-toggle"><span>{t('layers.onionSkinEnabled')}</span><input type="checkbox" checked={layerSettings.onionSkin.enabled} onChange={(event) => applyLayerSettings({ ...layerSettings, onionSkin: { ...layerSettings.onionSkin, enabled: event.target.checked } })} /><span className="toggle-track" aria-hidden="true"><i /></span></label><div className="layer-settings-pair"><label>{t('layers.previousFrames')}<NumberInput min={0} max={8} value={layerSettings.onionSkin.previousFrames} onValueChange={(value) => applyLayerSettings({ ...layerSettings, onionSkin: { ...layerSettings.onionSkin, previousFrames: value } })} /></label><label>{t('layers.nextFrames')}<NumberInput min={0} max={8} value={layerSettings.onionSkin.nextFrames} onValueChange={(value) => applyLayerSettings({ ...layerSettings, onionSkin: { ...layerSettings.onionSkin, nextFrames: value } })} /></label><label>{t('layers.previousOpacity')}<div className="brush-size-control layer-setting-percent" onPointerDown={() => setLayerSettingsSlider('previousOpacity')}><NumberInput min={0} max={100} suffix="%" value={layerSettings.onionSkin.previousOpacity} onValueChange={(value) => applyLayerSettings({ ...layerSettings, onionSkin: { ...layerSettings.onionSkin, previousOpacity: value } })} onFocus={() => setLayerSettingsSlider('previousOpacity')} />{layerSettingsSlider === 'previousOpacity' && <div className="brush-size-popover" role="dialog"><input aria-label={t('layers.previousOpacity')} type="range" min={0} max={100} value={layerSettings.onionSkin.previousOpacity} onChange={(event) => applyLayerSettings({ ...layerSettings, onionSkin: { ...layerSettings.onionSkin, previousOpacity: Number(event.target.value) } })} onBlur={() => setLayerSettingsSlider(null)} /><strong>{layerSettings.onionSkin.previousOpacity}%</strong></div>}</div></label><label>{t('layers.nextOpacity')}<div className="brush-size-control layer-setting-percent" onPointerDown={() => setLayerSettingsSlider('nextOpacity')}><NumberInput min={0} max={100} suffix="%" value={layerSettings.onionSkin.nextOpacity} onValueChange={(value) => applyLayerSettings({ ...layerSettings, onionSkin: { ...layerSettings.onionSkin, nextOpacity: value } })} onFocus={() => setLayerSettingsSlider('nextOpacity')} />{layerSettingsSlider === 'nextOpacity' && <div className="brush-size-popover" role="dialog"><input aria-label={t('layers.nextOpacity')} type="range" min={0} max={100} value={layerSettings.onionSkin.nextOpacity} onChange={(event) => applyLayerSettings({ ...layerSettings, onionSkin: { ...layerSettings.onionSkin, nextOpacity: Number(event.target.value) } })} onBlur={() => setLayerSettingsSlider(null)} /><strong>{layerSettings.onionSkin.nextOpacity}%</strong></div>}</div></label><label>{t('layers.previousColor')}<ColorValueControl color={layerSettings.onionSkin.previousColor} onChange={(color) => applyLayerSettings({ ...layerSettings, onionSkin: { ...layerSettings.onionSkin, previousColor: color } })} label={t('layers.previousColor')} /></label><label>{t('layers.nextColor')}<ColorValueControl color={layerSettings.onionSkin.nextColor} onChange={(color) => applyLayerSettings({ ...layerSettings, onionSkin: { ...layerSettings.onionSkin, nextColor: color } })} label={t('layers.nextColor')} /></label></div></fieldset>
        </div>
        <footer><button type="button" className="quiet-button" onClick={resetLayerSettings}><PixelUtilityIcon kind="restore" />{t('common.reset')}</button><span className="modal-footer-spacer" /><button type="button" className="quiet-button" onClick={() => setLayerSettingsOpen(false)}>{t('common.cancel')}</button><button type="submit" className="primary-button">{t('common.save')}</button></footer>
      </ModalShell>
    </div>}
    {form && <div className="modal-backdrop" role="presentation" onPointerDown={(event) => { if (event.target === event.currentTarget) closeProperties() }}>
      <ModalShell as="form" storageKey="layer-properties-v2" defaultWidth={380} defaultHeight={470} minWidth={340} minHeight={400} maxWidth={520} maxHeight={700} className="layer-modal" onSubmit={(event) => { event.preventDefault(); closeProperties() }} onKeyDown={(event) => {
        if (event.key !== 'Enter' || event.nativeEvent.isComposing || (event.target as HTMLElement).tagName === 'TEXTAREA') return
        event.preventDefault()
        event.stopPropagation()
        closeProperties()
      }}>
        <header><div><span className="eyebrow">{form.targets.length > 1 ? 'MULTIPLE PROPERTIES' : form.kind === 'group' ? 'GROUP PROPERTIES' : 'LAYER PROPERTIES'}</span><h2>{t(form.targets.length > 1 ? 'layers.multipleProperties' : form.kind === 'group' ? 'layers.groupProperties' : 'layers.layerProperties')}</h2></div><button type="button" className="icon-button" aria-label={t('common.close')} onClick={closeProperties}><PixelUtilityIcon kind="close" /></button></header>
        <div className="modal-body">
          <label>{t('layers.name')}<input autoFocus onFocus={(event) => event.currentTarget.select()} value={form.name} onChange={(event) => previewProperties({ ...form, name: event.target.value }, 'name')} /></label>
          <label>{t('layers.blendMode')}<ThemedSelect label={t('layers.blendMode')} value={form.blendMode} groups={blendOptionGroups} disabled={singleFormTargetLocked} onChange={(blendMode) => previewProperties({ ...form, blendMode }, 'blendMode')} /></label>
          <label>{t('layers.opacity')}<div className="layer-opacity-control"><input aria-label={t('layers.opacity')} type="range" min="0" max="100" step="1" disabled={singleFormTargetLocked} value={form.opacity} onChange={(event) => previewProperties({ ...form, opacity: Number(event.target.value) }, 'opacity')} /><NumberInput aria-label={t('layers.opacityValue')} min={0} max={100} disabled={singleFormTargetLocked} value={form.opacity} onValueChange={(opacity) => previewProperties({ ...form, opacity }, 'opacity')} /><span>%</span></div></label>
          <label className="layer-display-color-field">{t('layers.displayColor')}<div className="layer-display-color-options"><button type="button" className={`layer-color-preset no-color ${form.displayColor === null ? 'selected' : ''}`} aria-label={t('layers.noDisplayColor')} aria-pressed={form.displayColor === null} onClick={() => previewProperties({ ...form, displayColor: null }, 'displayColor')}><span /></button>{layerDisplayColorPresets.map((color) => <button key={`${color.r}-${color.g}-${color.b}`} type="button" className={`layer-color-preset ${sameColor(form.displayColor, color) ? 'selected' : ''}`} aria-label={t('layers.displayColorRgb', { r: color.r, g: color.g, b: color.b })} aria-pressed={sameColor(form.displayColor, color)} style={{ '--layer-preset-color': `rgb(${color.r} ${color.g} ${color.b})` } as React.CSSProperties} onClick={() => previewProperties({ ...form, displayColor: { ...color } }, 'displayColor')}><span /></button>)}<ColorValueControl color={form.displayColor ?? defaultLayerDisplayColor} onChange={(displayColor) => previewProperties({ ...form, displayColor }, 'displayColor')} label={t('layers.colorControl')} roleLabel={t('layers.custom')} className="layer-custom-color-trigger" /></div></label>
          <label>{t('layers.description')}<TextAreaInput rows={4} value={form.description} placeholder={t('layers.descriptionPlaceholder')} onChange={(event) => previewProperties({ ...form, description: event.target.value }, 'description')} /></label>
        </div>
      </ModalShell>
    </div>}
    {floating.style && <PanelResizeHandles onResize={floating.startResize} />}
  </section>
  <FloatingDockPreview style={floating.dockPreview} />
  </>
}
