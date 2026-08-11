import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { MoonSpriteApi } from '@shared/types'
import { createDocument } from '@/core/document'
import { getRecentProjects, recordRecentProject } from '@/core/home-history'
import { encodeProject } from '@/core/project-format'
import { useWorkspace } from '@/store/workspace'
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
    installApi({ readBinary: vi.fn(() => new Promise<Uint8Array>(() => {})) })

    render(<HomeWorkspace onNew={vi.fn()} onOpen={vi.fn()} onOpenProject={vi.fn(async () => true)} onRestoreRecovery={vi.fn(async () => true)} />)

    expect(await screen.findByText('slow.moonsprite')).toBeInTheDocument()
    expect(screen.queryByText('其他')).not.toBeInTheDocument()
  })

  it('limits progressive preview loading to three concurrent files', async () => {
    localStorage.setItem('moonsprite.home-section.v1', 'gallery')
    const galleryProjects = Array.from({ length: 5 }, (_, index) => ({ filePath: `C:\\gallery\\large-${index}.moonsprite`, fileName: `large-${index}.moonsprite`, modifiedAt: index + 10 }))
    const readBinary = vi.fn(() => new Promise<Uint8Array>(() => {}))
    installApi({
      listGalleryProjects: vi.fn(async () => ({ directoryPath: 'C:\\gallery', projects: galleryProjects })),
      readBinary
    })

    render(<HomeWorkspace onNew={vi.fn()} onOpen={vi.fn()} onOpenProject={vi.fn(async () => true)} onRestoreRecovery={vi.fn(async () => true)} />)

    expect(await screen.findByText('large-4.moonsprite')).toBeInTheDocument()
    await waitFor(() => expect(readBinary).toHaveBeenCalledTimes(3))
  })

  it('keeps an unreadable gallery file when opening fails', async () => {
    localStorage.setItem('moonsprite.home-section.v1', 'gallery')
    const deleteGalleryProject = vi.fn(async () => undefined)
    const onOpenProject = vi.fn(async () => false)
    installApi({ readBinary: vi.fn(async () => { throw new Error('broken preview') }), deleteGalleryProject })

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
    fireEvent.click(await screen.findByRole('button', { name: '从最近移除 missing-home-test.moonsprite' }))

    expect(getRecentProjects()).toEqual([])
    expect(deleteGalleryProject).not.toHaveBeenCalled()
  })

  it('automatically removes a recent record when its file no longer exists', async () => {
    const filePath = 'C:\\art\\renamed-home-test.moonsprite'
    recordRecentProject(filePath)
    const readBinary = vi.fn(async () => { throw new Error('should not read a missing file') })
    const onOpenProject = vi.fn(async () => false)
    installApi({ fileExists: vi.fn(async () => false), readBinary })

    render(<HomeWorkspace onNew={vi.fn()} onOpen={vi.fn()} onOpenProject={onOpenProject} onRestoreRecovery={vi.fn(async () => true)} />)

    await waitFor(() => expect(getRecentProjects()).toEqual([]))
    expect(screen.queryByText('renamed-home-test.moonsprite')).not.toBeInTheDocument()
    expect(useWorkspace.getState().message).toBe('renamed-home-test.moonsprite：文件不存在，已从最近记录移除。')
    expect(readBinary).not.toHaveBeenCalled()
    expect(onOpenProject).not.toHaveBeenCalled()
  })

  it('reuses a decoded preview while its path and timestamp stay unchanged', async () => {
    const cachedProject = { ...galleryProject, filePath: 'C:\\gallery\\cached-home-test.moonsprite', fileName: 'cached-home-test.moonsprite', modifiedAt: 73 }
    const bytes = encodeProject(createDocument('cached preview', 3, 2, 'rgba'))
    const readBinary = vi.fn(async () => bytes)
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => `blob:preview-${Math.random()}`) })
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() })
    localStorage.setItem('moonsprite.home-section.v1', 'gallery')
    installApi({
      listGalleryProjects: vi.fn(async () => ({ directoryPath: 'C:\\gallery', projects: [cachedProject] })),
      readBinary
    })

    render(<HomeWorkspace onNew={vi.fn()} onOpen={vi.fn()} onOpenProject={vi.fn(async () => true)} onRestoreRecovery={vi.fn(async () => true)} />)
    const refresh = await screen.findByRole('button', { name: '刷新当前栏目' })
    await waitFor(() => expect(readBinary).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(refresh).not.toBeDisabled())
    fireEvent.click(refresh)

    await waitFor(() => expect(screen.getByText('3 x 2 · RGBA')).toBeInTheDocument())
    expect(readBinary).toHaveBeenCalledTimes(1)
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
