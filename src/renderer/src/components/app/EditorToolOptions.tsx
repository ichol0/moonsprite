import { memo, useEffect, useRef, useState } from 'react'
import { Check, ChevronDown, Redo2, RefreshCw, Trash2, Undo2 } from 'lucide-react'
import type { ImageBrush, ImageBrushSettings, ProceduralBrushId, ProceduralBrushSettings, RgbaColor } from '@shared/types'
import { NumberInput } from '@/components/NumberInput'
import { PerformanceProfiler } from '@/components/PerformanceProfiler'
import { toolOptionsRenderKey } from '@/core/app-render-keys'
import { isProceduralBrushId } from '@/core/brushes'
import { brushMaskOffsets, brushStampDimensions } from '@/core/tools'
import { loadEditorPreferences, type CheckerboardPreferences } from '@/core/file-preferences'
import { useWorkspace } from '@/store/workspace'
import { useBrushLibrary } from './useBrushLibrary'
import { PixelAssetIcon, PixelShapeIcon, SELECTION_MODES, TOOL_DEFINITIONS } from './editor-tools'

function GrayscaleBrushThumbnail({ brush }: { brush: ImageBrush }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const context = canvasRef.current?.getContext('2d')
    if (!context) return
    const size = 32
    const image = context.createImageData(size, size)
    for (let y = 0; y < size; y += 1) for (let x = 0; x < size; x += 1) {
      const sourceX = Math.min(brush.width - 1, Math.floor(x * brush.width / size))
      const sourceY = Math.min(brush.height - 1, Math.floor(y * brush.height / size))
      const gray = brush.coverage[sourceY * brush.width + sourceX] ?? 0
      const offset = (y * size + x) * 4
      image.data[offset] = gray
      image.data[offset + 1] = gray
      image.data[offset + 2] = gray
      image.data[offset + 3] = 255
    }
    context.putImageData(image, 0, 0)
  }, [brush])
  return <canvas ref={canvasRef} width={32} height={32} aria-hidden="true" />
}

