import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { chromium } from 'playwright'
import { parseCanvasPerformanceOptions } from './canvas-performance-options.mjs'

const options = parseCanvasPerformanceOptions(process.argv.slice(2))

const host = '127.0.0.1'
const port = Number(process.env.MOONSPRITE_PERF_PORT ?? 4175)
const externalUrl = process.env.MOONSPRITE_PERF_URL
const baseUrl = externalUrl ?? `http://${host}:${port}`
const performanceUrl = new URL(baseUrl)
performanceUrl.searchParams.set('moonsprite-perf', '1')
const chromeCandidates = [
  process.env.MOONSPRITE_CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe'
].filter(Boolean)
const executablePath = chromeCandidates.find((candidate) => existsSync(candidate))

if (!executablePath) throw new Error('未找到可用于画布性能基准的 Chrome 或 Edge。')

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))

async function waitForServer(url) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      const response = await fetch(url)
      if (response.ok) return
    } catch {
      // Preview server is still starting.
    }
    await delay(100)
  }
  throw new Error(`画布性能基准无法连接到 ${url}`)
}

function percentile(values, fraction) {
  if (values.length === 0) return 0
  const sorted = [...values].sort((left, right) => left - right)
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * fraction))]
}

function summarize(label, canvasSize, samples) {
  const frames = samples.frames.filter((duration) => Number.isFinite(duration) && duration > 0)
  const longTasks = samples.longTasks.filter((duration) => Number.isFinite(duration) && duration > 0)
  const draws = samples.draws.filter((duration) => Number.isFinite(duration) && duration >= 0)
  const inputs = samples.inputs.map((sample) => sample.duration).filter((duration) => Number.isFinite(duration) && duration >= 0)
  const rootReactCommits = samples.reactCommits.filter((sample) => sample.region === 'MoonSprite').map((sample) => sample.duration).filter((duration) => Number.isFinite(duration) && duration >= 0)
  const reactByRegion = Object.fromEntries([...new Set(samples.reactCommits.map((sample) => sample.region))].map((region) => {
    const durations = samples.reactCommits.filter((sample) => sample.region === region).map((sample) => sample.duration)
    return [region, { count: durations.length, p95: percentile(durations, 0.95), longest: Math.max(0, ...durations) }]
  }))
  return {
    canvasSize,
    scenario: label,
    sampleCount: frames.length,
    p50: percentile(frames, 0.5),
    p95: percentile(frames, 0.95),
    p99: percentile(frames, 0.99),
    over25Percent: frames.length === 0 ? 0 : frames.filter((duration) => duration > 25).length / frames.length * 100,
    longestFrame: Math.max(0, ...frames),
    longestTask: Math.max(0, ...longTasks),
    drawCount: draws.length,
    drawP50: percentile(draws, 0.5),
    drawP95: percentile(draws, 0.95),
    drawP99: percentile(draws, 0.99),
    longestDraw: Math.max(0, ...draws),
    inputCount: inputs.length,
    inputP95: percentile(inputs, 0.95),
    inputP99: percentile(inputs, 0.99),
    longestInput: Math.max(0, ...inputs),
    reactCommitCount: rootReactCommits.length,
    reactCommitP95: percentile(rootReactCommits, 0.95),
    longestReactCommit: Math.max(0, ...rootReactCommits),
    reactByRegion
  }
}

async function startFrameProbe(page) {
  await page.evaluate(() => {
    const samples = { frames: [], longTasks: [], draws: [], inputs: [], reactCommits: [] }
    let lastFrame = 0
    let running = true
    let observer = null
    const tick = (timestamp) => {
      if (!running) return
      if (lastFrame > 0) samples.frames.push(timestamp - lastFrame)
      lastFrame = timestamp
      requestAnimationFrame(tick)
    }
    if ('PerformanceObserver' in window) {
      try {
        observer = new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) samples.longTasks.push(entry.duration)
        })
        observer.observe({ entryTypes: ['longtask'] })
      } catch {
        observer = null
      }
    }
    requestAnimationFrame(tick)
    window.__moonSpriteCanvasProbe = {
      recordDraw(duration) {
        samples.draws.push(duration)
      },
      recordInput(kind, duration) {
        samples.inputs.push({ kind, duration })
      },
      recordReactCommit(region, duration, phase) {
        samples.reactCommits.push({ region, duration, phase })
      },
      stop() {
        running = false
        observer?.disconnect()
        return samples
      }
    }
  })
  await page.waitForTimeout(100)
}

async function stopFrameProbe(page) {
  await page.waitForTimeout(180)
  return page.evaluate(() => window.__moonSpriteCanvasProbe.stop())
}

