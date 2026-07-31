import type { MoonSpriteApi } from '@shared/types'

declare global {
  interface Window {
    moonSprite: MoonSpriteApi
    __TAURI_INTERNALS__?: unknown
  }
}

export {}
