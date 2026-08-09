import type { RgbaColor } from '@shared/types'
import { readStoredString, writeStoredString } from './storage'

export const THEME_PREFERENCE_KEY = 'moonsprite.preference.theme'
export const THEME_SCHEMA_VERSION = 2

export type ThemeMode = 'dark' | 'light'

export interface ThemeSeedColors {
  workspace: string
  surface: string
  raisedSurface: string
  deepSurface: string
  canvasSurround: string
  border: string
  borderStrong: string
  controlBackground: string
  textPrimary: string
  textSecondary: string
  textMuted: string
  accent: string
  danger: string
  success: string
  warning: string
}

export interface ThemeVisualDefaults {
  checkerLight: RgbaColor
  checkerDark: RgbaColor
  pixelGrid: RgbaColor
  customGrid: RgbaColor
  onionPrevious: RgbaColor
  onionNext: RgbaColor
  symmetryAxis: RgbaColor
}

export interface ThemeDefinition {
  kind: 'moonsprite-theme'
  schemaVersion: 2
  id: string
  name: string
  baseThemeId?: string
  seeds: ThemeSeedColors
  visualDefaults: ThemeVisualDefaults
}

export interface ThemePreferences {
  activeThemeId: string
  customThemes: ThemeDefinition[]
  visualOverrides?: Partial<ThemeVisualDefaults>
}

export type ThemePalette = { [K in keyof ThemeVisualDefaults]: string }

export interface ResolvedTheme {
  definition: ThemeDefinition
  visualDefaults: ThemeVisualDefaults
  mode: ThemeMode
  variables: Record<string, string>
}