async function createDocument(page, size) {
  await page.goto(performanceUrl.href, { waitUntil: 'domcontentloaded', timeout: 30_000 })
  await page.waitForSelector('button.start-action.primary-button', { timeout: 30_000 })
  await page.locator('button.start-action.primary-button').click()
  await page.getByRole('spinbutton', { name: '画布宽度' }).fill(String(size))
  await page.getByRole('spinbutton', { name: '画布高度' }).fill(String(size))
  await page.locator('.modal-backdrop button.primary-button').last().click()
  await page.waitForSelector('canvas.stage-canvas', { timeout: 30_000 })
  await page.waitForTimeout(300)
}

async function createComplexDocument(page, size) {
  await page.goto(performanceUrl.href, { waitUntil: 'domcontentloaded', timeout: 30_000 })
  await page.waitForSelector('button.start-action.primary-button', { timeout: 30_000 })
  await page.evaluate(async (canvasSize) => {
    const [{ useWorkspace }, { createDocument, createLayer }] = await Promise.all([
      import('/src/store/workspace.ts'),
      import('/src/core/document.ts')
    ])
    const document = createDocument('Complex performance project', canvasSize, canvasSize, 'rgba')
    document.groups = Array.from({ length: 6 }, (_, index) => ({
      id: `perf-group-${index}`,
      name: `Group ${index}`,
      parentGroupId: index >= 3 ? `perf-group-${index - 3}` : null,
      visible: true,
      locked: false,
      opacity: 1,
      blendMode: 'normal'
    }))
    document.layers = Array.from({ length: 24 }, (_, layerIndex) => {
      const layer = createLayer(`Layer ${layerIndex}`, canvasSize, canvasSize, 'rgba')
      layer.groupId = `perf-group-${layerIndex % 6}`
      const channel = layerIndex % 3
      for (let y = layerIndex % 8; y < canvasSize; y += 8) {
        for (let x = 0; x < canvasSize; x += 1) {
          const offset = (y * canvasSize + x) * 4
          layer.pixels[offset + channel] = 64 + layerIndex * 7
          layer.pixels[offset + 3] = 96 + layerIndex * 5
        }
      }
      return layer
    })
    document.activeLayerId = document.layers.at(-1).id
    const frames = Array.from({ length: 12 }, (_, index) => ({ id: `perf-frame-${index}`, duration: 80 }))
    document.animation = {
      frames,
      activeFrameId: frames[0].id,
      loop: true,
      cels: frames.flatMap((frame, frameIndex) => document.layers.map((layer, layerIndex) => ({
        id: `perf-cel-${frameIndex}-${layerIndex}`,
        layerId: layer.id,
        frameId: frame.id,
        opacity: layer.opacity,
        surface: {
          format: 'rgba',
          width: layer.width,
          height: layer.height,
          offsetX: frameIndex % 3 - 1,
          offsetY: frameIndex % 2,
          pixels: layer.pixels
        }
      })))
    }
    document.timelapse = { ...document.timelapse, enabled: false, snapshots: [] }
    useWorkspace.getState().addSession(document)
  }, size)
  await page.waitForSelector('canvas.stage-canvas', { timeout: 30_000 })
  await page.waitForTimeout(500)
}

async function runScenario(page, size, label, action) {
  await startFrameProbe(page)
  await action()
  return summarize(label, size, await stopFrameProbe(page))
}

async function resetSimpleScenario(page, initialView) {
  await page.evaluate(async (view) => {
    const { useWorkspace } = await import('/src/store/workspace.ts')
    const state = useWorkspace.getState()
    state.setView(view)
    state.setSelection(null)
  }, initialView)
  await page.waitForTimeout(50)
}

async function prepareToolScenario(page, initialView, tool, fillKind = null, shapeKind = null) {
  await resetSimpleScenario(page, initialView)
  await page.evaluate(async ({ activeTool, activeFillKind, activeShapeKind }) => {
    const { useWorkspace } = await import('/src/store/workspace.ts')
    const state = useWorkspace.getState()
    state.setTool(activeTool)
    if (activeFillKind) state.setFillKind(activeFillKind)
    if (activeShapeKind) state.setShapeKind(activeShapeKind)
    state.setPrimaryColor({ r: 41, g: 121, b: 255, a: 255 })
    state.setSecondaryColor({ r: 245, g: 86, b: 74, a: 255 })
    state.setGradientDither('none')
  }, { activeTool: tool, activeFillKind: fillKind, activeShapeKind: shapeKind })
  await page.waitForTimeout(50)
}

