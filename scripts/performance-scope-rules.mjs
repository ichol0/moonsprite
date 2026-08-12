import {
  CANVAS_PERFORMANCE_SCENARIOS,
  LARGE_CANVAS_PERFORMANCE_SCENARIOS,
  STANDARD_CANVAS_PERFORMANCE_SIZES,
} from './canvas-performance-options.mjs'

const normalized = (file) => file.replaceAll('\\', '/')

const p4Patterns = [
  /(^|\/)pnpm-lock\.yaml$/,
  /(^|\/)vite\.config\.ts$/,
  /^src-tauri\/Cargo\.(toml|lock)$/,
]

const p3Patterns = [
  /\/CanvasStage\.tsx$/,
  /\/(canvas|onion-skin)-composite-cache\.(ts|tsx)$/,
  /\/canvas-render-plan\.(ts|tsx)$/,
  /\/core\/(animation|animation-thumbnail|document|gif|onion-skin|raster|timelapse|tools)\.ts$/,
  /\/core\/(project-format|document-files)\.ts$/,
  /\/workers\/(document-decode|timelapse-encode)\.worker\.ts$/,
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
  return classifyPerformanceAudit(files)
}

const levelRank = { P0: 0, P1: 1, P2: 2, P3: 3, P4: 4 }

const canvasSuite = (id, sizes, scenarios, repetitions = 1, runtime = 'production') => ({ id, kind: 'canvas', sizes, scenarios, repetitions, runtime })
const benchmarkSuite = (id, file) => ({ id, kind: 'vitest-benchmark', file })

const largeCanvasSuites = () => [
  canvasSuite('canvas-large-800', [800], [...LARGE_CANVAS_PERFORMANCE_SCENARIOS]),
  canvasSuite('canvas-large-2048', [2048], [...LARGE_CANVAS_PERFORMANCE_SCENARIOS]),
  canvasSuite('canvas-large-4000', [4000], [...LARGE_CANVAS_PERFORMANCE_SCENARIOS]),
]

const largeSentinelSuite = () => canvasSuite('canvas-large-sentinel', [2048, 4000], ['large-detail-pan', 'large-detail-draw'], 3)

export function classifyPerformanceAudit(files, options = {}) {
  const paths = files.map(normalized).filter(Boolean)
  const matched = (patterns) => paths.some((file) => patterns.some((pattern) => pattern.test(file)))
  let level = 'P0'
  if (matched(p4Patterns)) level = 'P4'
  else if (matched(p3Patterns)) level = 'P3'
  else if (matched(p2Patterns)) level = 'P2'
  else if (paths.some((file) => !isTestOrMaintenance(file))) level = 'P1'

  const minimumLevel = options.minimumLevel ?? 'P0'
  if (levelRank[minimumLevel] > levelRank[level]) level = minimumLevel

  const selectionAlgorithm = paths.some((file) => /\/core\/selection(?:-performance)?\.(?:ts|tsx)$/.test(file))
  const projectFormat = paths.some((file) => /\/core\/(?:project-format|document-files)\.ts$/.test(file) || /\/workers\/document-decode\.worker\.ts$/.test(file))
  const canvasInteraction = paths.some((file) => /\/(canvas-input|view-geometry|canvas-selection-renderer|useCanvasViewPreview)/.test(file))
  const complexDocument = paths.some((file) => /\/(animation|animation-thumbnail|document|layer-operations|onion-skin|timelapse|workspace|LayersPanel|PreviewPanel)/.test(file))
  const includeReleaseComplexSuite = options.releaseAudit === true
  const suites = []

  if (level === 'P4') {
    suites.push(
      canvasSuite('canvas-standard', [...STANDARD_CANVAS_PERFORMANCE_SIZES], [...CANVAS_PERFORMANCE_SCENARIOS], 3),
      canvasSuite('canvas-profile', [512, 1024], [...CANVAS_PERFORMANCE_SCENARIOS], 3, 'profile'),
      canvasSuite('canvas-complex', [800, 1024], ['complex-draw', 'complex-undo', 'complex-playback'], 3),
      ...largeCanvasSuites(),
      largeSentinelSuite(),
      benchmarkSuite('selection', 'src/renderer/src/core/selection-performance.bench.ts'),
      benchmarkSuite('document-composite', 'src/renderer/src/core/document-performance.bench.ts'),
      benchmarkSuite('project-format', 'src/renderer/src/core/project-format-performance.bench.ts'),
      { id: 'bundle', kind: 'bundle' },
      { id: 'desktop', kind: 'desktop' },
    )
  } else if (level === 'P3') {
    suites.push(
      canvasSuite('canvas-standard', [...STANDARD_CANVAS_PERFORMANCE_SIZES], [...CANVAS_PERFORMANCE_SCENARIOS]),
      canvasSuite('canvas-profile', [1024], ['zoom', 'draw', 'bucket-fill'], 3, 'profile'),
      ...largeCanvasSuites(),
      largeSentinelSuite(),
    )
    if (includeReleaseComplexSuite || complexDocument) {
      suites.push(canvasSuite('canvas-complex', [1024], ['complex-draw', 'complex-undo', 'complex-playback'], includeReleaseComplexSuite ? 3 : 1))
    }
    if (complexDocument) suites.push(benchmarkSuite('document-composite', 'src/renderer/src/core/document-performance.bench.ts'))
    if (projectFormat || includeReleaseComplexSuite) suites.push(benchmarkSuite('project-format', 'src/renderer/src/core/project-format-performance.bench.ts'))
    if (selectionAlgorithm) suites.push(benchmarkSuite('selection', 'src/renderer/src/core/selection-performance.bench.ts'))
    suites.push({ id: 'bundle', kind: 'bundle' })
  } else if (level === 'P2') {
    if (selectionAlgorithm) suites.push(benchmarkSuite('selection', 'src/renderer/src/core/selection-performance.bench.ts'))
    else if (projectFormat) suites.push(benchmarkSuite('project-format', 'src/renderer/src/core/project-format-performance.bench.ts'))
    else if (canvasInteraction) suites.push(canvasSuite('canvas-interaction', [512], ['pan', 'zoom']))
    else if (complexDocument) suites.push(canvasSuite('canvas-complex', [512], ['complex-draw', 'complex-undo', 'complex-playback']))
    else suites.push({ id: 'uncovered', kind: 'uncovered' })
  }

  const commands = suites.map((suite) => {
    if (suite.kind === 'canvas' && suite.id === 'canvas-standard') return `pnpm bench:canvas -- --full${suite.repetitions > 1 ? ` --repeat=${suite.repetitions}` : ''}`
    if (suite.kind === 'canvas' && suite.runtime === 'profile') return `pnpm bench:canvas:profile -- --size=${suite.sizes.join(',')} --scenario=${suite.scenarios.join(',')}${suite.repetitions > 1 ? ` --repeat=${suite.repetitions}` : ''}`
    if (suite.kind === 'canvas') return `pnpm bench:canvas -- --size=${suite.sizes.join(',')} --scenario=${suite.scenarios.join(',')} --runtime=${suite.runtime}`
    if (suite.kind === 'vitest-benchmark') return `pnpm exec vitest bench ${suite.file} --run`
    if (suite.kind === 'bundle') return 'pnpm build:web（记录包体积）'
    if (suite.kind === 'desktop') return 'pnpm test:desktop'
    return '暂无对应自动基准：运行相关测试，并在性能历史标记未覆盖'
  })
  return { level, files: paths, suites, commands }
}