const DARK_SEEDS: ThemeSeedColors = {
  workspace: '#090a0d', surface: '#171a21', raisedSurface: '#20242d', deepSurface: '#10141b', canvasSurround: '#4a4a51',
  border: '#303641', borderStrong: '#596271', controlBackground: '#0b0e13', textPrimary: '#f1f4f8', textSecondary: '#c2cad5', textMuted: '#9aa3b2',
  accent: '#2979ff', danger: '#ef5350', success: '#66bb6a', warning: '#ffab26'
}
const LIGHT_SEEDS: ThemeSeedColors = {
  workspace: '#d8dee7', surface: '#f7f8fa', raisedSurface: '#ffffff', deepSurface: '#e9edf2', canvasSurround: '#c7ced8',
  border: '#b7c0cc', borderStrong: '#7b8797', controlBackground: '#ffffff', textPrimary: '#17202b', textSecondary: '#334155', textMuted: '#667386',
  accent: '#1d63d8', danger: '#b8323a', success: '#247a4d', warning: '#9a5a00'
}
const GRAY_SEEDS: ThemeSeedColors = {
  workspace: '#303339', surface: '#3b3f46', raisedSurface: '#474c54', deepSurface: '#292c32', canvasSurround: '#5b6068',
  border: '#555b65', borderStrong: '#737a85', controlBackground: '#282b31', textPrimary: '#f1f3f5', textSecondary: '#d5d9de', textMuted: '#adb3bb',
  accent: '#2979ff', danger: '#ef5350', success: '#66bb6a', warning: '#ffab26'
}
const AMBER_SEEDS: ThemeSeedColors = {
  workspace: '#211b16', surface: '#2b241d', raisedSurface: '#3b3026', deepSurface: '#1c1713', canvasSurround: '#51463b',
  border: '#5f5144', borderStrong: '#806c58', controlBackground: '#19140f', textPrimary: '#fff5e8', textSecondary: '#e4d3bf', textMuted: '#b4a08c',
  accent: '#8b5a16', danger: '#df6258', success: '#6bbf7a', warning: '#d89a2b'
}
const MINT_SEEDS: ThemeSeedColors = {
  workspace: '#122525', surface: '#183434', raisedSurface: '#214343', deepSurface: '#0e1d1d', canvasSurround: '#3a5552',
  border: '#365f5a', borderStrong: '#518077', controlBackground: '#0d1919', textPrimary: '#edf9f5', textSecondary: '#c3ded7', textMuted: '#8db3a9',
  accent: '#147d69', danger: '#dc625d', success: '#63b77a', warning: '#d6a13a'
}
const PLUM_SEEDS: ThemeSeedColors = {
  workspace: '#211827', surface: '#2d2038', raisedSurface: '#3b2a4a', deepSurface: '#1a121f', canvasSurround: '#51415b',
  border: '#584667', borderStrong: '#795d8b', controlBackground: '#17101c', textPrimary: '#f7effc', textSecondary: '#decde8', textMuted: '#b09ab9',
  accent: '#7836a1', danger: '#df626e', success: '#67b879', warning: '#d6a248'
}
const OCEAN_SEEDS: ThemeSeedColors = {
  workspace: '#0b1020', surface: '#14273a', raisedSurface: '#283052', deepSurface: '#080d18', canvasSurround: '#4b5268',
  border: '#31536a', borderStrong: '#65779a', controlBackground: '#090f1a', textPrimary: '#f2f6ff', textSecondary: '#c7d6e8', textMuted: '#8fa5bc',
  accent: '#176f73', danger: '#c94f68', success: '#4c9a6a', warning: '#c58a28'
}
const FOREST_SEEDS: ThemeSeedColors = {
  workspace: '#141510', surface: '#20281e', raisedSurface: '#3a3525', deepSurface: '#0c100d', canvasSurround: '#50544a',
  border: '#465744', borderStrong: '#7a765b', controlBackground: '#0c110e', textPrimary: '#f7f3df', textSecondary: '#d7d2b0', textMuted: '#a49d7a',
  accent: '#8a5b16', danger: '#c14e4e', success: '#4e8a5a', warning: '#b87818'
}
const SUNSET_SEEDS: ThemeSeedColors = {
  workspace: '#191326', surface: '#27243a', raisedSurface: '#443044', deepSurface: '#100d1a', canvasSurround: '#585064',
  border: '#514b70', borderStrong: '#80677e', controlBackground: '#0e0c18', textPrimary: '#fff3f7', textSecondary: '#ddcedf', textMuted: '#aa97ad',
  accent: '#9a3f67', danger: '#c4494f', success: '#43836e', warning: '#b77a2a'
}
const CLASSIC_SEEDS: ThemeSeedColors = {
  workspace: '#68717d', surface: '#b9b9b7', raisedSurface: '#d1d1cd', deepSurface: '#8f9499', canvasSurround: '#747d87',
  border: '#777c81', borderStrong: '#4f555a', controlBackground: '#dededb', textPrimary: '#202326', textSecondary: '#354047', textMuted: '#414a51',
  accent: '#4b6f93', danger: '#a64e57', success: '#3d7049', warning: '#875b16'
}
const SLATE_SEEDS: ThemeSeedColors = {
  workspace: '#5f665f', surface: '#b9bcb2', raisedSurface: '#d5d6ca', deepSurface: '#858b80', canvasSurround: '#72796f',
  border: '#7b8276', borderStrong: '#4e574e', controlBackground: '#dedfd5', textPrimary: '#242824', textSecondary: '#3e483e', textMuted: '#505b50',
  accent: '#55765c', danger: '#a34c4e', success: '#3e754b', warning: '#8a641b'
}
const COPPER_SEEDS: ThemeSeedColors = {
  workspace: '#6e6b68', surface: '#bcb8b0', raisedSurface: '#d4d0c6', deepSurface: '#918d87', canvasSurround: '#817b78',
  border: '#837f79', borderStrong: '#58534c', controlBackground: '#e2ded5', textPrimary: '#282725', textSecondary: '#48433d', textMuted: '#5c5750',
  accent: '#8f6650', danger: '#a44d49', success: '#4f714c', warning: '#93621a'
}
const DARK_VISUALS: ThemeVisualDefaults = { checkerLight: { r: 215, g: 215, b: 217, a: 255 }, checkerDark: { r: 155, g: 155, b: 159, a: 255 }, pixelGrid: { r: 69, g: 77, b: 92, a: 143 }, customGrid: { r: 0, g: 0, b: 255, a: 255 }, onionPrevious: { r: 239, g: 83, b: 80, a: 255 }, onionNext: { r: 41, g: 121, b: 255, a: 255 }, symmetryAxis: { r: 41, g: 121, b: 255, a: 242 } }
const LIGHT_VISUALS: ThemeVisualDefaults = { checkerLight: { r: 245, g: 246, b: 248, a: 255 }, checkerDark: { r: 210, g: 214, b: 220, a: 255 }, pixelGrid: { r: 119, g: 128, b: 142, a: 150 }, customGrid: { r: 30, g: 80, b: 210, a: 255 }, onionPrevious: { r: 205, g: 55, b: 53, a: 255 }, onionNext: { r: 31, g: 97, b: 210, a: 255 }, symmetryAxis: { r: 31, g: 97, b: 210, a: 242 } }
const GRAY_VISUALS: ThemeVisualDefaults = { checkerLight: { r: 215, g: 217, b: 220, a: 255 }, checkerDark: { r: 157, g: 160, b: 165, a: 255 }, pixelGrid: { r: 193, g: 198, b: 207, a: 145 }, customGrid: { r: 76, g: 142, b: 232, a: 255 }, onionPrevious: { r: 239, g: 83, b: 80, a: 255 }, onionNext: { r: 41, g: 121, b: 255, a: 255 }, symmetryAxis: { r: 41, g: 121, b: 255, a: 242 } }
const AMBER_VISUALS: ThemeVisualDefaults = { checkerLight: { r: 218, g: 210, b: 200, a: 255 }, checkerDark: { r: 143, g: 132, b: 119, a: 255 }, pixelGrid: { r: 183, g: 158, b: 126, a: 145 }, customGrid: { r: 224, g: 162, b: 59, a: 255 }, onionPrevious: { r: 223, g: 98, b: 88, a: 255 }, onionNext: { r: 224, g: 162, b: 59, a: 255 }, symmetryAxis: { r: 224, g: 162, b: 59, a: 242 } }
const MINT_VISUALS: ThemeVisualDefaults = { checkerLight: { r: 211, g: 225, b: 222, a: 255 }, checkerDark: { r: 117, g: 145, b: 141, a: 255 }, pixelGrid: { r: 151, g: 197, b: 187, a: 145 }, customGrid: { r: 56, g: 169, b: 144, a: 255 }, onionPrevious: { r: 220, g: 98, b: 93, a: 255 }, onionNext: { r: 56, g: 169, b: 144, a: 255 }, symmetryAxis: { r: 56, g: 169, b: 144, a: 242 } }
const PLUM_VISUALS: ThemeVisualDefaults = { checkerLight: { r: 224, g: 214, b: 229, a: 255 }, checkerDark: { r: 137, g: 116, b: 151, a: 255 }, pixelGrid: { r: 190, g: 163, b: 205, a: 145 }, customGrid: { r: 168, g: 90, b: 214, a: 255 }, onionPrevious: { r: 223, g: 98, b: 110, a: 255 }, onionNext: { r: 168, g: 90, b: 214, a: 255 }, symmetryAxis: { r: 168, g: 90, b: 214, a: 242 } }
const OCEAN_VISUALS: ThemeVisualDefaults = { checkerLight: { r: 216, g: 222, b: 238, a: 255 }, checkerDark: { r: 126, g: 137, b: 166, a: 255 }, pixelGrid: { r: 105, g: 154, b: 177, a: 145 }, customGrid: { r: 127, g: 140, b: 255, a: 255 }, onionPrevious: { r: 219, g: 90, b: 119, a: 255 }, onionNext: { r: 48, g: 181, b: 174, a: 255 }, symmetryAxis: { r: 127, g: 140, b: 255, a: 242 } }
const FOREST_VISUALS: ThemeVisualDefaults = { checkerLight: { r: 224, g: 220, b: 198, a: 255 }, checkerDark: { r: 139, g: 136, b: 112, a: 255 }, pixelGrid: { r: 145, g: 166, b: 134, a: 145 }, customGrid: { r: 210, g: 145, b: 47, a: 255 }, onionPrevious: { r: 211, g: 83, b: 76, a: 255 }, onionNext: { r: 78, g: 151, b: 103, a: 255 }, symmetryAxis: { r: 210, g: 145, b: 47, a: 242 } }
const SUNSET_VISUALS: ThemeVisualDefaults = { checkerLight: { r: 226, g: 216, b: 230, a: 255 }, checkerDark: { r: 141, g: 126, b: 153, a: 255 }, pixelGrid: { r: 168, g: 147, b: 184, a: 145 }, customGrid: { r: 74, g: 192, b: 176, a: 255 }, onionPrevious: { r: 218, g: 73, b: 91, a: 255 }, onionNext: { r: 74, g: 192, b: 176, a: 255 }, symmetryAxis: { r: 201, g: 91, b: 139, a: 242 } }
const CLASSIC_VISUALS: ThemeVisualDefaults = { checkerLight: { r: 226, g: 226, b: 224, a: 255 }, checkerDark: { r: 171, g: 173, b: 174, a: 255 }, pixelGrid: { r: 76, g: 82, b: 88, a: 145 }, customGrid: { r: 48, g: 96, b: 158, a: 255 }, onionPrevious: { r: 178, g: 55, b: 68, a: 255 }, onionNext: { r: 49, g: 98, b: 168, a: 255 }, symmetryAxis: { r: 75, g: 111, b: 147, a: 242 } }
const SLATE_VISUALS: ThemeVisualDefaults = { checkerLight: { r: 226, g: 227, b: 219, a: 255 }, checkerDark: { r: 171, g: 175, b: 166, a: 255 }, pixelGrid: { r: 82, g: 96, b: 84, a: 145 }, customGrid: { r: 73, g: 108, b: 151, a: 255 }, onionPrevious: { r: 174, g: 73, b: 77, a: 255 }, onionNext: { r: 64, g: 119, b: 158, a: 255 }, symmetryAxis: { r: 85, g: 118, b: 92, a: 242 } }
const COPPER_VISUALS: ThemeVisualDefaults = { checkerLight: { r: 229, g: 227, b: 221, a: 255 }, checkerDark: { r: 174, g: 171, b: 166, a: 255 }, pixelGrid: { r: 91, g: 87, b: 81, a: 145 }, customGrid: { r: 79, g: 120, b: 164, a: 255 }, onionPrevious: { r: 174, g: 74, b: 67, a: 255 }, onionNext: { r: 67, g: 119, b: 157, a: 255 }, symmetryAxis: { r: 143, g: 102, b: 80, a: 242 } }

