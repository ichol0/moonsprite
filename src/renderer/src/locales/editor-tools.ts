import type { FillKind, SelectionKind, SelectionMode, ShapeKind, ToolId } from '@shared/types'
import type { AppLocale } from '@/core/localization'

interface ToolCopy { label: string; description: string }

const zhTools: Record<ToolId, ToolCopy> = {
  pencil: { label: '铅笔工具', description: '按住拖动绘制像素；按住 Shift 可从上次落点连接直线。' },
  airbrush: { label: '喷枪工具', description: '按住持续喷涂粒子；可调整粒子大小、散布范围、密度和产生频率。' },
  eraser: { label: '橡皮擦工具', description: '按住拖动擦除当前图层中的像素。' },
  selection: { label: '选区工具', description: '创建、组合或变换选区；再次单击可展开选区工具。' },
  move: { label: '移动工具', description: '拖动当前图层、所选图层或选区中的内容。' },
  shape: { label: '形状工具', description: '拖动绘制矩形或椭圆；再次单击可选择形状。' },
  fill: { label: '油漆桶工具', description: '单击填充连续区域；右键使用背景色。' },
  eyedropper: { label: '吸管工具', description: '单击或拖动读取画布颜色；右键设置背景色。' },
  hand: { label: '抓手工具', description: '按住拖动画布视图，不会修改像素内容。' },
  zoom: { label: '缩放工具', description: '拖动或单击调整视图缩放，右键执行反向缩放。' },
  rotate: { label: '旋转视图工具', description: '围绕旋转指向标拖动，只旋转当前画布视图。' }
}

const enTools: Record<ToolId, ToolCopy> = {
  pencil: { label: 'Pencil Tool', description: 'Drag to draw pixels. Hold Shift to connect a line from the previous point.' },
  airbrush: { label: 'Airbrush Tool', description: 'Hold to spray particles continuously. Adjust particle size, spread, density, and frequency.' },
  eraser: { label: 'Eraser Tool', description: 'Drag to erase pixels from the current layer.' },
  selection: { label: 'Selection Tool', description: 'Create, combine, or transform selections. Click again to open the selection tools.' },
  move: { label: 'Move Tool', description: 'Drag the current layer, selected layers, or selected content.' },
  shape: { label: 'Shape Tool', description: 'Drag to draw rectangles or ellipses. Click again to choose a shape.' },
  fill: { label: 'Paint Bucket Tool', description: 'Click to fill a contiguous area. Right-click to use the background color.' },
  eyedropper: { label: 'Eyedropper Tool', description: 'Click or drag to sample canvas colors. Right-click to set the background color.' },
  hand: { label: 'Hand Tool', description: 'Drag the canvas view without changing pixel content.' },
  zoom: { label: 'Zoom Tool', description: 'Drag or click to zoom the view. Right-click to zoom in the opposite direction.' },
  rotate: { label: 'Rotate View Tool', description: 'Drag around the rotation indicator to rotate only the current canvas view.' }
}

const zhFills: Record<FillKind, ToolCopy> = {
  bucket: { label: '油漆桶工具', description: '单击填充连续区域；右键使用背景色。' },
  gradient: { label: '渐变工具', description: '按住拖动创建前景色到背景色的线性渐变；右键反向渐变。' }
}

const enFills: Record<FillKind, ToolCopy> = {
  bucket: { label: 'Paint Bucket Tool', description: 'Click to fill a contiguous area. Right-click to use the background color.' },
  gradient: { label: 'Gradient Tool', description: 'Drag to create a linear foreground-to-background gradient. Right-click reverses it.' }
}

const zhSelections: Record<SelectionKind, ToolCopy> = {
  rectangle: { label: '矩形框选工具', description: '拖动建立矩形选区；按住 Shift 可创建正方形选区。' },
  ellipse: { label: '椭圆框选工具', description: '拖动建立椭圆选区；按住 Shift 可创建圆形选区。' },
  lasso: { label: '套索工具', description: '按住并沿目标边缘自由拖动，松开后闭合选区。' },
  'polygon-lasso': { label: '多边形套索工具', description: '逐点单击建立边界，双击、点击起点或按 Enter 完成。' },
  magic: { label: '魔棒工具', description: '单击选择颜色相近的连续区域，可在属性栏调整容差。' }
}

const enSelections: Record<SelectionKind, ToolCopy> = {
  rectangle: { label: 'Rectangular Selection Tool', description: 'Drag to create a rectangular selection. Hold Shift to create a square.' },
  ellipse: { label: 'Elliptical Selection Tool', description: 'Drag to create an elliptical selection. Hold Shift to create a circle.' },
  lasso: { label: 'Lasso Tool', description: 'Drag freely around the target edge, then release to close the selection.' },
  'polygon-lasso': { label: 'Polygonal Lasso Tool', description: 'Click to add boundary points. Double-click, click the start point, or press Enter to finish.' },
  magic: { label: 'Magic Wand Tool', description: 'Click to select a contiguous area of similar colors. Adjust tolerance in the options bar.' }
}

const zhShapes: Record<ShapeKind, ToolCopy> = {
  'rectangle-outline': { label: '矩形工具', description: '拖动绘制只有描边的矩形。' },
  rectangle: { label: '矩形填充工具', description: '拖动绘制使用前景色填充的矩形。' },
  'ellipse-outline': { label: '椭圆工具', description: '拖动绘制只有描边的椭圆。' },
  ellipse: { label: '椭圆填充工具', description: '拖动绘制使用前景色填充的椭圆。' }
}

const enShapes: Record<ShapeKind, ToolCopy> = {
  'rectangle-outline': { label: 'Rectangle Tool', description: 'Drag to draw an outlined rectangle.' },
  rectangle: { label: 'Filled Rectangle Tool', description: 'Drag to draw a rectangle filled with the foreground color.' },
  'ellipse-outline': { label: 'Ellipse Tool', description: 'Drag to draw an outlined ellipse.' },
  ellipse: { label: 'Filled Ellipse Tool', description: 'Drag to draw an ellipse filled with the foreground color.' }
}

export const editorToolCopyByLocale: Record<AppLocale, Record<ToolId, ToolCopy>> = { 'zh-CN': zhTools, 'en-US': enTools }
export const selectionToolCopyByLocale: Record<AppLocale, Record<SelectionKind, ToolCopy>> = { 'zh-CN': zhSelections, 'en-US': enSelections }
export const shapeToolCopyByLocale: Record<AppLocale, Record<ShapeKind, ToolCopy>> = { 'zh-CN': zhShapes, 'en-US': enShapes }
export const fillToolCopyByLocale: Record<AppLocale, Record<FillKind, ToolCopy>> = { 'zh-CN': zhFills, 'en-US': enFills }
export const selectionModeLabelsByLocale: Record<AppLocale, Record<SelectionMode, string>> = {
  'zh-CN': { replace: '新建', add: '加选', subtract: '减选', intersect: '交集' },
  'en-US': { replace: 'Replace', add: 'Add', subtract: 'Subtract', intersect: 'Intersect' }
}
