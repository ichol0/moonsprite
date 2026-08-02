const normalized = (file) => file.replaceAll('\\', '/')

const p4Patterns = [
  /(^|\/)pnpm-lock\.yaml$/,
  /(^|\/)vite\.config\.ts$/,
  /^src-tauri\/Cargo\.(toml|lock)$/,
]

const p3Patterns = [
  /\/CanvasStage\.tsx$/,
  /\/canvas-(composite-cache|render-plan)\.(ts|tsx)$/,
  /\/core\/(document|raster|tools)\.ts$/,
  /\/store\/workspace(-session|-history|-palette)?\.ts$/,
  /\/components\/(WorkspacePanels|PerformanceProfiler)\.tsx$/,
  /\/components\/app\/(EditorCanvasHost|EditorWorkspaceShell)\.tsx$/,
  /\/App\.tsx$/,
  /\/main\.tsx$/,
]

const p2Patterns = [
  /\/core\/(canvas-input|selection|view-geometry|palette|palette-layout|layer-operations|panel-render-keys)\.ts$/,
  /\/components\/(ColorPicker|canvas-selection-renderer|useCanvasViewPreview)\.tsx?$/,
  /\/components\/panels\/(PalettePanel|LayersPanel|ColorPanel|PreviewPanel)\.tsx$/,
]

const isTestOrMaintenance = (file) => file.endsWith('.md')
  || file.includes('/docs/')
  || file.startsWith('docs/')
  || file.startsWith('.github/')
  || file.startsWith('scripts/')
  || /\.(test|bench)\.[cm]?[jt]sx?$/.test(file)

export function classifyPerformanceImpact(files) {
  const paths = files.map(normalized).filter(Boolean)
  const matched = (patterns) => paths.some((file) => patterns.some((pattern) => pattern.test(file)))
  let level = 'P0'
  if (matched(p4Patterns)) level = 'P4'
  else if (matched(p3Patterns)) level = 'P3'
  else if (matched(p2Patterns)) level = 'P2'
  else if (paths.some((file) => !isTestOrMaintenance(file))) level = 'P1'

  const selectionAlgorithm = paths.some((file) => /\/core\/selection(?:-performance)?\.(?:ts|tsx)$/.test(file))
  const canvasInteraction = paths.some((file) => /\/(canvas-input|view-geometry|canvas-selection-renderer|useCanvasViewPreview)/.test(file))
  const commands = level === 'P4'
    ? ['pnpm bench:canvas -- --full（连续三次取中位数）', 'pnpm bench:selection', 'pnpm test:desktop']
    : level === 'P3'
      ? ['pnpm bench:canvas -- --full']
      : level === 'P2'
        ? [selectionAlgorithm
            ? 'pnpm bench:selection'
            : canvasInteraction
              ? 'pnpm bench:canvas -- --size=512 --scenario=pan,zoom'
              : '暂无对应自动基准：运行相关测试，并在性能历史标记未覆盖']
        : []
  return { level, files: paths, commands }
}
