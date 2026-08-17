import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ImageBrush, ProjectBrush, StoredBrush } from '@shared/types'
import { createProceduralBrushes, decodeImageBrush, encodeBrushPng } from '@/core/brushes'
import { useWorkspace, type DocumentSession } from '@/store/workspace'
import { useI18n } from '@/components/I18nProvider'

export interface LoadedBrush {
  stored: StoredBrush | null
  brush: ImageBrush
  procedural?: boolean
  project?: boolean
}

export function useBrushLibrary(session: DocumentSession | null) {
  const { t } = useI18n()
  const [brushSaveName, setBrushSaveName] = useState(() => t('brush.defaultName'))
  const [localBrushes, setLocalBrushes] = useState<LoadedBrush[]>([])
  const [brushLibraryLoaded, setBrushLibraryLoaded] = useState(false)

  const proceduralBrushes = useMemo<LoadedBrush[]>(() => createProceduralBrushes().map((brush) => ({
    brush,
    procedural: true,
    stored: { id: brush.id, name: brush.name, filePath: '' }
  })), [])
  const projectBrushes = useMemo<LoadedBrush[]>(() => (session?.document.customBrushes ?? []).map((brush: ProjectBrush) => ({
    project: true,
    stored: null,
    brush: { ...brush, coverage: brush.coverage.slice(), intrinsicSize: true }
  })), [session?.document.customBrushes])
  const availableImageBrushes = useMemo(
    () => [...proceduralBrushes, ...projectBrushes, ...localBrushes],
    [localBrushes, proceduralBrushes, projectBrushes]
  )
  const selectionBrushes = useMemo(
    () => [...projectBrushes, ...localBrushes.filter((item) => item.brush.intrinsicSize)],
    [localBrushes, projectBrushes]
  )
  const grayscaleBrushes = useMemo(
    () => localBrushes.filter((item) => !item.brush.intrinsicSize),
    [localBrushes]
  )
  const selectedProjectBrush = Boolean(session?.brushImage?.intrinsicSize)
  const selectedCustomBrush = useMemo(
    () => selectionBrushes.find((item) => item.brush.id === session?.brushImage?.id) ?? null,
    [selectionBrushes, session?.brushImage?.id]
  )

  const loadLocalBrushes = useCallback(async (): Promise<void> => {
    let listing
    try {
      listing = await window.moonSprite.listBrushes()
    } catch (error) {
      useWorkspace.getState().setMessage(error instanceof Error ? error.message : t('brush.folderReadError'))
      setBrushLibraryLoaded(true)
      return
    }
    const loaded = await Promise.all(listing.brushes.map(async (stored): Promise<LoadedBrush | null> => {
      try {
        const bytes = await window.moonSprite.readBinary(stored.filePath)
        return { stored, brush: await decodeImageBrush(stored, bytes) }
      } catch (error) {
        useWorkspace.getState().setMessage(error instanceof Error ? t('brush.loadError', { name: stored.name, error: error.message }) : t('brush.loadErrorSimple', { name: stored.name }))
        return null
      }
    }))
    setLocalBrushes(loaded.filter((item): item is LoadedBrush => item !== null))
    setBrushLibraryLoaded(true)
  }, [t])

  useEffect(() => {
    void loadLocalBrushes()
  }, [loadLocalBrushes])

  useEffect(() => {
    if (!session?.brushImageId || session.brushImageTemporary) return
    const brush = availableImageBrushes.find((item) => item.brush.id === session.brushImageId)?.brush
    if (brush && session.brushImage?.id !== brush.id) useWorkspace.getState().setBrushImage(brush)
    if (!brush && brushLibraryLoaded && !session.brushImage) useWorkspace.getState().setBrushImage(null)
  }, [availableImageBrushes, brushLibraryLoaded, session?.brushImage?.id, session?.brushImageId, session?.brushImageTemporary])

  const saveTemporaryBrush = async (): Promise<void> => {
    if (!session?.brushImage || !session.brushImageTemporary) return
    const workspace = useWorkspace.getState()
    const name = brushSaveName.trim() || t('brush.defaultName')
    try {
      const bytes = encodeBrushPng(session.brushImage)
      const stored = await window.moonSprite.saveBrush(name, bytes, session.brushImage.intrinsicSize, session.brushImage.sourceX, session.brushImage.sourceY)
      workspace.setBrushImage(await decodeImageBrush(stored, bytes))
      setBrushSaveName(t('brush.defaultName'))
      await loadLocalBrushes()
      workspace.setMessage(t('brush.saved', { name }))
    } catch (error) {
      workspace.setMessage(error instanceof Error ? error.message : t('brush.saveError'))
    }
  }

  const deleteLocalBrush = async (item: LoadedBrush): Promise<void> => {
    const workspace = useWorkspace.getState()
    const choice = await workspace.requestDialog({
      title: t('brush.deleteTitle'),
      message: t('brush.deleteMessage', { name: item.brush.name }),
      detail: t('brush.deleteDetail'),
      choices: [{ id: 'cancel', label: t('common.cancel'), tone: 'quiet' }, { id: 'delete', label: t('common.delete'), tone: 'danger' }]
    })
    if (choice !== 'delete') return
    try {
      if (item.project) workspace.deleteProjectBrush(item.brush.id)
      else if (item.stored) await window.moonSprite.deleteBrush(item.stored.id)
      if (session?.brushImageId === item.brush.id) workspace.setBrushImage(null)
      if (!item.project) await loadLocalBrushes()
      workspace.setMessage(t('brush.deleted', { name: item.brush.name }))
    } catch (error) {
      workspace.setMessage(error instanceof Error ? error.message : t('brush.deleteError'))
    }
  }

  return {
    brushSaveName,
    setBrushSaveName,
    proceduralBrushes,
    availableImageBrushes,
    selectionBrushes,
    grayscaleBrushes,
    selectedProjectBrush,
    selectedCustomBrush,
    loadLocalBrushes,
    saveTemporaryBrush,
    deleteLocalBrush
  }
}
