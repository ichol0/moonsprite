import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { analyzePerformance } from './performance-analysis.mjs'
import { classifyPerformanceAudit } from './performance-scope-rules.mjs'
import { confirmCanvasCandidate, executePerformanceSuites } from './performance-executor.mjs'
import {
  PERFORMANCE_ARTIFACT_ROOT,
  PERFORMANCE_BASELINE_PATH,
  normalizeSuiteReports,
  parseAuditArguments,
  performanceReportMarkdown,
  readOptionalJson,
  writeJson,
} from './performance-audit-store.mjs'
import { currentReleaseLabel, performanceEnvironment, performanceSourceFingerprint, workingTreeFiles } from './performance-runtime.mjs'

const options = parseAuditArguments(process.argv.slice(2))
const files = options.files.length > 0 ? options.files : workingTreeFiles()
const scope = classifyPerformanceAudit(files, {
  minimumLevel: options.release ? 'P3' : 'P0',
  releaseAudit: options.release,
})
const id = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').replace('Z', '')
const directory = resolve(PERFORMANCE_ARTIFACT_ROOT, id)
await mkdir(directory, { recursive: true })

const environment = performanceEnvironment()
const sourceFingerprint = performanceSourceFingerprint()
const baseline = await readOptionalJson(PERFORMANCE_BASELINE_PATH)
const reports = await executePerformanceSuites(scope.suites, directory)
let metrics = normalizeSuiteReports(scope.suites, reports)
let analysis = analyzePerformance(metrics, baseline, environment)

if (analysis.candidate?.target.kind === 'canvas') {
  const suite = scope.suites.find((item) => item.id === analysis.candidate.suiteId)
  reports[suite.id] = await confirmCanvasCandidate(suite, analysis.candidate, directory, reports[suite.id])
  metrics = normalizeSuiteReports(scope.suites, reports)
  analysis = analyzePerformance(metrics, baseline, environment)
}

const audit = {
  schemaVersion: 1,
  id,
  createdAt: new Date().toISOString(),
  releaseLabel: currentReleaseLabel(),
  releaseAudit: options.release,
  ci: options.ci,
  files,
  scope,
  environment,
  sourceFingerprint,
  metrics,
  analysis,
  attempts: [],
  status: analysis.candidate ? analysis.candidate.permission === 'auto-low-risk' ? 'candidate-ready' : 'approval-required' : 'uncovered',
}

await writeJson(resolve(directory, 'audit.json'), audit)
await writeJson(resolve(directory, 'decision.json'), {
  auditId: id,
  status: audit.status,
  severity: analysis.severity,
  candidate: analysis.candidate,
})
await writeFile(resolve(directory, 'report.md'), performanceReportMarkdown(audit), 'utf8')

console.log(`性能审计编号：${id}`)
console.log(`性能等级：${scope.level}`)
console.log(`报告：${resolve(directory, 'report.md')}`)
if (!analysis.candidate) console.log('没有自动基准覆盖的候选，发布前需要人工确认。')
else console.log(`优化候选：${analysis.candidate.label}；权限：${analysis.candidate.permission}`)
