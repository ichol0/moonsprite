import { PhysicalSize } from '@tauri-apps/api/dpi'
import { getCurrentWebview } from '@tauri-apps/api/webview'
import { getCurrentWindow } from '@tauri-apps/api/window'
import type { ToolIconScale, UiScale } from '@/core/file-preferences'
import { isTauriRuntime, observeDisplayScaleFactor } from './display-scale'

const ZOOM_EPSILON = 0.000001
const BASE_MINIMUM_WINDOW_WIDTH = 1024
const BASE_MINIMUM_WINDOW_HEIGHT = 640

interface NativeScaleTarget {
  scale: UiScale
  displayScaleFactor: number
  zoom: number
}

let requestedScale: UiScale | null = null
let appliedTarget: NativeScaleTarget | null = null
let desiredTarget: NativeScaleTarget | null = null
let nativeScaleQueue = Promise.resolve()

function zoomsMatch(left: number, right: number): boolean {
  return Math.abs(left - right) <= ZOOM_EPSILON
}

function targetsMatch(left: NativeScaleTarget, right: NativeScaleTarget): boolean {
  return left.scale === right.scale
    && zoomsMatch(left.displayScaleFactor, right.displayScaleFactor)
    && zoomsMatch(left.zoom, right.zoom)
}

function nativeScaleTarget(scale: UiScale, displayScaleFactor: number): NativeScaleTarget {
  return { scale, displayScaleFactor, zoom: scale / displayScaleFactor }
}

function minimumWindowSize(scale: UiScale): PhysicalSize {
  return new PhysicalSize(
    Math.round(BASE_MINIMUM_WINDOW_WIDTH * scale),
    Math.round(BASE_MINIMUM_WINDOW_HEIGHT * scale)
  )
}

function queueNativeScale(target: NativeScaleTarget): Promise<void> {
  desiredTarget = target
  const operation = nativeScaleQueue.catch(() => undefined).then(async () => {
    if (!desiredTarget || !targetsMatch(target, desiredTarget) || (appliedTarget && targetsMatch(target, appliedTarget))) return
    await Promise.all([
      getCurrentWebview().setZoom(target.zoom),
      getCurrentWindow().setMinSize(minimumWindowSize(target.scale))
    ])
    appliedTarget = target
  })
  nativeScaleQueue = operation
  return operation
}

function handleDisplayScaleChange(scaleFactor: number): void {
  if (requestedScale === null) return
  void queueNativeScale(nativeScaleTarget(requestedScale, scaleFactor)).catch(() => undefined)
}

export async function applyUiScale(scale: UiScale): Promise<void> {
  if (!isTauriRuntime()) return
  requestedScale = scale
  const displayScaleFactor = await observeDisplayScaleFactor(handleDisplayScaleChange)
  await queueNativeScale(nativeScaleTarget(requestedScale, displayScaleFactor))
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
