import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { classifyDevTier, evaluateDevValidationRequest, isExplicitDevTestFile } from './dev-validation-policy.mjs'

const validationScript = fileURLToPath(new URL('./run-validation.mjs', import.meta.url))

test('dev validation requires an explicit file list', () => {
  const policy = evaluateDevValidationRequest([])
  assert.equal(policy.errors.length, 1)
})

test('normal core and store changes do not require tests', () => {
  const policy = evaluateDevValidationRequest([
    'src/renderer/src/core/tools.ts',
    'src/renderer/src/store/workspace.ts',
  ])
  assert.deepEqual(policy.errors, [])
  assert.deepEqual(policy.explicitTestFiles, [])
  assert.equal(policy.tier, 'D2')
  assert.equal(policy.runTypecheck, true)
})

test('ordinary component changes use the quick D1 path', () => {
  const policy = evaluateDevValidationRequest([
    'src/renderer/src/components/Toolbar.tsx',
    'src/renderer/src/styles.css',
  ])
  assert.equal(policy.tier, 'D1')
  assert.equal(policy.runTypecheck, false)
})

test('strict mode keeps type checking available for quick-path work', () => {
  assert.equal(classifyDevTier(['src/renderer/src/components/Toolbar.tsx']), 'D1')
  const policy = evaluateDevValidationRequest(
    ['src/renderer/src/components/Toolbar.tsx'],
    { strict: true },
  )
  assert.equal(policy.tier, 'D1')
  assert.equal(policy.runTypecheck, true)
})

test('documentation-only changes stay on D0', () => {
  const policy = evaluateDevValidationRequest(['docs/agent-workflow.md'])
  assert.equal(policy.tier, 'D0')
  assert.equal(policy.runTypecheck, false)
})

test('nested CSS-only changes stay on D0', () => {
  assert.equal(classifyDevTier(['src/renderer/src/styles.css']), 'D0')
})

test('core tests do not get misclassified as presentation work', () => {
  assert.equal(classifyDevTier(['src/renderer/src/core/tools.test.ts']), 'D2')
})

test('high-risk validation requires a targeted test', () => {
  const policy = evaluateDevValidationRequest(
    ['src/renderer/src/core/selection.ts'],
    { highRisk: true },
  )
  assert.equal(policy.errors.length, 1)
})

test('high-risk validation accepts an explicit Vitest file', () => {
  const policy = evaluateDevValidationRequest(
    [
      'src/renderer/src/core/selection.ts',
      'src/renderer/src/core/selection.test.ts',
    ],
    { highRisk: true },
  )
  assert.deepEqual(policy.errors, [])
  assert.deepEqual(policy.explicitTestFiles, ['src/renderer/src/core/selection.test.ts'])
})

test('explicit Node and Vitest tests are recognized', () => {
  assert.equal(isExplicitDevTestFile('scripts/validation-scope.test.mjs'), true)
  assert.equal(isExplicitDevTestFile('src/renderer/src/core/tools.spec.ts'), true)
  assert.equal(isExplicitDevTestFile('src/renderer/src/core/tools.ts'), false)
})

test('dev command fails before validation when no files are provided', () => {
  const result = spawnSync(process.execPath, [validationScript, 'dev'], { encoding: 'utf8' })
  assert.equal(result.status, 1)
  assert.match(result.stderr, /必须显式传入本任务文件/)
})

test('dev command rejects high risk without an explicit test', () => {
  const result = spawnSync(process.execPath, [
    validationScript,
    'dev',
    '--risk=high',
    'src/renderer/src/core/selection.ts',
  ], { encoding: 'utf8' })
  assert.equal(result.status, 1)
  assert.match(result.stderr, /必须显式传入至少一个相关测试文件/)
})
