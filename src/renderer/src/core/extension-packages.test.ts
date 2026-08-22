import { describe, expect, it } from 'vitest'
import { isExtensionPackagePath } from './extension-packages'

describe('extension package paths', () => {
  it('recognizes the case-insensitive msext suffix only', () => {
    expect(isExtensionPackagePath('D:\\Downloads\\sample.msext')).toBe(true)
    expect(isExtensionPackagePath('D:\\Downloads\\sample.MSEXT')).toBe(true)
    expect(isExtensionPackagePath('D:\\Downloads\\sample.zip')).toBe(false)
  })
})
