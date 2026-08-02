import { describe, expect, it, vi } from 'vitest'
import type { Event } from '@tauri-apps/api/event'
import type { DragDropEvent } from '@tauri-apps/api/window'
import { subscribeToNativeDocumentDrops } from './document-drop-events'

describe('native document drop events', () => {
  it('forwards only completed Tauri drops and returns the native cleanup', async () => {
    let handler!: (event: Event<DragDropEvent>) => void
    const unlisten = vi.fn()
    const source = {
      onDragDropEvent: vi.fn(async (next: (event: Event<DragDropEvent>) => void) => { handler = next; return unlisten })
    }
    const onDrop = vi.fn()
    const cleanup = await subscribeToNativeDocumentDrops(source, onDrop)

    handler({ event: 'tauri://drag-over', id: 1, payload: { type: 'over', position: { x: 0, y: 0 } } as DragDropEvent })
    handler({ event: 'tauri://drag-drop', id: 2, payload: { type: 'drop', paths: ['D:\\gallery\\sprite.moonsprite'], position: { x: 0, y: 0 } } as DragDropEvent })
    expect(onDrop).toHaveBeenCalledOnce()
    expect(onDrop).toHaveBeenCalledWith(['D:\\gallery\\sprite.moonsprite'])

    cleanup()
    expect(unlisten).toHaveBeenCalledOnce()
  })
})
