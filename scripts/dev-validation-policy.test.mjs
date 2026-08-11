import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { evaluateDevValidationRequest, isExplicitDevTestFile } from './dev-validation-policy.mjs'

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
