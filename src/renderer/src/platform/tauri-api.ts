import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import type { ClipboardImage, ClipboardImageSize, MoonSpriteApi, RgbaColor, SaveDialogFormat, StoredBrush, StoredPalette, StoredWorkspace } from '@shared/types'
import { builtInPalettes } from '@/core/built-in-palettes'
import { loadEditorPreferences } from '@/core/file-preferences'
import { translate, type TranslationKey, type TranslationParams } from '@/core/localization'
import { createResourceInfoReader } from './resource-info-cache'

const tr = (key: TranslationKey, params?: TranslationParams): string => translate(loadEditorPreferences().language, key, params)
const dialogLanguage = (): string => loadEditorPreferences().language

const browserRecoveries = new Map<string, { name: string; data: Uint8Array; updatedAt: string }>()
const browserBrushes = new Map<string, { stored: StoredBrush; data: Uint8Array }>()
const browserPalettes = new Map<string, StoredPalette>(builtInPalettes.map((palette) => [palette.id, {
  ...palette,
  filePath: '',
  builtIn: true,
  colors: palette.colors.map((color) => ({ ...color }))
}]))
const browserWorkspaces = new Map<string, StoredWorkspace>([['builtin-default', {
  id: 'builtin-default', name: tr('app.workspace.default'), filePath: '', updatedAt: '', builtIn: true,
  layout: { panelDocks: { color: 'left', palette: 'left', layers: 'right', preview: 'right' }, panelVisibility: { color: true, palette: true, layers: true, preview: true }, inspectorWidth: 300, leftDockWidth: 280, bottomDockHeight: 180, toolRailSide: 'left', previewOpen: true, inspectorLayout: '{"order":["palette","color","layers","preview"],"sizes":{"color":330,"palette":620,"layers":560,"preview":220},"bottomWidths":{"color":280,"palette":280,"layers":320,"preview":280}}', colorSquareDock: 'left', colorSquareAnchor: 'end', floatingPanels: { color: null, palette: null, layers: null, preview: null }, mainWindow: null },
  initialLayout: { panelDocks: { color: 'left', palette: 'left', layers: 'right', preview: 'right' }, panelVisibility: { color: true, palette: true, layers: true, preview: true }, inspectorWidth: 300, leftDockWidth: 280, bottomDockHeight: 180, toolRailSide: 'left', previewOpen: true, inspectorLayout: '{"order":["palette","color","layers","preview"],"sizes":{"color":330,"palette":620,"layers":560,"preview":220},"bottomWidths":{"color":280,"palette":280,"layers":320,"preview":280}}', colorSquareDock: 'left', colorSquareAnchor: 'end', floatingPanels: { color: null, palette: null, layers: null, preview: null }, mainWindow: null }
} as StoredWorkspace]])

const readTauriResourceInfo = createResourceInfoReader(async () => {
  const [totalBytes, freeBytes] = await invoke<[number, number]>('get_resource_info')
  return { totalBytes, freeBytes }
})

const browserPaletteId = (name: string): string => {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || `palette-${Date.now()}`
  let id = base
  let suffix = 2
  while (browserPalettes.has(id)) id = `${base}-${suffix++}`
  return id
}