interface PixelThemeDerivedColors {
  surfaceHover: string
  surfaceActive: string
  textFaint: string
  textDisabled: string
  accentHover: string
  accentSelected: string
  accentSoft: string
  surfaceMuted?: string
  surfaceDisabled?: string
  dangerSoft?: string
  successSoft?: string
  warningSoft?: string
  scrollbarTrack?: string
  scrollbarThumb?: string
}

const PIXEL_THEME_DERIVED: Record<string, PixelThemeDerivedColors> = {
  amber: { surfaceHover: '#4a3a2c', surfaceActive: '#594523', textFaint: '#9b8976', textDisabled: '#776858', accentHover: '#b8791f', accentSelected: '#754a10', accentSoft: '#4a3215' },
  mint: { surfaceHover: '#2a5250', surfaceActive: '#2b5b54', textFaint: '#759a91', textDisabled: '#5c7b75', accentHover: '#1d9a82', accentSelected: '#106653', accentSoft: '#163f37' },
  plum: { surfaceHover: '#4b375a', surfaceActive: '#5a3b6b', textFaint: '#987fa2', textDisabled: '#765f80', accentHover: '#9650c0', accentSelected: '#642889', accentSoft: '#422050' },
  ocean: { surfaceHover: '#1c3746', surfaceActive: '#343b68', textFaint: '#728ba5', textDisabled: '#586b82', accentHover: '#268b8d', accentSelected: '#10595c', accentSoft: '#16363f' },
  forest: { surfaceHover: '#30402d', surfaceActive: '#4a422d', textFaint: '#8d886b', textDisabled: '#6d6a54', accentHover: '#a86f20', accentSelected: '#70470f', accentSoft: '#352a16' },
  sunset: { surfaceHover: '#34304b', surfaceActive: '#52384c', textFaint: '#927f98', textDisabled: '#716276', accentHover: '#b5537c', accentSelected: '#7f3154', accentSoft: '#3a2031' },
  classic: { surfaceMuted: '#a4a4aa', surfaceDisabled: '#a7a7ad', dangerSoft: '#e7aeb5', successSoft: '#a8c7ae', warningSoft: '#d8c29b', scrollbarTrack: '#909097', scrollbarThumb: '#5d5d65', surfaceHover: '#c8c9c8', surfaceActive: '#b1bac2', textFaint: '#5d666d', textDisabled: '#707980', accentHover: '#6284aa', accentSelected: '#3b5877', accentSoft: '#c1cfdd' },
  slate: { surfaceMuted: '#a1a7a0', surfaceDisabled: '#9aa19a', dangerSoft: '#e1afb2', successSoft: '#a8c9ad', warningSoft: '#d9c79d', scrollbarTrack: '#858b80', scrollbarThumb: '#5d675d', surfaceHover: '#c8cbc0', surfaceActive: '#b8c5b8', textFaint: '#626d62', textDisabled: '#707970', accentHover: '#6d9276', accentSelected: '#3f5d46', accentSoft: '#c3d2c4' },
  copper: { surfaceMuted: '#aaa59e', surfaceDisabled: '#a39e96', dangerSoft: '#e1aeaa', successSoft: '#aec7a9', warningSoft: '#dcc79c', scrollbarTrack: '#918d87', scrollbarThumb: '#625d57', surfaceHover: '#cbc6bd', surfaceActive: '#b9b0aa', textFaint: '#706a63', textDisabled: '#7e7870', accentHover: '#aa7e63', accentSelected: '#73503f', accentSoft: '#d9c6b9' }
} as const

