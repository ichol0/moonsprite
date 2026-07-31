import { beforeEach, describe, expect, it } from 'vitest'
import { clearRecentProjects, getRecentProjects, recordRecentProject, removeRecentProject, reorderRecentProjects, toggleRecentProjectPinned } from './home-history'

describe('recent project history', () => {
  beforeEach(() => localStorage.clear())

  it('keeps pinned projects before newer unpinned projects', () => {
    recordRecentProject('C:\\art\\first.moonsprite', 'first')
    toggleRecentProjectPinned('C:\\art\\first.moonsprite')
    recordRecentProject('C:\\art\\second.moonsprite', 'second')
    expect(getRecentProjects().map((item) => [item.name, item.pinned])).toEqual([['first', true], ['second', false]])
  })

  it('preserves pin state when a project is opened again', () => {
    recordRecentProject('C:\\art\\sprite.moonsprite', 'sprite')
    toggleRecentProjectPinned('C:\\art\\sprite.moonsprite')
    recordRecentProject('C:\\art\\sprite.moonsprite', 'sprite')
    expect(getRecentProjects()[0].pinned).toBe(true)
  })

  it('persists manual order within the pinned and unpinned groups', () => {
    recordRecentProject('C:\\art\\first.moonsprite', 'first')
    recordRecentProject('C:\\art\\second.moonsprite', 'second')
    recordRecentProject('C:\\art\\third.moonsprite', 'third')
    toggleRecentProjectPinned('C:\\art\\first.moonsprite')
    reorderRecentProjects([
      'C:\\art\\first.moonsprite',
      'C:\\art\\second.moonsprite',
      'C:\\art\\third.moonsprite'
    ])
    expect(getRecentProjects().map((item) => item.name)).toEqual(['first', 'second', 'third'])
  })

  it('clears only unpinned projects', () => {
    recordRecentProject('C:\\art\\pinned.moonsprite', 'pinned')
    toggleRecentProjectPinned('C:\\art\\pinned.moonsprite')
    recordRecentProject('C:\\art\\temporary.moonsprite', 'temporary')
    expect(clearRecentProjects().map((item) => item.name)).toEqual(['pinned'])
    expect(getRecentProjects().map((item) => item.name)).toEqual(['pinned'])
  })

  it('removes an unreadable project from recent history', () => {
    recordRecentProject('C:\\art\\missing.moonsprite', 'missing')
    recordRecentProject('C:\\art\\available.moonsprite', 'available')
    expect(removeRecentProject('C:\\art\\missing.moonsprite').map((item) => item.name)).toEqual(['available'])
  })
})
