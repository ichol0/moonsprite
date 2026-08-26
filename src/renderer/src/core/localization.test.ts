import { describe, expect, it } from 'vitest'
import { AVAILABLE_APP_LOCALES, DEFAULT_APP_LOCALE, LANGUAGE_PREFERENCE_KEY, currentAppLocale, formatTranslation, localeDisplayName, parseAppLocale, translate, translateCurrent } from './localization'
import { zhCNMessages } from '@/locales/zh-CN'
import { enUSMessages } from '@/locales/en-US'
import { jaJPMessages } from '@/locales/ja-JP'
import { koKRMessages } from '@/locales/ko-KR'
import { esESMessages } from '@/locales/es-ES'
import { frFRMessages } from '@/locales/fr-FR'
import { deDEMessages } from '@/locales/de-DE'
import { ptBRMessages } from '@/locales/pt-BR'
import { ruRUMessages } from '@/locales/ru-RU'

const catalogs = {
  'zh-CN': zhCNMessages,
  'en-US': enUSMessages,
  'ja-JP': jaJPMessages,
  'ko-KR': koKRMessages,
  'es-ES': esESMessages,
  'fr-FR': frFRMessages,
  'de-DE': deDEMessages,
  'pt-BR': ptBRMessages,
  'ru-RU': ruRUMessages
} as const

const placeholders = (value: string): string[] => [...value.matchAll(/\{([A-Za-z][A-Za-z0-9_]*)\}/g)].map((match) => match[1]).sort()

describe('localization', () => {
  it('keeps every locale catalog complete and placeholder-compatible', () => {
    const baseKeys = Object.keys(zhCNMessages).sort()
    for (const locale of AVAILABLE_APP_LOCALES) {
      const catalog = catalogs[locale]
      expect(Object.keys(catalog).sort(), locale).toEqual(baseKeys)
      for (const key of baseKeys) {
        expect(placeholders(catalog[key as keyof typeof catalog]), `${locale}:${key}`).toEqual(placeholders(zhCNMessages[key as keyof typeof zhCNMessages]))
      }
    }
  })

  it('only exposes locales with complete registered catalogs', () => {
    expect(AVAILABLE_APP_LOCALES).toEqual(['zh-CN', 'en-US', 'ja-JP', 'ko-KR', 'es-ES', 'fr-FR', 'de-DE', 'pt-BR', 'ru-RU'])
    expect(localeDisplayName(DEFAULT_APP_LOCALE)).toBe('简体中文')
    expect(localeDisplayName('en-US')).toBe('English')
    expect(localeDisplayName('en-US', 'zh-CN')).toBe('English')
    expect(localeDisplayName('zh-CN', 'en-US')).toBe('简体中文')
    expect(localeDisplayName('ja-JP')).toBe('日本語')
    expect(localeDisplayName('ko-KR')).toBe('한국어')
    expect(localeDisplayName('es-ES')).toBe('Español')
    expect(localeDisplayName('fr-FR')).toBe('Français')
    expect(localeDisplayName('de-DE')).toBe('Deutsch')
    expect(localeDisplayName('pt-BR')).toBe('Português (Brasil)')
    expect(localeDisplayName('ru-RU')).toBe('Русский')
  })

  it('loads English and falls back to Simplified Chinese for unavailable preferences', () => {
    expect(parseAppLocale(null)).toBe('zh-CN')
    expect(parseAppLocale('en-US')).toBe('en-US')
    expect(parseAppLocale('ja-JP')).toBe('ja-JP')
    expect(parseAppLocale('ru-RU')).toBe('ru-RU')
    expect(parseAppLocale('invalid')).toBe('zh-CN')
    expect(translate(parseAppLocale('en-US'), 'app.menu.file')).toBe('File')
    for (const locale of AVAILABLE_APP_LOCALES) {
      expect(translate(locale, 'app.menu.file')).toBeTruthy()
      expect(translate(locale, 'preferences.language')).toBeTruthy()
    }
  })

  it('interpolates named values without deleting unresolved placeholders', () => {
    expect(formatTranslation('{name}：已导出 {count} 帧', { name: 'walk', count: 8 })).toBe('walk：已导出 8 帧')
    expect(formatTranslation('{name}：{missing}', { name: 'walk' })).toBe('walk：{missing}')
  })

  it('uses the persisted locale for non-React runtime messages', () => {
    const values = new Map([[LANGUAGE_PREFERENCE_KEY, 'en-US']])
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value) },
      removeItem: (key: string) => { values.delete(key) },
      clear: () => { values.clear() },
      key: (index: number) => [...values.keys()][index] ?? null,
      get length() { return values.size }
    } as Storage
    expect(currentAppLocale(storage)).toBe('en-US')
    expect(translateCurrent('core.layerMerge.needTwo', undefined, storage)).toBe('Select at least two layers.')
  })
})
