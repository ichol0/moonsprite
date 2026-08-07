import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { Eraser, FileImage, FolderOpen, GripVertical, Images, Pin, Plus, RefreshCw, Trash2, TriangleAlert, X } from 'lucide-react'
import type { RecoveryRecord } from '@shared/types'
import { APP_CHANNEL_LABEL } from '@/core/app-meta'
import { readProjectGalleryMetadata } from '@/core/project-format'
import { decodeDocumentFileAsync } from '@/core/document-files'
import { exportDocumentImage } from '@/core/png'
import { clearRecentProjects, getGalleryPins, getRecentProjects, recordRecentProject, removeGalleryPin, removeRecentProject, reorderRecentProjects, toggleGalleryPin, toggleRecentProjectPinned, type RecentProject } from '@/core/home-history'
import { useWorkspace } from '@/store/workspace'
import { useI18n } from '@/components/I18nProvider'
import { translate, type AppLocale } from '@/core/localization'
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
  onRestoreRecovery(id: string): Promise<boolean>
}

type HomeSection = 'recent' | 'gallery' | 'recovery'
const homeSectionStorageKey = 'moonsprite.home-section.v1'
interface CachedProjectPreview {
  bytes: Uint8Array
  width: number
  height: number
  colorMode: ProjectCard['colorMode']
}
const projectPreviewCache = new Map<string, CachedProjectPreview>()
const maxCachedProjectPreviews = 48
const previewCacheKey = (record: RecentProject): string => `${record.filePath}\u0000${record.lastOpened}`
const cacheProjectPreview = (key: string, preview: CachedProjectPreview): void => {
  projectPreviewCache.delete(key)
  projectPreviewCache.set(key, preview)
  while (projectPreviewCache.size > maxCachedProjectPreviews) projectPreviewCache.delete(projectPreviewCache.keys().next().value!)
}
const createPreviewUrl = (bytes: Uint8Array): string => {
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
  return URL.createObjectURL(new Blob([buffer], { type: 'image/png' }))
}
const loadHomeSection = (): HomeSection => {
  const stored = localStorage.getItem(homeSectionStorageKey)
  return stored === 'gallery' || stored === 'recovery' ? stored : 'recent'
}