const createBrowserApi = (): MoonSpriteApi => ({
  openFiles: async () => ({ canceled: true, filePaths: [] }),
  takeStartupFiles: async () => [],
  saveProject: async (_defaultPath?: string, _format?: SaveDialogFormat) => ({ canceled: true }),
  exportImage: async () => ({ canceled: true }),
  savePaletteImage: async () => ({ canceled: true }),
  saveShortcutFile: async () => ({ canceled: true }),
  fileExists: async () => false,
  readBinary: async (filePath) => {
    const brush = [...browserBrushes.values()].find((item) => item.stored.filePath === filePath)
    if (brush) return brush.data.slice()
    throw new Error(tr('platform.browser.readUnsupported'))
  },
  writeBinaryAtomic: async () => { throw new Error(tr('platform.browser.writeUnsupported')) },
  writeClipboardImage: async () => {},
  readClipboardImage: async () => null,
  readClipboardImageSize: async () => null,
  listPalettes: async () => ({ directoryPath: 'palettes', palettes: [...browserPalettes.values()].map((palette) => ({ ...palette, colors: palette.colors.map((color) => ({ ...color })) })) }),
  savePalette: async (requestedId, name, colors) => {
    const id = requestedId ?? browserPaletteId(name)
    const palette = { id, name, filePath: `palettes/${id}.palette.json`, builtIn: false, colors: colors.map((color: RgbaColor) => ({ ...color })) }
    browserPalettes.set(id, palette)
    return { ...palette, colors: palette.colors.map((color) => ({ ...color })) }
  },
  deletePalette: async (id) => {
    if (browserPalettes.get(id)?.builtIn) throw new Error(tr('platform.palette.builtInDelete'))
    browserPalettes.delete(id)
  },
  openPaletteFolder: async () => {},
  listWorkspaces: async () => ({ directoryPath: 'workspaces', workspaces: [...browserWorkspaces.values()].map((workspace) => ({ ...workspace, layout: structuredClone(workspace.layout), initialLayout: structuredClone(workspace.initialLayout) })) }),
  saveWorkspace: async (requestedId, name, layout) => {
    const id = requestedId ?? browserPaletteId(name)
    const existing = browserWorkspaces.get(id)
    const stored: StoredWorkspace = { id, name: name.trim() || tr('app.workspace.default'), filePath: id === 'builtin-default' ? 'workspaces/default.workspace.json' : `workspaces/${id}.workspace.json`, updatedAt: String(Date.now()), builtIn: existing?.builtIn === true || id === 'builtin-default', layout: structuredClone(layout), initialLayout: existing ? structuredClone(existing.initialLayout) : structuredClone(layout) }
    browserWorkspaces.set(id, stored)
    return { ...stored, layout: structuredClone(stored.layout), initialLayout: structuredClone(stored.initialLayout) }
  },
  deleteWorkspace: async (id) => { if (browserWorkspaces.get(id)?.builtIn) throw new Error(tr('app.workspace.builtInDelete')); browserWorkspaces.delete(id) },
  openWorkspaceFolder: async () => {},
  listBrushes: async () => ({ directoryPath: 'brushes', brushes: [...browserBrushes.values()].map((item) => ({ ...item.stored })) }),
  saveBrush: async (name, data, intrinsicSize = false, sourceX, sourceY) => {
    const id = `${name.trim() || tr('brush.defaultName')}-${Date.now()}.png`
    const stored = { id, name: name.trim() || tr('brush.defaultName'), filePath: `brushes/${id}`, intrinsicSize, sourceX, sourceY }
    browserBrushes.set(id, { stored, data: data.slice() })
    return { ...stored }
  },
  deleteBrush: async (id) => { browserBrushes.delete(id) },
  openBrushFolder: async () => {},
  listRecoveries: async () => [...browserRecoveries].map(([id, item]) => ({ id, name: item.name, updatedAt: item.updatedAt })),
  readRecovery: async (id) => {
    const recovery = browserRecoveries.get(id)
    if (!recovery) throw new Error(tr('platform.recovery.notFound'))
    return recovery.data.slice()
  },
  writeRecovery: async (id, name, data) => { browserRecoveries.set(id, { name, data: data.slice(), updatedAt: new Date().toISOString() }) },
  deleteRecovery: async (id) => { browserRecoveries.delete(id) },
  listGalleryProjects: async () => ({ directoryPath: 'gallery', projects: [] }),
  deleteGalleryProject: async () => {},
  openGalleryFolder: async () => {},
  ensureBuiltinExample: async () => null,
  openProjectInFolder: async () => {},
  openExternalUrl: async (url) => { window.open(url, '_blank', 'noopener,noreferrer') },
  getResourceInfo: async () => ({ totalBytes: 8 * 1024 ** 3, freeBytes: 4 * 1024 ** 3 }),
  confirmUnsaved: async () => 'cancel',
  pathForFile: () => '',
  onRequestClose: () => () => {},
  cancelClose: () => {},
  approveClose: () => {}
})

const invokeBytes = async (command: string, args?: Record<string, unknown>): Promise<Uint8Array> => {
  const bytes = await invoke<number[]>(command, args)
  return new Uint8Array(bytes)
}

