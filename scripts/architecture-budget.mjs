import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

export const ARCHITECTURE_BUDGET_FILE = 'scripts/architecture-debt-budget.json'

const parseVersion = (value) => {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-dev\.(\d+))?$/.exec(value)
  if (!match) throw new Error(`不支持的版本格式：${value}`)
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    dev: match[4] === undefined ? Number.POSITIVE_INFINITY : Number(match[4]),
  }
}
export const compareProjectVersions = (left, right) => {
  const a = parseVersion(left)
  const b = parseVersion(right)
  for (const key of ['major', 'minor', 'patch', 'dev']) {
    if (a[key] !== b[key]) return a[key] < b[key] ? -1 : 1
  }
  return 0
}

export const parseArchitectureBudget = (source) => {
  const budget = JSON.parse(source)
  if (budget?.schemaVersion !== 1 || !budget.rules || typeof budget.rules !== 'object') {
    throw new Error('架构债务预算格式无效。')
  }
  return budget
}

export const readArchitectureBudget = async (root = process.cwd()) => (
  parseArchitectureBudget(await readFile(join(root, ARCHITECTURE_BUDGET_FILE), 'utf8'))
)

export const architectureBudgetErrors = ({
  budget,
  counts,
  currentVersion,
  knownRuleIds,
  previousBudget = null,
}) => {
  const errors = []
  const known = new Set(knownRuleIds)

  for (const ruleId of knownRuleIds) {
    const entry = budget.rules[ruleId]
    if (!entry) {
      errors.push(`预算缺少规则 ${ruleId}。`)
      continue
    }
    if (!Number.isInteger(entry.remaining) || entry.remaining < 0) {
      errors.push(`${ruleId} 的 remaining 必须是非负整数。`)
      continue
    }
    if (typeof entry.expiresAt !== 'string' || typeof entry.target !== 'string' || !entry.target.trim()) {
      errors.push(`${ruleId} 必须包含 expiresAt 和 target。`)
      continue
    }

    const actual = counts[ruleId] ?? 0
    if (actual > entry.remaining) {
      errors.push(`${ruleId} 新增了架构债务：实际 ${actual}，预算 ${entry.remaining}。`)
    } else if (actual < entry.remaining) {
      errors.push(`${ruleId} 已降至 ${actual}，必须把预算从 ${entry.remaining} 同步下调，避免留下虚高额度。`)
    }

    if (entry.remaining > 0 && compareProjectVersions(currentVersion, entry.expiresAt) >= 0) {
      errors.push(`${ruleId} 的 ${entry.remaining} 项迁移债务已到期（${entry.expiresAt}），必须清零。`)
    }

    const previous = previousBudget?.rules?.[ruleId]
    if (previous) {
      if (entry.remaining > previous.remaining) {
        errors.push(`${ruleId} 的预算不得从 ${previous.remaining} 回升到 ${entry.remaining}。`)
      }
      if (compareProjectVersions(entry.expiresAt, previous.expiresAt) > 0) {
        errors.push(`${ruleId} 的到期版本不得从 ${previous.expiresAt} 延后到 ${entry.expiresAt}。`)
      }
    }
  }

  for (const ruleId of Object.keys(budget.rules)) {
    if (!known.has(ruleId)) errors.push(`预算包含未知规则 ${ruleId}。`)
  }

  return errors
}
