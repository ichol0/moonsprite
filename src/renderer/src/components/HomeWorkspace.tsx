import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { Eraser, FileImage, FolderOpen, GripVertical, Images, MoreHorizontal, Pin, Plus, RefreshCw, Trash2, TriangleAlert } from 'lucide-react'
import type { RecoveryRecord } from '@shared/types'
import { APP_CHANNEL_LABEL } from '@/core/app-meta'
import { readProjectGalleryMetadata } from '@/core/project-format'
import { clearRecentProjects, getGalleryPins, getRecentProjects, recordRecentProject, removeGalleryPin, removeRecentProject, reorderRecentProjects, toggleGalleryPin, toggleRecentProjectPinned, type RecentProject } from '@/core/home-history'
import { useWorkspace } from '@/store/workspace'
import moonspriteLogo from '@/assets/moonsprite-logo.svg'

interface ProjectCard extends RecentProject {
  previewUrl?: string
  width?: number
  height?: number
  colorMode?: 'rgba' | 'indexed'
  error?: string
}

interface HomeWorkspaceProps {
  onNew(): void
  onOpen(): void
  onOpenProject(filePath: string, keepHomeOpen?: boolean): Promise<boolean>
}

type HomeSection = 'recent' | 'gallery' | 'recovery' | 'other'
const homeSectionStorageKey = 'moonsprite.home-section.v1'
const loadHomeSection = (): HomeSection => {
  const stored = localStorage.getItem(homeSectionStorageKey)
  return stored === 'gallery' || stored === 'recovery' || stored === 'other' ? stored : 'recent'
}

const formatTime = (value: number): string => {
  if (!Number.isFinite(value) || value <= 0 || Number.isNaN(new Date(value).getTime())) return '时间未知'
  return new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(value))
}

function parseRecoveryTimestamp(value: string): number {
  const numeric = Number(value)
  if (Number.isFinite(numeric)) {
    // Older builds stored nanoseconds, while the browser Date API expects milliseconds.
    if (Math.abs(numeric) >= 100_000_000_000_000_000) return Math.trunc(numeric / 1_000_000)
    if (Math.abs(numeric) >= 100_000_000_000_000) return Math.trunc(numeric / 1_000)
    if (Math.abs(numeric) > 0 && Math.abs(numeric) < 100_000_000_000) return Math.trunc(numeric * 1_000)
    return Math.trunc(numeric)
  }
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : 0
}

const colorModeLabel = (colorMode?: ProjectCard['colorMode']): string => colorMode === 'indexed' ? '索引色' : 'RGBA'

interface ProjectFileRowProps {
  project: ProjectCard
  reorderable: boolean
  dragging: boolean
  removePending: boolean
  onOpen(): void
  onOpenInBackground(): void
  onPin(): void
  onDelete?(): void
  onReorderStart(event: ReactPointerEvent<HTMLButtonElement>, filePath: string): void
  onReorderMove(event: ReactPointerEvent<HTMLButtonElement>): void
  onReorderEnd(event: ReactPointerEvent<HTMLButtonElement>): void
}

