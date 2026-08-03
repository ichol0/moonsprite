import { fireEvent, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Event } from '@tauri-apps/api/event'
import type { DragDropEvent } from '@tauri-apps/api/window'
import { startDocumentDropService } from './document-drop-service'

const dropEvent = (paths: string[]): Event<DragDropEvent> => ({
  event: 'tauri://drag-drop',
  id: 1,
  payload: { type: 'drop', paths, position: { x: 0, y: 0 } } as DragDropEvent
})

afterEach(() => vi.restoreAllMocks())

describe('document drop service', () => {
  it('deduplicates the same file reported by native and Rust channels', async () => {
    let nativeHandler!: (event: Event<DragDropEvent>) => void
    let rustHandler!: (paths: string[]) => void
    const nativeCleanup = vi.fn()
    const rustCleanup = vi.fn()
    const openPath = vi.fn(async () => true)
    const onOpened = vi.fn()
    const stop = startDocumentDropService({
      openPath,
      onOpened,
      pathForFile: () => '',
      desktop: true,
      nativeSources: [{ onDragDropEvent: vi.fn(async (handler) => { nativeHandler = handler; return nativeCleanup }) }],
      rustSubscriber: vi.fn(async (handler) => { rustHandler = handler; return rustCleanup }),
      warn: vi.fn()
    })

    await waitFor(() => expect(nativeHandler).toBeTypeOf('function'))
    nativeHandler(dropEvent(['D:\\Art\\sprite.moonsprite']))
    rustHandler(['d:\\art\\SPRITE.MOONSPRITE'])

    await waitFor(() => expect(openPath).toHaveBeenCalledOnce())
    expect(openPath).toHaveBeenCalledWith('D:\\Art\\sprite.moonsprite')
    expect(onOpened).toHaveBeenCalledOnce()
    stop()
    expect(nativeCleanup).toHaveBeenCalledOnce()
    expect(rustCleanup).toHaveBeenCalledOnce()
  })

  it('keeps working when one native source fails and retries failed channels on focus', async () => {
    let recoveredHandler!: (event: Event<DragDropEvent>) => void
    const recoveredCleanup = vi.fn()
    const source = {
      onDragDropEvent: vi.fn(async (handler: (event: Event<DragDropEvent>) => void) => {
        if (source.onDragDropEvent.mock.calls.length === 1) throw new Error('temporary failure')
        recoveredHandler = handler
        return recoveredCleanup
      })
    }
    const openPath = vi.fn(async () => true)
    const stop = startDocumentDropService({
      openPath,
      pathForFile: () => '',
      desktop: true,
      nativeSources: [source],
      rustSubscriber: async () => { throw new Error('rust unavailable') },
      warn: vi.fn()
    })

    await waitFor(() => expect(source.onDragDropEvent).toHaveBeenCalledOnce())
    fireEvent.focus(window)
    await waitFor(() => expect(source.onDragDropEvent).toHaveBeenCalledTimes(2))
    recoveredHandler(dropEvent(['D:\\Art\\sprite.aseprite']))
    await waitFor(() => expect(openPath).toHaveBeenCalledWith('D:\\Art\\sprite.aseprite'))

    stop()
    expect(recoveredCleanup).toHaveBeenCalledOnce()
  })

  it('keeps the HTML drop fallback active outside Tauri', async () => {
    const openPath = vi.fn(async () => true)
    const stop = startDocumentDropService({
      openPath,
      pathForFile: () => 'D:\\Art\\sprite.png',
      desktop: false
    })
    const file = new File(['pixel'], 'sprite.png', { type: 'image/png' })

    fireEvent.drop(window, { dataTransfer: { files: [file] } })

    await waitFor(() => expect(openPath).toHaveBeenCalledWith('D:\\Art\\sprite.png'))
    stop()
  })
})
