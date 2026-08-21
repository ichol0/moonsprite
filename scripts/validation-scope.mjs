const normalize = (file) => file.replaceAll('\\', '/')

const FULL_VALIDATION_FILES = new Set([
  'package.json',
  'pnpm-lock.yaml',
  'vite.config.ts',
  'vitest.config.ts',
  'tsconfig.json',
  'tsconfig.node.json',
  'tsconfig.web.json',
  '.github/workflows/ci.yml',
  'scripts/ci-scope.mjs',
  'scripts/run-validation.mjs',
  'scripts/validation-scope.mjs',
])

const startsWithAny = (file, roots) => roots.some((root) => file.startsWith(root))
const rendererCodePattern = /^src\/(?:renderer|shared)\/.*\.[cm]?[jt]sx?$/

export const isRendererCodeFile = (file) => rendererCodePattern.test(normalize(file))

export const getRendererCodeFiles = (files) => (
  [...new Set(files.map(normalize).filter(isRendererCodeFile))]
)

export function classifyValidationScope(files, { forceFull = false, expandFull = true } = {}) {
  const normalizedFiles = [...new Set(files.map(normalize).filter(Boolean))]
  const full = forceFull || normalizedFiles.some((file) => FULL_VALIDATION_FILES.has(file))
  const expand = full && expandFull
  const web = expand || normalizedFiles.some((file) => (
    startsWithAny(file, ['src/renderer/', 'src/shared/'])
    || /^(package\.json|pnpm-lock\.yaml|vite\.config\.ts|vitest\.config\.ts|tsconfig(\.node|\.web)?\.json)$/.test(file)
  ))
  const thumbnail = expand || normalizedFiles.some((file) => file.startsWith('src-tauri/thumbnail-provider/'))
  const rust = expand || normalizedFiles.some((file) => (
    startsWithAny(file, [
      'src-tauri/src/',
      'src-tauri/capabilities/',
      'src-tauri/icons/',
      'src-tauri/resources/',
    ])
    || /^src-tauri\/(Cargo\.(toml|lock)|build\.rs|tauri\.conf\.json)$/.test(file)
  ))
  const desktop = expand || rust || normalizedFiles.some((file) => /scripts\/(desktop-regression|tauri-smoke|prepare-release)\.mjs$/.test(file))

  return { files: normalizedFiles, full, web, rust, thumbnail, desktop }
}
