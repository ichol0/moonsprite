import { Profiler, type ReactNode } from 'react'

const enabled = typeof __MOONSPRITE_REACT_PROFILE__ !== 'undefined'
  && __MOONSPRITE_REACT_PROFILE__
  && new URLSearchParams(window.location.search).has('moonsprite-perf')

export function PerformanceProfiler({ id, children }: { id: string; children: ReactNode }) {
  if (!enabled) return children
  return <Profiler id={id} onRender={(region, phase, actualDuration) => window.__moonSpriteCanvasProbe?.recordReactCommit?.(region, actualDuration, phase)}>{children}</Profiler>
}
