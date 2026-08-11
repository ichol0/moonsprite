import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import { arch, cpus, platform, release, totalmem } from 'node:os'
import { relative, resolve } from 'node:path'

export const normalizePath = (file) => file.replaceAll('\\', '/')
const splitLines = (value) => value.split(/\r?\n/).filter(Boolean)

export function git(args) {
  return execFileSync('git', ['-c', 'core.quotepath=false', ...args], { encoding: 'utf8' }).trim()
}

export function workingTreeFiles() {
  return [...new Set([
    ...splitLines(git(['diff', '--name-only', 'HEAD'])),
    ...splitLines(git(['ls-files', '--others', '--exclude-standard'])),
  ].map(normalizePath).filter((file) => !file.startsWith('resource/')))]
}

const isPerformanceSource = (file) => (
  /^(src\/|src-tauri\/(src|thumbnail-provider\/src)\/)/.test(file)
  || ['package.json', 'pnpm-lock.yaml', 'vite.config.ts', 'src-tauri/Cargo.toml', 'src-tauri/Cargo.lock', 'src-tauri/tauri.conf.json'].includes(file)
) && !/\.(test|spec|bench)\.[cm]?[jt]sx?$/.test(file)

export function performanceSourceFingerprint(root = process.cwd()) {
  const tracked = splitLines(git(['ls-files']))
  const untracked = splitLines(git(['ls-files', '--others', '--exclude-standard']))
  const files = [...new Set([...tracked, ...untracked].map(normalizePath).filter(isPerformanceSource))].sort()
  const hash = createHash('sha256')
  for (const file of files) {
    const absolute = resolve(root, file)
    if (!existsSync(absolute)) continue
    hash.update(`${file}\0`)
    hash.update(readFileSync(absolute))
    hash.update('\0')
  }
  return { algorithm: 'sha256', value: hash.digest('hex'), files: files.length }
}

const browserCandidates = [
  process.env.MOONSPRITE_CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
].filter(Boolean)

function commandOutput(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8', windowsHide: true })
  if (result.error || result.status !== 0) return 'unavailable'
  return (result.stdout || result.stderr || '').trim() || 'unavailable'
}

function windowsGpuFingerprint() {
  if (platform() !== 'win32') return 'unavailable'
  return commandOutput('powershell.exe', [
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    'Get-CimInstance Win32_VideoController | Sort-Object Name | ForEach-Object { "$($_.Name)|$($_.DriverVersion)" }',
  ]).split(/\r?\n/).map((item) => item.trim()).filter(Boolean).join('; ')
}

function windowsPowerPlan() {
  if (platform() !== 'win32') return 'unavailable'
  const output = commandOutput('powercfg.exe', ['/getactivescheme'])
  return output.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)?.[0]?.toLowerCase() ?? output
}

export function performanceEnvironment() {
  const browserPath = browserCandidates.find((candidate) => existsSync(candidate))
  let browser = 'unavailable'
  if (browserPath) {
    const version = platform() === 'win32'
      ? commandOutput('powershell.exe', [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          `(Get-Item -LiteralPath '${browserPath.replaceAll("'", "''")}').VersionInfo.ProductVersion`,
        ])
      : commandOutput(browserPath, ['--version'])
    browser = version === 'unavailable' ? browserPath : `${browserPath} ${version}`
  }
  return {
    platform: `${platform()} ${release()}`,
    arch: arch(),
    cpu: cpus()[0]?.model ?? 'unknown',
    logicalCpuCount: cpus().length,
    totalMemoryBytes: totalmem(),
    gpu: windowsGpuFingerprint(),
    powerPlan: windowsPowerPlan(),
    node: process.version,
    browser,
  }
}

export function currentReleaseLabel(root = process.cwd()) {
  const source = readFileSync(resolve(root, 'src/renderer/src/core/app-meta.ts'), 'utf8')
  const match = source.match(/APP_CHANNEL_LABEL\s*=\s*['"]([^'"]+)['"]/)
  if (!match) throw new Error('无法读取 APP_CHANNEL_LABEL。')
  return match[1]
}

export function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', shell: false, windowsHide: true, ...options })
  if (result.stdout && options.stdio !== 'inherit') process.stdout.write(result.stdout)
  if (result.stderr && options.stdio !== 'inherit') process.stderr.write(result.stderr)
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} 执行失败，退出码 ${result.status ?? 1}。`)
  return result
}

export function runPnpm(args, options = {}) {
  if (process.env.npm_execpath) return run(process.execPath, [process.env.npm_execpath, ...args], options)
  return run(process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm', args, options)
}

function walk(directory) {
  if (!existsSync(directory)) return []
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name)
    return entry.isDirectory() ? walk(path) : [path]
  })
}

export function collectBundleReport(root = process.cwd()) {
  const outputRoot = resolve(root, 'out/renderer')
  const chunks = walk(outputRoot).filter((file) => /\.(js|css)$/.test(file)).map((file) => {
    const bytes = readFileSync(file)
    return {
      file: normalizePath(relative(outputRoot, file)),
      bytes: statSync(file).size,
      gzipBytes: gzipSync(bytes).length,
    }
  }).sort((left, right) => right.gzipBytes - left.gzipBytes)
  return { schemaVersion: 1, suite: 'bundle', createdAt: new Date().toISOString(), chunks }
}
