import { describe, expect, it } from 'vitest'
import { nextTopMenuOnHover } from './menu-behavior'

describe('top menu hover behavior', () => {
  it('switches menus only after a top menu has been opened', () => {
    expect(nextTopMenuOnHover(null, 'edit')).toBeNull()
    expect(nextTopMenuOnHover('file', 'edit')).toBe('edit')
    expect(nextTopMenuOnHover('edit', 'select')).toBe('select')
    expect(nextTopMenuOnHover('workspace', 'edit')).toBe('workspace')
  })
})