async function benchmarkDocument(browser, size, scenarios) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  const page = await context.newPage()
  const complex = [...scenarios].some((scenario) => scenario.startsWith('complex-'))
  if (complex) await createComplexDocument(page, size)
  else await createDocument(page, size)
  const canvas = page.locator('canvas.stage-canvas')
  const box = await canvas.boundingBox()
  if (!box) throw new Error(`无法读取 ${size} x ${size} 画布区域。`)
  const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
  const results = []
  const initialView = complex ? null : await page.evaluate(async () => {
    const { useWorkspace } = await import('/src/store/workspace.ts')
    const state = useWorkspace.getState()
    const session = state.sessions.find((candidate) => candidate.document.id === state.activeId)
    return session ? { ...session.view } : null
  })

  if (scenarios.has('pan')) {
    if (initialView) await resetSimpleScenario(page, initialView)
    results.push(await runScenario(page, size, 'pan', async () => {
      await page.mouse.move(center.x - 90, center.y - 45)
      await page.mouse.down({ button: 'middle' })
      for (let index = 0; index < 72; index += 1) {
        const progress = index / 71
        await page.mouse.move(center.x - 90 + progress * 180, center.y - 45 + Math.sin(progress * Math.PI * 2) * 70)
        await page.waitForTimeout(12)
      }
      await page.mouse.up({ button: 'middle' })
    }))
  }

  if (scenarios.has('zoom')) {
    if (initialView) await resetSimpleScenario(page, initialView)
    results.push(await runScenario(page, size, 'zoom', async () => {
      await page.mouse.move(center.x, center.y)
      for (let index = 0; index < 54; index += 1) {
        await page.mouse.wheel(0, index % 18 < 9 ? -80 : 80)
        await page.waitForTimeout(12)
      }
    }))
  }

  if (scenarios.has('rotated-zoom')) {
    if (initialView) await resetSimpleScenario(page, initialView)
    await page.keyboard.press('R')
    const rotationInput = page.locator('.rotate-view-options input')
    await rotationInput.fill('37')
    await rotationInput.press('Enter')
    await page.keyboard.press('Z')
    results.push(await runScenario(page, size, 'rotated-zoom', async () => {
      await page.mouse.move(center.x, center.y)
      for (let index = 0; index < 54; index += 1) {
        await page.mouse.wheel(0, index % 18 < 9 ? -80 : 80)
        await page.waitForTimeout(12)
      }
    }))
  }

  if (scenarios.has('draw')) {
    if (initialView) await prepareToolScenario(page, initialView, 'pencil')
    results.push(await runScenario(page, size, 'draw', async () => {
      await page.mouse.move(center.x - 120, center.y - 70)
      await page.mouse.down({ button: 'left' })
      for (let index = 0; index < 72; index += 1) {
        const progress = index / 71
        await page.mouse.move(center.x - 120 + progress * 240, center.y - 70 + Math.sin(progress * Math.PI * 4) * 95)
        await page.waitForTimeout(12)
      }
      await page.mouse.up({ button: 'left' })
    }))
  }

  if (scenarios.has('shape')) {
    if (initialView) await prepareToolScenario(page, initialView, 'shape', null, 'ellipse')
    results.push(await runScenario(page, size, 'shape', async () => {
      await page.mouse.move(center.x - 120, center.y - 80)
      await page.mouse.down({ button: 'left' })
      for (let index = 0; index < 48; index += 1) {
        const progress = index / 47
        await page.mouse.move(center.x - 120 + progress * 240, center.y - 80 + progress * 160)
        await page.waitForTimeout(12)
      }
      await page.mouse.up({ button: 'left' })
    }))
  }

  if (scenarios.has('marquee')) {
    if (initialView) await prepareToolScenario(page, initialView, 'selection')
    results.push(await runScenario(page, size, 'marquee', async () => {
      await page.mouse.move(center.x - 120, center.y - 80)
      await page.mouse.down({ button: 'left' })
      for (let index = 0; index < 48; index += 1) {
        const progress = index / 47
        await page.mouse.move(center.x - 120 + progress * 240, center.y - 80 + progress * 160)
        await page.waitForTimeout(12)
      }
      await page.mouse.up({ button: 'left' })
    }))
  }

  if (scenarios.has('bucket-fill')) {
    if (initialView) await prepareToolScenario(page, initialView, 'fill', 'bucket')
    results.push(await runScenario(page, size, 'bucket-fill', async () => {
      await page.mouse.click(center.x, center.y, { button: 'left' })
    }))
  }

  if (scenarios.has('gradient')) {
    if (initialView) await prepareToolScenario(page, initialView, 'fill', 'gradient')
    results.push(await runScenario(page, size, 'gradient', async () => {
      await page.mouse.move(center.x - 140, center.y - 90)
      await page.mouse.down({ button: 'left' })
      for (let index = 0; index < 48; index += 1) {
        const progress = index / 47
        await page.mouse.move(center.x - 140 + progress * 280, center.y - 90 + progress * 180)
        await page.waitForTimeout(12)
      }
      await page.mouse.up({ button: 'left' })
    }))
  }

  if (scenarios.has('complex-draw')) {
    await page.keyboard.press('B')
    results.push(await runScenario(page, size, 'complex-draw', async () => {
      await page.mouse.move(center.x - 120, center.y - 70)
      await page.mouse.down({ button: 'left' })
      for (let index = 0; index < 72; index += 1) {
        const progress = index / 71
        await page.mouse.move(center.x - 120 + progress * 240, center.y - 70 + Math.sin(progress * Math.PI * 4) * 95)
        await page.waitForTimeout(12)
      }
      await page.mouse.up({ button: 'left' })
    }))
  }

  if (scenarios.has('complex-undo')) {
    results.push(await runScenario(page, size, 'complex-undo', async () => {
      await page.evaluate(async () => {
        const { useWorkspace } = await import('/src/store/workspace.ts')
        for (let index = 0; index < 6; index += 1) {
          useWorkspace.getState().undo()
          await new Promise((resolve) => setTimeout(resolve, 60))
          useWorkspace.getState().redo()
          await new Promise((resolve) => setTimeout(resolve, 60))
        }
      })
    }))
  }

  if (scenarios.has('complex-playback')) {
    results.push(await runScenario(page, size, 'complex-playback', async () => {
      await page.evaluate(async () => {
        const { useWorkspace } = await import('/src/store/workspace.ts')
        const session = useWorkspace.getState().sessions.find((candidate) => candidate.document.id === useWorkspace.getState().activeId)
        const frameIds = session?.document.animation?.frames.map((frame) => frame.id) ?? []
        useWorkspace.getState().setAnimationPlaying(true)
        for (const frameId of frameIds) {
          useWorkspace.getState().setActiveAnimationFrame(frameId)
          await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
          await new Promise((resolve) => setTimeout(resolve, 40))
        }
        useWorkspace.getState().setAnimationPlaying(false)
      })
    }))
  }

  await context.close()
  return results
}

