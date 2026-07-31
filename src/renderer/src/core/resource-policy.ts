import type { ColorMode, ResourceInfo } from '@shared/types'

export interface ResourceEstimate {
  pixels: number
  documentBytes: number
  operationBytes: number
  peakBytes: number
}

export interface ResourceCheck {
  allowed: boolean
  estimate: ResourceEstimate
  reason?: string
}

const MAX_TYPED_ARRAY_BYTES = 0x7fffffff

export function estimateDocumentBytes(width: number, height: number, layers: number, colorMode: ColorMode): ResourceEstimate {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1 || layers < 1) {
    throw new Error('画布尺寸和图层数量必须为正整数。')
  }
  const pixels = width * height
  if (!Number.isSafeInteger(pixels)) throw new Error('画布尺寸过大，无法安全计算内存。')
  const bytesPerPixel = colorMode === 'rgba' ? 4 : 4
  const documentBytes = pixels * bytesPerPixel * layers
  const operationBytes = pixels * 8
  return { pixels, documentBytes, operationBytes, peakBytes: documentBytes + operationBytes }
}

export function checkResourceLimit(
  width: number,
  height: number,
  layers: number,
  colorMode: ColorMode,
  system: ResourceInfo
): ResourceCheck {
  const estimate = estimateDocumentBytes(width, height, layers, colorMode)
  if (estimate.documentBytes > MAX_TYPED_ARRAY_BYTES) {
    return { allowed: false, estimate, reason: '单个图层超过当前 JavaScript TypedArray 的可分配范围。' }
  }
  const dynamicBudget = Math.floor(system.freeBytes * 0.4)
  if (estimate.peakBytes > dynamicBudget) {
    return {
      allowed: false,
      estimate,
      reason: `预计峰值 ${formatBytes(estimate.peakBytes)}，超过当前可用内存的 40%（${formatBytes(dynamicBudget)}）。`
    }
  }
  return { allowed: true, estimate }
}

export const formatBytes = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = bytes / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unit]}`
}
