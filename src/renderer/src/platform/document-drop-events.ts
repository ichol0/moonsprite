import type { Event, UnlistenFn } from '@tauri-apps/api/event'
import type { DragDropEvent } from '@tauri-apps/api/window'
import { translateCurrent as tr } from '@/core/localization'

export interface NativeDocumentDropSource {
  onDragDropEvent(handler: (event: Event<DragDropEvent>) => void): Promise<UnlistenFn>
}

export interface NativeDocumentDrop {
  paths: string[]
  position: { x: number; y: number }
}

export const subscribeToNativeDocumentDrops = async (source: NativeDocumentDropSource, onDrop: (drop: NativeDocumentDrop) => void): Promise<() => void> =>
  source.onDragDropEvent((event) => {
    if (event.payload.type === 'drop' && event.payload.paths?.length) onDrop({ paths: event.payload.paths, position: event.payload.position })
  })

export const subscribeToNativeDocumentDropSources = async (
  sources: NativeDocumentDropSource[],
  onDrop: (drop: NativeDocumentDrop) => void
): Promise<() => void> => {
  const subscriptions = await Promise.allSettled(sources.map((source) => subscribeToNativeDocumentDrops(source, onDrop)))
  const cleanups = subscriptions.flatMap((subscription) => subscription.status === 'fulfilled' ? [subscription.value] : [])
  if (cleanups.length === 0) throw new Error(tr('core.drop.subscribeFailed'))
  return () => cleanups.forEach((cleanup) => cleanup())
}
