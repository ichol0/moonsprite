import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { MoonSpriteApi } from '@shared/types'
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
    listGalleryProjects: vi.fn(async () => ({ directoryPath: 'C:\\gallery', projects: [galleryProject] })),
    deleteGalleryProject: vi.fn(async () => undefined),
    ...overrides
  } as unknown as MoonSpriteApi
}

describe('HomeWorkspace', () => {
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
})