export const BUILT_IN_THEMES: readonly ThemeDefinition[] = [
  { kind: 'moonsprite-theme', schemaVersion: 2, id: 'dark', name: 'MoonSprite Dark', seeds: DARK_SEEDS, visualDefaults: DARK_VISUALS },
  { kind: 'moonsprite-theme', schemaVersion: 2, id: 'light', name: 'MoonSprite Light', seeds: LIGHT_SEEDS, visualDefaults: LIGHT_VISUALS },
  { kind: 'moonsprite-theme', schemaVersion: 2, id: 'gray', name: 'MoonSprite Gray', seeds: GRAY_SEEDS, visualDefaults: GRAY_VISUALS },
  { kind: 'moonsprite-theme', schemaVersion: 2, id: 'classic', name: 'Pixel Classic', seeds: CLASSIC_SEEDS, visualDefaults: CLASSIC_VISUALS },
  { kind: 'moonsprite-theme', schemaVersion: 2, id: 'slate', name: 'Pixel Moss', seeds: SLATE_SEEDS, visualDefaults: SLATE_VISUALS },
  { kind: 'moonsprite-theme', schemaVersion: 2, id: 'copper', name: 'Pixel Copper', seeds: COPPER_SEEDS, visualDefaults: COPPER_VISUALS },
  { kind: 'moonsprite-theme', schemaVersion: 2, id: 'amber', name: 'Pixel Amber', seeds: AMBER_SEEDS, visualDefaults: AMBER_VISUALS },
  { kind: 'moonsprite-theme', schemaVersion: 2, id: 'mint', name: 'Pixel Mint', seeds: MINT_SEEDS, visualDefaults: MINT_VISUALS },
  { kind: 'moonsprite-theme', schemaVersion: 2, id: 'plum', name: 'Pixel Plum', seeds: PLUM_SEEDS, visualDefaults: PLUM_VISUALS },
  { kind: 'moonsprite-theme', schemaVersion: 2, id: 'ocean', name: 'Pixel Aurora', seeds: OCEAN_SEEDS, visualDefaults: OCEAN_VISUALS },
  { kind: 'moonsprite-theme', schemaVersion: 2, id: 'forest', name: 'Pixel Workshop', seeds: FOREST_SEEDS, visualDefaults: FOREST_VISUALS },
  { kind: 'moonsprite-theme', schemaVersion: 2, id: 'sunset', name: 'Pixel Bloom', seeds: SUNSET_SEEDS, visualDefaults: SUNSET_VISUALS }
]
export const DEFAULT_THEME_PREFERENCES: ThemePreferences = { activeThemeId: 'dark', customThemes: [] }

