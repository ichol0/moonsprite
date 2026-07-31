import { spawn } from 'node:child_process'
import { access, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium } from 'playwright'

const executable = join(process.cwd(), 'src-tauri', 'target', 'release', 'moonsprite.exe')
const startupProject = join(process.cwd(), 'src-tauri', 'resources', '示例.moonsprite')
const debugPort = '9225'
const temporaryFile = join(tmpdir(), `moonsprite-smoke-${process.pid}.bin`)

await access(executable)
const child = spawn(executable, [startupProject], {
  detached: false,
  stdio: 'ignore',
  env: {
    ...process.env,
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${debugPort}`
  }
})

let browser
try {
  const endpoint = `http://127.0.0.1:${debugPort}`
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      browser = await chromium.connectOverCDP(endpoint)
      break
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 250))
    }
  }
  if (!browser) throw new Error('MoonSprite did not expose a WebView2 debugging endpoint.')

  const page = browser.contexts()[0]?.pages()[0]
  if (!page) throw new Error('MoonSprite did not create a renderer page.')
  await page.waitForFunction(() => Boolean(window.moonSprite))
  await page.waitForFunction(() => Boolean(document.querySelector('.document-tab')) && !document.querySelector('.aseprite-home'))
  const result = await page.evaluate(async (filePath) => {
    const bytes = new Uint8Array([77, 111, 111, 110])
    await window.moonSprite.writeBinaryAtomic(filePath, bytes)
    const restored = await window.moonSprite.readBinary(filePath)
    const memory = await window.moonSprite.getResourceInfo()
    const policy = document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.getAttribute('content') ?? ''
    return {
      restored: [...restored],
      hasMemory: memory.totalBytes > 0 && memory.freeBytes > 0,
      allowsTauriIpc: policy.includes('http://ipc.localhost')
    }
  }, temporaryFile)
  if (result.restored.join(',') !== '77,111,111,110' || !result.hasMemory || !result.allowsTauriIpc) throw new Error('Tauri IPC bridge or renderer policy is invalid.')
  await page.evaluate(() => window.moonSprite.approveClose())
  console.log('Tauri WebView2 smoke test passed.')
} finally {
  await browser?.close().catch(() => undefined)
  if (!child.killed) child.kill()
  await rm(temporaryFile, { force: true })
}
