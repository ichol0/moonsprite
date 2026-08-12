import { useSyncExternalStore, type ReactElement } from 'react'
import { createPortal } from 'react-dom'
import { openProgress } from '@/core/open-progress'
import { useI18n } from './I18nProvider'
import { PixelUtilityIcon } from './PixelUtilityIcon'

export function OpenProgressOverlay(): ReactElement | null {
  const { t } = useI18n()
  const snapshot = useSyncExternalStore(openProgress.subscribe, openProgress.getSnapshot, openProgress.getSnapshot)
  if (snapshot.phase === 'hidden') return null
  const complete = snapshot.phase === 'complete'

  return createPortal(
    <div className={`modal-backdrop save-progress-backdrop simulated-progress-backdrop ${complete ? 'is-complete' : 'is-running'}`} role="presentation">
      <section className={`modal save-progress-modal simulated-progress-modal ${complete ? 'is-complete' : ''}`} role="dialog" aria-modal="true" aria-live="polite" aria-labelledby="open-progress-title">
        <header>
          <div className="save-progress-heading">
            <span className="save-progress-icon" aria-hidden="true"><span className="save-progress-animation" /></span>
            <div><span className="eyebrow">FILE OPERATION</span><h2 id="open-progress-title">{t('workspace.open.progressTitle')}</h2></div>
          </div>
          {!complete && <button type="button" className="icon-button" aria-label={t('app.progress.close', { title: t('workspace.open.progressTitle') })} onClick={openProgress.dismiss}><PixelUtilityIcon kind="close" /></button>}
        </header>
        <div className="save-progress-body">
          <strong>{t(complete ? 'workspace.open.progressDone' : 'workspace.open.decoding')}</strong>
          <div className={`save-progress-track simulated-progress-track ${complete ? 'is-full' : ''}`} aria-label={t('workspace.open.progressTitle')}><i /></div>
          <div className="save-progress-meta"><span>{t(complete ? 'app.progress.complete' : 'app.progress.processing')}</span></div>
        </div>
      </section>
    </div>,
    document.body
  )
}