let previewProcess = null
let browser = null
try {
  if (!externalUrl) {
    previewProcess = spawn(process.execPath, [resolve('node_modules/vite/bin/vite.js'), '--config', 'vite.config.ts', '--host', host, '--port', String(port), '--strictPort'], {
      cwd: process.cwd(),
      stdio: 'ignore',
      windowsHide: true
    })
  }
  await waitForServer(baseUrl)
  browser = await chromium.launch({ headless: true, executablePath })
  const results = []
  const scenarios = new Set(options.scenarios)
  console.log(`画布性能范围：尺寸 ${options.sizes.join(', ')}；场景 ${options.scenarios.join(', ')}`)
  for (let iteration = 1; iteration <= options.repetitions; iteration += 1) {
    for (const size of options.sizes) {
      const iterationResults = await benchmarkDocument(browser, size, scenarios)
      results.push(...iterationResults.map((result) => ({ ...result, iteration })))
    }
  }
  console.table(results.map((result) => ({
    canvas: `${result.canvasSize}x${result.canvasSize}`,
    scenario: result.scenario,
    samples: result.sampleCount,
    p50: result.p50.toFixed(2),
    p95: result.p95.toFixed(2),
    p99: result.p99.toFixed(2),
    over25: `${result.over25Percent.toFixed(1)}%`,
    longestFrame: result.longestFrame.toFixed(2),
    longestTask: result.longestTask.toFixed(2),
    drawP95: result.drawP95.toFixed(2),
    longestDraw: result.longestDraw.toFixed(2),
    inputP95: result.inputP95.toFixed(2),
    longestInput: result.longestInput.toFixed(2),
    reactCommits: result.reactCommitCount,
    reactP95: result.reactCommitP95.toFixed(2),
    longestReact: result.longestReactCommit.toFixed(2)
  })))
  const report = { schemaVersion: 1, suite: 'canvas', createdAt: new Date().toISOString(), results }
  if (options.outputJson) {
    const outputPath = resolve(options.outputJson)
    await mkdir(dirname(outputPath), { recursive: true })
    await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
    console.log(`画布性能报告已写入 ${outputPath}`)
  }
  console.log(`MOONSPRITE_CANVAS_PERF=${JSON.stringify(report)}`)
} finally {
  await browser?.close().catch(() => undefined)
  if (previewProcess && !previewProcess.killed) previewProcess.kill()
}
