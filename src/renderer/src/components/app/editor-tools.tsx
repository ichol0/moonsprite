import type { FillKind, SelectionKind, SelectionMode, ShapeKind, ToolId } from '@shared/types'
import type { ShortcutId } from '@/core/shortcuts'
import { DEFAULT_APP_LOCALE, type AppLocale } from '@/core/localization'
import { editorToolCopyByLocale, fillToolCopyByLocale, selectionModeLabelsByLocale, selectionToolCopyByLocale, shapeToolCopyByLocale } from '@/locales/editor-tools'
import toolSelectionIcon from '@/assets/tool-icons/tool-selection.png'
import toolPencilIcon from '@/assets/tool-icons/tool-pencil.png'
import toolEraserIcon from '@/assets/tool-icons/tool-eraser.png'
import toolFillIcon from '@/assets/tool-icons/tool-fill.png'
import toolEyedropperIcon from '@/assets/tool-icons/tool-eyedropper.png'
import toolHandIcon from '@/assets/tool-icons/tool-hand.png'
import toolMoveIcon from '@/assets/tool-icons/tool-move.png'
import toolRotateIcon from '@/assets/tool-icons/tool-rotate.png'
import toolZoomIcon from '@/assets/tool-icons/tool-zoom.png'
import toolShapeIcon from '@/assets/tool-icons/tool-shape.png'
import selectionRectangleIcon from '@/assets/tool-icons/selection-rectangle.png'
import selectionEllipseIcon from '@/assets/tool-icons/selection-ellipse.png'
import selectionLassoIcon from '@/assets/tool-icons/selection-lasso.png'
import selectionPolygonLassoIcon from '@/assets/tool-icons/selection-polygon-lasso.png'
import selectionMagicIcon from '@/assets/tool-icons/selection-magic.png'
import selectionReplaceIcon from '@/assets/tool-icons/selection-replace.png'
import selectionAddIcon from '@/assets/tool-icons/selection-add.png'
import selectionSubtractIcon from '@/assets/tool-icons/selection-subtract.png'
import selectionIntersectIcon from '@/assets/tool-icons/selection-intersect.png'
import shapeRectangleFillIcon from '@/assets/tool-icons/shape-rectangle-fill.png'
import shapeRectangleIcon from '@/assets/tool-icons/shape-rectangle.png'
import shapeEllipseFillIcon from '@/assets/tool-icons/shape-ellipse-fill.png'
import shapeEllipseIcon from '@/assets/tool-icons/shape-ellipse.png'
import toolGradientIcon from '@/assets/tool-icons/tool-gradient-6-6.png'

const TOOL_BASE: Array<{ id: ToolId; icon: string; shortcutId: ShortcutId }> = [
  { id: 'pencil', icon: toolPencilIcon, shortcutId: 'tool.pencil' }, { id: 'eraser', icon: toolEraserIcon, shortcutId: 'tool.eraser' }, { id: 'selection', icon: toolSelectionIcon, shortcutId: 'tool.selection' }, { id: 'move', icon: toolMoveIcon, shortcutId: 'tool.move' }, { id: 'shape', icon: toolShapeIcon, shortcutId: 'tool.shape' }, { id: 'fill', icon: toolFillIcon, shortcutId: 'tool.fill' }, { id: 'eyedropper', icon: toolEyedropperIcon, shortcutId: 'tool.eyedropper' }, { id: 'hand', icon: toolHandIcon, shortcutId: 'tool.hand' }, { id: 'zoom', icon: toolZoomIcon, shortcutId: 'tool.zoom' }, { id: 'rotate', icon: toolRotateIcon, shortcutId: 'tool.rotate' }
]

export const toolDefinitions = (locale: AppLocale) => TOOL_BASE.map((item) => ({ ...item, ...editorToolCopyByLocale[locale][item.id] }))
export const TOOL_DEFINITIONS = toolDefinitions(DEFAULT_APP_LOCALE)

export const SELECTION_KIND_ICONS = {
  rectangle: selectionRectangleIcon,
  ellipse: selectionEllipseIcon,
  lasso: selectionLassoIcon,
  'polygon-lasso': selectionPolygonLassoIcon,
  magic: selectionMagicIcon
} as const

const SELECTION_KIND_BASE: Array<{
  id: SelectionKind
  shortcutId: ShortcutId
}> = [
  { id: 'rectangle', shortcutId: 'tool.selection' }, { id: 'ellipse', shortcutId: 'tool.selection.ellipse' }, { id: 'lasso', shortcutId: 'lasso' }, { id: 'polygon-lasso', shortcutId: 'polygonLasso' }, { id: 'magic', shortcutId: 'magic' }
]
export const selectionKindDefinitions = (locale: AppLocale) => SELECTION_KIND_BASE.map((item) => ({ ...item, ...selectionToolCopyByLocale[locale][item.id] }))
export const SELECTION_KIND_DEFINITIONS = selectionKindDefinitions(DEFAULT_APP_LOCALE)

