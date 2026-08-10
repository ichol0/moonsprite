export const CANVAS_PERFORMANCE_SIZES = [128, 512, 1024]
export const CANVAS_PERFORMANCE_SCENARIOS = ['pan', 'zoom', 'rotated-zoom', 'draw', 'shape', 'marquee', 'bucket-fill', 'gradient']
export const COMPLEX_CANVAS_PERFORMANCE_SCENARIOS = ['complex-draw', 'complex-undo', 'complex-playback']
const SUPPORTED_SCENARIOS = [...CANVAS_PERFORMANCE_SCENARIOS, ...COMPLEX_CANVAS_PERFORMANCE_SCENARIOS]

const readOption = (args, name) => {
  const inline = args.find((argument) => argument.startsWith(`${name}=`))
  if (inline) return inline.slice(name.length + 1)
  const index = args.indexOf(name)
  return index >= 0 ? args[index + 1] : undefined
}

const parseList = (value) => value?.split(',').map((item) => item.trim()).filter(Boolean)

export function parseCanvasPerformanceOptions(rawArgs) {
  const args = rawArgs.filter((argument) => argument !== '--')
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]
    if (argument === '--full' || argument.startsWith('--size=') || argument.startsWith('--scenario=') || argument.startsWith('--repeat=') || argument.startsWith('--output-json=')) continue
    if (argument === '--size' || argument === '--scenario' || argument === '--repeat' || argument === '--output-json') {
      if (!args[index + 1] || args[index + 1].startsWith('--')) throw new Error(`${argument} 缺少参数值。`)
      index += 1
      continue
    }
    throw new Error(`未知的画布性能参数：${argument}`)
  }
  const full = args.includes('--full')
  const sizeValues = parseList(readOption(args, '--size'))
  const scenarioValues = parseList(readOption(args, '--scenario'))
  const repetitions = Number(readOption(args, '--repeat') ?? 1)
  const outputJson = readOption(args, '--output-json')
  const sizes = full || !sizeValues
    ? [...CANVAS_PERFORMANCE_SIZES]
    : sizeValues.map((value) => Number(value))
  const scenarios = full || !scenarioValues
    ? [...CANVAS_PERFORMANCE_SCENARIOS]
    : scenarioValues

  const invalidSizes = sizes.filter((size) => !CANVAS_PERFORMANCE_SIZES.includes(size))
  const invalidScenarios = scenarios.filter((scenario) => !SUPPORTED_SCENARIOS.includes(scenario))
  if (invalidSizes.length > 0) throw new Error(`不支持的画布尺寸：${invalidSizes.join(', ')}。可选值：${CANVAS_PERFORMANCE_SIZES.join(', ')}。`)
  if (invalidScenarios.length > 0) throw new Error(`不支持的画布场景：${invalidScenarios.join(', ')}。可选值：${SUPPORTED_SCENARIOS.join(', ')}。`)
  if (scenarios.some((scenario) => scenario.startsWith('complex-')) && scenarios.some((scenario) => !scenario.startsWith('complex-'))) throw new Error('复杂工程场景不能与普通画布场景混合运行。')
  if (full && (sizeValues || scenarioValues)) throw new Error('`--full` 不能与 `--size` 或 `--scenario` 同时使用。')
  if (!Number.isInteger(repetitions) || repetitions < 1 || repetitions > 10) throw new Error('`--repeat` 必须是 1 至 10 的整数。')

  return { full, sizes, scenarios, repetitions, outputJson }
}
