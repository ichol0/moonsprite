import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createDocument, createLayer, getActiveLayer } from '@/core/document'
import { buildLayerPanelTree } from '@/core/layer-panel-layout'
import { useWorkspace } from '@/store/workspace'
import { LayersPanel } from './LayersPanel'

beforeEach(() => {
  localStorage.clear()
  useWorkspace.setState({ sessions: [], activeId: null, message: null, dialog: null })
})

afterEach(() => {
  cleanup()
})

describe('LayersPanel properties', () => {
  it('commits the previewed properties and closes on Enter', () => {
    const document = createDocument('layer properties', 2, 2, 'rgba')
    const layer = getActiveLayer(document)
    useWorkspace.getState().addSession(document)
    const session = useWorkspace.getState().sessions[0]
    render(<LayersPanel session={session} docked />)

    fireEvent.doubleClick(screen.getByRole('button', { name: new RegExp(layer.name) }))
    const nameInput = screen.getByDisplayValue(layer.name)
    fireEvent.change(nameInput, { target: { value: '已确认名称' } })
    fireEvent.keyDown(nameInput, { key: 'Enter' })

    expect(layer.name).toBe('已确认名称')
    expect(screen.queryByDisplayValue('已确认名称')).not.toBeInTheDocument()
    expect(document.dirty).toBe(true)
  })

  it('does not open properties when the visibility control is double-clicked', () => {
    const document = createDocument('layer visibility', 2, 2, 'rgba')
    useWorkspace.getState().addSession(document)
    const session = useWorkspace.getState().sessions[0]
    render(<LayersPanel session={session} docked />)

    fireEvent.doubleClick(screen.getByRole('button', { name: '隐藏图层' }))

    expect(screen.queryByRole('heading', { name: '图层属性' })).not.toBeInTheDocument()
  })

  it('opens locked layer properties while disabling visual controls', () => {
    const document = createDocument('locked layer properties', 2, 2, 'rgba')
    const layer = getActiveLayer(document)
    layer.locked = true
    useWorkspace.getState().addSession(document)
    render(<LayersPanel session={useWorkspace.getState().sessions[0]} docked />)

    fireEvent.doubleClick(screen.getByRole('button', { name: new RegExp(layer.name) }))

    expect(screen.getByDisplayValue(layer.name)).toBeEnabled()
    expect(screen.getByRole('button', { name: '混合模式' })).toBeDisabled()
    expect(screen.getByRole('slider', { name: '不透明度' })).toBeDisabled()
  })

  it('replaces a multi-layer selection on an ordinary click', () => {
    const document = createDocument('replace layer selection', 2, 2, 'rgba')
    const first = getActiveLayer(document)
    const second = createLayer('Second', 2, 2, 'rgba')
    document.layers.push(second)
    useWorkspace.getState().addSession(document)
    useWorkspace.getState().selectLayer(first.id)
    useWorkspace.getState().selectLayer(second.id, 'toggle')
    render(<LayersPanel session={useWorkspace.getState().sessions[0]} docked />)

    fireEvent.pointerDown(screen.getByRole('button', { name: new RegExp(first.name) }), { button: 0, clientX: 20, clientY: 20 })

    expect(useWorkspace.getState().sessions[0].selectedLayerIds).toEqual([first.id])
  })

  it('includes a group row when Shift extends the visible selection range', () => {
    const document = createDocument('group range panel', 2, 2, 'rgba')
    const bottom = getActiveLayer(document)
    const member = createLayer('Member', 2, 2, 'rgba')
    member.groupId = 'group'
    document.layers.push(member)
    document.groups.push({ id: 'group', name: 'Group', parentGroupId: null, visible: true, locked: false, opacity: 1, blendMode: 'normal' })
    useWorkspace.getState().addSession(document)
    render(<LayersPanel session={useWorkspace.getState().sessions[0]} docked />)

    fireEvent.pointerDown(screen.getByRole('button', { name: /Group/ }), { button: 0, clientX: 20, clientY: 20 })
    fireEvent.pointerDown(screen.getByRole('button', { name: new RegExp(bottom.name) }), { button: 0, shiftKey: true, clientX: 20, clientY: 80 })

    expect(useWorkspace.getState().sessions[0].selectedGroupIds).toEqual(['group'])
  })

  it('does not show merge or ungroup actions in the panel header', () => {
    const document = createDocument('compact layer header', 2, 2, 'rgba')
    useWorkspace.getState().addSession(document)
    const { container } = render(<LayersPanel session={useWorkspace.getState().sessions[0]} docked />)
    const header = container.querySelector('.layers-panel > header')!

    expect(header.querySelector('[aria-label="向下合并"]')).not.toBeInTheDocument()
    expect(header.querySelector('[aria-label="解组"]')).not.toBeInTheDocument()
  })

  it('shows an unlocked icon for an unlocked group', () => {
    const document = createDocument('group lock icon', 2, 2, 'rgba')
    document.groups.push({ id: 'group', name: 'Group', parentGroupId: null, visible: true, locked: false, opacity: 1, blendMode: 'normal' })
    useWorkspace.getState().addSession(document)
    render(<LayersPanel session={useWorkspace.getState().sessions[0]} docked />)

    const lockButton = screen.getByRole('button', { name: '锁定图层组' })
    expect(lockButton.querySelector('.lucide-lock-open')).toBeInTheDocument()
    expect(lockButton.querySelector('.lucide-lock')).not.toBeInTheDocument()
  })

  it('keeps realtime property edits when the close button is used', () => {
    const document = createDocument('layer close', 2, 2, 'rgba')
    const layer = getActiveLayer(document)
    useWorkspace.getState().addSession(document)
    render(<LayersPanel session={useWorkspace.getState().sessions[0]} docked />)

    fireEvent.doubleClick(screen.getByRole('button', { name: new RegExp(layer.name) }))
    fireEvent.change(screen.getByDisplayValue(layer.name), { target: { value: '关闭仍保存' } })
    fireEvent.click(screen.getByRole('button', { name: '关闭' }))

    expect(layer.name).toBe('关闭仍保存')
    expect(document.dirty).toBe(true)
    useWorkspace.getState().undo()
    expect(layer.name).not.toBe('关闭仍保存')
  })

  it.each(['解除图层锁定', '锁定图层'] as const)('does not open properties when the %s control is double-clicked', (label) => {
    const document = createDocument('layer lock', 2, 2, 'rgba')
    getActiveLayer(document).locked = label === '解除图层锁定'
    useWorkspace.getState().addSession(document)
    render(<LayersPanel session={useWorkspace.getState().sessions[0]} docked />)

    fireEvent.doubleClick(screen.getByRole('button', { name: label }))

    expect(screen.queryByRole('heading', { name: '图层属性' })).not.toBeInTheDocument()
  })

  it('shows the top edge indicator and places a layer above an anchored group', () => {
    const document = createDocument('layer top edge', 2, 2, 'rgba')
    const member = getActiveLayer(document)
    const root = createLayer('根图层', 2, 2, 'rgba')
    member.groupId = 'anchored'
    document.layers.push(root)
    document.groups.push({ id: 'anchored', name: '锚定组', parentGroupId: null, panelOrder: 2, visible: true, locked: false, opacity: 1, blendMode: 'normal' })
    useWorkspace.getState().addSession(document)
    const { container } = render(<LayersPanel session={useWorkspace.getState().sessions[0]} docked />)
    const list = container.querySelector<HTMLElement>('.layer-list')!
    const rootRow = container.querySelector<HTMLElement>(`[data-layer-id="${root.id}"]`)!
    Object.defineProperty(list, 'getBoundingClientRect', { value: () => ({ left: 0, right: 300, top: 100, bottom: 400, width: 300, height: 300, x: 0, y: 100, toJSON: () => ({}) }) })
    Object.defineProperty(rootRow, 'getBoundingClientRect', { value: () => ({ left: 0, right: 300, top: 180, bottom: 222, width: 300, height: 42, x: 0, y: 180, toJSON: () => ({}) }) })

    fireEvent.pointerDown(rootRow, { button: 0, clientX: 150, clientY: 200 })
    fireEvent.pointerMove(window, { clientX: 150, clientY: 104 })
    expect(container.querySelector('.layer-edge-drop-indicator.top')).toBeInTheDocument()
    fireEvent.pointerUp(window, { clientX: 150, clientY: 104 })

    expect(buildLayerPanelTree(document).map((node) => node.id)).toEqual([root.id, 'anchored', member.id])
    expect(container.querySelector('.layer-edge-drop-indicator')).not.toBeInTheDocument()
  })

  it('uses the lower edge of the last root group as the root bottom target', () => {
    const document = createDocument('layer bottom edge', 2, 2, 'rgba')
    const root = getActiveLayer(document)
    document.groups.push({ id: 'bottom-group', name: 'Bottom Group', parentGroupId: null, panelOrder: -1, visible: true, locked: false, opacity: 1, blendMode: 'normal' })
    useWorkspace.getState().addSession(document)
    const { container } = render(<LayersPanel session={useWorkspace.getState().sessions[0]} docked />)
    const list = container.querySelector<HTMLElement>('.layer-list')!
    const rootRow = container.querySelector<HTMLElement>(`[data-layer-id="${root.id}"]`)!
    const groupRow = container.querySelector<HTMLElement>('[data-group-id="bottom-group"]')!
    Object.defineProperty(list, 'getBoundingClientRect', { value: () => ({ left: 0, right: 300, top: 100, bottom: 400, width: 300, height: 300, x: 0, y: 100, toJSON: () => ({}) }) })
    Object.defineProperty(rootRow, 'getBoundingClientRect', { value: () => ({ left: 0, right: 300, top: 120, bottom: 162, width: 300, height: 42, x: 0, y: 120, toJSON: () => ({}) }) })
    Object.defineProperty(groupRow, 'getBoundingClientRect', { value: () => ({ left: 0, right: 300, top: 180, bottom: 222, width: 300, height: 42, x: 0, y: 180, toJSON: () => ({}) }) })

    fireEvent.pointerDown(rootRow, { button: 0, clientX: 150, clientY: 140 })
    fireEvent.pointerMove(window, { clientX: 150, clientY: 220 })
    expect(container.querySelector('.layer-edge-drop-indicator.bottom')).toBeInTheDocument()
    fireEvent.pointerUp(window, { clientX: 150, clientY: 220 })

    expect(buildLayerPanelTree(document).map((node) => node.id)).toEqual(['bottom-group', root.id])
  })
})