const SHAPE_KIND_BASE: Array<{
  id: ShapeKind
  shortcutId: ShortcutId
  icon: string
}> = [
  { id: 'rectangle-outline', shortcutId: 'tool.shape', icon: shapeRectangleIcon }, { id: 'rectangle', shortcutId: 'tool.shape', icon: shapeRectangleFillIcon }, { id: 'ellipse-outline', shortcutId: 'tool.shape', icon: shapeEllipseIcon }, { id: 'ellipse', shortcutId: 'tool.shape', icon: shapeEllipseFillIcon }
]
export const shapeKindDefinitions = (locale: AppLocale) => SHAPE_KIND_BASE.map((item) => ({ ...item, ...shapeToolCopyByLocale[locale][item.id] }))

const FILL_KIND_BASE: Array<{ id: FillKind; shortcutId: ShortcutId; icon: string }> = [
  { id: 'bucket', shortcutId: 'tool.fill', icon: toolFillIcon },
  { id: 'gradient', shortcutId: 'tool.fill.gradient', icon: toolGradientIcon }
]

export const fillKindDefinitions = (locale: AppLocale) => FILL_KIND_BASE.map((item) => ({ ...item, ...fillToolCopyByLocale[locale][item.id] }))
export const FILL_KIND_ICONS = Object.fromEntries(FILL_KIND_BASE.map((item) => [item.id, item.icon])) as Record<FillKind, string>
export const SHAPE_KIND_DEFINITIONS = shapeKindDefinitions(DEFAULT_APP_LOCALE)

export interface ActiveToolPresentation {
  id: ToolId
  label: string
  description: string
  icon: string
  shortcutId: ShortcutId
}

export const activeToolPresentation = (
  toolId: ToolId,
  selectionKind: SelectionKind,
  shapeKind: ShapeKind,
  locale: AppLocale = DEFAULT_APP_LOCALE,
  fillKind: FillKind = 'bucket'
): ActiveToolPresentation => {
  if (toolId === 'selection') {
    const definition = selectionKindDefinitions(locale).find((item) => item.id === selectionKind)!
    return { ...definition, id: toolId, icon: SELECTION_KIND_ICONS[selectionKind] }
  }
  if (toolId === 'shape') {
    const definition = shapeKindDefinitions(locale).find((item) => item.id === shapeKind)!
    return { ...definition, id: toolId }
  }
  if (toolId === 'fill') {
    const definition = fillKindDefinitions(locale).find((item) => item.id === fillKind)!
    return { ...definition, id: toolId }
  }
  return toolDefinitions(locale).find((item) => item.id === toolId)!
}

const SELECTION_MODE_BASE = [
  { id: 'replace', icon: selectionReplaceIcon }, { id: 'add', icon: selectionAddIcon }, { id: 'subtract', icon: selectionSubtractIcon }, { id: 'intersect', icon: selectionIntersectIcon }
] as const
export const selectionModes = (locale: AppLocale) => SELECTION_MODE_BASE.map((item) => ({ ...item, label: selectionModeLabelsByLocale[locale][item.id] }))
export const SELECTION_MODES = selectionModes(DEFAULT_APP_LOCALE)

export const temporarySelectionModeForModifiers = (shiftHeld: boolean, secondaryHeld: boolean): SelectionMode | null =>
  secondaryHeld ? 'subtract' : shiftHeld ? 'add' : null

export const ALL_EDITOR_TOOL_ICONS = [...new Set([
  ...TOOL_BASE.map((item) => item.icon),
  ...Object.values(SELECTION_KIND_ICONS),
  ...SELECTION_MODE_BASE.map((item) => item.icon),
  ...SHAPE_KIND_BASE.map((item) => item.icon),
  ...FILL_KIND_BASE.map((item) => item.icon)
])]

const pixelMasks = {
  round: ['01110', '11111', '11111', '11111', '01110'],
  square: ['11111', '11111', '11111', '11111', '11111'],
  line: ['11111'],
  rectangle: ['111111', '111111', '111111', '111111'],
  ellipse: ['011110', '111111', '111111', '011110'],
  'rectangle-outline': ['111111', '100001', '100001', '111111'],
  'ellipse-outline': ['011110', '100001', '100001', '011110']
} as const

export function PixelShapeIcon({ kind }: { kind: keyof typeof pixelMasks }) {
  const mask = pixelMasks[kind]
  return <span className={`pixel-shape-icon ${kind}`} aria-hidden="true">{mask.flatMap((row, y) => [...row].map((cell, x) => <i key={`${x}-${y}`} className={cell === '1' ? 'filled' : ''} />))}</span>
}

export function PixelAssetIcon({ src, className = '' }: { src: string; className?: string }) {
  return <img className={`pixel-asset-icon ${className}`.trim()} src={src} alt="" draggable={false} aria-hidden="true" />
}
