import { describe, expect, it } from 'vitest'
import { nextTopMenuOnHover, TOP_MENU_IDS } from './menu-behavior'

describe('top menu hover behavior', () => {
  it('switches menus only after a top menu has been opened', () => {
    expect(nextTopMenuOnHover(null, 'edit')).toBeNull()
    expect(nextTopMenuOnHover('file', 'edit')).toBe('edit')
    expect(nextTopMenuOnHover('edit', 'select')).toBe('select')
    expect(nextTopMenuOnHover('workspace', 'edit')).toBe('workspace')
  })

  it('switches across extension-provided top menus when they are available', () => {
    const extensionMenu = 'extension-menu:com.example.tools:tools'
    const available = [...TOP_MENU_IDS, extensionMenu]
    expect(nextTopMenuOnHover('layer', extensionMenu, available)).toBe(extensionMenu)
    expect(nextTopMenuOnHover(extensionMenu, 'window', available)).toBe('window')
    expect(nextTopMenuOnHover('layer', extensionMenu)).toBe('layer')
  })
})