const visualKeys = ['checkerLight', 'checkerDark', 'pixelGrid', 'customGrid', 'onionPrevious', 'onionNext', 'symmetryAxis'] as const
const seedKeys = Object.keys(DARK_SEEDS) as Array<keyof ThemeSeedColors>
const validColor = (value: unknown): value is string => typeof value === 'string' && /^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(value)
const clamp = (value: number): number => Math.max(0, Math.min(255, Math.round(value)))
const copyRgba = (value: RgbaColor): RgbaColor => ({ r: clamp(value.r), g: clamp(value.g), b: clamp(value.b), a: clamp(value.a) })
const copyVisuals = (value: ThemeVisualDefaults): ThemeVisualDefaults => Object.fromEntries(visualKeys.map((key) => [key, copyRgba(value[key])])) as unknown as ThemeVisualDefaults
const hexBytes = (value: string): [number, number, number, number] => { const hex = value.slice(1); return [Number.parseInt(hex.slice(0, 2), 16), Number.parseInt(hex.slice(2, 4), 16), Number.parseInt(hex.slice(4, 6), 16), hex.length === 8 ? Number.parseInt(hex.slice(6, 8), 16) : 255] }
const cssColor = (value: string): string => { const [r, g, b, a] = hexBytes(value); return a === 255 ? value.slice(0, 7).toLowerCase() : `rgb(${r} ${g} ${b} / ${a / 255})` }
const rgbaFromHex = (value: string): RgbaColor => { const [r, g, b, a] = hexBytes(value); return { r, g, b, a } }
export const rgbaHex = (value: RgbaColor): string => `#${[value.r, value.g, value.b, value.a].map((channel) => clamp(channel).toString(16).padStart(2, '0')).join('')}`
export function parseThemeColor(value: unknown, fallback: RgbaColor): RgbaColor { return validColor(value) ? rgbaFromHex(value) : copyRgba(fallback) }

const linearChannel = (channel: number): number => { const value = channel / 255; return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4 }
export const themeColorLuminance = (value: string): number => { const [r, g, b] = hexBytes(validColor(value) ? value : '#000000'); return 0.2126 * linearChannel(r) + 0.7152 * linearChannel(g) + 0.0722 * linearChannel(b) }
const darkestThemeSeed = (seeds: ThemeSeedColors): string => Object.values(seeds).reduce((darkest, candidate) => themeColorLuminance(candidate) < themeColorLuminance(darkest) ? candidate : darkest)
export const themeContrastRatio = (a: string, b: string): number => { const light = Math.max(themeColorLuminance(a), themeColorLuminance(b)); const dark = Math.min(themeColorLuminance(a), themeColorLuminance(b)); return (light + 0.05) / (dark + 0.05) }
const highestContrastColor = (background: string, candidates: readonly string[]): string => candidates.reduce((best, candidate) => themeContrastRatio(candidate, background) > themeContrastRatio(best, background) ? candidate : best)
export function inferThemeMode(seeds: ThemeSeedColors): ThemeMode { return themeColorLuminance(seeds.textPrimary) < themeColorLuminance(seeds.surface) ? 'light' : 'dark' }
export function themeById(preferences: ThemePreferences, id = preferences.activeThemeId): ThemeDefinition { return BUILT_IN_THEMES.find((theme) => theme.id === id) ?? BUILT_IN_THEMES[0] }
export function defaultThemeVisuals(id = 'dark'): ThemeVisualDefaults { return copyVisuals(themeById({ activeThemeId: id, customThemes: [] }).visualDefaults) }

