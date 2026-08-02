import type { Event, UnlistenFn } from '@tauri-apps/api/event'
import type { DragDropEvent } from '@tauri-apps/api/window'

interface NativeDocumentDropSource {
  onDragDropEvent(handler: (event: Event<DragDropEvent>) => void): Promise<UnlistenFn>
}

export const subscribeToNativeDocumentDrops = async (source: NativeDocumentDropSource, onDrop: (paths: string[]) => void): Promise<() => void> =>
  source.onDragDropEvent((event) => {
    if (event.payload.type === 'drop' && event.payload.paths?.length) onDrop(event.payload.paths)
  })
