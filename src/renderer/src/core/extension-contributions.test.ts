import { describe, expect, it } from 'vitest'
import type { StoredExtension } from '@shared/types'
import {
  arrangeExtensionTopMenuIds,
  extensionCommandScriptId,
  extensionMenuItemKey,
  extensionPanelKey,
  extensionTopMenuKey,
  extensionMenuItemsAt,
  listExtensionMenuItemContributions,
  listExtensionPanelContributions,
  listExtensionTopMenuContributions,
  reconcileExtensionPanelVisibility,
  saveExtensionPanelVisibility
} from './extension-contributions'

const extension = (enabled = true): StoredExtension => ({
  id: 'com.example.tools',
  name: 'Example Tools',
  version: '1.0.0',
  description: '',
  author: '',
  commands: [
    { id: 'paint', name: 'Paint', description: 'Paint a test pixel.', entry: 'paint.lua' },
    { id: 'inspect', name: 'Inspect', description: '', entry: 'inspect.lua' }
  ],
  panels: [{ id: 'tools', name: 'Tools', description: '', defaultVisible: true, commands: ['paint'] }],
  menuItems: [{ id: 'file-tools', menu: 'file', position: 'end', commands: ['inspect'] }],
  topMenus: [{ id: 'tools-menu', name: 'Tools', description: '', position: 'before:help', commands: ['paint', 'inspect'] }],
  filePath: 'extensions/com.example.tools',
  enabled
})

describe('extension contributions', () => {
  it('creates opaque command and panel identifiers', () => {
    expect(extensionCommandScriptId('com.example.tools', 'paint')).toBe('extension:com.example.tools:paint')
    expect(extensionPanelKey('com.example.tools', 'tools')).toBe('com.example.tools:tools')
    expect(extensionMenuItemKey('com.example.tools', 'file-tools')).toBe('com.example.tools:menu-item:file-tools')
    expect(extensionTopMenuKey('com.example.tools', 'tools-menu')).toBe('extension-menu:com.example.tools:tools-menu')
  })

  it('only exposes panels from enabled extensions and resolves their commands', () => {
    expect(listExtensionPanelContributions([extension(false)])).toEqual([])
    expect(listExtensionPanelContributions([extension()])[0]?.commands.map((command) => command.id)).toEqual(['paint'])
  })

  it('resolves existing-menu and custom top-menu command contributions', () => {
    expect(listExtensionMenuItemContributions([extension(false)])).toEqual([])
    const menuItems = listExtensionMenuItemContributions([extension()])
    expect(extensionMenuItemsAt(menuItems, 'file', 'end')[0]?.commands.map((command) => command.id)).toEqual(['inspect'])

    const topMenus = listExtensionTopMenuContributions([extension()])
    expect(topMenus[0]?.commands.map((command) => command.id)).toEqual(['paint', 'inspect'])
    expect(arrangeExtensionTopMenuIds(
      ['file', 'edit', 'select', 'canvas', 'layer', 'window', 'help'],
      topMenus
    )).toEqual([
      'file',
      'edit',
      'select',
      'canvas',
      'layer',
      'window',
      'extension-menu:com.example.tools:tools-menu',
      'help'
    ])
  })

  it('uses manifest defaults once and persists explicit visibility choices', () => {
    const storage = new Map<string, string>()
    const storageAdapter = {
      get length() { return storage.size },
      clear: () => storage.clear(),
      getItem: (key: string) => storage.get(key) ?? null,
      key: (index: number) => [...storage.keys()][index] ?? null,
      removeItem: (key: string) => { storage.delete(key) },
      setItem: (key: string, value: string) => { storage.set(key, value) }
    } satisfies Storage
    const panelKey = extensionPanelKey('com.example.tools', 'tools')

    expect(reconcileExtensionPanelVisibility([extension()], {}, storageAdapter)[panelKey]).toBe(true)
    saveExtensionPanelVisibility(panelKey, false, storageAdapter)
    expect(reconcileExtensionPanelVisibility([extension()], {}, storageAdapter)[panelKey]).toBe(false)
  })
})