const formatTime = (value: number, locale: AppLocale): string => {
  if (!Number.isFinite(value) || value <= 0 || Number.isNaN(new Date(value).getTime())) return translate(locale, 'home.unknownTime')
  return new Intl.DateTimeFormat(locale, { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(value))
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

interface ProjectFileRowProps {
  project: ProjectCard
  reorderable: boolean
  dragging: boolean
  removePending: boolean
  onOpen(): void
  onOpenInBackground(): void
  onPin(): void
  onDelete?(): void
  onRemoveFromRecent?(): void
  onReorderStart(event: ReactPointerEvent<HTMLButtonElement>, filePath: string): void
}

function ProjectFileRow({ project, reorderable, dragging, removePending, onOpen, onOpenInBackground, onPin, onDelete, onRemoveFromRecent, onReorderStart }: ProjectFileRowProps) {
  const { locale, t } = useI18n()
  const invalid = Boolean(project.error)
  return <article className={`recent-file-row ${invalid ? 'invalid' : ''} ${project.pinned ? 'pinned' : ''} ${reorderable ? 'reorderable' : ''} ${onDelete ? 'deletable' : ''} ${onRemoveFromRecent ? 'removable' : ''} ${dragging ? 'dragging' : ''} ${removePending ? 'remove-pending' : ''}`} data-recent-path={project.filePath}>
    <button type="button" className="recent-file-open" onPointerDown={(event) => { if (event.button === 1) event.preventDefault() }} onClick={onOpen} onAuxClick={(event) => { if (event.button !== 1) return; event.preventDefault(); event.stopPropagation(); onOpenInBackground() }} title={invalid ? t('home.previewReadFailedTitle', { error: project.error ?? '' }) : t('home.openProject', { name: project.name })}>
      <span className="recent-file-preview">{project.previewUrl ? <img src={project.previewUrl} alt="" /> : invalid ? <TriangleAlert size={21} /> : <FileImage size={20} />}</span>
      <span className="recent-file-copy"><strong>{project.name}</strong><small>{invalid ? t('home.previewReadFailed') : project.width && project.height ? `${project.width} x ${project.height} · ${project.colorMode === 'indexed' ? t('home.indexedColor') : 'RGBA'}` : t('home.readingPreview')}</small><span>{project.filePath}</span></span>
      <time>{formatTime(project.lastOpened, locale)}</time>
    </button>
    <button className="recent-file-pin" type="button" onClick={onPin} aria-label={t(project.pinned ? 'home.unpinProject' : 'home.pinProject', { name: project.name })} title={t(project.pinned ? 'home.unpin' : 'home.pin')}><Pin size={14} /></button>
    {onDelete && <button className="recent-file-delete" type="button" onClick={onDelete} aria-label={t('home.deleteProjectAria', { name: project.name })} title={t('home.deleteProject')}><Trash2 size={14} /></button>}
    {onRemoveFromRecent && <button className="recent-file-remove" type="button" onClick={onRemoveFromRecent} aria-label={t('home.removeRecentAria', { name: project.name })} title={t('home.removeRecentHint')}><X size={15} /></button>}
    {reorderable && <button className="recent-file-reorder" type="button" onPointerDown={(event) => onReorderStart(event, project.filePath)} aria-label={t('home.reorderAria', { name: project.name })} title={t('home.reorderHint')}><GripVertical size={15} /></button>}
  </article>
}

function RecoveryFileRow({ record, onRestore, onDiscard }: { record: RecoveryRecord; onRestore(): void; onDiscard(): void }) {
  const { locale, t } = useI18n()
  const updatedAt = parseRecoveryTimestamp(record.updatedAt)
  return <article className="recent-file-row recovery-file-row">
    <button type="button" className="recent-file-open" onClick={onRestore} title={t('home.restoreProject', { name: record.name })}>
      <span className="recent-file-preview"><RefreshCw size={20} /></span>
      <span className="recent-file-copy"><strong>{record.name}</strong><small>{t('home.recoveryDescription')}</small><span>{t('home.lastSaved', { time: formatTime(updatedAt, locale) })}</span></span>
      <time>{formatTime(updatedAt, locale)}</time>
    </button>
    <button type="button" className="recent-file-discard" onClick={onDiscard} aria-label={t('home.discardRecoveryAria', { name: record.name })} title={t('home.discardRecoveryHint')}><Trash2 size={14} /></button>
  </article>
}

export function HomeWorkspace({ onNew, onOpen, onOpenProject, onRestoreRecovery }: HomeWorkspaceProps) {
  const { t } = useI18n()
  const [section, setSection] = useState<HomeSection>(loadHomeSection)
  const [projects, setProjects] = useState<ProjectCard[]>([])
  const [galleryDirectory, setGalleryDirectory] = useState('')
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const objectUrls = useRef<string[]>([])
  const loadGeneration = useRef(0)
  const projectsRef = useRef<ProjectCard[]>([])
  const recentListRef = useRef<HTMLDivElement>(null)
  const reorderRef = useRef<{ filePath: string; pointerId: number; outsideList: boolean; captureTarget: HTMLElement | null } | null>(null)
  const [draggingProjectPath, setDraggingProjectPath] = useState('')
  const [removePendingProjectPath, setRemovePendingProjectPath] = useState('')
  const setMessage = useWorkspace((state) => state.setMessage)
  const recoveryRecords = useWorkspace((state) => state.recoveryRecords)
  const discardRecovery = useWorkspace((state) => state.discardRecovery)
  const requestDialog = useWorkspace((state) => state.requestDialog)

  const releaseObjectUrls = (): void => {
    for (const url of objectUrls.current) URL.revokeObjectURL(url)
    objectUrls.current = []
  }

  const readCard = async (record: RecentProject): Promise<ProjectCard> => {
    try {
      const cacheKey = previewCacheKey(record)
      const cached = projectPreviewCache.get(cacheKey)
      if (cached) {
        projectPreviewCache.delete(cacheKey)
        projectPreviewCache.set(cacheKey, cached)
        return { ...record, name: record.fileName, previewUrl: createPreviewUrl(cached.bytes), width: cached.width, height: cached.height, colorMode: cached.colorMode }
      }
      const bytes = await window.moonSprite.readBinary(record.filePath)
      if (/\.moonsprite$/i.test(record.filePath)) {
        const metadata = readProjectGalleryMetadata(bytes)
        const previewBytes = metadata.preview.slice()
        cacheProjectPreview(cacheKey, { bytes: previewBytes, width: metadata.width, height: metadata.height, colorMode: metadata.colorMode })
        const previewUrl = createPreviewUrl(previewBytes)
        return { ...record, name: record.fileName, previewUrl, width: metadata.width, height: metadata.height, colorMode: metadata.colorMode }
      }
      const document = await decodeDocumentFileAsync(bytes, record.filePath)
      const preview = await exportDocumentImage(document, 100, 'png-auto')
      const previewBytes = preview.bytes.slice()
      cacheProjectPreview(cacheKey, { bytes: previewBytes, width: document.width, height: document.height, colorMode: document.colorMode })
      const previewUrl = createPreviewUrl(previewBytes)
      return { ...record, name: record.fileName, previewUrl, width: document.width, height: document.height, colorMode: document.colorMode }
    } catch (error) {
      return { ...record, name: record.fileName, error: error instanceof Error ? error.message : t('home.projectUnreadable') }
    }
  }

  const loadSection = async (target: HomeSection): Promise<void> => {
    const generation = ++loadGeneration.current
    releaseObjectUrls()
    setProjects([])
    setLoadError('')
    if (target === 'recovery') { setLoading(false); return }
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
      if (generation !== loadGeneration.current) return
      const initialCards = records.map((record): ProjectCard => ({ ...record, name: record.fileName }))
      projectsRef.current = initialCards
      setProjects(initialCards)
      setLoading(false)
      let nextIndex = 0
      const loadNext = async (): Promise<void> => {
        while (nextIndex < records.length) {
          const index = nextIndex
          nextIndex += 1
          const record = records[index]
          if (target === 'recent') {
            let exists = true
            try {
              exists = await window.moonSprite.fileExists(record.filePath)
            } catch {
              // Retain the record when existence cannot be determined.
            }
            if (generation !== loadGeneration.current) return
            if (!exists) {
              removeRecentProject(record.filePath)
              setProjects((items) => {
                const next = items.filter((item) => item.filePath !== record.filePath)
                projectsRef.current = next
                return next
              })
              setMessage(t('home.missingRecentRemovedMessage', { name: record.fileName }))
              continue
            }
          }
          const card = await readCard(record)
          if (generation !== loadGeneration.current) {
            if (card.previewUrl) URL.revokeObjectURL(card.previewUrl)
            return
          }
          if (card.previewUrl) objectUrls.current.push(card.previewUrl)
          setProjects((items) => {
            const next = items.map((item) => item.filePath === card.filePath ? card : item)
            projectsRef.current = next
            return next
          })
        }
      }
      await Promise.all(Array.from({ length: Math.min(3, records.length) }, () => loadNext()))
    } catch (error) {
      if (generation === loadGeneration.current) setLoadError(error instanceof Error ? error.message : t('home.sectionReadFailed', { section: t(target === 'gallery' ? 'home.section.gallery' : 'home.section.recentFiles') }))
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
        recordRecentProject(filePath, t('home.exampleName'))
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
      title: t('home.deleteProject'),
      message: t('home.deleteConfirm', { name: project.name }),
      detail: t('home.deleteDetail'),
      choices: [
        { id: 'cancel', label: t('common.cancel'), tone: 'quiet' },
        { id: 'delete', label: t('home.deleteProject'), tone: 'danger' }
      ]
    })
    if (choice !== 'delete') return

    try {
      const fileName = project.filePath.split(/[\\/]/).pop() ?? project.fileName
      await window.moonSprite.deleteGalleryProject(fileName)
      removeGalleryPin(project.filePath)
      removeRecentProject(project.filePath)
      removeProjectFromView(project.filePath)
      setMessage(t('home.deletedMessage', { name: project.name }))
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t('home.deleteFailed'))
    }
  }

  const removeFromRecent = (project: ProjectCard): void => {
    removeRecentProject(project.filePath)
    removeProjectFromView(project.filePath)
    setMessage(t('home.removedRecentMessage', { name: project.name }))
  }

  const openProject = async (project: ProjectCard, keepHomeOpen = false): Promise<void> => {
    const opened = await onOpenProject(project.filePath, keepHomeOpen)
    if (opened) return
    const error = t('home.openFailed')
    setProjects((items) => items.map((item) => item.filePath === project.filePath ? { ...item, error } : item))
    setMessage(`${project.name}：${error}`)
  }

  const startRecentReorder = (event: ReactPointerEvent<HTMLButtonElement>, filePath: string): void => {
    if (section !== 'recent' || event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    reorderRef.current = { filePath, pointerId: event.pointerId, outsideList: false, captureTarget: event.currentTarget }
    setDraggingProjectPath(filePath)
    setRemovePendingProjectPath('')
  }

  const pointIsInsideRecentList = (clientX: number, clientY: number): boolean => {
    const bounds = recentListRef.current?.getBoundingClientRect()
    return Boolean(bounds && clientX >= bounds.left && clientX <= bounds.right && clientY >= bounds.top && clientY <= bounds.bottom)
  }

  const moveRecentReorder = (clientX: number, clientY: number, pointerId: number): void => {
    const drag = reorderRef.current
    if (!drag || drag.pointerId !== pointerId) return
    const outsideList = !pointIsInsideRecentList(clientX, clientY)
    if (outsideList !== drag.outsideList) {
      drag.outsideList = outsideList
      setRemovePendingProjectPath(outsideList ? drag.filePath : '')
    }
    if (outsideList) return
    const targetRow = document.elementsFromPoint(clientX, clientY)
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
    const insertAfter = clientY >= targetRow.getBoundingClientRect().top + targetRow.offsetHeight / 2
    remaining.splice(targetIndex + (insertAfter ? 1 : 0), 0, source)
    if (remaining.every((item, index) => item.filePath === items[index]?.filePath)) return
    projectsRef.current = remaining
    setProjects(remaining)
  }

  const endRecentReorder = (pointerId: number, clientX: number, clientY: number, eventType: string): void => {
    const drag = reorderRef.current
    if (!drag || drag.pointerId !== pointerId) return
    if (drag.captureTarget?.hasPointerCapture(pointerId)) drag.captureTarget.releasePointerCapture(pointerId)
    reorderRef.current = null
    setDraggingProjectPath('')
    setRemovePendingProjectPath('')
    const removeFromRecent = eventType !== 'pointercancel' && !pointIsInsideRecentList(clientX, clientY)
    if (removeFromRecent) {
      const project = projectsRef.current.find((item) => item.filePath === drag.filePath)
      removeRecentProject(drag.filePath)
      removeProjectFromView(drag.filePath)
      setMessage(t('home.removedRecentMessage', { name: project?.name ?? t('home.projectFallback') }))
      return
    }
    reorderRecentProjects(projectsRef.current.map((project) => project.filePath))
  }

  useEffect(() => {
    const move = (event: PointerEvent): void => {
      if (!reorderRef.current || reorderRef.current.pointerId !== event.pointerId) return
      event.preventDefault()
      moveRecentReorder(event.clientX, event.clientY, event.pointerId)
    }
    const end = (event: PointerEvent): void => {
      if (!reorderRef.current || reorderRef.current.pointerId !== event.pointerId) return
      event.preventDefault()
      endRecentReorder(event.pointerId, event.clientX, event.clientY, event.type)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', end)
    window.addEventListener('pointercancel', end)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', end)
      window.removeEventListener('pointercancel', end)
    }
  }, [section])

  const emptyState = section === 'gallery'
    ? { icon: <Images size={28} />, title: t('home.emptyGallery'), detail: t('home.emptyGalleryDetail') }
    : section === 'recovery'
      ? { icon: <RefreshCw size={28} />, title: t('home.emptyRecovery'), detail: t('home.emptyRecoveryDetail') }
      : { icon: <FileImage size={28} />, title: t('home.emptyRecent'), detail: t('home.emptyRecentDetail') }

  return <section className="aseprite-home" aria-label={t('home.aria')}>
    <div className="aseprite-home-inner">
      <header className="start-screen-header">
        <div className="start-screen-mark" aria-hidden="true"><img src={moonspriteLogo} alt="" /></div>
        <div><h1>MOONSPRITE</h1><p>{t('home.tagline')}</p></div>
        <span className="start-screen-version">{APP_CHANNEL_LABEL}</span>
      </header>
      <div className="start-screen-rule" />
      <div className="start-screen-layout">
        <aside className="start-actions" aria-label={t('home.actionsAria')}>
          <button className="start-action primary-button" type="button" onClick={onNew}><Plus size={20} /><span><strong>{t('home.newSprite')}</strong><small>{t('home.newSpriteDetail')}</small></span></button>
          <button className="start-action quiet-button" type="button" onClick={onOpen}><FolderOpen size={20} /><span><strong>{t('home.openSprite')}</strong><small>{t('home.openSpriteDetail')}</small></span></button>
          <div className="start-action-note"><FileImage size={15} /><span>{t('home.supportedFormats')}</span></div>
        </aside>
        <section className="recent-files-panel" aria-label={t(section === 'recent' ? 'home.section.recentFiles' : section === 'gallery' ? 'home.section.galleryTab' : 'home.section.recovery')}>
          <header className="recent-files-header">
            <div className="home-section-tabs" role="tablist" aria-label={t('home.sectionsAria')}>
              <button role="tab" aria-selected={section === 'recent'} className={section === 'recent' ? 'selected' : ''} onClick={() => selectSection('recent')}>{t('home.section.recent')}</button>
              <button role="tab" aria-selected={section === 'gallery'} className={section === 'gallery' ? 'selected' : ''} onClick={() => selectSection('gallery')}>{t('home.section.galleryTab')}</button>
              {recoveryRecords.length > 0 && <button role="tab" aria-selected={section === 'recovery'} className={section === 'recovery' ? 'selected' : ''} onClick={() => selectSection('recovery')}>{t('home.section.recovery')}<span className="recovery-count">{recoveryRecords.length}</span></button>}
            </div>
            <div className="recent-file-tools">
              {section === 'gallery' && <button className="icon-button" type="button" onClick={() => void window.moonSprite.openGalleryFolder()} aria-label={t('home.openGalleryFolder')} title={galleryDirectory || t('home.openGalleryFolder')}><FolderOpen size={15} /></button>}
              <button className="icon-button" type="button" onClick={() => void loadSection(section)} disabled={loading || section === 'recovery'} aria-label={t('home.refreshSection')} title={t('common.refresh')}><RefreshCw size={15} /></button>
              {section === 'recent' && <button className="icon-button" type="button" onClick={clearRecent} disabled={!projects.some((project) => !project.pinned)} aria-label={t('home.clearUnpinned')} title={t('home.clearUnpinned')}><Eraser size={15} /></button>}
            </div>
          </header>
          <div ref={recentListRef} className="recent-files-list component-scrollbar">
            {loading && <div className="start-screen-state"><RefreshCw className="spin" size={22} /><span>{t('home.readingProjects')}</span></div>}
            {!loading && loadError && <div className="start-screen-state error"><TriangleAlert size={22} /><strong>{t('home.readSectionFailed')}</strong><span>{loadError}</span><button className="quiet-button" type="button" onClick={() => void loadSection(section)}>{t('home.retry')}</button></div>}
            {!loading && !loadError && ((section !== 'recovery' && projects.length === 0) || (section === 'recovery' && recoveryRecords.length === 0)) && <div className="start-screen-state">{emptyState.icon}<strong>{emptyState.title}</strong><span>{emptyState.detail}</span></div>}
            {!loading && !loadError && section === 'recovery' && recoveryRecords.map((record) => <RecoveryFileRow key={record.id} record={record} onRestore={() => void onRestoreRecovery(record.id)} onDiscard={() => void discardRecovery(record.id)} />)}
             {!loading && !loadError && section !== 'recovery' && projects.map((project) => <ProjectFileRow key={project.filePath} project={project} reorderable={section === 'recent'} dragging={draggingProjectPath === project.filePath} removePending={removePendingProjectPath === project.filePath} onOpen={() => void openProject(project)} onOpenInBackground={() => void openProject(project, true)} onPin={() => pinProject(project.filePath)} onDelete={section === 'gallery' ? () => void deleteGalleryProject(project) : undefined} onRemoveFromRecent={section === 'recent' && project.error ? () => removeFromRecent(project) : undefined} onReorderStart={startRecentReorder} />)}
          </div>
        </section>
      </div>
      <footer className="start-screen-footer"><span className="start-screen-attribution"><span>{t('home.footer')}</span><span aria-hidden="true">{' · '}</span><span>MIT License</span></span><small className="start-screen-development-notice">{t('home.developmentNotice', { version: APP_CHANNEL_LABEL.toLowerCase() })}</small></footer>
    </div>
  </section>
}
