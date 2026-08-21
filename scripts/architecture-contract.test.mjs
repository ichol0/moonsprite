import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { analyzeArchitectureFiles, ARCHITECTURE_RULES } from './architecture-contract.mjs'
import { architectureBudgetErrors, compareProjectVersions } from './architecture-budget.mjs'

const fixturePath = fileURLToPath(new URL('./fixtures/architecture-contract/cases.json', import.meta.url))
const fixtures = JSON.parse(await readFile(fixturePath, 'utf8'))

test('valid architecture samples remain clean', () => {
  const result = analyzeArchitectureFiles(fixtures.valid)
  assert.deepEqual(result.counts, Object.fromEntries(Object.keys(ARCHITECTURE_RULES).map((rule) => [rule, 0])))
})
for (const fixture of fixtures.invalid) {
  test(`architecture sample rejects ${fixture.name}`, () => {
    const result = analyzeArchitectureFiles(fixture.files)
    for (const [rule, count] of Object.entries(fixture.expected)) {
      assert.equal(result.counts[rule], count, `${rule} findings`)
    }
  })
}

const zeroBudget = () => ({
  schemaVersion: 1,
  rules: Object.fromEntries(Object.keys(ARCHITECTURE_RULES).map((rule) => [rule, {
    remaining: 0,
    expiresAt: '0.1.0-dev.6',
    target: 'clear',
  }])),
})

const evaluate = (changes = {}) => architectureBudgetErrors({
  budget: changes.budget ?? zeroBudget(),
  counts: changes.counts ?? Object.fromEntries(Object.keys(ARCHITECTURE_RULES).map((rule) => [rule, 0])),
  currentVersion: changes.currentVersion ?? '0.1.0-dev.6',
  knownRuleIds: Object.keys(ARCHITECTURE_RULES),
  previousBudget: changes.previousBudget ?? null,
})

test('architecture budget accepts exact current debt', () => {
  assert.deepEqual(evaluate(), [])
})

test('architecture budget rejects new debt and stale high budget', () => {
  const budget = zeroBudget()
  budget.rules['history-project-snapshot'].remaining = 2
  assert.match(evaluate({ budget, counts: { 'history-project-snapshot': 3 } })[0], /新增了架构债务/)
  assert.match(evaluate({ budget, counts: { 'history-project-snapshot': 1 } })[0], /同步下调/)
})

test('architecture budget cannot increase or postpone its deadline', () => {
  const previousBudget = zeroBudget()
  previousBudget.rules['workspace-root-command'] = { remaining: 2, expiresAt: '0.1.0-dev.6', target: 'clear' }
  const budget = zeroBudget()
  budget.rules['workspace-root-command'] = { remaining: 3, expiresAt: '0.1.0-dev.7', target: 'clear' }
  const errors = evaluate({ budget, previousBudget, counts: { 'workspace-root-command': 3 } })
  assert.ok(errors.some((error) => /不得从 2 回升到 3/.test(error)))
  assert.ok(errors.some((error) => /不得从 0.1.0-dev.6 延后/.test(error)))
})

test('architecture debt must be zero when its target version arrives', () => {
  const budget = zeroBudget()
  budget.rules['recovery-error-swallow'].remaining = 1
  const errors = evaluate({ budget, counts: { 'recovery-error-swallow': 1 }, currentVersion: '0.1.0-dev.6' })
  assert.ok(errors.some((error) => /已到期/.test(error)))
})

test('project version comparison orders dev releases before formal versions', () => {
  assert.equal(compareProjectVersions('0.1.0-dev.5', '0.1.0-dev.6'), -1)
  assert.equal(compareProjectVersions('0.1.0-dev.6', '0.1.0'), -1)
  assert.equal(compareProjectVersions('0.1.0', '0.1.0'), 0)
})
