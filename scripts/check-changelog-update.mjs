import { execFileSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const CHANGELOG_PATH = 'CHANGELOG.md'
const SOFTWARE_ROOTS = ['src/', 'src-tauri/', 'scripts/', '.github/workflows/']
const SOFTWARE_FILES = new Set([
  'package.json',
  'pnpm-lock.yaml',
  'vite.config.ts',
  'tsconfig.json',
  'tsconfig.node.json',
  'tsconfig.web.json',
])

const normalizePath = (path) => path.replaceAll('\\', '/')

export const isSoftwareChange = (path) => {
  const normalized = normalizePath(path)
  if (normalized === CHANGELOG_PATH) return false
  return SOFTWARE_FILES.has(normalized) || SOFTWARE_ROOTS.some((root) => normalized.startsWith(root))
}

export const validateChangelogUpdate = (changedFiles, changelog) => {
  const normalizedFiles = changedFiles.map(normalizePath)
  const errors = []
  if (!/^## 未发布\s*$/m.test(changelog)) {
    errors.push('CHANGELOG.md 必须保留“## 未发布”区。')
  }

  const softwareChanges = normalizedFiles.filter(isSoftwareChange)
  if (softwareChanges.length > 0 && !normalizedFiles.includes(CHANGELOG_PATH)) {
    errors.push(`本批包含 ${softwareChanges.length} 个软件或工程文件变化，但没有同步更新 CHANGELOG.md。`)
  }
  return errors
}

const git = (args) => execFileSync('git', args, { encoding: 'utf8' }).trim()
const splitLines = (value) => value ? value.split(/\r?\n/).filter(Boolean) : []

const changedFilesForCurrentContext = () => {
  const baseRef = process.env.GITHUB_BASE_REF
  if (baseRef) {
    const mergeBase = git(['merge-base', 'HEAD', `origin/${baseRef}`])
    return splitLines(git(['diff', '--name-only', `${mergeBase}...HEAD`]))
  }

  const before = process.env.GITHUB_EVENT_BEFORE
  if (before && !/^0+$/.test(before)) {
    return splitLines(git(['diff', '--name-only', `${before}..HEAD`]))
  }

  return [
    ...splitLines(git(['diff', '--name-only', 'HEAD'])),
    ...splitLines(git(['ls-files', '--others', '--exclude-standard'])),
  ]
}

const run = async () => {
  const changedFiles = [...new Set(changedFilesForCurrentContext())]
  const changelog = await readFile(CHANGELOG_PATH, 'utf8')
  const errors = validateChangelogUpdate(changedFiles, changelog)
  if (errors.length > 0) {
    console.error('完整更新日志检查失败：')
    for (const error of errors) console.error(`- ${error}`)
    process.exitCode = 1
    return
  }

  const softwareChangeCount = changedFiles.filter(isSoftwareChange).length
  console.log(`完整更新日志检查通过：检测到 ${softwareChangeCount} 个软件或工程文件变化。`)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await run()
