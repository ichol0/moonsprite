import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { MoonSpriteApi, ProjectPreview } from '@shared/types'
import { createDocument } from '@/core/document'
import { getRecentProjects, recordRecentProject } from '@/core/home-history'
import { encodeProject } from '@/core/project-format'
import { HomeWorkspace } from './HomeWorkspace'

const galleryProject = {
  filePath: 'C:\\gallery\\slow.moonsprite',
  fileName: 'slow.moonsprite',
  modifiedAt: 1
}

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

    expect(screen.getByText(/dev\.4/)).toBeInTheDocument()
    expect(document.querySelector('.start-screen-attribution')).toHaveTextContent('MoonSprite 是独立实现的像素画编辑器 · MIT License')
  })

  it('shows project rows before their previews finish decoding', async () => {
    localStorage.setItem('moonsprite.home-section.v1', 'gallery')
    installApi({ readProjectPreview: vi.fn(() => new Promise<ProjectPreview>(() => {})) })

    render(<HomeWorkspace onNew={vi.fn()} onOpen={vi.fn()} onOpenProject={vi.fn(async () => true)} onRestoreRecovery={vi.fn(async () => true)} />)

    expect(await screen.findByText('slow.moonsprite')).toBeInTheDocument()
    expect(screen.queryByText('其他')).not.toBeInTheDocument()
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
