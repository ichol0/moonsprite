import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MoonSpriteApi, ProjectPreview } from '@shared/types'
import { createDocument } from '@/core/document'
import { loadEditorPreferences } from '@/core/file-preferences'
import { getRecentProjects, recordRecentProject } from '@/core/home-history'
import { HOME_SECTIONS_STORAGE_KEY } from '@/core/home-sections'
import { encodeProject } from '@/core/project-format'
import { useWorkspace } from '@/store/workspace'
import { HomeWorkspace } from './HomeWorkspace'

const galleryProject = {
  filePath: 'C:\\gallery\\slow.moonsprite',
  fileName: 'slow.moonsprite',
  modifiedAt: 1
}

beforeEach(() => {
  useWorkspace.setState({ recoveryRecords: [] })
})

afterEach(() => {
  cleanup()
  localStorage.clear()
  vi.restoreAllMocks()
})

function installApi(overrides: Partial<MoonSpriteApi>): void {
  window.moonSprite = {
    ensureBuiltinExample: vi.fn(async () => null),
    fileExists: vi.fn(async () => true),
    readProjectPreview: vi.fn(async () => { throw new Error('preview unavailable') }),
    cacheProjectPreview: vi.fn(async () => undefined),
    listGalleryProjects: vi.fn(async () => ({ directoryPath: 'C:\\gallery', projects: [galleryProject] })),
    deleteGalleryProject: vi.fn(async () => undefined),
    ...overrides
  } as unknown as MoonSpriteApi
}

