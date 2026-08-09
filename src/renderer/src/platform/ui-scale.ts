import { getCurrentWebview } from '@tauri-apps/api/webview'
import type { UiScale } from '@/core/file-preferences'

let appliedScale: UiScale | null = null

export async function applyUiScale(scale: UiScale): Promise<void> {
  if (typeof window === 'undefined' || !('__TAURI_INTERNALS__' in window) || appliedScale === scale) return
  await getCurrentWebview().setZoom(scale)
  appliedScale = scale
}
