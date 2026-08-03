import type { SelectionKind, SelectionMode, ShapeKind, ToolId } from '@shared/types'
import type { ShortcutId } from '@/core/shortcuts'
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

export const TOOL_DEFINITIONS: Array<{ id: ToolId; label: string; description: string; icon: string; shortcutId: ShortcutId }> = [
  { id: 'pencil', label: '铅笔工具', description: '按住拖动绘制像素；按住 Shift 可从上次落点连接直线。', icon: toolPencilIcon, shortcutId: 'tool.pencil' },
  { id: 'eraser', label: '橡皮擦工具', description: '按住拖动擦除当前图层中的像素。', icon: toolEraserIcon, shortcutId: 'tool.eraser' },
  { id: 'selection', label: '选区工具', description: '创建、组合或变换选区；再次单击可展开选区工具。', icon: toolSelectionIcon, shortcutId: 'tool.selection' },
  { id: 'move', label: '移动工具', description: '拖动当前图层、所选图层或选区中的内容。', icon: toolMoveIcon, shortcutId: 'tool.move' },
  { id: 'shape', label: '形状工具', description: '拖动绘制矩形或椭圆；再次单击可选择形状。', icon: toolShapeIcon, shortcutId: 'tool.shape' },
  { id: 'fill', label: '油漆桶工具', description: '单击填充连续区域；右键使用背景色。', icon: toolFillIcon, shortcutId: 'tool.fill' },
  { id: 'eyedropper', label: '吸管工具', description: '单击或拖动读取画布颜色；右键设置背景色。', icon: toolEyedropperIcon, shortcutId: 'tool.eyedropper' },
  { id: 'hand', label: '抓手工具', description: '按住拖动画布视图，不会修改像素内容。', icon: toolHandIcon, shortcutId: 'tool.hand' },
  { id: 'zoom', label: '缩放工具', description: '拖动或单击调整视图缩放，右键执行反向缩放。', icon: toolZoomIcon, shortcutId: 'tool.zoom' },
  { id: 'rotate', label: '旋转视图工具', description: '围绕旋转指向标拖动，只旋转当前画布视图。', icon: toolRotateIcon, shortcutId: 'tool.rotate' }
]

export const SELECTION_KIND_ICONS = {
  rectangle: selectionRectangleIcon,
  ellipse: selectionEllipseIcon,
  lasso: selectionLassoIcon,
  'polygon-lasso': selectionPolygonLassoIcon,
  magic: selectionMagicIcon
} as const

export const SELECTION_KIND_DEFINITIONS: Array<{
  id: SelectionKind
  label: string
  description: string
  shortcutId: ShortcutId
}> = [
  { id: 'rectangle', label: '矩形框选工具', description: '拖动建立矩形选区；按住 Shift 可创建正方形选区。', shortcutId: 'tool.selection' },
  { id: 'ellipse', label: '椭圆框选工具', description: '拖动建立椭圆选区；按住 Shift 可创建圆形选区。', shortcutId: 'tool.selection.ellipse' },
  { id: 'lasso', label: '套索工具', description: '按住并沿目标边缘自由拖动，松开后闭合选区。', shortcutId: 'lasso' },
  { id: 'polygon-lasso', label: '多边形套索工具', description: '逐点单击建立边界，双击、点击起点或按 Enter 完成。', shortcutId: 'polygonLasso' },
  { id: 'magic', label: '魔棒工具', description: '单击选择颜色相近的连续区域，可在属性栏调整容差。', shortcutId: 'magic' }
]

export const SHAPE_KIND_DEFINITIONS: Array<{
  id: ShapeKind
  label: string
  description: string
  shortcutId: ShortcutId
  icon: string
}> = [
  { id: 'rectangle-outline', label: '矩形工具', description: '拖动绘制只有描边的矩形。', shortcutId: 'tool.shape', icon: shapeRectangleIcon },
  { id: 'rectangle', label: '矩形填充工具', description: '拖动绘制使用前景色填充的矩形。', shortcutId: 'tool.shape', icon: shapeRectangleFillIcon },
  { id: 'ellipse-outline', label: '椭圆工具', description: '拖动绘制只有描边的椭圆。', shortcutId: 'tool.shape', icon: shapeEllipseIcon },
  { id: 'ellipse', label: '椭圆填充工具', description: '拖动绘制使用前景色填充的椭圆。', shortcutId: 'tool.shape', icon: shapeEllipseFillIcon }
]

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
  shapeKind: ShapeKind
): ActiveToolPresentation => {
  if (toolId === 'selection') {
    const definition = SELECTION_KIND_DEFINITIONS.find((item) => item.id === selectionKind)!
    return { ...definition, id: toolId, icon: SELECTION_KIND_ICONS[selectionKind] }
  }
  if (toolId === 'shape') {
    const definition = SHAPE_KIND_DEFINITIONS.find((item) => item.id === shapeKind)!
    return { ...definition, id: toolId }
  }
  return TOOL_DEFINITIONS.find((item) => item.id === toolId)!
}

export const SELECTION_MODES = [
  { id: 'replace', label: '新建', icon: selectionReplaceIcon },
  { id: 'add', label: '加选', icon: selectionAddIcon },
  { id: 'subtract', label: '减选', icon: selectionSubtractIcon },
  { id: 'intersect', label: '交集', icon: selectionIntersectIcon }
] as const

export const temporarySelectionModeForModifiers = (shiftHeld: boolean, secondaryHeld: boolean): SelectionMode | null =>
  secondaryHeld ? 'subtract' : shiftHeld ? 'add' : null

export const ALL_EDITOR_TOOL_ICONS = [...new Set([
  ...TOOL_DEFINITIONS.map((item) => item.icon),
  ...Object.values(SELECTION_KIND_ICONS),
  ...SELECTION_MODES.map((item) => item.icon),
  ...SHAPE_KIND_DEFINITIONS.map((item) => item.icon)
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
