export type OpenProgressPhase = 'hidden' | 'running' | 'complete'

export interface OpenProgressSnapshot {
  phase: OpenProgressPhase
}

type Listener = () => void

export interface OpenProgressController {
  begin(): (succeeded?: boolean) => void
  dismiss(): void
  getSnapshot(): OpenProgressSnapshot
  subscribe(listener: Listener): () => void
}

export function createOpenProgressController(
  scheduleFrame: (callback: FrameRequestCallback) => number = window.requestAnimationFrame.bind(window)
): OpenProgressController {
  const listeners = new Set<Listener>()
  let activeOperations = 0
  let completionGeneration = 0
  let snapshot: OpenProgressSnapshot = { phase: 'hidden' }

  const publish = (phase: OpenProgressPhase): void => {
    if (snapshot.phase === phase) return
    snapshot = { phase }
    listeners.forEach((listener) => listener())
  }

  return {
    begin() {
      activeOperations += 1
      if (activeOperations === 1) {
        const generation = ++completionGeneration
        if (snapshot.phase === 'hidden') {
          scheduleFrame(() => {
            if (activeOperations > 0 && completionGeneration === generation) publish('running')
          })
        } else publish('running')
      }
      let finished = false
      return (succeeded = true) => {
        if (finished) return
        finished = true
        activeOperations = Math.max(0, activeOperations - 1)
        if (activeOperations > 0 || snapshot.phase === 'hidden') return
        if (!succeeded) {
          publish('hidden')
          return
        }
        publish('complete')
        const generation = ++completionGeneration
        scheduleFrame(() => scheduleFrame(() => {
          if (activeOperations === 0 && completionGeneration === generation) publish('hidden')
        }))
      }
    },
    dismiss() {
      completionGeneration += 1
      publish('hidden')
    },
    getSnapshot() {
      return snapshot
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    }
  }
}

export const openProgress = createOpenProgressController()
