import { getCurrentWindow } from '@tauri-apps/api/window'

const currentDesktopWindow = () => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
  ? getCurrentWindow()
  : null

export async function minimizeAppWindow(): Promise<void> {
  await currentDesktopWindow()?.minimize()
}

export async function toggleAppWindowMaximized(): Promise<boolean> {
  const appWindow = currentDesktopWindow()
  if (!appWindow) return false
  await appWindow.toggleMaximize()
  return appWindow.isMaximized()
}

export async function closeAppWindow(): Promise<void> {
  await currentDesktopWindow()?.close()
}

export function observeAppWindowMaximized(onChange: (maximized: boolean) => void): () => void {
  const appWindow = currentDesktopWindow()
  if (!appWindow) {
    onChange(false)
    return () => {}
  }

  let disposed = false
  let removeResized: (() => void) | null = null
  let refreshInFlight = false
  let refreshQueued = false

  const refresh = async (): Promise<void> => {
    if (refreshInFlight) {
      refreshQueued = true
      return
    }
    refreshInFlight = true
    try {
      const maximized = await appWindow.isMaximized()
      if (!disposed) onChange(maximized)
    } catch {
      // Keep the current caption state when the native query is unavailable.
    } finally {
      refreshInFlight = false
      if (refreshQueued && !disposed) {
        refreshQueued = false
        void refresh()
      }
    }
  }

  void refresh()
  void appWindow.onResized(() => { void refresh() }).then((remove) => {
    if (disposed) remove()
    else removeResized = remove
  }).catch(() => {})

  return () => {
    disposed = true
    removeResized?.()
  }
}
