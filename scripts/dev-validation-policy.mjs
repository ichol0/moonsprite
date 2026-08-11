const normalize = (file) => file.replaceAll('\\', '/')

const vitestPattern = /^src\/.*\.(test|spec)\.[cm]?[jt]sx?$/
const nodeTestPattern = /^scripts\/.*\.test\.mjs$/

export const isExplicitDevTestFile = (file) => {
  const normalized = normalize(file)
  return vitestPattern.test(normalized) || nodeTestPattern.test(normalized)
}

export const evaluateDevValidationRequest = (requestedFiles, { highRisk = false } = {}) => {
  const files = requestedFiles.map(normalize)
  const explicitTestFiles = files.filter(isExplicitDevTestFile)
  const errors = []

  if (files.length === 0) {
    errors.push('开发检查必须显式传入本任务文件，不能自动扫描整个工作树。')
  }

  if (highRisk && explicitTestFiles.length === 0) {
    errors.push('高风险开发检查必须显式传入至少一个相关测试文件。')
  }

  return { files, explicitTestFiles, errors }
}
