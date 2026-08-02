import type { ToolId } from '@shared/types'
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
import selectionMagicIcon from '@/assets/tool-icons/selection-magic.png'
import selectionReplaceIcon from '@/assets/tool-icons/selection-replace.png'
import selectionAddIcon from '@/assets/tool-icons/selection-add.png'
import selectionSubtractIcon from '@/assets/tool-icons/selection-subtract.png'
import selectionIntersectIcon from '@/assets/tool-icons/selection-intersect.png'

export const TOOL_DEFINITIONS: Array<{ id: ToolId; label: string; icon: string; key: string }> = [
  { id: 'pencil', label: '铅笔', icon: toolPencilIcon, key: 'B' },
  { id: 'eraser', label: '橡皮擦', icon: toolEraserIcon, key: 'E' },
  { id: 'selection', label: '选区', icon: toolSelectionIcon, key: 'M' },
  { id: 'move', label: '移动', icon: toolMoveIcon, key: 'V' },
  { id: 'shape', label: '形状', icon: toolShapeIcon, key: 'U' },
  { id: 'fill', label: '油漆桶', icon: toolFillIcon, key: 'G' },
  { id: 'eyedropper', label: '吸管', icon: toolEyedropperIcon, key: 'I' },
  { id: 'hand', label: '抓手', icon: toolHandIcon, key: 'H' },
  { id: 'zoom', label: '缩放', icon: toolZoomIcon, key: 'Z' },
  { id: 'rotate', label: '旋转视图', icon: toolRotateIcon, key: 'R' }
]

export const SELECTION_KIND_ICONS = {
  rectangle: selectionRectangleIcon,
  ellipse: selectionEllipseIcon,
  lasso: selectionLassoIcon,
  magic: selectionMagicIcon
} as const

export const SELECTION_MODES = [
  { id: 'replace', label: '新建', icon: selectionReplaceIcon },
  { id: 'add', label: '加选', icon: selectionAddIcon },
  { id: 'subtract', label: '减选', icon: selectionSubtractIcon },
  { id: 'intersect', label: '交集', icon: selectionIntersectIcon }
] as const

const pixelMasks = {
  round: ['01110', '11111', '11111', '11111', '01110'],
  square: ['11111', '11111', '11111', '11111', '11111'],
  line: ['11111'],
  rectangle: ['111111', '111111', '111111', '111111'],
  ellipse: ['011110', '111111', '111111', '011110']
} as const

export function PixelShapeIcon({ kind }: { kind: keyof typeof pixelMasks }) {
  const mask = pixelMasks[kind]
  return <span className={`pixel-shape-icon ${kind}`} aria-hidden="true">{mask.flatMap((row, y) => [...row].map((cell, x) => <i key={`${x}-${y}`} className={cell === '1' ? 'filled' : ''} />))}</span>
}

export function PixelAssetIcon({ src, className = '' }: { src: string; className?: string }) {
  return <img className={`pixel-asset-icon ${className}`.trim()} src={src} alt="" draggable={false} aria-hidden="true" />
}
