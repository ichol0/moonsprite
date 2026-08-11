import type { AppLocale } from '@/core/localization'
import type { ShortcutGroupId, ShortcutId } from '@/core/shortcuts'

const zhGroups: Record<ShortcutGroupId, string> = {
  animation: '动画',
  file: '文件', tools: '工具', selection: '选区', image: '图像', colors: '颜色', adjustments: '调整', layers: '图层', view: '视图', commands: '编辑', modifiers: '修饰键', help: '帮助'
}

const enGroups: Record<ShortcutGroupId, string> = {
  animation: 'Animation',
  file: 'File', tools: 'Tools', selection: 'Selection', image: 'Image', colors: 'Color', adjustments: 'Adjustments', layers: 'Layers', view: 'View', commands: 'Edit', modifiers: 'Modifiers', help: 'Help'
}

const zhLabels: Record<ShortcutId, string> = {
  toggleClippingMask: '剪贴蒙版',
  addAnimationFrame: '新增帧', addBlankAnimationFrame: '新建空帧', deleteAnimationFrame: '删除帧', copyAnimationCel: '复制单元格',
  newDocument: '新建工程', openDocument: '打开工程', closeDocument: '关闭工程', openProjectFolder: '在文件夹中打开', exportDocument: '导出',
  'tool.pencil': '画笔', 'tool.eraser': '橡皮擦', 'tool.selection': '矩形选区', 'tool.selection.ellipse': '椭圆选区', 'tool.move': '移动工具', 'tool.shape': '形状工具', 'tool.fill': '油漆桶', 'tool.fill.gradient': '渐变工具', 'tool.eyedropper': '吸管', 'tool.hand': '抓手', 'tool.zoom': '缩放工具', 'tool.rotate': '旋转视图',
  lasso: '套索选区', polygonLasso: '多边形套索', magic: '魔棒选区', canvasResize: '调整画布大小', imageResize: '调整图像大小', transform: '变换', outline: '描边', adjustmentColorBalance: '色彩平衡', adjustmentBrightnessContrast: '亮度/对比度', adjustmentHueSaturation: '色相/饱和度', adjustmentCurves: '曲线', openShortcutSettings: '快捷键设置', openPreferences: '首选项', flipVertical: '垂直翻转', flipHorizontal: '水平翻转', selectAll: '全选', invertSelection: '反选选区', deselect: '取消选择', createBrushFromSelection: '从选区创建笔刷',
  copy: '复制', cut: '剪切', paste: '粘贴', pasteAsNewLayer: '粘贴为新图层', pasteAsNewDocument: '粘贴为新项目', save: '保存', saveAs: '另存为', undo: '撤销', redo: '重做', relativeLuminance: '查看相对明暗', advancedMode: '高级模式', fillForeground: '填充前景色', swapForegroundBackground: '交换前景色与背景色', replaceColor: '替换颜色', convertColorMode: '转换颜色模式', newLayer: '新建图层', createLayerGroup: '新建图层组', duplicateLayer: '复制图层', mergeLayerDown: '向下合并', mergeSelectedLayers: '合并所选图层', mergeLayerGroup: '合并图层组', mergeVisibleLayers: '合并可见图层', ungroupLayers: '解组', deleteLayer: '删除图层或选区', toggleSelectionOutline: '显示或隐藏蚂蚁线', mirrorView: '水平镜像视图', mirrorViewVertical: '垂直镜像视图', toggleGrid: '显示像素网格', toggleCustomGrid: '显示自定义网格', rotateViewClockwise90: '顺时针旋转视图 90°', rotateViewCounterClockwise90: '逆时针旋转视图 90°', resetView: '复位视图', toggleColorPanel: '显示或隐藏颜色栏目', togglePalettePanel: '显示或隐藏调色板栏目', toggleLayersPanel: '显示或隐藏图层栏目', togglePreviewPanel: '显示或隐藏预览栏目', toolRailLeft: '工具栏放到左侧', toolRailRight: '工具栏放到右侧', openComponentLibrary: '组件库', openAbout: '关于 MoonSprite',
  brushSizeDecrease: '减小笔刷尺寸', brushSizeIncrease: '增大笔刷尺寸', temporaryEyedropper: '临时吸色', copySelectionContent: '复制选区内容', copyLayerOnDrag: '拖动复制图层', constrainAxis: '水平或垂直约束', addToSelection: '加选', proportionalSelectionTransform: '选区固定比例缩放', integerSelectionScale: '选区整数倍缩放', snapSelectionRotation: '选区八方向旋转', snapViewRotation: '视图八方向旋转', resetViewRotation: '旋转视图临时复位', temporaryPan: '临时抓手', brushSizeAdjust: '拖动调整笔刷尺寸', brushSizeWheelAdjust: '滚轮调整笔刷尺寸', lineConnectionMode: '直线连接模式', constrainLineDirections: '约束直线方向'
}

