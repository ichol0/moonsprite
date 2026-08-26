const normalize = (file) => file.replaceAll('\\', '/')

const vitestPattern = /^src\/.*\.(test|spec)\.[cm]?[jt]sx?$/
const nodeTestPattern = /^scripts\/.*\.test\.mjs$/

const nonApplicationPattern = /^(?:docs\/|CHANGELOG(?:\.[^/]+)?$|.*\.(?:css|md|scss|txt)$)/
const quickRendererPattern = /^src\/renderer\/src\/(?:components\/|styles\.css$|locales\/|assets\/)/

const normalizeList = (files) => files.map(normalize).filter(Boolean)

// D1 covers presentation work whose correctness is primarily user-visible.
// Keep domain and shared TypeScript on the stricter D2 path.
export const classifyDevTier = (requestedFiles, { highRisk = false } = {}) => {
  const files = normalizeList(requestedFiles)
  if (highRisk) return 'D3'
  if (files.length > 0 && files.every((file) => nonApplicationPattern.test(file))) return 'D0'
  if (files.length > 0 && files.every((file) => quickRendererPattern.test(file))) return 'D1'
  return 'D2'
}

export const isExplicitDevTestFile = (file) => {
  const normalized = normalize(file)
  return vitestPattern.test(normalized) || nodeTestPattern.test(normalized)
}

export const evaluateDevValidationRequest = (requestedFiles, { highRisk = false, strict = false } = {}) => {
  const files = normalizeList(requestedFiles)
  const explicitTestFiles = files.filter(isExplicitDevTestFile)
  const tier = classifyDevTier(files, { highRisk })
  const errors = []

  if (files.length === 0) {
    errors.push('开发检查必须显式传入本任务文件，不能自动扫描整个工作树。')
  }

  if (highRisk && explicitTestFiles.length === 0) {
    errors.push('高风险开发检查必须显式传入至少一个相关测试文件。')
  }

  return {
    files,
    explicitTestFiles,
    errors,
    tier,
    runTypecheck: strict || (tier !== 'D0' && tier !== 'D1'),
  }
}
