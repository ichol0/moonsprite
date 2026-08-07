import { readdir, readFile } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createScanner, SyntaxKind } from 'typescript/unstable/ast'

const ROOT = 'src/renderer/src'
const LEGACY_TAURI_IMPORTS = new Set(['src/renderer/src/App.tsx'])
const LEGACY_CORE_STORE_IMPORTS = new Set(['src/renderer/src/core/app-render-keys.ts'])
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
        modules.push(token.value)
      } else if (previous?.kind === SyntaxKind.OpenParenToken && twoBack?.kind === SyntaxKind.ImportKeyword) {
        modules.push(token.value)
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

export const moduleBoundaryErrors = (file, source) => {
  const normalizedFile = normalize(file)
  const errors = []
  const isTest = /\.(test|spec)\.[cm]?[jt]sx?$/.test(normalizedFile)
  const inPlatform = normalizedFile.startsWith(`${ROOT}/platform/`)
  const inCore = normalizedFile.startsWith(`${ROOT}/core/`)
  const inStore = normalizedFile.startsWith(`${ROOT}/store/`)

  for (const specifier of importedModules(source)) {
    if (specifier.startsWith('@tauri-apps/') && !inPlatform && !LEGACY_TAURI_IMPORTS.has(normalizedFile)) {
      errors.push(`${normalizedFile}: Tauri API 只能由 platform/ 访问（${specifier}）`)
    }
    if (isTest) continue
    if (inCore && (/^react(?:-dom)?(?:\/|$)/.test(specifier) || pointsTo(specifier, 'components') || pointsTo(specifier, 'platform'))) {
      errors.push(`${normalizedFile}: core/ 不得依赖 React、components/ 或 platform/（${specifier}）`)
    }
    if (inCore && pointsTo(specifier, 'store') && !LEGACY_CORE_STORE_IMPORTS.has(normalizedFile)) {
      errors.push(`${normalizedFile}: core/ 不得依赖 store/（${specifier}）`)
    }
    if (inStore && pointsTo(specifier, 'components')) {
      errors.push(`${normalizedFile}: store/ 不得依赖 components/（${specifier}）`)
    }
  }
  return errors
}

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
  const errors = []
  for (const path of await sourceFiles(ROOT)) {
    const file = normalize(relative(process.cwd(), path))
    errors.push(...moduleBoundaryErrors(file, await readFile(path, 'utf8')))
  }
  if (errors.length > 0) {
    console.error('模块边界检查失败：')
    for (const error of errors) console.error(`- ${error}`)
    process.exitCode = 1
    return
  }
  console.log('模块边界检查通过。')
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await run()
