import type { MoonSpriteApi } from '@shared/types'

declare global {
  interface Window {
    moonSprite: MoonSpriteApi
    __TAURI_INTERNALS__?: unknown
    __moonSpriteCanvasProbe?: {
      recordDraw(duration: number): void
      recordInput?(kind: 'pointer-down' | 'pointer-move' | 'pointer-up', duration: number): void
      recordReactCommit?(region: string, duration: number, phase: 'mount' | 'update' | 'nested-update'): void
    }
  }
}

export {}