export function resolveTheme(preferences: ThemePreferences): ResolvedTheme {
  const definition = themeById(preferences)
  const visualDefaults = copyVisuals({ ...definition.visualDefaults, ...preferences.visualOverrides })
  const s = definition.seeds
  const dark = definition.id === 'dark'
  const gray = definition.id === 'gray'
  const classic = definition.id === 'classic' || definition.id === 'slate' || definition.id === 'copper'
  const pixelTheme = PIXEL_THEME_DERIVED[definition.id as keyof typeof PIXEL_THEME_DERIVED]
  const pixel = Boolean(pixelTheme)
  const onAccent = '#ffffff'
  const onDanger = '#ffffff'
  const surfaceMuted = dark ? '#11141a' : gray ? '#363a40' : classic ? pixelTheme?.surfaceMuted ?? s.deepSurface : pixel ? s.deepSurface : '#eef1f5'
  const surfaceHover = dark ? '#20242d' : gray ? '#4f555e' : pixelTheme?.surfaceHover ?? '#e3e8ef'
  const surfaceActive = dark ? '#212c40' : gray ? '#555b66' : pixelTheme?.surfaceActive ?? '#d7e5fb'
  const surfaceDisabled = dark ? '#111319' : gray ? '#2f3238' : classic ? pixelTheme?.surfaceDisabled ?? s.deepSurface : pixel ? s.deepSurface : '#e2e6eb'
  const borderMuted = dark ? '#454d5c' : gray ? '#646b75' : pixel ? s.borderStrong : '#9aa6b5'
  const borderHover = dark ? '#596476' : gray ? '#737b86' : pixel ? s.borderStrong : '#6f7d90'
  const textFaint = dark ? '#7f8998' : gray ? '#9ba2ac' : pixelTheme?.textFaint ?? '#8995a5'
  const textSoft = dark ? '#d4dae4' : gray ? '#e0e3e7' : pixel ? s.textSecondary : '#253246'
  const textSecondaryStrong = dark ? '#c6ccd6' : gray ? '#cbd0d6' : pixel ? s.textSecondary : '#405069'
  const textMutedStrong = dark ? '#8f99a8' : gray ? '#b0b6be' : pixel ? s.textMuted : '#667386'
  const textSoftAlt = dark ? '#aeb8c7' : gray ? '#b9bec6' : pixel ? s.textMuted : '#52627a'
  const textBright = dark ? '#edf2fb' : gray ? '#f5f6f7' : pixel ? s.textPrimary : '#17202b'
  const textDisabled = dark ? '#616874' : gray ? '#858b95' : pixelTheme?.textDisabled ?? '#9aa5b4'
  const iconMuted = dark ? '#727b89' : gray ? '#9aa1aa' : pixel ? s.textMuted : '#7e8998'
  const accentHover = dark ? '#478bff' : gray ? '#478bff' : pixelTheme?.accentHover ?? '#3d7bea'
  const accentSelected = dark ? '#256de6' : gray ? '#256de6' : pixelTheme?.accentSelected ?? '#1658c6'
  const accentSoft = dark ? '#182a46' : gray ? '#334967' : pixelTheme?.accentSoft ?? '#dbe8ff'
  const dangerHover = dark ? '#f16b68' : gray ? '#f16b68' : classic ? '#bd4554' : pixel ? '#ef766e' : '#c94b53'
  const dangerSoft = dark ? '#422024' : gray ? '#593237' : classic ? pixelTheme?.dangerSoft ?? '#f8dfe1' : pixel ? '#542a2d' : '#f8dfe1'
  const successSoft = dark ? '#233b28' : gray ? '#314b37' : classic ? pixelTheme?.successSoft ?? '#dcefe3' : pixel ? '#294a32' : '#dcefe3'
  const warningSoft = dark ? '#45361d' : gray ? '#544526' : classic ? pixelTheme?.warningSoft ?? '#f8ebd1' : pixel ? '#4c391c' : '#f8ebd1'
  const developmentNoticeText = highestContrastColor(warningSoft, [s.warning, s.textPrimary, '#ffffff', '#101216'])
  const canvasGridBorder = dark ? '#566170' : gray ? '#7d848e' : pixel ? s.borderStrong : '#7b8797'
  const divider = dark ? '#252b36' : gray ? '#51565f' : pixel ? s.border : '#d0d7e1'
  const magnifierLine = darkestThemeSeed(s)
  const variables: Record<string, string> = {
    '--theme-workspace-background': s.workspace, '--theme-app-background': s.workspace, '--theme-surface': s.surface, '--theme-raised-surface': s.raisedSurface, '--theme-control-background': s.controlBackground, '--theme-deep-surface': s.deepSurface, '--theme-magnifier-line': magnifierLine,
    '--theme-surface-muted': surfaceMuted, '--theme-surface-hover': surfaceHover, '--theme-surface-active': surfaceActive, '--theme-surface-disabled': surfaceDisabled, '--theme-canvas-surround': s.canvasSurround,
    '--theme-border': s.border, '--theme-border-subtle': s.border, '--theme-border-strong': s.borderStrong, '--theme-border-muted': borderMuted, '--theme-border-hover': borderHover, '--theme-canvas-grid-border': canvasGridBorder, '--theme-divider': divider,
    '--theme-text-primary': s.textPrimary, '--theme-text-secondary': s.textSecondary, '--theme-text-muted': s.textMuted, '--theme-text-faint': textFaint, '--theme-text-soft': textSoft, '--theme-text-secondary-strong': textSecondaryStrong, '--theme-text-muted-strong': textMutedStrong, '--theme-text-soft-alt': textSoftAlt, '--theme-text-bright': textBright, '--theme-text-disabled': textDisabled, '--theme-icon-muted': iconMuted,
    '--theme-accent': s.accent, '--theme-accent-hover': accentHover, '--theme-accent-selected': accentSelected, '--theme-accent-soft': accentSoft, '--theme-on-accent': onAccent, '--theme-danger': s.danger, '--theme-danger-hover': dangerHover, '--theme-danger-soft': dangerSoft, '--theme-on-danger': onDanger, '--theme-success': s.success, '--theme-success-soft': successSoft, '--theme-warning': s.warning, '--theme-warning-soft': warningSoft, '--theme-development-notice-text': developmentNoticeText, '--theme-development-notice-background': warningSoft, '--theme-development-notice-border': s.warning,
    '--theme-overlay': dark || (pixel && !classic) ? '#00000073' : '#18202b52', '--theme-shadow': dark || (pixel && !classic) ? '#0000006b' : '#18202b38', '--theme-shadow-strong': dark || (pixel && !classic) ? '#0000009e' : '#18202b52', '--theme-scrollbar-track': classic ? pixelTheme?.scrollbarTrack ?? s.deepSurface : dark || pixel ? s.deepSurface : '#e2e6eb', '--theme-scrollbar-thumb': classic ? pixelTheme?.scrollbarThumb ?? s.borderStrong : dark || pixel ? s.borderStrong : '#9aa6b5', '--theme-selection-contrast': '#ffffff', '--theme-selection-outline-dark': '#090a0d', '--theme-selection-outline-light': '#f1f4f8',
    '--theme-checker-light': rgbaHex(visualDefaults.checkerLight), '--theme-checker-dark': rgbaHex(visualDefaults.checkerDark), '--theme-pixel-grid': rgbaHex(visualDefaults.pixelGrid), '--theme-custom-grid': rgbaHex(visualDefaults.customGrid), '--theme-onion-previous': rgbaHex(visualDefaults.onionPrevious), '--theme-onion-next': rgbaHex(visualDefaults.onionNext), '--theme-symmetry-axis': rgbaHex(visualDefaults.symmetryAxis), '--theme-selection': s.accent
  }
  return { definition, visualDefaults, mode: inferThemeMode(s), variables: Object.fromEntries(Object.entries(variables).map(([key, value]) => [key, value.startsWith('#') ? cssColor(value) : value])) }
}