function ProjectFileRow({ project, reorderable, dragging, removePending, onOpen, onOpenInBackground, onPin, onDelete, onReorderStart, onReorderMove, onReorderEnd }: ProjectFileRowProps) {
  const invalid = Boolean(project.error)
  return <article className={`recent-file-row ${invalid ? 'invalid' : ''} ${project.pinned ? 'pinned' : ''} ${reorderable ? 'reorderable' : ''} ${onDelete ? 'deletable' : ''} ${dragging ? 'dragging' : ''} ${removePending ? 'remove-pending' : ''}`} data-recent-path={project.filePath}>
    <button type="button" className="recent-file-open" onPointerDown={(event) => { if (event.button === 1) event.preventDefault() }} onClick={onOpen} onAuxClick={(event) => { if (event.button !== 1) return; event.preventDefault(); event.stopPropagation(); onOpenInBackground() }} title={invalid ? `无法读取：${project.error}。点击移除该项目。` : `打开 ${project.name}`}>
      <span className="recent-file-preview">{project.previewUrl ? <img src={project.previewUrl} alt="" /> : invalid ? <TriangleAlert size={21} /> : <FileImage size={20} />}</span>
      <span className="recent-file-copy"><strong>{project.name}</strong><small>{invalid ? '无法读取，点击后移除' : `${project.width ?? '-'} x ${project.height ?? '-'} · ${colorModeLabel(project.colorMode)}`}</small><span>{project.filePath}</span></span>
      <time>{formatTime(project.lastOpened)}</time>
    </button>
    <button className="recent-file-pin" type="button" onClick={onPin} aria-label={project.pinned ? `取消置顶 ${project.name}` : `置顶 ${project.name}`} title={project.pinned ? '取消置顶' : '置顶'}><Pin size={14} /></button>
    {onDelete && <button className="recent-file-delete" type="button" onClick={onDelete} aria-label={`删除工程 ${project.name}`} title="删除工程"><Trash2 size={14} /></button>}
    {reorderable && <button className="recent-file-reorder" type="button" onPointerDown={(event) => onReorderStart(event, project.filePath)} onPointerMove={onReorderMove} onPointerUp={onReorderEnd} onPointerCancel={onReorderEnd} aria-label={`调整 ${project.name} 的位置`} title="拖动调整位置"><GripVertical size={15} /></button>}
  </article>
}

function RecoveryFileRow({ record, onRestore, onDiscard }: { record: RecoveryRecord; onRestore(): void; onDiscard(): void }) {
  const updatedAt = parseRecoveryTimestamp(record.updatedAt)
  return <article className="recent-file-row recovery-file-row">
    <button type="button" className="recent-file-open" onClick={onRestore} title={`恢复 ${record.name}`}>
      <span className="recent-file-preview"><RefreshCw size={20} /></span>
      <span className="recent-file-copy"><strong>{record.name}</strong><small>非正常关闭后自动保存 · 点击恢复</small><span>上次保存：{formatTime(updatedAt)}</span></span>
      <time>{formatTime(updatedAt)}</time>
    </button>
    <button type="button" className="recent-file-discard" onClick={onDiscard} aria-label={`放弃 ${record.name}`} title="放弃并删除草稿"><Trash2 size={14} /></button>
  </article>
}

