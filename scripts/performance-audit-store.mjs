import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { normalizeBundleReport, normalizeCanvasResults, normalizeVitestBenchmark } from './performance-analysis.mjs'

export const PERFORMANCE_ARTIFACT_ROOT = 'artifacts/performance'
export const PERFORMANCE_BASELINE_PATH = 'docs/testing/performance-baseline-data.json'
export const PERFORMANCE_RECEIPT_PATH = 'docs/testing/performance-release-receipt.json'

export async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'))
}

export async function readOptionalJson(path) {
  return existsSync(path) ? readJson(path) : null
}

export async function writeJson(path, value) {
  await mkdir(resolve(path, '..'), { recursive: true })
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

export function normalizeSuiteReports(suites, reports) {
  return suites.flatMap((suite) => {
    const report = reports[suite.id]
    if (!report) return []
    if (suite.kind === 'canvas') return normalizeCanvasResults(report.results, suite.id, { reactOnly: suite.runtime === 'profile' })
    if (suite.kind === 'vitest-benchmark') return normalizeVitestBenchmark(report, suite.id)
    if (suite.kind === 'bundle') return normalizeBundleReport(report, suite.id)
    return []
  })
}

const percent = (value) => value === null || value === undefined ? '-' : `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`

export function performanceReportMarkdown(audit) {
  const candidate = audit.analysis.candidate
  const lines = [
    `# 性能审计 ${audit.id}`,
    '',
    `- 发布目标：${audit.releaseLabel}`,
    `- 性能等级：${audit.scope.level}`,
    `- 历史基线可比：${audit.analysis.comparable ? '是' : '否'}`,
    `- 总体状态：${audit.analysis.severity}`,
    `- 优化轮次上限：2`,
    '',
    '## 候选',
    '',
  ]
  if (!candidate) lines.push('没有可测量候选；发布前需要人工确认未覆盖范围。')
  else lines.push(
    `- 指标：${candidate.label}`,
    `- 当前值：${candidate.value.toFixed(3)}`,
    `- 相对基线：${percent(candidate.deltaPercent)}`,
    `- 测量噪声：${candidate.noisePercent.toFixed(2)}%`,
    `- 自动化权限：${candidate.permission}`,
    `- 优化方向：${candidate.recommendation}`,
    '',
    candidate.permission === 'auto-low-risk'
      ? '允许本地代理尝试一项低风险优化；优化后必须运行相关正确性测试和定向复测。'
      : '候选涉及高风险或跨层语义；先输出具体方案并等待用户确认，禁止自动修改。',
  )
  lines.push('', '## 套件', '', ...audit.scope.suites.map((suite) => `- ${suite.id} (${suite.kind})`), '')
  return `${lines.join('\n')}\n`
}

export function parseAuditArguments(args) {
  const values = args.filter((argument) => argument !== '--')
  const option = (name) => values.find((argument) => argument.startsWith(`${name}=`))?.slice(name.length + 1)
  const options = new Set(values.filter((argument) => argument.startsWith('--') && !argument.includes('=')))
  const files = values.filter((argument) => !argument.startsWith('--'))
  return {
    auditId: option('--audit'),
    outcome: option('--outcome'),
    reason: option('--reason'),
    release: options.has('--release'),
    ci: options.has('--ci'),
    correctnessPassed: options.has('--correctness-passed'),
    userApproved: options.has('--user-approved'),
    files,
  }
}
