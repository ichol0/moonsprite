import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ImageBrush, ProjectBrush, StoredBrush } from '@shared/types'
import { createProceduralBrushes, decodeImageBrush, encodeBrushPng } from '@/core/brushes'
import { useWorkspace, type DocumentSession } from '@/store/workspace'

export interface LoadedBrush {
  stored: StoredBrush | null
  brush: ImageBrush
  procedural?: boolean
  project?: boolean
}

export function useBrushLibrary(session: DocumentSession | null) {
  const [brushSaveName, setBrushSaveName] = useState('选区笔刷')
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
      useWorkspace.getState().setMessage(error instanceof Error ? error.message : '无法读取笔刷文件夹。')
      setBrushLibraryLoaded(true)
      return
    }
    const loaded = await Promise.all(listing.brushes.map(async (stored): Promise<LoadedBrush | null> => {
      try {
        const bytes = await window.moonSprite.readBinary(stored.filePath)
        return { stored, brush: decodeImageBrush(stored, bytes) }
      } catch (error) {
        useWorkspace.getState().setMessage(error instanceof Error ? `无法载入笔刷 ${stored.name}：${error.message}` : `无法载入笔刷 ${stored.name}。`)
        return null
      }
    }))
    setLocalBrushes(loaded.filter((item): item is LoadedBrush => item !== null))
    setBrushLibraryLoaded(true)
  }, [])

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
    const name = brushSaveName.trim() || '选区笔刷'
    try {
      const bytes = encodeBrushPng(session.brushImage)
      const stored = await window.moonSprite.saveBrush(name, bytes, session.brushImage.intrinsicSize, session.brushImage.sourceX, session.brushImage.sourceY)
      workspace.setBrushImage(decodeImageBrush(stored, bytes))
      setBrushSaveName('选区笔刷')
      await loadLocalBrushes()
      workspace.setMessage(`笔刷“${name}”已永久保存。`)
    } catch (error) {
      workspace.setMessage(error instanceof Error ? error.message : '无法保存笔刷。')
    }
  }

  const deleteLocalBrush = async (item: LoadedBrush): Promise<void> => {
    const workspace = useWorkspace.getState()
    const choice = await workspace.requestDialog({
      title: '删除笔刷',
      message: `确定删除“${item.brush.name}”吗？`,
      detail: '删除后无法从 MoonSprite 中恢复。',
      choices: [{ id: 'cancel', label: '取消', tone: 'quiet' }, { id: 'delete', label: '删除', tone: 'danger' }]
    })
    if (choice !== 'delete') return
    try {
      if (item.project) workspace.deleteProjectBrush(item.brush.id)
      else if (item.stored) await window.moonSprite.deleteBrush(item.stored.id)
      if (session?.brushImageId === item.brush.id) workspace.setBrushImage(null)
      if (!item.project) await loadLocalBrushes()
      workspace.setMessage(`已删除笔刷“${item.brush.name}”。`)
    } catch (error) {
      workspace.setMessage(error instanceof Error ? error.message : '无法删除笔刷。')
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
