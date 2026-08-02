import { memo } from 'react'
import { PerformanceProfiler } from '@/components/PerformanceProfiler'
import { statusBarRenderKey } from '@/core/app-render-keys'
import { useWorkspace } from '@/store/workspace'

interface EditorStatusBarProps {
  homeOpen: boolean
  resourceLabel: string
}

export const EditorStatusBar = memo(function EditorStatusBar({ homeOpen, resourceLabel }: EditorStatusBarProps) {
  const renderKey = useWorkspace((state) => statusBarRenderKey(
    state.sessions.find((item) => item.document.id === state.activeId) ?? null,
    state.message
  ))
  const state = useWorkspace.getState()
  const session = state.sessions.find((item) => item.document.id === state.activeId) ?? null
  void renderKey

  return <PerformanceProfiler id="EditorStatusBar"><footer className="statusbar">
    {session && !homeOpen ? <>
      <span>{session.document.colorMode === 'rgba' ? 'RGBA 真彩色' : '索引模式'}</span>
      <span>{session.document.layers.length} 图层</span>
      <span>{Math.round(session.view.zoom * 100)}%</span>
      <span>{session.selection ? `选区 ${session.selection.width} x ${session.selection.height}` : '无选区'}</span>
    </> : <span>准备就绪</span>}
    <span className="status-spacer" />
    {state.message && <span className="status-message" onClick={() => useWorkspace.getState().setMessage(null)}>{state.message}</span>}
    <span>{resourceLabel}</span>
  </footer></PerformanceProfiler>
})
