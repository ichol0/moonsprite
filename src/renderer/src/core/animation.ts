import type { AnimationCel, AnimationFrame, AnimationTimeline } from '@shared/types'

export const DEFAULT_FRAME_DURATION = 100
export const MAX_ANIMATION_FRAME_DURATION = 60_000

export const createDefaultAnimationTimeline = (): AnimationTimeline => ({
  frames: [{ id: 'frame-1', duration: DEFAULT_FRAME_DURATION }],
  cels: [],
  activeFrameId: 'frame-1',
  loop: true
})

const normalizeFrame = (value: unknown, index: number, seen: Set<string>): AnimationFrame | null => {
  if (!value || typeof value !== 'object') return null
  const candidate = value as Partial<AnimationFrame>
  const id = typeof candidate.id === 'string' && candidate.id.trim() ? candidate.id : `frame-${index + 1}`
  if (seen.has(id)) return null
  seen.add(id)
  const duration = Number.isFinite(candidate.duration)
    ? Math.max(1, Math.min(MAX_ANIMATION_FRAME_DURATION, Math.trunc(Number(candidate.duration))))
    : DEFAULT_FRAME_DURATION
  return { id, duration }
}

const normalizeCels = (value: unknown, frameIds: Set<string>): AnimationCel[] => {
  if (!Array.isArray(value)) return []
  const result: AnimationCel[] = []
  const ids = new Set<string>()
  const slots = new Set<string>()
  for (const item of value) {
    if (!item || typeof item !== 'object') continue
    const candidate = item as Partial<AnimationCel>
    if (typeof candidate.id !== 'string' || !candidate.id || ids.has(candidate.id)) continue
    if (typeof candidate.layerId !== 'string' || !candidate.layerId || typeof candidate.frameId !== 'string' || !frameIds.has(candidate.frameId)) continue
    const slot = `${candidate.layerId}:${candidate.frameId}`
    if (slots.has(slot)) continue
    ids.add(candidate.id)
    slots.add(slot)
    result.push({ id: candidate.id, layerId: candidate.layerId, frameId: candidate.frameId, ...(typeof candidate.linkedCelId === 'string' ? { linkedCelId: candidate.linkedCelId } : {}) })
  }
  return result
}

/** 读取项目时总会产生完整、可用的动画元数据；不存在动画字段的旧工程视为单帧工程。 */
export const normalizeAnimationTimeline = (value: unknown): AnimationTimeline => {
  if (!value || typeof value !== 'object') return createDefaultAnimationTimeline()
  const candidate = value as Partial<AnimationTimeline>
  const seen = new Set<string>()
  const frames = Array.isArray(candidate.frames)
    ? candidate.frames.map((frame, index) => normalizeFrame(frame, index, seen)).filter((frame): frame is AnimationFrame => Boolean(frame))
    : []
  if (frames.length === 0) return createDefaultAnimationTimeline()
  const frameIds = new Set(frames.map((frame) => frame.id))
  return {
    frames,
    cels: normalizeCels(candidate.cels, frameIds),
    activeFrameId: typeof candidate.activeFrameId === 'string' && frameIds.has(candidate.activeFrameId) ? candidate.activeFrameId : frames[0].id,
    loop: candidate.loop !== false
  }
}

export const animationFrameAt = (timeline: AnimationTimeline, frameId: string): AnimationFrame | null =>
  timeline.frames.find((frame) => frame.id === frameId) ?? null
