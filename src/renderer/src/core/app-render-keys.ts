import type { DocumentSession } from '@/store/workspace'

interface DocumentTabsState {
  activeId: string | null
  sessions: Array<Pick<DocumentSession, 'document'>>
}

interface AppCoordinatorState {
  activeId: string | null
  sessions: DocumentSession[]
  dialog: {
    title: string
    message: string
    detail?: string
    choices: Array<{ id: string; label: string; tone?: string }>
  } | null
  saveProgress: { title: string; value: number; label: string } | null
}

const colorKey = (color: DocumentSession['primaryColor']): string =>
  `${color.r},${color.g},${color.b},${color.a}`

export const documentTabsRenderKey = (state: DocumentTabsState): string => [
  state.activeId ?? '',
  state.sessions.map((session) => `${session.document.id}:${session.document.name}:${session.document.dirty ? 1 : 0}`).join('|')
].join(';')

export const appCoordinatorRenderKey = (state: AppCoordinatorState): string => {
  const session = state.sessions.find((item) => item.document.id === state.activeId)
  const preview = session?.canvasResizePreview
  return [
    state.activeId ?? '',
    state.sessions.map((item) => item.document.id).join(','),
    session?.document.width ?? 0,
    session?.document.height ?? 0,
    session?.tool ?? '',
    session?.selectionKind ?? '',
    session?.shapeKind ?? '',
    session?.fillKind ?? 'bucket',
    session?.view.showPixelGrid ? 1 : 0,
    session?.view.showGrid ? 1 : 0,
    session?.view.grid ? `${session.view.grid.x}:${session.view.grid.y}:${session.view.grid.width}:${session.view.grid.height}` : '',
    session?.view.relativeLuminance ? 1 : 0,
    session?.view.showSelectionOutline === false ? 0 : 1,
    preview ? `${preview.width}:${preview.height}:${preview.offsetX}:${preview.offsetY}` : '',
    state.saveProgress ? `${state.saveProgress.title}:${state.saveProgress.value}:${state.saveProgress.label}` : '',
    state.dialog ? `${state.dialog.title}:${state.dialog.message}:${state.dialog.detail ?? ''}:${state.dialog.choices.map((choice) => `${choice.id}:${choice.label}:${choice.tone ?? ''}`).join('|')}` : ''
  ].join(';')
}

export const toolRailRenderKey = (session: DocumentSession | null): string => session
  ? `${session.document.id}:${session.tool}:${session.selectionKind}:${session.shapeKind}:${session.fillKind ?? 'bucket'}`
  : ''

export const appMenuRenderKey = (session: DocumentSession | null): string => session
  ? [
      session.document.id,
      session.document.colorMode,
      session.document.layers.length,
      session.document.filePath ?? '',
      session.document.sourceFilePath ?? '',
      session.history.canUndo ? 1 : 0,
      session.history.canRedo ? 1 : 0,
      session.selection ? 1 : 0,
      session.selectedGroupId ?? '',
      session.selectedGroupIds.join(','),
      session.selectedLayerIds.join(','),
      session.view.showPixelGrid ? 1 : 0,
      session.view.showGrid ? 1 : 0,
      session.view.grid ? `${session.view.grid.x}:${session.view.grid.y}:${session.view.grid.width}:${session.view.grid.height}` : '',
      session.view.relativeLuminance ? 1 : 0,
      session.view.showSelectionOutline === false ? 0 : 1,
      session.view.mirrored ? 1 : 0,
      session.view.mirroredVertical ? 1 : 0
    ].join(';')
  : ''

export const toolOptionsRenderKey = (session: DocumentSession | null): string => {
  if (!session) return ''
  const imageSettings = session.brushImageSettings
  const brush = session.brushImage
  const proceduralSettings = brush && brush.id in session.proceduralBrushSettings
    ? session.proceduralBrushSettings[brush.id as keyof typeof session.proceduralBrushSettings]
    : null
  return [
    session.document.id,
    session.tool,
    session.brushSize,
    session.brushShape,
    session.brushTexture,
    session.brushTextureScale,
    session.brushPaintMode,
    session.brushImageId ?? '',
    brush ? `${brush.id}:${brush.name}:${brush.width}:${brush.height}:${brush.intrinsicSize ? 1 : 0}` : '',
    session.brushImageTemporary ? 1 : 0,
    `${imageSettings.mode}:${imageSettings.blackPoint}:${imageSettings.whitePoint}:${imageSettings.threshold}:${imageSettings.invert ? 1 : 0}`,
    proceduralSettings ? `${proceduralSettings.scale}:${proceduralSettings.detail}:${proceduralSettings.variation}:${proceduralSettings.angle}:${proceduralSettings.seed}` : '',
    session.proceduralAntialias ? 1 : 0,
    session.proceduralAntialiasStrength,
    session.shapeKind,
    session.shapeRatio?.width ?? '',
    session.shapeRatio?.height ?? '',
    session.fillMode,
    session.fillKind ?? 'bucket',
    session.gradientDither ?? 'none',
    session.moveAutoSelect ? 1 : 0,
    session.selectionKind,
    session.selectionMode,
    session.wandTolerance,
    session.wandContiguous ? 1 : 0,
    session.perfectPixels ? 1 : 0,
    session.symmetryAxes?.horizontal ? 1 : 0,
    session.symmetryAxes?.vertical ? 1 : 0,
    session.symmetryAxes?.diagonalUp ? 1 : 0,
    session.symmetryAxes?.diagonalDown ? 1 : 0,
    session.symmetryCenter?.x ?? '',
    session.symmetryCenter?.y ?? '',
    Math.round(session.view.rotation * 10),
    session.history.canUndo ? 1 : 0,
    session.history.canRedo ? 1 : 0,
    colorKey(session.primaryColor),
    colorKey(session.secondaryColor),
    (session.document.customBrushes ?? []).map((item) => `${item.id}:${item.name}:${item.width}:${item.height}`).join('|')
  ].join(';')
}

export const statusBarRenderKey = (
  session: DocumentSession | null,
  message: string | null
): string => session
  ? [
      session.document.id,
      session.document.colorMode,
      session.document.layers.length,
      Math.round(session.view.zoom * 100),
      session.selection ? `${session.selection.width}:${session.selection.height}` : '',
      message ?? ''
    ].join(';')
  : `home;${message ?? ''}`
