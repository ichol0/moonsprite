import { describe, expect, it } from 'vitest'
import stylesText from '../styles.css?raw'
import { BUILT_IN_THEMES, DEFAULT_THEME_PREFERENCES, copyTheme, inferThemeMode, normalizeThemePreferences, parseImportedTheme, resolveTheme, serializeTheme, themeColorLuminance } from './theme'

const contrastRatio = (a: string, b: string): number => {
  const light = Math.max(themeColorLuminance(a), themeColorLuminance(b))
  const dark = Math.min(themeColorLuminance(a), themeColorLuminance(b))
  return (light + 0.05) / (dark + 0.05)
}

describe('theme definitions', () => {
  it('keeps the built-in dark theme aligned with the existing interface colors', () => {
    const resolved = resolveTheme(DEFAULT_THEME_PREFERENCES)
    expect(resolved.definition.id).toBe('dark')
    expect(resolved.variables['--theme-workspace-background']).toBe('#090a0d')
    expect(resolved.variables['--theme-surface']).toBe('#171a21')
    expect(resolved.variables['--theme-border']).toBe('#303641')
    expect(resolved.variables['--theme-accent']).toBe('#2979ff')
    expect(resolved.variables['--theme-text-primary']).toBe('#f1f4f8')
    expect(resolved.variables['--theme-magnifier-line']).toBe('#090a0d')
    expect(resolveTheme({ ...DEFAULT_THEME_PREFERENCES, activeThemeId: 'light' }).variables['--theme-magnifier-line']).toBe('#17202b')
  })

  it('infers native color scheme without storing an editable appearance mode', () => {
    const light = resolveTheme({ ...DEFAULT_THEME_PREFERENCES, activeThemeId: 'light' })
    expect(light.mode).toBe('light')
    expect(inferThemeMode(BUILT_IN_THEMES[0].seeds)).toBe('dark')
    expect('appearance' in light.definition).toBe(false)
  })

  it('provides complete and readable variables for every built-in theme', () => {
    expect(BUILT_IN_THEMES.map((theme) => theme.id)).toEqual(expect.arrayContaining(['ocean', 'forest', 'sunset', 'classic', 'slate', 'copper', 'pink']))
    for (const definition of BUILT_IN_THEMES) {
      const resolved = resolveTheme({ ...DEFAULT_THEME_PREFERENCES, activeThemeId: definition.id })
      expect(Object.keys(resolved.variables).length).toBeGreaterThan(45)
      expect(Object.values(resolved.variables).every(Boolean)).toBe(true)
      expect(contrastRatio(definition.seeds.textPrimary, definition.seeds.surface)).toBeGreaterThanOrEqual(4.5)
      expect(resolved.variables['--theme-on-accent']).toBe('#ffffff')
      expect(contrastRatio(resolved.variables['--theme-development-notice-text'], resolved.variables['--theme-development-notice-background'])).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('keeps selection ants and transform handles identical across themes', () => {
    const outlines = BUILT_IN_THEMES.map((definition) => {
      const variables = resolveTheme({ ...DEFAULT_THEME_PREFERENCES, activeThemeId: definition.id }).variables
      return [variables['--theme-selection-outline-dark'], variables['--theme-selection-outline-light']]
    })

    expect(new Set(outlines.map((colors) => colors.join(':')))).toEqual(new Set(['#090a0d:#f1f4f8']))
  })

  it('keeps the dark theme interaction layers distinct', () => {
    const resolved = resolveTheme(DEFAULT_THEME_PREFERENCES)
    expect(resolved.variables['--theme-accent-soft']).toBe('#182a46')
    expect(resolved.variables['--theme-surface-active']).toBe('#212c40')
    expect(resolved.variables['--theme-accent-hover']).toBe('#478bff')
  })

  it('provides a readable light pink theme with distinct interaction layers', () => {
    const resolved = resolveTheme({ ...DEFAULT_THEME_PREFERENCES, activeThemeId: 'pink' })
    expect(resolved.mode).toBe('light')
    expect(resolved.variables['--theme-surface']).toBe('#fff7fb')
    expect(resolved.variables['--theme-surface-hover']).toBe('#fde7f2')
    expect(resolved.variables['--theme-surface-active']).toBe('#f6cfe1')
    expect(contrastRatio(resolved.variables['--theme-on-accent'], resolved.variables['--theme-accent'])).toBeGreaterThanOrEqual(4.5)
  })

  it('applies auxiliary visual overrides without mutating the built-in theme', () => {
    const pixelGrid = { r: 1, g: 2, b: 3, a: 4 }
    const resolved = resolveTheme({ ...DEFAULT_THEME_PREFERENCES, visualOverrides: { pixelGrid } })
    expect(resolved.visualDefaults.pixelGrid).toEqual(pixelGrid)
    expect(BUILT_IN_THEMES[0].visualDefaults.pixelGrid).not.toEqual(pixelGrid)
  })
})

describe('theme JSON boundary', () => {
  it('round-trips the current structured theme format', () => {
    const theme = copyTheme(BUILT_IN_THEMES[0], 'night-work', 'Night Work')
    expect(parseImportedTheme(serializeTheme(theme))).toEqual(theme)
  })

  it('migrates schema version 1 themes and ignores their old appearance switch', () => {
    const current = BUILT_IN_THEMES[0]
    const legacy = {
      ...current,
      schemaVersion: 1,
      appearance: 'light',
      seeds: {
        appBackground: current.seeds.workspace,
        surface: current.seeds.surface,
        raisedSurface: current.seeds.raisedSurface,
        deepSurface: current.seeds.workspace,
        canvasSurround: current.seeds.canvasSurround,
        border: current.seeds.border,
        borderStrong: current.seeds.borderStrong,
        controlBackground: current.seeds.controlBackground,
        textPrimary: current.seeds.textPrimary,
        textSecondary: current.seeds.textSecondary,
        textMuted: current.seeds.textMuted,
        accent: current.seeds.accent,
        danger: current.seeds.danger,
        success: current.seeds.success,
        warning: current.seeds.warning
      }
    }
    const migrated = parseImportedTheme(JSON.stringify(legacy))
    expect(migrated?.schemaVersion).toBe(2)
    expect(migrated?.seeds.workspace).toBe(current.seeds.workspace)
    expect(migrated && 'appearance' in migrated).toBe(false)
  })

  it('rejects malformed colors, missing fields and unsupported versions', () => {
    const theme = copyTheme(BUILT_IN_THEMES[0], 'invalid', 'Invalid')
    expect(parseImportedTheme('{')).toBeNull()
    expect(parseImportedTheme(JSON.stringify({ ...theme, schemaVersion: 3 }))).toBeNull()
    expect(parseImportedTheme(JSON.stringify({ ...theme, seeds: { ...theme.seeds, accent: 'red' } }))).toBeNull()
    expect(parseImportedTheme(JSON.stringify({ ...theme, visualDefaults: { ...theme.visualDefaults, pixelGrid: { r: -1, g: 0, b: 0, a: 255 } } }))).toBeNull()
  })

  it('falls back to dark when the active custom theme is unavailable', () => {
    expect(normalizeThemePreferences({ activeThemeId: 'missing', customThemes: [], visualOverrides: {} }).activeThemeId).toBe('dark')
  })
})

describe('theme color source audit', () => {
  it('keeps renderer UI colors behind theme variables', () => {
    const body = stylesText.replace(/^[\s\S]*?:root\s*\{[\s\S]*?\}\s*/, '')
    const intrinsicColorSelectors = [
      '.hue-strip-input', '.value-strip-input', '.hue-slider input',
      '.color-scheme-preview', '.swatch.primary::after', '.swatch.secondary::before',
      '.curve-channel-tabs button i', '.curve-channel-', '.curve-editor-',
      '.curve-line-', '.curve-histogram-'
    ]
    const unexpected = body.split(/\r?\n/).filter((line) => /#[0-9a-f]{3,8}|rgba?\(/i.test(line) && !intrinsicColorSelectors.some((selector) => line.trimStart().startsWith(selector)))
    expect(unexpected).toEqual([])
  })
})