export function applyThemeToDocument(preferences: ThemePreferences): void { if (typeof document === 'undefined') return; const resolved = resolveTheme(preferences); for (const [name, value] of Object.entries(resolved.variables)) document.documentElement.style.setProperty(name, value); document.documentElement.dataset.themeId = resolved.definition.id; document.documentElement.dataset.themeMode = resolved.mode; document.documentElement.style.colorScheme = resolved.mode }
export function copyTheme(theme: ThemeDefinition, id: string, name: string): ThemeDefinition { return { ...theme, id, name, seeds: { ...theme.seeds }, visualDefaults: copyVisuals(theme.visualDefaults) } }
const uniqueThemeId = (base: string, themes: readonly ThemeDefinition[]): string => { const normalized = base.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'custom-theme'; let id = normalized; let index = 2; while (BUILT_IN_THEMES.some((theme) => theme.id === id) || themes.some((theme) => theme.id === id)) id = `${normalized}-${index++}`; return id }
export function editableThemePreferences(preferences: ThemePreferences, suffix = 'Custom'): { preferences: ThemePreferences; definition: ThemeDefinition } { const current = themeById(preferences); if (preferences.customThemes.some((theme) => theme.id === current.id)) return { preferences, definition: current }; const definition = { ...copyTheme(current, uniqueThemeId(`${current.name} ${suffix}`, preferences.customThemes), `${current.name} ${suffix}`), baseThemeId: current.id }; return { preferences: { activeThemeId: definition.id, customThemes: [...preferences.customThemes, definition] }, definition } }
export function withThemePaletteColors(preferences: ThemePreferences, colors: Partial<ThemePalette>): ThemePreferences { const visualOverrides = { ...(preferences.visualOverrides ?? {}) }; for (const key of visualKeys) { const value = colors[key]; if (value && validColor(value)) visualOverrides[key] = rgbaFromHex(value) }; return { activeThemeId: preferences.activeThemeId, customThemes: [], visualOverrides } }