const enLabels: Record<ShortcutId, string> = {
  toggleClippingMask: 'Clipping Mask',
  addAnimationFrame: 'Add Frame', addBlankAnimationFrame: 'New Blank Frame', deleteAnimationFrame: 'Delete Frame', copyAnimationCel: 'Copy Cel',
  newDocument: 'New Project', openDocument: 'Open Project', closeDocument: 'Close Project', openProjectFolder: 'Show in Folder', exportDocument: 'Export',
  'tool.pencil': 'Pencil', 'tool.eraser': 'Eraser', 'tool.selection': 'Rectangular Selection', 'tool.selection.ellipse': 'Elliptical Selection', 'tool.move': 'Move Tool', 'tool.shape': 'Shape Tool', 'tool.fill': 'Paint Bucket', 'tool.fill.gradient': 'Gradient Tool', 'tool.eyedropper': 'Eyedropper', 'tool.hand': 'Hand Tool', 'tool.zoom': 'Zoom Tool', 'tool.rotate': 'Rotate View',
  lasso: 'Lasso Selection', polygonLasso: 'Polygonal Lasso', magic: 'Magic Wand Selection', canvasResize: 'Canvas Size', imageResize: 'Image Size', transform: 'Transform', outline: 'Outline', adjustmentColorBalance: 'Color Balance', adjustmentBrightnessContrast: 'Brightness/Contrast', adjustmentHueSaturation: 'Hue/Saturation', adjustmentCurves: 'Curves', openShortcutSettings: 'Keyboard Shortcuts', openPreferences: 'Preferences', flipVertical: 'Flip Vertically', flipHorizontal: 'Flip Horizontally', selectAll: 'Select All', invertSelection: 'Invert Selection', deselect: 'Deselect', createBrushFromSelection: 'Create Brush from Selection',
  copy: 'Copy', cut: 'Cut', paste: 'Paste', pasteAsNewLayer: 'Paste as New Layer', pasteAsNewDocument: 'Paste as New Project', save: 'Save', saveAs: 'Save As', undo: 'Undo', redo: 'Redo', relativeLuminance: 'Relative Luminance', advancedMode: 'Advanced Mode', fillForeground: 'Fill with Foreground Color', swapForegroundBackground: 'Swap Foreground and Background', replaceColor: 'Replace Color', convertColorMode: 'Convert Color Mode', newLayer: 'New Layer', createLayerGroup: 'New Layer Group', duplicateLayer: 'Duplicate Layer', mergeLayerDown: 'Merge Down', mergeSelectedLayers: 'Merge Selected Layers', mergeLayerGroup: 'Merge Layer Group', mergeVisibleLayers: 'Merge Visible Layers', ungroupLayers: 'Ungroup', deleteLayer: 'Delete Layer or Selection', toggleSelectionOutline: 'Show or Hide Marching Ants', mirrorView: 'Mirror View Horizontally', mirrorViewVertical: 'Mirror View Vertically', toggleGrid: 'Show Pixel Grid', toggleCustomGrid: 'Show Custom Grid', rotateViewClockwise90: 'Rotate View 90° Clockwise', rotateViewCounterClockwise90: 'Rotate View 90° Counterclockwise', resetView: 'Reset View', toggleColorPanel: 'Show or Hide Color Panel', togglePalettePanel: 'Show or Hide Palette Panel', toggleLayersPanel: 'Show or Hide Layers Panel', togglePreviewPanel: 'Show or Hide Preview Panel', toolRailLeft: 'Move Toolbar to Left', toolRailRight: 'Move Toolbar to Right', openComponentLibrary: 'Component Library', openAbout: 'About MoonSprite',
  brushSizeDecrease: 'Decrease Brush Size', brushSizeIncrease: 'Increase Brush Size', temporaryEyedropper: 'Temporary Eyedropper', copySelectionContent: 'Copy Selection Content', copyLayerOnDrag: 'Duplicate Layer While Dragging', constrainAxis: 'Constrain Horizontally or Vertically', addToSelection: 'Add to Selection', proportionalSelectionTransform: 'Proportional Selection Scale', integerSelectionScale: 'Integer Selection Scale', snapSelectionRotation: 'Snap Selection Rotation to 8 Directions', snapViewRotation: 'Snap View Rotation to 8 Directions', resetViewRotation: 'Temporarily Reset View Rotation', temporaryPan: 'Temporary Hand Tool', brushSizeAdjust: 'Drag to Adjust Brush Size', brushSizeWheelAdjust: 'Wheel to Adjust Brush Size', lineConnectionMode: 'Line Connection Mode', constrainLineDirections: 'Constrain Line Directions'
}

export const shortcutGroupLabelsByLocale: Record<AppLocale, Record<ShortcutGroupId, string>> = {
  'zh-CN': zhGroups,
  'en-US': enGroups
}

export const shortcutLabelsByLocale: Record<AppLocale, Record<ShortcutId, string>> = {
  'zh-CN': zhLabels,
  'en-US': enLabels
}