export function HomeWorkspace({ onNew, onOpen, onOpenProject }: HomeWorkspaceProps) {
  const [section, setSection] = useState<HomeSection>(loadHomeSection)
  const [projects, setProjects] = useState<ProjectCard[]>([])
  const [galleryDirectory, setGalleryDirectory] = useState('')
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const objectUrls = useRef<string[]>([])
  const loadGeneration = useRef(0)
  const projectsRef = useRef<ProjectCard[]>([])
  const recentListRef = useRef<HTMLDivElement>(null)
  const reorderRef = useRef<{ filePath: string; pointerId: number; outsideList: boolean } | null>(null)
  const [draggingProjectPath, setDraggingProjectPath] = useState('')
  const [removePendingProjectPath, setRemovePendingProjectPath] = useState('')
  const setMessage = useWorkspace((state) => state.setMessage)
  const recoveryRecords = useWorkspace((state) => state.recoveryRecords)
  const restoreRecovery = useWorkspace((state) => state.restoreRecovery)
  const discardRecovery = useWorkspace((state) => state.discardRecovery)
  const requestDialog = useWorkspace((state) => state.requestDialog)

  const releaseObjectUrls = (): void => {
    for (const url of objectUrls.current) URL.revokeObjectURL(url)
    objectUrls.current = []
  }

  const readCards = async (records: RecentProject[]): Promise<ProjectCard[]> => Promise.all(records.map(async (record): Promise<ProjectCard> => {
    try {
      const bytes = await window.moonSprite.readBinary(record.filePath)
      const metadata = readProjectGalleryMetadata(bytes)
      const buffer = metadata.preview.buffer.slice(metadata.preview.byteOffset, metadata.preview.byteOffset + metadata.preview.byteLength) as ArrayBuffer
      const previewUrl = URL.createObjectURL(new Blob([buffer], { type: 'image/png' }))
      return { ...record, name: record.fileName, previewUrl, width: metadata.width, height: metadata.height, colorMode: metadata.colorMode }
    } catch (error) {
      return { ...record, name: record.fileName, error: error instanceof Error ? error.message : '工程文件无法读取' }
    }
  }))

  const loadSection = async (target: HomeSection): Promise<void> => {
    const generation = ++loadGeneration.current
    releaseObjectUrls()
    setProjects([])
    setLoadError('')
    if (target === 'other' || target === 'recovery') { setLoading(false); return }
    setLoading(true)
    try {
      let records: RecentProject[]
      if (target === 'gallery') {
        const listing = await window.moonSprite.listGalleryProjects()
        const pins = new Set(getGalleryPins())
        setGalleryDirectory(listing.directoryPath)
        records = listing.projects.map((project) => ({ filePath: project.filePath, fileName: project.fileName, name: project.fileName, lastOpened: project.modifiedAt, pinned: pins.has(project.filePath) }))
          .sort((left, right) => Number(right.pinned) - Number(left.pinned) || right.lastOpened - left.lastOpened)
      } else records = getRecentProjects()
      const cards = await readCards(records)
      if (generation !== loadGeneration.current) {
        for (const card of cards) if (card.previewUrl) URL.revokeObjectURL(card.previewUrl)
        return
      }
      objectUrls.current = cards.flatMap((card) => card.previewUrl ? [card.previewUrl] : [])
      setProjects(cards)
    } catch (error) {
      if (generation === loadGeneration.current) setLoadError(error instanceof Error ? error.message : `无法读取${target === 'gallery' ? '画廊' : '最近文件'}`)
    } finally {
      if (generation === loadGeneration.current) setLoading(false)
    }
  }

  useEffect(() => {
    projectsRef.current = projects
  }, [projects])

  useEffect(() => {
    void loadSection(section)
    return () => { loadGeneration.current += 1; releaseObjectUrls() }
  }, [section])

  useEffect(() => {
    let disposed = false
    void window.moonSprite.ensureBuiltinExample().then((filePath) => {
      if (disposed || !filePath) return
      const existing = getRecentProjects().find((project) => project.filePath === filePath)
      if (!existing) {
        recordRecentProject(filePath, '示例')
        toggleRecentProjectPinned(filePath)
        void loadSection(section)
      }
    }).catch(() => {
      // A missing bundled example must not block the start screen.
    })
    return () => { disposed = true }
  // The example is seeded once per start-screen mount; section changes reload normally above.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const selectSection = (target: HomeSection): void => {
    setSection(target)
    try { localStorage.setItem(homeSectionStorageKey, target) } catch { /* Keep the selected home section for this session. */ }
  }

  const clearRecent = (): void => {
    const retainedPaths = new Set(clearRecentProjects().map((project) => project.filePath))
    setProjects((items) => {
      const removedUrls = new Set(items.flatMap((item) => !retainedPaths.has(item.filePath) && item.previewUrl ? [item.previewUrl] : []))
      for (const url of removedUrls) URL.revokeObjectURL(url)
      objectUrls.current = objectUrls.current.filter((url) => !removedUrls.has(url))
      const next = items.filter((item) => retainedPaths.has(item.filePath))
      projectsRef.current = next
      return next
    })
  }

  const pinProject = (filePath: string): void => {
    if (section === 'gallery') {
      const pinned = new Set(toggleGalleryPin(filePath))
      setProjects((items) => {
        const next = items.map((item) => ({ ...item, pinned: pinned.has(item.filePath) })).sort((left, right) => Number(right.pinned) - Number(left.pinned) || right.lastOpened - left.lastOpened)
        projectsRef.current = next
        return next
      })
      return
    }
    const ordered = toggleRecentProjectPinned(filePath)
    const records = new Map(ordered.map((item, index) => [item.filePath, { pinned: item.pinned, index }]))
    setProjects((items) => {
      const next = items.map((item) => ({ ...item, pinned: records.get(item.filePath)?.pinned === true }))
        .sort((left, right) => (records.get(left.filePath)?.index ?? Number.MAX_SAFE_INTEGER) - (records.get(right.filePath)?.index ?? Number.MAX_SAFE_INTEGER))
      projectsRef.current = next
      return next
    })
  }

  const removeProjectFromView = (filePath: string): void => {
    setProjects((items) => {
      const removed = items.find((item) => item.filePath === filePath)
      if (removed?.previewUrl) {
        URL.revokeObjectURL(removed.previewUrl)
        objectUrls.current = objectUrls.current.filter((url) => url !== removed.previewUrl)
      }
      const next = items.filter((item) => item.filePath !== filePath)
      projectsRef.current = next
      return next
    })
  }

  const deleteGalleryProject = async (project: ProjectCard): Promise<void> => {
    const choice = await requestDialog({
      title: '删除工程',
      message: `确定删除“${project.name}”吗？`,
      detail: '工程文件将从画廊文件夹中删除，同时从最近记录和置顶列表中移除。此操作无法撤销。',
      choices: [
        { id: 'cancel', label: '取消', tone: 'quiet' },
        { id: 'delete', label: '删除工程', tone: 'danger' }
      ]
    })
    if (choice !== 'delete') return

    try {
      const fileName = project.filePath.split(/[\\/]/).pop() ?? project.fileName
      await window.moonSprite.deleteGalleryProject(fileName)
      removeGalleryPin(project.filePath)
      removeRecentProject(project.filePath)
      removeProjectFromView(project.filePath)
      setMessage(`${project.name}：已从画廊和最近记录删除。`)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '无法删除画廊工程。')
    }
  }

  const discardUnreadableProject = async (project: ProjectCard, reason?: string): Promise<void> => {
    const detail = reason ?? project.error ?? '工程文件不存在或已损坏。'
    if (section === 'gallery') {
      try {
        const fileName = project.filePath.split(/[\\/]/).pop() ?? project.fileName
        await window.moonSprite.deleteGalleryProject(fileName)
        removeGalleryPin(project.filePath)
        setMessage(`${project.name}：${detail}，已从画廊删除。`)
      } catch (error) {
        setMessage(`${project.name}：${detail}，无法删除画廊文件，已从当前列表移除。${error instanceof Error ? ` ${error.message}` : ''}`)
      }
    } else {
      removeRecentProject(project.filePath)
      setMessage(`${project.name}：${detail}，已从最近记录移除。`)
    }
    removeProjectFromView(project.filePath)
  }

  const openProject = async (project: ProjectCard, keepHomeOpen = false): Promise<void> => {
    if (project.error) {
      await discardUnreadableProject(project)
      return
    }
    const opened = await onOpenProject(project.filePath, keepHomeOpen)
    if (!opened) await discardUnreadableProject(project, '打开时无法读取工程文件。')
  }

  const startRecentReorder = (event: ReactPointerEvent<HTMLButtonElement>, filePath: string): void => {
    if (section !== 'recent' || event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    reorderRef.current = { filePath, pointerId: event.pointerId, outsideList: false }
    setDraggingProjectPath(filePath)
    setRemovePendingProjectPath('')
  }

  const pointIsInsideRecentList = (clientX: number, clientY: number): boolean => {
    const bounds = recentListRef.current?.getBoundingClientRect()
    return Boolean(bounds && clientX >= bounds.left && clientX <= bounds.right && clientY >= bounds.top && clientY <= bounds.bottom)
  }

  const moveRecentReorder = (event: ReactPointerEvent<HTMLButtonElement>): void => {
    const drag = reorderRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    event.preventDefault()
    const outsideList = !pointIsInsideRecentList(event.clientX, event.clientY)
    if (outsideList !== drag.outsideList) {
      drag.outsideList = outsideList
      setRemovePendingProjectPath(outsideList ? drag.filePath : '')
    }
    if (outsideList) return
    const targetRow = document.elementsFromPoint(event.clientX, event.clientY)
      .map((element) => element.closest<HTMLElement>('.recent-file-row[data-recent-path]'))
      .find((element): element is HTMLElement => Boolean(element))
    const targetPath = targetRow?.dataset.recentPath
    if (!targetPath || targetPath === drag.filePath) return
    const items = projectsRef.current
    const source = items.find((item) => item.filePath === drag.filePath)
    const target = items.find((item) => item.filePath === targetPath)
    if (!source || !target || source.pinned !== target.pinned) return
    const remaining = items.filter((item) => item.filePath !== drag.filePath)
    const targetIndex = remaining.findIndex((item) => item.filePath === targetPath)
    if (targetIndex < 0) return
    const insertAfter = event.clientY >= targetRow.getBoundingClientRect().top + targetRow.offsetHeight / 2
    remaining.splice(targetIndex + (insertAfter ? 1 : 0), 0, source)
    if (remaining.every((item, index) => item.filePath === items[index]?.filePath)) return
    projectsRef.current = remaining
    setProjects(remaining)
  }

  const endRecentReorder = (event: ReactPointerEvent<HTMLButtonElement>): void => {
    const drag = reorderRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    reorderRef.current = null
    setDraggingProjectPath('')
    setRemovePendingProjectPath('')
    const removeFromRecent = event.type !== 'pointercancel' && !pointIsInsideRecentList(event.clientX, event.clientY)
    if (removeFromRecent) {
      const project = projectsRef.current.find((item) => item.filePath === drag.filePath)
      removeRecentProject(drag.filePath)
      removeProjectFromView(drag.filePath)
      setMessage(`${project?.name ?? '工程'}：已从最近记录移除，工程文件未删除。`)
      return
    }
    reorderRecentProjects(projectsRef.current.map((project) => project.filePath))
  }

  const emptyState = section === 'gallery'
    ? { icon: <Images size={28} />, title: '画廊中没有工程', detail: '工程文件保存在 MoonSprite 根目录的 gallery 文件夹中。' }
    : section === 'recovery'
      ? { icon: <RefreshCw size={28} />, title: '没有待恢复的工程', detail: '非正常关闭的工程会出现在这里。' }
      : section === 'other'
      ? { icon: <MoreHorizontal size={28} />, title: '其他栏目', detail: '这个栏目暂时留空。' }
      : { icon: <FileImage size={28} />, title: '没有最近文件', detail: '打开或保存一个工程后，它会显示在这里。' }

  return <section className="aseprite-home" aria-label="MoonSprite 启动页">
    <div className="aseprite-home-inner">
      <header className="start-screen-header">
        <div className="start-screen-mark" aria-hidden="true"><img src={moonspriteLogo} alt="" /></div>
        <div><h1>MOONSPRITE</h1><p>像素画工作台</p></div>
        <span className="start-screen-version">{APP_CHANNEL_LABEL}</span>
      </header>
      <div className="start-screen-rule" />
      <div className="start-screen-layout">
        <aside className="start-actions" aria-label="新建和打开">
          <button className="start-action primary-button" type="button" onClick={onNew}><Plus size={20} /><span><strong>新建精灵</strong><small>创建一个新的像素画布</small></span></button>
          <button className="start-action quiet-button" type="button" onClick={onOpen}><FolderOpen size={20} /><span><strong>打开精灵</strong><small>打开 MoonSprite、Aseprite 工程或 PNG</small></span></button>
          <div className="start-action-note"><FileImage size={15} /><span>支持：`.moonsprite`、`.ase`、`.aseprite`、`.png`</span></div>
        </aside>
        <section className="recent-files-panel" aria-label={section === 'recent' ? '最近文件' : section === 'gallery' ? '画廊' : section === 'recovery' ? '恢复' : '其他栏目'}>
          <header className="recent-files-header">
            <div className="home-section-tabs" role="tablist" aria-label="首页栏目">
              <button role="tab" aria-selected={section === 'recent'} className={section === 'recent' ? 'selected' : ''} onClick={() => selectSection('recent')}>最近</button>
              <button role="tab" aria-selected={section === 'gallery'} className={section === 'gallery' ? 'selected' : ''} onClick={() => selectSection('gallery')}>画廊</button>
              {recoveryRecords.length > 0 && <button role="tab" aria-selected={section === 'recovery'} className={section === 'recovery' ? 'selected' : ''} onClick={() => selectSection('recovery')}>恢复<span className="recovery-count">{recoveryRecords.length}</span></button>}
              <button role="tab" aria-selected={section === 'other'} className={section === 'other' ? 'selected' : ''} onClick={() => selectSection('other')}>其他</button>
            </div>
            <div className="recent-file-tools">
              {section === 'gallery' && <button className="icon-button" type="button" onClick={() => void window.moonSprite.openGalleryFolder()} aria-label="打开画廊文件夹" title={galleryDirectory || '打开画廊文件夹'}><FolderOpen size={15} /></button>}
              <button className="icon-button" type="button" onClick={() => void loadSection(section)} disabled={loading || section === 'other' || section === 'recovery'} aria-label="刷新当前栏目" title="刷新"><RefreshCw size={15} /></button>
              {section === 'recent' && <button className="icon-button" type="button" onClick={clearRecent} disabled={!projects.some((project) => !project.pinned)} aria-label="清除未置顶记录" title="清除未置顶记录"><Eraser size={15} /></button>}
            </div>
          </header>
          <div ref={recentListRef} className="recent-files-list">
            {loading && <div className="start-screen-state"><RefreshCw className="spin" size={22} /><span>正在读取工程</span></div>}
            {!loading && loadError && <div className="start-screen-state error"><TriangleAlert size={22} /><strong>无法读取栏目</strong><span>{loadError}</span><button className="quiet-button" type="button" onClick={() => void loadSection(section)}>重试</button></div>}
            {!loading && !loadError && ((section !== 'recovery' && projects.length === 0) || (section === 'recovery' && recoveryRecords.length === 0)) && <div className="start-screen-state">{emptyState.icon}<strong>{emptyState.title}</strong><span>{emptyState.detail}</span></div>}
            {!loading && !loadError && section === 'recovery' && recoveryRecords.map((record) => <RecoveryFileRow key={record.id} record={record} onRestore={() => void restoreRecovery(record.id)} onDiscard={() => void discardRecovery(record.id)} />)}
            {!loading && !loadError && section !== 'recovery' && projects.map((project) => <ProjectFileRow key={project.filePath} project={project} reorderable={section === 'recent'} dragging={draggingProjectPath === project.filePath} removePending={removePendingProjectPath === project.filePath} onOpen={() => void openProject(project)} onOpenInBackground={() => void openProject(project, true)} onPin={() => pinProject(project.filePath)} onDelete={section === 'gallery' ? () => void deleteGalleryProject(project) : undefined} onReorderStart={startRecentReorder} onReorderMove={moveRecentReorder} onReorderEnd={endRecentReorder} />)}
          </div>
        </section>
      </div>
      <footer className="start-screen-footer"><span>MoonSprite 是独立实现的像素画编辑器</span><span>MIT License</span></footer>
    </div>
  </section>
}
