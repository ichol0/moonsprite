import { LATEST_PACKAGED_RELEASE_LABEL } from './app-meta'
import type { TranslationKey } from './localization'

interface LatestReleaseSection {
  title: TranslationKey
  items: readonly TranslationKey[]
}

interface LatestReleaseDefinition {
  version: string
  publishedAt: string
  homeSummary: TranslationKey
  sections: readonly LatestReleaseSection[]
}

export const latestRelease = {
  version: LATEST_PACKAGED_RELEASE_LABEL,
  publishedAt: '2026-08-23',
  homeSummary: 'home.newsReleaseSummary',
  sections: [
    {
      title: 'latestRelease.section.interaction',
      items: [
        'latestRelease.item.tools',
        'latestRelease.item.selection',
        'latestRelease.item.layers',
        'latestRelease.item.dragDrop',
        'latestRelease.item.shortcuts',
        'latestRelease.item.dialogs'
      ]
    },
    {
      title: 'latestRelease.section.canvas',
      items: [
        'latestRelease.item.rendering',
        'latestRelease.item.preview',
        'latestRelease.item.mirror',
        'latestRelease.item.input'
      ]
    },
    {
      title: 'latestRelease.section.preferences',
      items: [
        'latestRelease.item.preferences',
        'latestRelease.item.colors',
        'latestRelease.item.cursor'
      ]
    },
    {
      title: 'latestRelease.section.maintenance',
      items: [
        'latestRelease.item.format',
        'latestRelease.item.docs',
        'latestRelease.item.performance'
      ]
    }
  ]
} as const satisfies LatestReleaseDefinition
