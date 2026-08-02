import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { MoonSpriteApi } from '@shared/types'
import { getWindowsFileNameError, NewDocumentDialog } from './NewDocumentDialog'

afterEach(() => {
  vi.restoreAllMocks()
})

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

  it('reads only clipboard image dimensions when opening', async () => {
    const readClipboardImageSize = vi.fn(async () => ({ width: 320, height: 180 }))
    const readClipboardImage = vi.fn(async () => { throw new Error('full clipboard pixels must not be requested') })
    window.moonSprite = { readClipboardImageSize, readClipboardImage } as unknown as MoonSpriteApi

    render(<NewDocumentDialog open onClose={vi.fn()} onCreate={vi.fn()} />)

    await waitFor(() => expect(screen.getByRole('spinbutton', { name: '画布宽度' })).toHaveValue('320'))
    expect(screen.getByRole('spinbutton', { name: '画布高度' })).toHaveValue('180')
    expect(readClipboardImageSize).toHaveBeenCalledOnce()
    expect(readClipboardImage).not.toHaveBeenCalled()
  })
})
