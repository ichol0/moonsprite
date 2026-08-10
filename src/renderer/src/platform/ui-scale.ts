import { getCurrentWebview } from '@tauri-apps/api/webview'
import type { ToolIconScale, UiScale } from '@/core/file-preferences'

let appliedScale: UiScale | null = null

export async function applyUiScale(scale: UiScale): Promise<void> {
  if (typeof window === 'undefined' || !('__TAURI_INTERNALS__' in window) || appliedScale === scale) return
  await getCurrentWebview().setZoom(scale)
  appliedScale = scale
}

export function applyToolIconScale(scale: ToolIconScale): void {
  if (typeof document === 'undefined') return
  const compact = scale === 1
  const sizes = {
    '--tool-rail-icon-size': compact ? '22px' : '32px',
    '--tool-rail-utility-icon-size': '22px',
    '--tool-rail-button-size': compact ? '32px' : '44px',
    '--tool-rail-flyout-offset': compact ? '36px' : '48px',
    '--tool-rail-column-size': compact ? '45px' : '57px'
  }
  document.documentElement.dataset.toolIconScale = compact ? 'normal' : 'large'
  for (const [name, value] of Object.entries(sizes)) document.documentElement.style.setProperty(name, value)
}
