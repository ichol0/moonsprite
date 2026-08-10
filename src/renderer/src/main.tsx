import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { I18nProvider } from './components/I18nProvider'
import { PerformanceProfiler } from './components/PerformanceProfiler'
import { loadEditorPreferences } from './core/file-preferences'
import { applyThemeToDocument } from './core/theme'
import { translate } from './core/localization'
import { installTauriApi } from './platform/tauri-api'
import { applyCursorPreferences } from './platform/cursor-theme'
import { applyToolIconScale, applyUiScale } from './platform/ui-scale'

const rootElement = document.getElementById('root')

if (!rootElement) throw new Error('MoonSprite root element is missing.')

const startupPreferences = loadEditorPreferences()
applyThemeToDocument(startupPreferences.theme)
applyToolIconScale(startupPreferences.toolIconScale)
void applyCursorPreferences(startupPreferences.useLocalCursors, startupPreferences.cursorScale).catch(() => undefined)

void installTauriApi()
  .then(async () => {
    await applyUiScale(startupPreferences.uiScale).catch(() => undefined)
    createRoot(rootElement).render(
      <StrictMode>
        <I18nProvider>
          <PerformanceProfiler id="MoonSprite">
            <App />
          </PerformanceProfiler>
        </I18nProvider>
      </StrictMode>
    )
  })
  .catch((error: unknown) => {
    console.error('MoonSprite failed to initialize.', error)
    rootElement.style.cssText = 'min-height:100vh;display:grid;place-items:center;padding:24px;color:var(--theme-text-primary);background:var(--theme-workspace-background);font:13px/1.6 sans-serif;text-align:center'
    rootElement.textContent = translate(loadEditorPreferences().language, 'startup.failed')
  })
