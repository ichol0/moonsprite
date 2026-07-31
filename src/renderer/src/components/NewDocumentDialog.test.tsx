import { describe, expect, it } from 'vitest'
import { getWindowsFileNameError } from './NewDocumentDialog'

describe('getWindowsFileNameError', () => {
  it('rejects Windows filename characters and reserved names', () => {
    expect(getWindowsFileNameError('8*8')).toContain('“*”')
    expect(getWindowsFileNameError('CON')).toContain('保留设备名')
    expect(getWindowsFileNameError('sprite.')).toContain('空格或句点')
    expect(getWindowsFileNameError('sprite ')).toContain('空格或句点')
  })

  it('accepts normal project names', () => {
    expect(getWindowsFileNameError('我的像素作品 01')).toBeNull()
    expect(getWindowsFileNameError('sprite.v2')).toBeNull()
  })
})