function GrayscaleBrushPreview({ brush, settings, color, paintMode, proceduralAntialiasStrength = 0 }: {
  brush: ImageBrush
  settings: ImageBrushSettings
  color: RgbaColor
  paintMode: 'paint' | 'pattern-source' | 'pattern-target'
  proceduralAntialiasStrength?: number
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [checkerboard, setCheckerboard] = useState<CheckerboardPreferences>(() => loadEditorPreferences().checkerboard)
  useEffect(() => {
    const syncPreferences = (): void => setCheckerboard(loadEditorPreferences().checkerboard)
    window.addEventListener('moonsprite:preferences-changed', syncPreferences)
    return () => window.removeEventListener('moonsprite:preferences-changed', syncPreferences)
  }, [])
  useEffect(() => {
    const canvas = canvasRef.current
    const context = canvas?.getContext('2d')
    if (!canvas || !context) return
    const checker = checkerboard.size
    context.clearRect(0, 0, canvas.width, canvas.height)
    for (let y = 0; y < canvas.height; y += checker) for (let x = 0; x < canvas.width; x += checker) {
      const background = ((x / checker) + (y / checker)) % 2 === 0 ? checkerboard.lightColor : checkerboard.darkColor
      context.fillStyle = `rgb(${background.r} ${background.g} ${background.b})`
      context.fillRect(x, y, checker, checker)
    }
    const stampSize = Math.min(64, Math.max(8, Math.max(brush.width, brush.height)))
    const stamp = brushStampDimensions(stampSize, brush)
    const pixelScale = Math.max(1, Math.floor(64 / Math.max(stamp.width, stamp.height)))
    const startX = Math.floor((canvas.width - stamp.width * pixelScale) / 2)
    const startY = Math.floor((canvas.height - stamp.height * pixelScale) / 2)
    context.fillStyle = `rgb(${color.r} ${color.g} ${color.b})`
    const previewMode = paintMode === 'pattern-source' ? 'paint' : paintMode
    for (const point of brushMaskOffsets(stampSize, 'square', 'solid', 1, 0, 0, brush, settings, proceduralAntialiasStrength, previewMode)) {
      context.globalAlpha = color.a / 255 * point.coverage / 255
      context.fillRect(startX + point.x * pixelScale, startY + point.y * pixelScale, pixelScale, pixelScale)
    }
    context.globalAlpha = 1
  }, [brush, checkerboard, color, paintMode, proceduralAntialiasStrength, settings])
  return <canvas ref={canvasRef} className="brush-live-preview" width={232} height={82} aria-label="灰度笔刷实时预览" />
}

type ProceduralControl = { key: keyof ProceduralBrushSettings; label: string; min: number; max: number; suffix?: string }
const proceduralControls: Record<ProceduralBrushId, ProceduralControl[]> = {
  'procedural:noise': [
    { key: 'scale', label: '颗粒', min: 1, max: 12, suffix: 'px' },
    { key: 'detail', label: '密度', min: 5, max: 95, suffix: '%' },
    { key: 'variation', label: '对比', min: 0, max: 100, suffix: '%' }
  ],
  'procedural:clouds': [
    { key: 'scale', label: '尺度', min: 4, max: 64, suffix: 'px' },
    { key: 'detail', label: '细节', min: 1, max: 5 },
    { key: 'variation', label: '对比', min: 0, max: 100, suffix: '%' }
  ],
  'procedural:cells': [
    { key: 'scale', label: '大小', min: 4, max: 40, suffix: 'px' },
    { key: 'detail', label: '边缘', min: 0, max: 100, suffix: '%' },
    { key: 'variation', label: '随机', min: 0, max: 100, suffix: '%' }
  ],
  'procedural:fibers': [
    { key: 'scale', label: '间距', min: 2, max: 32, suffix: 'px' },
    { key: 'angle', label: '方向', min: 0, max: 180, suffix: '°' },
    { key: 'detail', label: '弯曲', min: 0, max: 100, suffix: '%' },
    { key: 'variation', label: '杂乱', min: 0, max: 100, suffix: '%' }
  ]
}

const proceduralPresets: Record<ProceduralBrushId, Array<{ label: string; values: Partial<ProceduralBrushSettings> }>> = {
  'procedural:noise': [
    { label: '细腻', values: { scale: 1, detail: 42, variation: 30 } },
    { label: '标准', values: { scale: 2, detail: 50, variation: 50 } },
    { label: '粗粒', values: { scale: 6, detail: 60, variation: 75 } }
  ],
  'procedural:clouds': [
    { label: '柔和', values: { scale: 12, detail: 4, variation: 25 } },
    { label: '标准', values: { scale: 18, detail: 3, variation: 45 } },
    { label: '翻涌', values: { scale: 38, detail: 2, variation: 80 } }
  ],
  'procedural:cells': [
    { label: '细胞', values: { scale: 7, detail: 25, variation: 35 } },
    { label: '标准', values: { scale: 12, detail: 38, variation: 70 } },
    { label: '岩块', values: { scale: 25, detail: 62, variation: 95 } }
  ],
  'procedural:fibers': [
    { label: '细丝', values: { scale: 5, detail: 18, variation: 12 } },
    { label: '标准', values: { scale: 9, detail: 35, variation: 28 } },
    { label: '木纹', values: { scale: 17, detail: 72, variation: 58 } }
  ]
}

function ProceduralBrushControls({ brushId, settings, onChange }: {
  brushId: ProceduralBrushId
  settings: ProceduralBrushSettings
  onChange: (settings: Partial<ProceduralBrushSettings>) => void
}) {
  return <>
    <div className="procedural-preset-row">{proceduralPresets[brushId].map((preset) => <button type="button" key={preset.label} onClick={() => onChange(preset.values)}>{preset.label}</button>)}</div>
    <div className="procedural-parameter-list">
      {proceduralControls[brushId].map((control) => <label key={control.key}><span>{control.label}</span><input type="range" min={control.min} max={control.max} value={settings[control.key]} onChange={(event) => onChange({ [control.key]: Number(event.target.value) })} /><NumberInput min={control.min} max={control.max} value={settings[control.key]} onValueChange={(value) => onChange({ [control.key]: value })} /><strong>{control.suffix ?? ''}</strong></label>)}
      <label className="procedural-seed"><span>种子</span><NumberInput min={0} max={9999} value={settings.seed} onValueChange={(seed) => onChange({ seed })} /><button type="button" title="更换随机种子" aria-label="更换随机种子" onClick={() => onChange({ seed: Math.floor(Math.random() * 10000) })}><RefreshCw size={13} /></button></label>
    </div>
  </>
}

function BrushOutputControls({ settings, onChange }: { settings: ImageBrushSettings; onChange: (settings: Partial<ImageBrushSettings>) => void }) {
  return <>
    <div className="brush-gray-presets"><button type="button" onClick={() => onChange({ mode: 'dither', blackPoint: 0, whitePoint: 255, threshold: 128, invert: false })}>柔和</button><button type="button" onClick={() => onChange({ mode: 'dither', blackPoint: 40, whitePoint: 215, threshold: 128, invert: false })}>清晰</button><button type="button" onClick={() => onChange({ mode: 'threshold', blackPoint: 0, whitePoint: 255, threshold: 128, invert: false })}>硬边</button></div>
    <div className="brush-gray-mode"><button type="button" className={settings.mode === 'dither' ? 'selected' : ''} onClick={() => onChange({ mode: 'dither' })}>抖动</button><button type="button" className={settings.mode === 'threshold' ? 'selected' : ''} onClick={() => onChange({ mode: 'threshold' })}>阈值</button></div>
    <div className="brush-level-controls">
      <label><span>黑场</span><input type="range" min={0} max={settings.whitePoint - 1} value={settings.blackPoint} onChange={(event) => onChange({ blackPoint: Number(event.target.value) })} /><NumberInput min={0} max={settings.whitePoint - 1} value={settings.blackPoint} onValueChange={(blackPoint) => onChange({ blackPoint })} /></label>
      <label><span>白场</span><input type="range" min={settings.blackPoint + 1} max={255} value={settings.whitePoint} onChange={(event) => onChange({ whitePoint: Number(event.target.value) })} /><NumberInput min={settings.blackPoint + 1} max={255} value={settings.whitePoint} onValueChange={(whitePoint) => onChange({ whitePoint })} /></label>
      {settings.mode === 'threshold' && <label><span>阈值</span><input type="range" min={0} max={255} value={settings.threshold} onChange={(event) => onChange({ threshold: Number(event.target.value) })} /><NumberInput min={0} max={255} value={settings.threshold} onValueChange={(threshold) => onChange({ threshold })} /></label>}
    </div>
  </>
}

export const EditorToolOptions = memo(function EditorToolOptions() {
  const renderKey = useWorkspace((state) => toolOptionsRenderKey(
    state.sessions.find((item) => item.document.id === state.activeId) ?? null
  ))
  const [brushFlyoutOpen, setBrushFlyoutOpen] = useState(false)
  const [brushSizeFlyoutOpen, setBrushSizeFlyoutOpen] = useState(false)
  const [brushOutputOpen, setBrushOutputOpen] = useState(false)
  const state = useWorkspace.getState()
  const session = state.sessions.find((item) => item.document.id === state.activeId) ?? null
  const {
    brushSaveName,
    setBrushSaveName,
    proceduralBrushes,
    selectionBrushes,
    grayscaleBrushes,
    selectedProjectBrush,
    selectedCustomBrush,
    loadLocalBrushes,
    saveTemporaryBrush,
    deleteLocalBrush
  } = useBrushLibrary(session)

  useEffect(() => {
    const closeOutside = (event: PointerEvent): void => {
      if (!(event.target instanceof Element)) return
      if (!event.target.closest('.brush-source')) setBrushFlyoutOpen(false)
      if (!event.target.closest('.brush-size-control')) setBrushSizeFlyoutOpen(false)
    }
    const closeOnBlur = (): void => setBrushFlyoutOpen(false)
    const closeAll = (): void => {
      setBrushFlyoutOpen(false)
      setBrushSizeFlyoutOpen(false)
      setBrushOutputOpen(false)
    }
    window.addEventListener('pointerdown', closeOutside, true)
    window.addEventListener('blur', closeOnBlur)
    window.addEventListener('moonsprite:close-dialog', closeAll)
    return () => {
      window.removeEventListener('pointerdown', closeOutside, true)
      window.removeEventListener('blur', closeOnBlur)
      window.removeEventListener('moonsprite:close-dialog', closeAll)
    }
  }, [])

  useEffect(() => {
    if (session?.tool !== 'pencil' && session?.tool !== 'eraser' && session?.tool !== 'fill') {
      setBrushFlyoutOpen(false)
      setBrushSizeFlyoutOpen(false)
    }
  }, [renderKey, session?.tool])

  if (!session) return null
  const workspace = useWorkspace.getState()
  const isBrushTool = session.tool === 'pencil' || session.tool === 'eraser' || session.tool === 'fill'

  return <PerformanceProfiler id="EditorToolOptions"><div className="tool-options">
    <span className="tool-label">{TOOL_DEFINITIONS.find((tool) => tool.id === session.tool)?.label}</span>
    {isBrushTool && <>
      {session.brushImage && <button type="button" className="brush-return-button" title="返回基础笔刷" onClick={() => { workspace.setBrushImage(null); setBrushFlyoutOpen(false) }}>返回</button>}
      <div className="brush-source">
        <button className={`brush-source-trigger ${brushFlyoutOpen ? 'selected' : ''}`} type="button" title="打开笔刷库" aria-label="打开笔刷库" onClick={() => setBrushFlyoutOpen((value) => !value)}>{session.brushImage ? <GrayscaleBrushThumbnail brush={session.brushImage} /> : <PixelShapeIcon kind={session.brushShape} />}</button>
        {brushFlyoutOpen && <>
          <div className="brush-library" role="dialog" aria-label="笔刷库">
            <div className="brush-library-selection-column">
              <section className="brush-library-section">
                <header className="brush-library-section-title"><strong>基础笔刷</strong><span>形状</span></header>
                <div className="brush-library-grid basic-brush-grid" aria-label="基础笔刷">
                  <button className={!session.brushImage && session.brushShape === 'round' ? 'selected' : ''} type="button" title="圆形笔刷" aria-label="圆形笔刷" onClick={() => { workspace.setBrushImage(null); workspace.setBrushShape('round') }}><PixelShapeIcon kind="round" /></button>
                  <button className={!session.brushImage && session.brushShape === 'square' ? 'selected' : ''} type="button" title="方形笔刷" aria-label="方形笔刷" onClick={() => { workspace.setBrushImage(null); workspace.setBrushShape('square') }}><PixelShapeIcon kind="square" /></button>
                  <button className={!session.brushImage && session.brushShape === 'line' ? 'selected' : ''} type="button" title="横线笔刷" aria-label="横线笔刷" onClick={() => { workspace.setBrushImage(null); workspace.setBrushShape('line') }}><PixelShapeIcon kind="line" /></button>
                </div>
              </section>
              <section className="brush-library-section">
                <header className="brush-library-section-title"><strong>程序纹理</strong><span>内置</span></header>
                <div className="brush-library-grid" aria-label="内置程序纹理">{proceduralBrushes.map((item) => <button key={item.brush.id} className={session.brushImage?.id === item.brush.id ? 'selected procedural' : 'procedural'} title={item.brush.name} aria-label={item.brush.name} onClick={() => workspace.setBrushImage(item.brush)}><GrayscaleBrushThumbnail brush={item.brush} /></button>)}</div>
              </section>
              <section className="brush-library-section">
                <header className="brush-library-section-title"><strong>自定义笔刷</strong><span>{selectionBrushes.length}</span></header>
                {selectionBrushes.length > 0 ? <div className="brush-library-grid local-brush-grid selection-brush-grid" aria-label="自定义笔刷">{selectionBrushes.map((item) => <div className="local-brush-item" key={item.brush.id}><button className={session.brushImage?.id === item.brush.id ? 'selected' : ''} title={`${item.brush.name} (${item.brush.width} x ${item.brush.height})`} aria-label={item.brush.name} onClick={() => workspace.setBrushImage(item.brush)}><GrayscaleBrushThumbnail brush={item.brush} /></button></div>)}</div> : <p className="brush-library-empty">用选区创建的笔刷会显示在这里</p>}
              </section>
              <section className="brush-library-section">
                <header className="brush-library-section-title"><strong>灰度图笔刷</strong><span>{grayscaleBrushes.length}</span></header>
                {grayscaleBrushes.length > 0 ? <div className="brush-library-grid grayscale-brush-grid" aria-label="本地灰度图笔刷">{grayscaleBrushes.map((item) => <button key={item.brush.id} className={session.brushImage?.id === item.brush.id ? 'selected' : ''} title={`${item.brush.name} (${item.brush.width} x ${item.brush.height})`} aria-label={item.brush.name} onClick={() => workspace.setBrushImage(item.brush)}><GrayscaleBrushThumbnail brush={item.brush} /></button>)}</div> : <p className="brush-library-empty">笔刷文件夹中暂无灰度图笔刷</p>}
              </section>
            </div>
            <footer><button type="button" onClick={() => void loadLocalBrushes()}>刷新</button><button type="button" onClick={() => void window.moonSprite.openBrushFolder()}>打开笔刷文件夹</button></footer>
          </div>
          {session.brushImage ? <aside className="brush-details-panel">
            {selectedProjectBrush ? <section className="brush-basic-settings custom-brush-settings">
              <GrayscaleBrushPreview brush={session.brushImage} settings={session.brushImageSettings} color={session.primaryColor} paintMode={session.brushPaintMode} />
              <strong>{session.brushImage.name}</strong>
              <p>这是保存在当前工程中的自定义笔刷，只保留原始像素和笔刷模式，不提供灰度图参数调整。</p>
              {selectedCustomBrush && <button type="button" className="brush-delete-command" onClick={() => void deleteLocalBrush(selectedCustomBrush)}><Trash2 size={13} />删除笔刷</button>}
            </section> : <section className="brush-gray-settings">
              <GrayscaleBrushPreview brush={session.brushImage} settings={session.brushImageSettings} color={session.primaryColor} paintMode="paint" proceduralAntialiasStrength={session.proceduralAntialias && session.brushImage.id.startsWith('procedural:') ? session.proceduralAntialiasStrength : 0} />
              <header><strong>{session.brushImage.name}{session.brushImageTemporary && <small>临时</small>}</strong><button type="button" className={session.brushImageSettings.invert ? 'selected' : ''} onClick={() => workspace.setBrushImageSettings({ invert: !session.brushImageSettings.invert })}>{session.brushImageSettings.invert && <Check size={12} />}反相</button></header>
              {isProceduralBrushId(session.brushImage.id) ? <>
                <ProceduralBrushControls brushId={session.brushImage.id} settings={session.proceduralBrushSettings[session.brushImage.id]} onChange={workspace.setProceduralBrushSettings} />
                <section className="brush-advanced-settings">
                  <button type="button" className="brush-advanced-trigger" aria-expanded={brushOutputOpen} onClick={() => setBrushOutputOpen((open) => !open)}><span>输出设置</span><ChevronDown size={14} /></button>
                  {brushOutputOpen && <div><div className="procedural-antialias-control"><label className="tool-checkbox"><input type="checkbox" checked={session.proceduralAntialias} onChange={(event) => workspace.setProceduralAntialias(event.target.checked)} />纹理抗锯齿</label>{session.proceduralAntialias && <label className="procedural-antialias-strength"><span>程度</span><input type="range" min="1" max="100" value={session.proceduralAntialiasStrength} onChange={(event) => workspace.setProceduralAntialiasStrength(Number(event.target.value))} /><NumberInput min={1} max={100} value={session.proceduralAntialiasStrength} onValueChange={workspace.setProceduralAntialiasStrength} /><strong>%</strong></label>}</div><BrushOutputControls settings={session.brushImageSettings} onChange={workspace.setBrushImageSettings} /></div>}
                </section>
              </> : <BrushOutputControls settings={session.brushImageSettings} onChange={workspace.setBrushImageSettings} />}
            </section>}
            {session.brushImageTemporary && <div className="temporary-brush-save"><input aria-label="永久笔刷名称" value={brushSaveName} maxLength={64} onChange={(event) => setBrushSaveName(event.target.value)} /><button type="button" onClick={() => void saveTemporaryBrush()}>永久保存</button></div>}
          </aside> : <aside className="brush-details-panel"><section className="brush-basic-settings"><div className="brush-basic-settings-preview"><PixelShapeIcon kind={session.brushShape} /></div><strong>{session.brushShape === 'round' ? '圆形笔刷' : session.brushShape === 'line' ? '横线笔刷' : '方形笔刷'}</strong><p>基础笔刷使用顶部的尺寸控制。选择程序纹理或灰度图后，可在这里调整纹理与输出。</p></section></aside>}
        </>}
      </div>
      {!session.brushImage?.intrinsicSize && <div className="brush-size-control" onPointerDown={() => setBrushSizeFlyoutOpen(true)}><NumberInput aria-label="笔刷尺寸数值" min={1} max={128} suffix="px" value={session.brushSize} onValueChange={workspace.setBrushSize} onFocus={() => setBrushSizeFlyoutOpen(true)} />{brushSizeFlyoutOpen && <div className="brush-size-popover" role="dialog" aria-label="调整笔刷尺寸"><input aria-label="笔刷尺寸滑条" type="range" min="1" max="128" value={session.brushSize} onChange={(event) => workspace.setBrushSize(Number(event.target.value))} /><strong>{session.brushSize}px</strong></div>}</div>}
      {session.brushImage?.intrinsicSize && <select className="brush-paint-mode-select" aria-label="笔刷模式" title="图案与来源对齐：按笔刷来源位置平铺；图案与目标对齐：按当前落点平铺；油漆笔刷：按画布原点平铺" value={session.brushPaintMode} onChange={(event) => workspace.setBrushPaintMode(event.target.value as typeof session.brushPaintMode)}><option value="pattern-source">图案与来源对齐</option><option value="pattern-target">图案与目标对齐</option><option value="paint">油漆笔刷</option></select>}
      {(session.tool === 'pencil' || session.tool === 'eraser') && <label className="tool-checkbox"><input type="checkbox" checked={session.perfectPixels} onChange={(event) => workspace.setPerfectPixels(event.target.checked)} />完美像素</label>}
    </>}
    {session.tool === 'selection' && <>
      <div className="segmented-control selection-mode-control" aria-label="选区模式">{SELECTION_MODES.map((mode) => <button key={mode.id} title={mode.label} aria-label={mode.label} className={session.selectionMode === mode.id ? 'selected' : ''} onClick={() => workspace.setSelectionMode(mode.id)}><PixelAssetIcon src={mode.icon} /></button>)}</div>
      {session.selectionKind === 'magic' && <><label className="wand-tolerance">容差 <NumberInput aria-label="魔棒容差" min={0} max={255} value={session.wandTolerance} onValueChange={workspace.setWandTolerance} /></label><label className="tool-checkbox"><input aria-label="连续选择" type="checkbox" checked={session.wandContiguous} onChange={(event) => workspace.setWandContiguous(event.target.checked)} />连续</label></>}
    </>}
    {session.tool === 'fill' && <div className="segmented-control fill-mode-control" aria-label="填充范围"><button className={session.fillMode === 'contiguous' ? 'selected' : ''} onClick={() => workspace.setFillMode('contiguous')}>连续</button><button className={session.fillMode === 'global' ? 'selected' : ''} onClick={() => workspace.setFillMode('global')}>不连续</button></div>}
    {session.tool === 'move' && <label className="tool-checkbox"><input type="checkbox" checked={session.moveAutoSelect} onChange={(event) => workspace.setMoveAutoSelect(event.target.checked)} />自动选择图层</label>}
    {session.tool === 'rotate' && <div className="rotate-view-options"><label>旋转度数 <NumberInput aria-label="旋转度数" min={0} max={359.9} step={0.1} value={Math.round(session.view.rotation * 10) / 10} onValueChange={(rotation) => workspace.setView({ rotation: ((rotation % 360) + 360) % 360 })} /></label><button type="button" className="tool-text-button" onClick={() => workspace.setView({ rotation: 0 })}>复位视图</button></div>}
    <span className="tool-options-spacer" />
    <button className="tool-text-button" onClick={() => workspace.undo()} disabled={!session.history.canUndo}><Undo2 size={15} />撤销</button>
    <button className="tool-text-button" onClick={() => workspace.redo()} disabled={!session.history.canRedo}><Redo2 size={15} />重做</button>
  </div></PerformanceProfiler>
})
