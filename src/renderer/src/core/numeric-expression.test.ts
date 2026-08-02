import { describe, expect, it } from 'vitest'
import { evaluateNumericExpression } from './numeric-expression'

describe('numeric expression input', () => {
  it('applies arithmetic precedence and parentheses', () => {
    expect(evaluateNumericExpression('2 + 3 * 4')).toBe(14)
    expect(evaluateNumericExpression('(2 + 3) * 4')).toBe(20)
  })

  it('supports unary signs, decimals, and scientific notation', () => {
    expect(evaluateNumericExpression('-5 + +2.5')).toBe(-2.5)
    expect(evaluateNumericExpression('1e2 / 4')).toBe(25)
  })

  it('rejects malformed input, unsupported characters, and division by zero', () => {
    expect(evaluateNumericExpression('2 +')).toBeNull()
    expect(evaluateNumericExpression('Math.max(1, 2)')).toBeNull()
    expect(evaluateNumericExpression('4 / 0')).toBeNull()
  })
})
