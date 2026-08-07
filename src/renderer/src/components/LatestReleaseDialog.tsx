import { X } from 'lucide-react'
import { useI18n } from '@/components/I18nProvider'
import { ModalShell } from '@/components/ModalShell'
import { LATEST_PACKAGED_RELEASE_LABEL } from '@/core/app-meta'
import type { TranslationKey } from '@/core/localization'

const latestRelease = {
  version: LATEST_PACKAGED_RELEASE_LABEL,
  sections: [
    {
      title: 'latestRelease.section.interaction' as TranslationKey,
      items: [
        'latestRelease.item.tools' as TranslationKey,
        'latestRelease.item.selection' as TranslationKey,
        'latestRelease.item.layers' as TranslationKey,
        'latestRelease.item.dragDrop' as TranslationKey,
        'latestRelease.item.shortcuts' as TranslationKey,
        'latestRelease.item.dialogs' as TranslationKey
      ]
    },
    {
      title: 'latestRelease.section.canvas' as TranslationKey,
      items: [
        'latestRelease.item.rendering' as TranslationKey,
        'latestRelease.item.preview' as TranslationKey,
        'latestRelease.item.mirror' as TranslationKey,
        'latestRelease.item.input' as TranslationKey
      ]
    },
    {
      title: 'latestRelease.section.preferences' as TranslationKey,
      items: [
        'latestRelease.item.preferences' as TranslationKey,
        'latestRelease.item.colors' as TranslationKey,
        'latestRelease.item.cursor' as TranslationKey
      ]
    },
    {
      title: 'latestRelease.section.maintenance' as TranslationKey,
      items: [
        'latestRelease.item.format' as TranslationKey,
        'latestRelease.item.docs' as TranslationKey,
        'latestRelease.item.performance' as TranslationKey
      ]
    }
  ]
}

export function LatestReleaseDialog({ onClose }: { onClose: () => void }) {
  const { t } = useI18n()
  return <div className="modal-backdrop" role="presentation" onPointerDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
    <ModalShell storageKey="latest-release" defaultWidth={640} defaultHeight={620} minWidth={480} minHeight={420} maxWidth={820} maxHeight={800} className="latest-release-modal" role="dialog" aria-modal="true" aria-labelledby="latest-release-title">
      <header><div><span className="eyebrow">MOONSPRITE {latestRelease.version}</span><h2 id="latest-release-title">{t('latestRelease.title')}</h2></div><button type="button" className="icon-button" aria-label={t('common.close')} onClick={onClose}><X size={16} /></button></header>
      <div className="latest-release-body"><p className="latest-release-version">{t('latestRelease.version', { version: latestRelease.version })}</p>{latestRelease.sections.map((section) => <section key={section.title}><h3>{t(section.title)}</h3><ul>{section.items.map((item) => <li key={item}>{t(item)}</li>)}</ul></section>)}</div>
      <footer><button type="button" className="primary-button" onClick={onClose}>{t('common.done')}</button></footer>
    </ModalShell>
  </div>
}