describe('HomeWorkspace', () => {
  it('shows the current development distribution notice', () => {
    installApi({})

    render(<HomeWorkspace onNew={vi.fn()} onOpen={vi.fn()} onOpenProject={vi.fn(async () => true)} onRestoreRecovery={vi.fn(async () => true)} />)

    expect(screen.getByText('DEV.5')).toBeInTheDocument()
    expect(document.querySelector('.start-screen-version')).not.toBeInTheDocument()
    expect(document.querySelectorAll('.start-screen-links > button')).toHaveLength(4)
    expect(document.querySelectorAll('.start-screen-links svg.start-screen-link-icon')).toHaveLength(4)
    expect(document.querySelector('.start-screen-attribution')).not.toBeInTheDocument()
    expect(screen.getByText('仅供内部使用')).toBeInTheDocument()
    expect(screen.getByText('未经允许请勿分发')).toBeInTheDocument()
  })

  it('opens homepage community links and changes language through a dialog', () => {
    const openExternalUrl = vi.fn(async () => undefined)
    installApi({ openExternalUrl })

    render(<HomeWorkspace onNew={vi.fn()} onOpen={vi.fn()} onOpenProject={vi.fn(async () => true)} onRestoreRecovery={vi.fn(async () => true)} />)

    fireEvent.click(screen.getByRole('button', { name: 'QQ 群' }))
    fireEvent.click(screen.getByRole('button', { name: 'Steam' }))
    fireEvent.click(screen.getByRole('button', { name: 'GitHub' }))
    expect(openExternalUrl.mock.calls).toEqual([
      ['https://qm.qq.com/q/3OUXtFg4lW'],
      ['https://store.steampowered.com/search/?term=MoonSprite'],
      ['https://github.com/MoonPixelTeam/moonsprite']
    ])

    fireEvent.click(screen.getByRole('button', { name: '语言' }))
    expect(screen.getByRole('dialog', { name: '界面语言' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('radio', { name: /English/ }))
    fireEvent.click(screen.getByRole('button', { name: '确定' }))
    expect(loadEditorPreferences().language).toBe('en-US')
  })

  it('conceals recent project details without removing the project cards', async () => {
    const filePath = 'C:\\art\\private-home-test.png'
    recordRecentProject(filePath)
    installApi({ readProjectPreview: vi.fn(() => new Promise<ProjectPreview>(() => {})) })

    render(<HomeWorkspace onNew={vi.fn()} onOpen={vi.fn()} onOpenProject={vi.fn(async () => true)} onRestoreRecovery={vi.fn(async () => true)} />)

    expect(await screen.findByText('private-home-test.png')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '隐藏最近项目信息' }))

    expect(screen.queryByText('private-home-test.png')).not.toBeInTheDocument()
    expect(screen.getByText('项目已隐藏')).toBeInTheDocument()
    expect(document.querySelectorAll('.recent-file-row[data-recent-path]')).toHaveLength(1)
    expect(localStorage.getItem('moonsprite.home-recent-privacy.v1')).toBe('hidden')

    fireEvent.click(screen.getByRole('button', { name: '显示最近项目信息' }))
    expect(screen.getByText('private-home-test.png')).toBeInTheDocument()
  })

  it('adds a selected folder as a persisted homepage section', async () => {
    const directoryPath = 'C:\\Reference\\Characters'
    const project = { filePath: `${directoryPath}\\hero.png`, fileName: 'hero.png', modifiedAt: 12 }
    const chooseDirectory = vi.fn(async () => ({ canceled: false, directoryPath }))
    const listFolderProjects = vi.fn(async () => ({ directoryPath, projects: [project] }))
    installApi({
      chooseDirectory,
      listFolderProjects,
      readProjectPreview: vi.fn(() => new Promise<ProjectPreview>(() => {}))
    })

    render(<HomeWorkspace onNew={vi.fn()} onOpen={vi.fn()} onOpenProject={vi.fn(async () => true)} onRestoreRecovery={vi.fn(async () => true)} />)

    fireEvent.click(screen.getByRole('button', { name: '管理首页栏目' }))
    expect(screen.getByRole('dialog', { name: '首页栏目' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '添加文件夹' }))

    await waitFor(() => expect(chooseDirectory).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(listFolderProjects).toHaveBeenCalledWith(directoryPath))
    expect(await screen.findByRole('tab', { name: 'Characters' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByText('hero.png')).toBeInTheDocument()
    expect(JSON.parse(localStorage.getItem(HOME_SECTIONS_STORAGE_KEY) ?? '[]')).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'folder', name: 'Characters', directoryPath })
    ]))
  })

  it('opens a recent project location from the card context menu', async () => {
    const filePath = 'C:\\art\\context-menu-home-test.png'
    recordRecentProject(filePath)
    const openProjectInFolder = vi.fn(async () => undefined)
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:context-preview') })
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() })
    installApi({
      openProjectInFolder,
      readProjectPreview: vi.fn(async () => ({ preview: new Uint8Array([1, 2, 3]), width: 16, height: 12, colorMode: 'rgba' as const }))
    })

    render(<HomeWorkspace onNew={vi.fn()} onOpen={vi.fn()} onOpenProject={vi.fn(async () => true)} onRestoreRecovery={vi.fn(async () => true)} />)
    const title = await screen.findByText('context-menu-home-test.png')
    fireEvent.contextMenu(title.closest('.recent-file-row')!)

    await waitFor(() => expect(openProjectInFolder).toHaveBeenCalledWith(filePath))
  })

  it('loads cached thumbnails for recent image files', async () => {
    const filePath = 'C:\\art\\recent-image-preview-test.webp'
    recordRecentProject(filePath)
    const readProjectPreview = vi.fn(async () => ({ preview: new Uint8Array([1, 2, 3]), width: 320, height: 180, colorMode: 'rgba' as const }))
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:image-preview') })
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() })
    installApi({ readProjectPreview })

    render(<HomeWorkspace onNew={vi.fn()} onOpen={vi.fn()} onOpenProject={vi.fn(async () => true)} onRestoreRecovery={vi.fn(async () => true)} />)

    await waitFor(() => expect(screen.getByText('320 x 180 · RGBA')).toBeInTheDocument())
    expect(readProjectPreview).toHaveBeenCalledWith(filePath)
  })

  it('generates a thumbnail for a recovery without an embedded preview', async () => {
    localStorage.setItem('moonsprite.home-section.v1', 'recovery')
    const sprite = createDocument('recovery-preview', 8, 6, 'rgba')
    sprite.layers[0].pixels.set([255, 0, 0, 255])
    const record = { id: sprite.id, name: 'recovery-preview', updatedAt: String(Date.now()) }
    useWorkspace.setState({ recoveryRecords: [record] })
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:recovery-preview') })
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() })
    installApi({ readRecovery: vi.fn(async () => encodeProject(sprite, { includePreview: false })) })

    render(<HomeWorkspace onNew={vi.fn()} onOpen={vi.fn()} onOpenProject={vi.fn(async () => true)} onRestoreRecovery={vi.fn(async () => true)} />)

    await waitFor(() => expect(screen.getByText('8 x 6 · RGBA')).toBeInTheDocument())
    expect(screen.getByText('recovery-preview（恢复）')).toBeInTheDocument()
    expect(screen.getByText('还剩 7 天自动删除')).toBeInTheDocument()
    expect(document.querySelector('.recovery-file-row img')).toHaveAttribute('src', 'blob:recovery-preview')
  })

  it('shows project rows before their previews finish decoding', async () => {
    localStorage.setItem('moonsprite.home-section.v1', 'gallery')
    installApi({ readProjectPreview: vi.fn(() => new Promise<ProjectPreview>(() => {})) })

    render(<HomeWorkspace onNew={vi.fn()} onOpen={vi.fn()} onOpenProject={vi.fn(async () => true)} onRestoreRecovery={vi.fn(async () => true)} />)

    expect(await screen.findByText('slow.moonsprite')).toBeInTheDocument()
    expect(screen.queryByText('其他')).not.toBeInTheDocument()
  })

  it('cycles and persists the homepage project layout with Ctrl+wheel', () => {
    installApi({})

    const { unmount } = render(<HomeWorkspace onNew={vi.fn()} onOpen={vi.fn()} onOpenProject={vi.fn(async () => true)} onRestoreRecovery={vi.fn(async () => true)} />)
    const list = document.querySelector<HTMLElement>('.recent-files-list')
    if (!list) throw new Error('Recent file list was not rendered')

    expect(list).toHaveClass('home-project-layout-medium')
    fireEvent.wheel(list, { ctrlKey: true, deltaY: -100 })
    expect(list).toHaveClass('home-project-layout-large')
    fireEvent.wheel(list, { ctrlKey: true, deltaY: 100 })
    fireEvent.wheel(list, { ctrlKey: true, deltaY: 100 })
    expect(list).toHaveClass('home-project-layout-small')
    expect(localStorage.getItem('moonsprite.home-project-layout.v1')).toBe('small')

    unmount()
    render(<HomeWorkspace onNew={vi.fn()} onOpen={vi.fn()} onOpenProject={vi.fn(async () => true)} onRestoreRecovery={vi.fn(async () => true)} />)
    expect(document.querySelector('.recent-files-list')).toHaveClass('home-project-layout-small')
  })

  it('limits progressive preview loading to three concurrent files', async () => {
    localStorage.setItem('moonsprite.home-section.v1', 'gallery')
    const galleryProjects = Array.from({ length: 5 }, (_, index) => ({ filePath: `C:\\gallery\\large-${index}.moonsprite`, fileName: `large-${index}.moonsprite`, modifiedAt: index + 10 }))
    const readProjectPreview = vi.fn(() => new Promise<ProjectPreview>(() => {}))
    installApi({
      listGalleryProjects: vi.fn(async () => ({ directoryPath: 'C:\\gallery', projects: galleryProjects })),
      readProjectPreview
    })

    render(<HomeWorkspace onNew={vi.fn()} onOpen={vi.fn()} onOpenProject={vi.fn(async () => true)} onRestoreRecovery={vi.fn(async () => true)} />)

    expect(await screen.findByText('large-4.moonsprite')).toBeInTheDocument()
    await waitFor(() => expect(readProjectPreview).toHaveBeenCalledTimes(3))
  })

  it('keeps an unreadable gallery file when opening fails', async () => {
    localStorage.setItem('moonsprite.home-section.v1', 'gallery')
    const deleteGalleryProject = vi.fn(async () => undefined)
    const onOpenProject = vi.fn(async () => false)
    installApi({ readProjectPreview: vi.fn(async () => { throw new Error('broken preview') }), deleteGalleryProject })

    render(<HomeWorkspace onNew={vi.fn()} onOpen={vi.fn()} onOpenProject={onOpenProject} onRestoreRecovery={vi.fn(async () => true)} />)
    const openButton = await screen.findByTitle(/点击重新尝试打开/)
    fireEvent.click(openButton)

    await waitFor(() => expect(onOpenProject).toHaveBeenCalledWith(galleryProject.filePath, false))
    expect(deleteGalleryProject).not.toHaveBeenCalled()
  })

  it('removes an unreadable recent record without deleting its file', async () => {
    const filePath = 'C:\\art\\missing-home-test.moonsprite'
    recordRecentProject(filePath)
    const deleteGalleryProject = vi.fn(async () => undefined)
    installApi({ readBinary: vi.fn(async () => { throw new Error('missing') }), deleteGalleryProject })

    render(<HomeWorkspace onNew={vi.fn()} onOpen={vi.fn()} onOpenProject={vi.fn(async () => false)} onRestoreRecovery={vi.fn(async () => true)} />)
    fireEvent.click((await screen.findByText('missing-home-test.moonsprite')).closest('.recent-file-open')!)
    fireEvent.click(await screen.findByRole('button', { name: '从最近移除 missing-home-test.moonsprite' }))

    expect(getRecentProjects()).toEqual([])
    expect(deleteGalleryProject).not.toHaveBeenCalled()
  })

  it('loads only the embedded preview for recent MoonSprite projects', async () => {
    const filePath = 'C:\\art\\renamed-home-test.moonsprite'
    recordRecentProject(filePath)
    const readBinary = vi.fn(async () => { throw new Error('should not read a missing file') })
    const onOpenProject = vi.fn(async () => false)
    const fileExists = vi.fn(async () => false)
    const readProjectPreview = vi.fn(async () => ({ preview: new Uint8Array([1, 2, 3]), width: 4000, height: 2000, colorMode: 'rgba' as const }))
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:recent-preview') })
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() })
    installApi({ fileExists, readBinary, readProjectPreview })

    render(<HomeWorkspace onNew={vi.fn()} onOpen={vi.fn()} onOpenProject={onOpenProject} onRestoreRecovery={vi.fn(async () => true)} />)

    expect(await screen.findByText('renamed-home-test.moonsprite')).toBeInTheDocument()
    expect(getRecentProjects()).toHaveLength(1)
    expect(fileExists).not.toHaveBeenCalled()
    await waitFor(() => expect(readProjectPreview).toHaveBeenCalledWith(filePath))
    expect(readBinary).not.toHaveBeenCalled()
    expect(onOpenProject).not.toHaveBeenCalled()
  })

  it('generates and caches a thumbnail when a MoonSprite project has no embedded preview', async () => {
    const filePath = 'C:\\art\\large-without-preview.moonsprite'
    recordRecentProject(filePath)
    const document = createDocument('large fallback', 1024, 512, 'rgba')
    document.layers[0].pixels.set([255, 0, 0, 255])
    const bytes = encodeProject(document, { includePreview: false, compressionLevel: 1 })
    const readBinary = vi.fn(async () => bytes)
    const cacheProjectPreview = vi.fn(async (_filePath: string, _preview: ProjectPreview) => undefined)
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:fallback-preview') })
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() })
    installApi({
      readProjectPreview: vi.fn(async () => { throw new Error('missing embedded preview') }),
      readBinary,
      cacheProjectPreview
    })

    render(<HomeWorkspace onNew={vi.fn()} onOpen={vi.fn()} onOpenProject={vi.fn(async () => true)} onRestoreRecovery={vi.fn(async () => true)} />)

    await waitFor(() => expect(screen.getByText('1024 x 512 · RGBA')).toBeInTheDocument())
    expect(readBinary).toHaveBeenCalledWith(filePath)
    expect(cacheProjectPreview).toHaveBeenCalledWith(filePath, expect.objectContaining({ width: 1024, height: 512, colorMode: 'rgba' }))
    expect(cacheProjectPreview.mock.calls[0]?.[1]?.preview.slice(0, 8)).toEqual(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]))
  })

  it('reuses an embedded preview while its path and timestamp stay unchanged', async () => {
    const cachedProject = { ...galleryProject, filePath: 'C:\\gallery\\cached-home-test.moonsprite', fileName: 'cached-home-test.moonsprite', modifiedAt: 73 }
    const readProjectPreview = vi.fn(async () => ({ preview: new Uint8Array([1, 2, 3]), width: 3, height: 2, colorMode: 'rgba' as const }))
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => `blob:preview-${Math.random()}`) })
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() })
    localStorage.setItem('moonsprite.home-section.v1', 'gallery')
    installApi({
      listGalleryProjects: vi.fn(async () => ({ directoryPath: 'C:\\gallery', projects: [cachedProject] })),
      readProjectPreview
    })

    render(<HomeWorkspace onNew={vi.fn()} onOpen={vi.fn()} onOpenProject={vi.fn(async () => true)} onRestoreRecovery={vi.fn(async () => true)} />)
    const refresh = await screen.findByRole('button', { name: '刷新当前栏目' })
    await waitFor(() => expect(readProjectPreview).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(refresh).not.toBeDisabled())
    fireEvent.click(refresh)

    await waitFor(() => expect(screen.getByText('3 x 2 · RGBA')).toBeInTheDocument())
    expect(readProjectPreview).toHaveBeenCalledTimes(1)
  })

  it('continues reordering when the pointer leaves the move button area', async () => {
    const firstPath = 'C:\\art\\first-home-test.png'
    const secondPath = 'C:\\art\\second-home-test.png'
    recordRecentProject(secondPath)
    recordRecentProject(firstPath)
    installApi({ readBinary: vi.fn(async () => { throw new Error('preview unavailable') }) })

    render(<HomeWorkspace onNew={vi.fn()} onOpen={vi.fn()} onOpenProject={vi.fn(async () => true)} onRestoreRecovery={vi.fn(async () => true)} />)

    await screen.findByText('first-home-test.png')
    const rows = [...document.querySelectorAll<HTMLElement>('.recent-file-row[data-recent-path]')]
    expect(rows.map((row) => row.dataset.recentPath)).toEqual([firstPath, secondPath])
    const firstRow = rows[0]
    const secondRow = rows[1]
    const moveButton = firstRow.querySelector<HTMLButtonElement>('.recent-file-reorder')
    if (!moveButton) throw new Error('Move button was not rendered')

    const setPointerCapture = vi.fn()
    const hasPointerCapture = vi.fn(() => false)
    const releasePointerCapture = vi.fn()
    Object.assign(moveButton, { setPointerCapture, hasPointerCapture, releasePointerCapture })
    Object.defineProperty(secondRow, 'offsetHeight', { configurable: true, value: 40 })
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      if (this === secondRow) return { top: 100, bottom: 140, left: 0, right: 300, width: 300, height: 40, x: 0, y: 100, toJSON: () => ({}) }
      if (this.classList.contains('recent-files-list')) return { top: 0, bottom: 200, left: 0, right: 300, width: 300, height: 200, x: 0, y: 0, toJSON: () => ({}) }
      return { top: 0, bottom: 40, left: 0, right: 300, width: 300, height: 40, x: 0, y: 0, toJSON: () => ({}) }
    })
    Object.defineProperty(document, 'elementsFromPoint', { configurable: true, value: vi.fn(() => [secondRow]) })

    fireEvent.pointerDown(moveButton, { button: 0, pointerId: 7, clientX: 290, clientY: 20 })
    fireEvent.pointerMove(window, { pointerId: 7, clientX: 150, clientY: 120 })

    await waitFor(() => expect([...document.querySelectorAll<HTMLElement>('.recent-file-row[data-recent-path]')].map((row) => row.dataset.recentPath)).toEqual([secondPath, firstPath]))
    expect(setPointerCapture).toHaveBeenCalledWith(7)

    fireEvent.pointerUp(window, { pointerId: 7, clientX: 150, clientY: 120 })
    expect(getRecentProjects().map((project) => project.filePath)).toEqual([secondPath, firstPath])
  })
})
