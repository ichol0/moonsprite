import { zhCNMessages } from '@/locales/zh-CN'
import { enUSMessages } from '@/locales/en-US'
import { readStoredString } from './storage'

export const DEFAULT_APP_LOCALE = 'zh-CN' as const
export const AVAILABLE_APP_LOCALES = [DEFAULT_APP_LOCALE, 'en-US'] as const
export const LANGUAGE_PREFERENCE_KEY = 'moonsprite.preference.language'

export type AppLocale = (typeof AVAILABLE_APP_LOCALES)[number]
export type TranslationParams = Record<string, string | number>
export type TranslationKey = keyof typeof zhCNMessages
export type TranslationCatalog = Record<TranslationKey, string>

const catalogs: Record<AppLocale, TranslationCatalog> = {
  'zh-CN': zhCNMessages,
  'en-US': enUSMessages
}

const localeNameKeys: Record<AppLocale, TranslationKey> = {
  'zh-CN': 'locale.zh-CN',
  'en-US': 'locale.en-US'
}

let runtimeLocale: AppLocale | null = null

export function parseAppLocale(value: string | null | undefined): AppLocale {
  return AVAILABLE_APP_LOCALES.includes(value as AppLocale) ? value as AppLocale : DEFAULT_APP_LOCALE
}

export function formatTranslation(template: string, params: TranslationParams = {}): string {
  return template.replace(/\{([A-Za-z][A-Za-z0-9_]*)\}/g, (placeholder, key: string) => {
    const value = params[key]
    return value === undefined ? placeholder : String(value)
  })
}

export function translate(locale: AppLocale, key: TranslationKey, params?: TranslationParams): string {
  const catalog = catalogs[parseAppLocale(locale)] ?? catalogs[DEFAULT_APP_LOCALE]
  return formatTranslation(catalog[key] ?? catalogs[DEFAULT_APP_LOCALE][key], params)
}

/** Reads the persisted language for non-React code such as core algorithms and stores. */
export function currentAppLocale(storage?: Storage): AppLocale {
  return runtimeLocale ?? parseAppLocale(readStoredString(LANGUAGE_PREFERENCE_KEY, storage))
}

/** Supplies a locale in runtimes without localStorage, such as decoding workers. */
export function setRuntimeAppLocale(locale: AppLocale | null): void {
  runtimeLocale = locale ? parseAppLocale(locale) : null
}

/** Translates runtime messages without coupling core modules to React or Tauri. */
export function translateCurrent(key: TranslationKey, params?: TranslationParams, storage?: Storage): string {
  return translate(currentAppLocale(storage), key, params)
}

export function localeDisplayName(locale: AppLocale, _displayLocale: AppLocale = locale): string {
  return translate(locale, localeNameKeys[locale])
}
