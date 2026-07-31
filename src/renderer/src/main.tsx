import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { installTauriApi } from './platform/tauri-api'

const rootElement = document.getElementById('root')

if (!rootElement) throw new Error('MoonSprite root element is missing.')

void installTauriApi()
  .then(() => createRoot(rootElement).render(<StrictMode><App /></StrictMode>))
  .catch((error: unknown) => {
    console.error('MoonSprite failed to initialize.', error)
    rootElement.style.cssText = 'min-height:100vh;display:grid;place-items:center;padding:24px;color:#f1f4f8;background:#0f1116;font:13px/1.6 sans-serif;text-align:center'
    rootElement.textContent = 'MoonSprite 启动失败。请重新启动软件；如果问题持续出现，请重新安装最新版。'
  })
