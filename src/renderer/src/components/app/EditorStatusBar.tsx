import { memo } from 'react'
import { PerformanceProfiler } from '@/components/PerformanceProfiler'
import { useI18n } from '@/components/I18nProvider'
import { statusBarRenderKey } from '@/core/app-render-keys'
import { useWorkspace } from '@/store/workspace'

interface EditorStatusBarProps {
  homeOpen: boolean
  resourceLabel: string
}

export const EditorStatusBar = memo(function EditorStatusBar({ homeOpen, resourceLabel }: EditorStatusBarProps) {
  const { t } = useI18n()
  const renderKey = useWorkspace((state) => statusBarRenderKey(
    state.sessions.find((item) => item.document.id === state.activeId) ?? null,
    state.message
  ))
  const state = useWorkspace.getState()
  const session = state.sessions.find((item) => item.document.id === state.activeId) ?? null
  void renderKey

  return <PerformanceProfiler id="EditorStatusBar"><footer className="statusbar">
    {session && !homeOpen ? <>
      <span>{t(`colorMode.${session.document.colorMode}`)}</span>
      <span>{t('status.layers', { count: session.document.layers.length })}</span>
      <span>{Math.round(session.view.zoom * 100)}%</span>
      <span>{session.selection ? t('status.selection', { width: session.selection.width, height: session.selection.height }) : t('status.noSelection')}</span>
    </> : <span>{t('status.ready')}</span>}
    <span className="status-spacer" />
    {state.message && <span className="status-message" onClick={() => useWorkspace.getState().setMessage(null)}>{state.message}</span>}
    <span>{resourceLabel}</span>
  </footer></PerformanceProfiler>
})