export const createTauriApi = (): MoonSpriteApi => ({
  openFiles: () => invoke('open_files', { language: dialogLanguage() }),
  takeStartupFiles: () => invoke('take_startup_files'),
  saveProject: (defaultPath, format) => invoke('save_project', { defaultPath, format, language: dialogLanguage() }),
  exportImage: (defaultPath, format) => invoke('export_image', { defaultPath, format, language: dialogLanguage() }),
  savePaletteImage: (defaultPath) => invoke('save_palette_image', { defaultPath, language: dialogLanguage() }),
  saveShortcutFile: (defaultPath) => invoke('save_shortcut_file', { defaultPath, language: dialogLanguage() }),
  fileExists: (filePath) => invoke('file_exists', { filePath }),
  readBinary: (filePath) => invokeBytes('read_binary', { filePath }),
  writeBinaryAtomic: (filePath, data) => invoke('write_binary_atomic', { filePath, data: Array.from(data) }),
  writeClipboardImage: (image) => invoke('write_clipboard_image', { width: image.width, height: image.height, data: Array.from(image.data) }),
  readClipboardImage: async (): Promise<ClipboardImage | null> => {
    const image = await invoke<{ width: number; height: number; data: number[] } | null>('read_clipboard_image')
    return image ? { width: image.width, height: image.height, data: new Uint8Array(image.data) } : null
  },
  readClipboardImageSize: () => invoke<ClipboardImageSize | null>('read_clipboard_image_size'),
  listPalettes: () => invoke('list_palettes'),
  savePalette: (id, name, colors) => invoke('save_palette', { id, name, colors }),
  deletePalette: (id) => invoke('delete_palette', { id }),
  openPaletteFolder: () => invoke('open_palette_folder'),
  listWorkspaces: () => invoke('list_workspaces'),
  saveWorkspace: (id, name, layout) => invoke('save_workspace', { id, name, layout }),
  deleteWorkspace: (id) => invoke('delete_workspace', { id }),
  openWorkspaceFolder: () => invoke('open_workspace_folder'),
  listBrushes: () => invoke('list_brushes'),
  saveBrush: (name, data, intrinsicSize = false, sourceX, sourceY) => invoke('save_brush', { name, data: Array.from(data), intrinsicSize, sourceX, sourceY }),
  deleteBrush: (id) => invoke('delete_brush', { id }),
  openBrushFolder: () => invoke('open_brush_folder'),
  listRecoveries: () => invoke('list_recoveries'),
  readRecovery: (id) => invokeBytes('read_recovery', { id }),
  writeRecovery: (id, name, data) => invoke('write_recovery', { id, name, data: Array.from(data) }),
  deleteRecovery: (id) => invoke('delete_recovery', { id }),
  listGalleryProjects: () => invoke('list_gallery_projects'),
  deleteGalleryProject: (fileName) => invoke('delete_gallery_project', { fileName }),
  openGalleryFolder: () => invoke('open_gallery_folder'),
  ensureBuiltinExample: () => invoke('ensure_builtin_example'),
  openProjectInFolder: (filePath) => invoke('open_project_in_folder', { filePath }),
  openExternalUrl: (url) => invoke('open_external_url', { url }),
  getResourceInfo: readTauriResourceInfo,
  confirmUnsaved: (name) => invoke('confirm_unsaved', { name }),
  pathForFile: (file) => (file as File & { path?: string }).path ?? '',
  onRequestClose: (callback) => {
    let active = true
    let removeListener: (() => void) | null = null
    void listen('app:request-close', () => { if (active) void callback() }).then((remove) => {
      removeListener = remove
      if (!active) remove()
    })
    return () => { active = false; removeListener?.() }
  },
  cancelClose: () => { void invoke('cancel_close') },
  approveClose: () => { void invoke('approve_close') }
})

export async function installTauriApi(): Promise<void> {
  if (window.moonSprite) return
  if ('__TAURI_INTERNALS__' in window) window.moonSprite = createTauriApi()
  else if (import.meta.env.DEV) window.moonSprite = createBrowserApi()
}
