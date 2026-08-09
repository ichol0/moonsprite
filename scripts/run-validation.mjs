import { execFileSync, spawnSync } from 'node:child_process'
import { classifyValidationScope } from './validation-scope.mjs'

const requestedMode = process.argv[2]
const modeAliases = { fast: 'dev', integration: 'release' }
const mode = modeAliases[requestedMode] ?? requestedMode
if (!['dev', 'release'].includes(mode)) {
  console.error('用法：node scripts/run-validation.mjs <dev|release> [--desktop] [-- <文件...>]')
  process.exit(1)
}

const args = process.argv.slice(3).filter((arg) => arg && arg !== '--')
const options = new Set(args.filter((arg) => arg.startsWith('--')))
const requestedFiles = args.filter((arg) => !arg.startsWith('--'))
const git = (gitArgs) => execFileSync('git', ['-c', 'core.quotepath=false', ...gitArgs], { encoding: 'utf8' }).trim()
const splitLines = (value) => value ? value.split(/\r?\n/).filter(Boolean) : []
const normalize = (file) => file.replaceAll('\\', '/')

const workingTreeFiles = () => [...new Set([
  ...splitLines(git(['diff', '--name-only', 'HEAD'])),
  ...splitLines(git(['ls-files', '--others', '--exclude-standard'])),
].filter((file) => !normalize(file).startsWith('resource/')))]

const files = (requestedFiles.length > 0 ? requestedFiles : workingTreeFiles()).map(normalize)
const scope = classifyValidationScope(files, {
  forceFull: mode === 'release',
  expandFull: mode === 'release',
})
const run = (command, commandArgs, runOptions = {}) => {
  console.log(`\n> ${command} ${commandArgs.join(' ')}`)
  const result = spawnSync(command, commandArgs, { stdio: 'inherit', shell: false, ...runOptions })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}

const runPnpm = (commandArgs) => {
  if (process.env.npm_execpath) {
    run(process.execPath, [process.env.npm_execpath, ...commandArgs])
    return
  }
  run('pnpm', commandArgs, { shell: process.platform === 'win32' })
}

const webCodeFiles = scope.files.filter((file) => /^(src\/(renderer|shared)\/.*|vite\.config\.ts|vitest\.config\.ts|tsconfig.*\.json|package\.json|pnpm-lock\.yaml)$/.test(file) && /\.(ts|tsx|json|yaml)$/.test(file))
const explicitVitestFiles = scope.files.filter((file) => /^src\/.*\.(test|spec)\.[cm]?[jt]sx?$/.test(file))
const highRiskWebFiles = scope.files.filter((file) => (
  /^src\/renderer\/src\/(core|store)\/.*\.[cm]?[jt]sx?$/.test(file)
  || /^src\/shared\/.*\.[cm]?[jt]sx?$/.test(file)
) && !/\.(test|spec)\.[cm]?[jt]sx?$/.test(file))
const nodeTestFiles = scope.files.filter((file) => /^scripts\/.*\.test\.mjs$/.test(file))
const versionFilesChanged = scope.files.some((file) => new Set([
  'package.json',
  'src-tauri/Cargo.toml',
  'src-tauri/tauri.conf.json',
  'src/renderer/src/core/app-meta.ts',
  'src/renderer/src/components/LatestReleaseDialog.tsx',
]).has(file))
const rendererCodeChanged = scope.files.some((file) => /^src\/renderer\/src\/.*\.[cm]?[jt]sx?$/.test(file))

if (mode === 'dev' && highRiskWebFiles.length > 0 && explicitVitestFiles.length === 0) {
  console.error('Core、Store 或 Shared 改动需要显式传入相关测试文件，避免自动扩散为大范围测试。')
  console.error('示例：pnpm check:dev -- src/renderer/src/core/tools.ts src/renderer/src/core/tools.test.ts')
  process.exit(1)
}

console.log(`验证模式：${mode === 'dev' ? 'dev.X 开发' : 'dev.X 发布'}`)
console.log(`范围：web=${scope.web}, rust=${scope.rust}, thumbnail=${scope.thumbnail}, desktop=${scope.desktop}`)

if (mode === 'release') {
  runPnpm(['check:performance-release'])
  runPnpm(['check:maintenance'])
  run(process.execPath, ['--test', 'scripts/module-boundaries.test.mjs'])
  runPnpm(['check:boundaries'])
  run(process.execPath, ['scripts/check-version-contract.mjs', '--release'])
} else if (rendererCodeChanged) {
  runPnpm(['check:boundaries'])
}

if (mode === 'dev' && nodeTestFiles.length > 0) {
  run(process.execPath, ['--test', ...nodeTestFiles])
}
if (mode === 'dev' && versionFilesChanged) runPnpm(['check:version'])

if (scope.web) {
  if (mode === 'release' || webCodeFiles.length > 0) runPnpm(['typecheck'])
  if (mode === 'release') {
    runPnpm(['test'])
    runPnpm(['build:web'])
  } else if (explicitVitestFiles.length > 0) {
    runPnpm(['exec', 'vitest', 'run', '--passWithNoTests', ...explicitVitestFiles])
  }
}

if (scope.rust) {
  if (mode === 'release') run('cargo', ['fmt', '--check', '--manifest-path', 'src-tauri/Cargo.toml'])
  run('cargo', ['check', '--manifest-path', 'src-tauri/Cargo.toml'])
}

if (scope.thumbnail) {
  if (mode === 'release') run('cargo', ['fmt', '--check', '--manifest-path', 'src-tauri/thumbnail-provider/Cargo.toml'])
  const thumbnailCommand = mode === 'release' ? 'build' : 'check'
  run('cargo', [thumbnailCommand, '--manifest-path', 'src-tauri/thumbnail-provider/Cargo.toml', ...(mode === 'release' ? ['--release'] : [])])
}

if (options.has('--desktop')) {
  if (mode !== 'release') {
    console.error('--desktop 只能用于 dev.X 发布检查。')
    process.exit(1)
  }
  runPnpm(['exec', 'tauri', 'build', '--no-bundle'])
  runPnpm(['test:tauri'])
}

if (mode === 'dev' && !scope.web && !scope.rust && !scope.thumbnail) {
  console.log('\n本次仅涉及文档或维护文件，无需应用验证。')
}
console.log('\n验证通过。')