const validRgba = (value: unknown): value is RgbaColor => Boolean(value && typeof value === 'object' && ['r', 'g', 'b', 'a'].every((key) => { const channel = (value as Record<string, unknown>)[key]; return typeof channel === 'number' && Number.isFinite(channel) && channel >= 0 && channel <= 255 }))
const parseVisuals = (value: unknown, fallback: ThemeVisualDefaults): ThemeVisualDefaults | null => { if (!value || typeof value !== 'object' || Array.isArray(value)) return copyVisuals(fallback); const source = value as Record<string, unknown>; if (Object.keys(source).some((key) => !visualKeys.includes(key as typeof visualKeys[number]))) return null; const result = copyVisuals(fallback); for (const key of visualKeys) if (source[key] !== undefined) { if (!validRgba(source[key])) return null; result[key] = copyRgba(source[key] as RgbaColor) }; return result }
const parseLegacy = (candidate: Record<string, unknown>): ThemeDefinition | null => { if (typeof candidate.id !== 'string' || typeof candidate.name !== 'string' || !candidate.seeds || typeof candidate.seeds !== 'object') return null; const raw = candidate.seeds as Record<string, unknown>; const seeds = { ...DARK_SEEDS }; const aliases: Record<string, keyof ThemeSeedColors> = { workspace: 'workspace', appBackground: 'workspace', surface: 'surface', raisedSurface: 'raisedSurface', deepSurface: 'deepSurface', canvasSurround: 'canvasSurround', border: 'border', borderStrong: 'borderStrong', controlBackground: 'controlBackground', textPrimary: 'textPrimary', textSecondary: 'textSecondary', textMuted: 'textMuted', accent: 'accent', danger: 'danger', success: 'success', warning: 'warning' }; for (const [key, target] of Object.entries(aliases)) if (raw[key] !== undefined) seeds[target] = raw[key] as string; if (!seedKeys.every((key) => validColor(seeds[key]))) return null; const mode = inferThemeMode(seeds); const visualDefaults = parseVisuals(candidate.visualDefaults, mode === 'light' ? LIGHT_VISUALS : DARK_VISUALS); if (!visualDefaults) return null; const baseThemeId = typeof candidate.baseThemeId === 'string' ? candidate.baseThemeId : undefined; return { kind: 'moonsprite-theme', schemaVersion: 2, id: candidate.id.trim(), name: candidate.name.trim() || 'Custom theme', ...(baseThemeId ? { baseThemeId } : {}), seeds, visualDefaults } }
const parseV3 = (candidate: Record<string, unknown>): ThemeDefinition | null => { if (typeof candidate.id !== 'string' || typeof candidate.name !== 'string' || !candidate.palette || typeof candidate.palette !== 'object') return null; const p = candidate.palette as Record<string, unknown>; const seeds = { ...DARK_SEEDS, workspace: p.workspace, surface: p.panel, raisedSurface: p.raised, deepSurface: p.panelSecondary, controlBackground: p.control, canvasSurround: p.canvasSurround, textPrimary: p.text, textSecondary: p.textSecondary, textMuted: p.textMuted, border: p.border, borderStrong: p.borderStrong, accent: p.accent, danger: p.danger, success: p.success, warning: p.warning } as unknown as ThemeSeedColors; if (!seedKeys.every((key) => validColor(seeds[key]))) return null; const mode = inferThemeMode(seeds); const visualSource = Object.fromEntries(visualKeys.map((key) => [key, p[key]])); const visualDefaults = parseVisuals(visualSource, mode === 'light' ? LIGHT_VISUALS : DARK_VISUALS); return visualDefaults ? { kind: 'moonsprite-theme', schemaVersion: 2, id: candidate.id.trim(), name: candidate.name.trim() || 'Custom theme', baseThemeId: mode, seeds, visualDefaults } : null }
export function parseThemeDefinition(value: unknown): ThemeDefinition | null { if (!value || typeof value !== 'object') return null; const candidate = value as Record<string, unknown>; if (candidate.kind !== 'moonsprite-theme' || typeof candidate.schemaVersion !== 'number') return null; if (candidate.schemaVersion === 3) return parseV3(candidate); if (candidate.schemaVersion === 1 || candidate.schemaVersion === 2) return parseLegacy(candidate); return null }
export function normalizeThemePreferences(value: unknown): ThemePreferences { if (!value || typeof value !== 'object') return { ...DEFAULT_THEME_PREFERENCES, customThemes: [] }; const candidate = value as Record<string, unknown>; const requested = typeof candidate.activeThemeId === 'string' ? candidate.activeThemeId : 'dark'; const activeThemeId = BUILT_IN_THEMES.some((theme) => theme.id === requested) ? requested : 'dark'; const visualOverrides = candidate.visualOverrides && typeof candidate.visualOverrides === 'object' ? parseVisuals(candidate.visualOverrides, DARK_VISUALS) : null; return { activeThemeId, customThemes: [], ...(visualOverrides ? { visualOverrides } : {}) } }
export function loadThemePreferences(storage?: Storage): ThemePreferences { try { const value = readStoredString(THEME_PREFERENCE_KEY, storage); return value ? normalizeThemePreferences(JSON.parse(value) as unknown) : { ...DEFAULT_THEME_PREFERENCES, customThemes: [] } } catch { return { ...DEFAULT_THEME_PREFERENCES, customThemes: [] } } }
export function saveThemePreferences(preferences: ThemePreferences, storage?: Storage): void { writeStoredString(THEME_PREFERENCE_KEY, JSON.stringify(normalizeThemePreferences(preferences)), storage) }
export function parseImportedTheme(text: string): ThemeDefinition | null { try { return parseThemeDefinition(JSON.parse(text) as unknown) } catch { return null } }
export function serializeTheme(theme: ThemeDefinition): string { return JSON.stringify(theme, null, 2) }
