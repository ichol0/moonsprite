import { readdir, readFile } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createScanner, SyntaxKind } from 'typescript/unstable/ast'
import { readArchitectureBudget } from './architecture-budget.mjs'

const ROOT = 'src/renderer/src'
const normalize = (file) => file.replaceAll('\\', '/')

const importedModules = (source) => {
  const scanner = createScanner(true, undefined, source)
  const modules = []
  let previous
  let twoBack
  let previousEnd = -1
  while (true) {
    const kind = scanner.scan()
    if (kind === SyntaxKind.EndOfFile) break
    const end = scanner.getTokenEnd()
    if (end <= previousEnd) break
    previousEnd = end
    const token = { kind, value: scanner.getTokenValue() }
    if (kind === SyntaxKind.StringLiteral) {
      if (previous?.kind === SyntaxKind.FromKeyword || previous?.kind === SyntaxKind.ImportKeyword) {
        modules.push({ specifier: token.value, pos: scanner.getTokenStart() })
      } else if (previous?.kind === SyntaxKind.OpenParenToken && twoBack?.kind === SyntaxKind.ImportKeyword) {
        modules.push({ specifier: token.value, pos: scanner.getTokenStart() })
      }
    }
    twoBack = previous
    previous = token
  }
  return modules
}

const pointsTo = (specifier, area) => (
  specifier.startsWith(`@/${area}/`)
  || specifier === `@/${area}`
  || specifier.includes(`/${area}/`)
  || specifier.endsWith(`/${area}`)
)

export const moduleBoundaryFindings = (file, source) => {
  const normalizedFile = normalize(file)
  const findings = []
  const isTest = /\.(test|spec)\.[cm]?[jt]sx?$/.test(normalizedFile)
  const inPlatform = normalizedFile.startsWith(`${ROOT}/platform/`)
  const inCore = normalizedFile.startsWith(`${ROOT}/core/`)
  const inStore = normalizedFile.startsWith(`${ROOT}/store/`)

  for (const imported of importedModules(source)) {
    const { specifier } = imported
    const add = (message) => findings.push({
      file: normalizedFile,
      line: source.slice(0, imported.pos).split(/\r?\n/).length,
      message,
    })
    if (specifier.startsWith('@tauri-apps/') && !inPlatform) {
      add(`Tauri API 只能由 platform/ 访问（${specifier}）`)
    }
    if (isTest) continue
    if (inCore && (/^react(?:-dom)?(?:\/|$)/.test(specifier) || pointsTo(specifier, 'components') || pointsTo(specifier, 'platform'))) {
      add(`core/ 不得依赖 React、components/ 或 platform/（${specifier}）`)
    }
    if (inCore && pointsTo(specifier, 'store')) {
      add(`core/ 不得依赖 store/（${specifier}）`)
    }
    if (inStore && pointsTo(specifier, 'components')) {
      add(`store/ 不得依赖 components/（${specifier}）`)
    }
  }
  return findings
}

export const moduleBoundaryErrors = (file, source) => moduleBoundaryFindings(file, source)
  .map((finding) => `${finding.file}: ${finding.message}`)

const sourceFiles = async (directory) => {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) files.push(...await sourceFiles(path))
    else if (/\.[cm]?[jt]sx?$/.test(entry.name)) files.push(path)
  }
  return files
}

const run = async () => {
  const findings = []
  for (const path of await sourceFiles(ROOT)) {
    const file = normalize(relative(process.cwd(), path))
    findings.push(...moduleBoundaryFindings(file, await readFile(path, 'utf8')))
  }
  const budget = await readArchitectureBudget()
  const remaining = budget.rules['module-boundary-debt']?.remaining
  if (!Number.isInteger(remaining)) {
    console.error('模块边界检查失败：架构债务预算缺少 module-boundary-debt。')
    process.exitCode = 1
    return
  }
  if (findings.length !== remaining) {
    console.error('模块边界检查失败：')
    for (const item of findings) console.error(`- ${item.file}:${item.line} ${item.message}`)
    if (findings.length > remaining) console.error(`- 新增了模块边界债务：实际 ${findings.length}，预算 ${remaining}。`)
    else console.error(`- 模块边界债务已降至 ${findings.length}，请同步把预算从 ${remaining} 下调。`)
    process.exitCode = 1
    return
  }
  console.log(`模块边界检查通过：当前 ${findings.length} 项到期迁移债务，未使用按文件白名单。`)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await run()
