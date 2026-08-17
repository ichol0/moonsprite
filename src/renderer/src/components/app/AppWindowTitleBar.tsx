import { useCallback, useEffect, useState } from 'react'
import moonspriteLogo from '@/assets/moonsprite-logo.svg'
import { useI18n } from '@/components/I18nProvider'
import { APP_CHANNEL_LABEL } from '@/core/app-meta'
import { closeAppWindow, minimizeAppWindow, observeAppWindowMaximized, toggleAppWindowMaximized } from '@/platform/app-window'

const captionGlyphs = {
  minimize: '\uE921',
  maximize: '\uE922',
  restore: '\uE923',
  close: '\uE8BB'
} as const

export function AppWindowTitleBar() {
  const { t } = useI18n()
  const [maximized, setMaximized] = useState(false)

  useEffect(() => observeAppWindowMaximized(setMaximized), [])

  const toggleMaximized = useCallback(() => {
    void toggleAppWindowMaximized().then(setMaximized).catch(() => {})
  }, [])

  const maximizeLabel = t(maximized ? 'app.window.restore' : 'app.window.maximize')

  return <header className="app-window-titlebar">
    <div className="app-window-titlebar-drag" data-tauri-drag-region="deep">
      <img className="app-window-titlebar-logo" src={moonspriteLogo} alt="" aria-hidden="true" />
      <span className="app-window-titlebar-text">MoonSprite {APP_CHANNEL_LABEL}</span>
    </div>
    <div className="app-window-controls">
      <button type="button" tabIndex={-1} className="app-window-control" title={t('app.window.minimize')} aria-label={t('app.window.minimize')} onClick={() => { void minimizeAppWindow().catch(() => {}) }}><span aria-hidden="true">{captionGlyphs.minimize}</span></button>
      <button type="button" tabIndex={-1} className="app-window-control" title={maximizeLabel} aria-label={maximizeLabel} onClick={toggleMaximized}><span aria-hidden="true">{maximized ? captionGlyphs.restore : captionGlyphs.maximize}</span></button>
      <button type="button" tabIndex={-1} className="app-window-control app-window-control-close" title={t('app.window.close')} aria-label={t('app.window.close')} onClick={() => { void closeAppWindow().catch(() => {}) }}><span aria-hidden="true">{captionGlyphs.close}</span></button>
    </div>
  </header>
}
