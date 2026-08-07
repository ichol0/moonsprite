import { describe, expect, it } from 'vitest'
import { AVAILABLE_APP_LOCALES, DEFAULT_APP_LOCALE, LANGUAGE_PREFERENCE_KEY, currentAppLocale, formatTranslation, localeDisplayName, parseAppLocale, translate, translateCurrent } from './localization'

describe('localization', () => {
  it('only exposes locales with complete registered catalogs', () => {
    expect(AVAILABLE_APP_LOCALES).toEqual(['zh-CN', 'en-US'])
    expect(localeDisplayName(DEFAULT_APP_LOCALE)).toBe('简体中文')
    expect(localeDisplayName('en-US')).toBe('English')
    expect(localeDisplayName('en-US', 'zh-CN')).toBe('English')
    expect(localeDisplayName('zh-CN', 'en-US')).toBe('简体中文')
  })

  it('loads English and falls back to Simplified Chinese for unavailable preferences', () => {
    expect(parseAppLocale(null)).toBe('zh-CN')
    expect(parseAppLocale('en-US')).toBe('en-US')
    expect(parseAppLocale('invalid')).toBe('zh-CN')
    expect(translate(parseAppLocale('en-US'), 'app.menu.file')).toBe('File')
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
