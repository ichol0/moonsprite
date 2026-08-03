import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { getCurrentWebview } from '@tauri-apps/api/webview'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { normalizeDroppedDocumentPaths } from '@/core/document-drop'
import { subscribeToNativeDocumentDrops, type NativeDocumentDropSource } from './document-drop-events'

type RustDropSubscriber = (onDrop: (paths: string[]) => void) => Promise<UnlistenFn>

export interface DocumentDropServiceOptions {
  openPath(path: string): boolean | Promise<boolean>
  pathForFile(file: File): string
  onOpened?(): void
  eventTarget?: Window
  desktop?: boolean
  nativeSources?: NativeDocumentDropSource[]
  rustSubscriber?: RustDropSubscriber
  dedupeMs?: number
  now?: () => number
  warn?: (message: string, error: unknown) => void
}

const defaultRustSubscriber: RustDropSubscriber = (onDrop) =>
  listen<string[]>('app:file-drop', (event) => onDrop(event.payload))

export function startDocumentDropService(options: DocumentDropServiceOptions): () => void {
  const target = options.eventTarget ?? window
  const desktop = options.desktop ?? '__TAURI_INTERNALS__' in window
  const nativeSources = options.nativeSources ?? (desktop ? [getCurrentWebview(), getCurrentWindow()] : [])
  const rustSubscriber = options.rustSubscriber ?? (desktop ? defaultRustSubscriber : undefined)
  const dedupeMs = options.dedupeMs ?? 1_000
  const now = options.now ?? Date.now
  const warn = options.warn ?? ((message: string, error: unknown) => console.warn(message, error))
  const recentlyOpened = new Map<string, number>()
  const cleanups = new Map<string, () => void>()
  const pending = new Set<string>()
  let active = true

  const openDroppedPaths = (paths: string[]): void => {
    const timestamp = now()
    for (const [key, openedAt] of recentlyOpened) {
      if (timestamp - openedAt >= dedupeMs) recentlyOpened.delete(key)
    }
    for (const path of normalizeDroppedDocumentPaths(paths)) {
      const key = path.toLowerCase()
      if (recentlyOpened.has(key)) continue
      recentlyOpened.set(key, timestamp)
      void Promise.resolve(options.openPath(path)).then((opened) => {
        if (active && opened) options.onOpened?.()
      }).catch((error) => warn(`无法打开拖入文件：${path}`, error))
    }
  }

  const subscribe = (key: string, create: () => Promise<() => void>): void => {
    if (!active || cleanups.has(key) || pending.has(key)) return
    pending.add(key)
    void create().then((cleanup) => {
      pending.delete(key)
      if (!active) { cleanup(); return }
      cleanups.set(key, cleanup)
    }).catch((error) => {
      pending.delete(key)
      if (active) warn(`文件拖入通道订阅失败：${key}`, error)
    })
  }

  const ensureDesktopSubscriptions = (): void => {
    if (!desktop) return
    nativeSources.forEach((source, index) => subscribe(`native-${index}`, () => subscribeToNativeDocumentDrops(source, openDroppedPaths)))
    if (rustSubscriber) subscribe('rust-window-event', () => rustSubscriber(openDroppedPaths))
  }

  const dragOver = (event: DragEvent): void => event.preventDefault()
  const drop = (event: DragEvent): void => {
    event.preventDefault()
    const paths = Array.from(event.dataTransfer?.files ?? []).map(options.pathForFile).filter(Boolean)
    openDroppedPaths(paths)
  }
  const focus = (): void => ensureDesktopSubscriptions()

  target.addEventListener('dragover', dragOver, true)
  target.addEventListener('drop', drop, true)
  target.addEventListener('focus', focus)
  ensureDesktopSubscriptions()

  return () => {
    active = false
    target.removeEventListener('dragover', dragOver, true)
    target.removeEventListener('drop', drop, true)
    target.removeEventListener('focus', focus)
    for (const cleanup of cleanups.values()) cleanup()
    cleanups.clear()
    pending.clear()
    recentlyOpened.clear()
  }
}
