import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MoonSpriteApi } from '@shared/types'
import { createDocument } from '@/core/document'
import { activeFreeTileCelTarget } from '@/core/free-tile-document'
import { I18nProvider } from '@/components/I18nProvider'
import { useWorkspace } from '@/store/workspace'
import { InspectorPanels, type PanelDock, type WorkspacePanelId } from './WorkspacePanels'

const panelDocks: Record<WorkspacePanelId, PanelDock> = {
  color: 'right',
  palette: 'right',
  layers: 'right',
  freeTileInstances: 'right',
  history: 'right',
  preview: 'right',
  tileset: 'right',
  brushes: 'right'
}

const panelVisibility = (tileset: boolean): Record<WorkspacePanelId, boolean> => ({
  color: false,
  palette: false,
  layers: false,
  freeTileInstances: false,
  history: false,
  preview: false,
  tileset,
  brushes: false
})

beforeEach(() => {
  localStorage.clear()
  Object.defineProperty(window, 'moonSprite', {
    configurable: true,
    writable: true,
    value: { getResourceInfo: vi.fn(async () => ({ totalBytes: 8_000_000_000, freeBytes: 4_000_000_000 })) } as unknown as MoonSpriteApi
  })
  useWorkspace.setState({ sessions: [], activeId: null, message: null, dialog: null })
})

afterEach(() => {
  cleanup()
  document.querySelectorAll('[data-workspace-panels-test-host]').forEach((element) => element.remove())
})

describe('InspectorPanels popup panels', () => {
  it('temporarily moves a docked panel into the popup and restores it after close', () => {
    const project = createDocument('tileset popup', 4, 4, 'rgba')
    useWorkspace.getState().addSession(project)
    const session = useWorkspace.getState().sessions[0]
    const onPopupPanelClose = vi.fn()
    const renderPanels = (popupPanelId: WorkspacePanelId | null) => <I18nProvider><InspectorPanels
      session={session}
      panelVisibility={panelVisibility(true)}
      onClosePreview={vi.fn()}
      panelDocks={panelDocks}
      leftDockHost={null}
      bottomDockHost={null}
      onPanelDockChange={vi.fn()}
      onPanelVisibilityChange={vi.fn()}
      popupPanelId={popupPanelId}
      onPopupPanelClose={onPopupPanelClose}
    /></I18nProvider>
    const view = render(renderPanels('tileset'))

    expect(document.querySelectorAll('.tileset-panel')).toHaveLength(1)
    expect(document.querySelector('.workspace-panel-popup .tileset-panel')).not.toBeNull()
    expect(document.querySelector('[data-panel-dock-content="right"] .tileset-panel')).toBeNull()

    const popupHeader = document.querySelector<HTMLElement>('.workspace-panel-popup .tileset-panel > header')
    expect(popupHeader).not.toBeNull()
    fireEvent.contextMenu(popupHeader!, { clientX: 80, clientY: 80 })
    expect(document.querySelector('.workspace-panel-context-menu')).not.toBeNull()

    window.dispatchEvent(new Event('blur'))
    expect(onPopupPanelClose).toHaveBeenCalledTimes(1)

    view.rerender(renderPanels(null))
    expect(document.querySelector('.workspace-panel-popup')).toBeNull()
    expect(document.querySelector('[data-panel-dock-content="right"] .tileset-panel')).not.toBeNull()
  })

  it('does not create a popup duplicate for a floating panel', () => {
    const project = createDocument('floating tileset', 4, 4, 'rgba')
    useWorkspace.getState().addSession(project)
    const session = useWorkspace.getState().sessions[0]
    const floatingPanelDocks = { ...panelDocks, tileset: 'floating' as const }

    render(<I18nProvider><InspectorPanels
      session={session}
      panelVisibility={panelVisibility(true)}
      onClosePreview={vi.fn()}
      panelDocks={floatingPanelDocks}
      leftDockHost={null}
      bottomDockHost={null}
      onPanelDockChange={vi.fn()}
      onPanelVisibilityChange={vi.fn()}
      popupPanelId="tileset"
      onPopupPanelClose={vi.fn()}
    /></I18nProvider>)

    expect(document.querySelector('.workspace-panel-popup')).toBeNull()
    expect(document.querySelectorAll('.tileset-panel')).toHaveLength(1)
    expect(document.querySelector('.floating-panel-host .tileset-panel')).not.toBeNull()
  })
})

describe('InspectorPanels Free Tile instance panel', () => {
  it('opens automatically and remains immediately after Layers in bottom and side docks', async () => {
    const project = createDocument('separate instance panel', 8, 8, 'rgba')
    useWorkspace.getState().addSession(project)
    await useWorkspace.getState().createFreeTileLayer({ name: 'Reusable Props' })
    const liveDocument = useWorkspace.getState().sessions[0].document
    const target = activeFreeTileCelTarget(liveDocument)!
    target.freeTiles.instances = [{ id: 'standalone-instance', sourceId: target.layer.freeTileSources![0].id, x: 2, y: 3 }]
    const session = useWorkspace.getState().sessions[0]
    const bottomHost = document.createElement('div')
    bottomHost.dataset.workspacePanelsTestHost = ''
    document.body.append(bottomHost)
    localStorage.setItem('moonsprite.inspector-layout.v2', JSON.stringify({ order: ['freeTileInstances', 'layers'] }))
    const onPanelVisibilityChange = vi.fn()
    const onPanelDockChange = vi.fn()
    const renderPanels = (visible: boolean, docks: Record<WorkspacePanelId, PanelDock>) => <I18nProvider><InspectorPanels
      session={session}
      panelVisibility={{ ...panelVisibility(false), layers: true, freeTileInstances: visible }}
      onClosePreview={vi.fn()}
      panelDocks={docks}
      leftDockHost={null}
      bottomDockHost={bottomHost}
      onPanelDockChange={onPanelDockChange}
      onPanelVisibilityChange={onPanelVisibilityChange}
    /></I18nProvider>
    const bottomDocks = { ...panelDocks, layers: 'bottom' as const, freeTileInstances: 'bottom' as const }
    const view = render(renderPanels(false, bottomDocks))

    await waitFor(() => expect(onPanelVisibilityChange).toHaveBeenCalledWith('freeTileInstances', true))
    view.rerender(renderPanels(true, bottomDocks))
    await waitFor(() => expect([...bottomHost.querySelectorAll<HTMLElement>('[data-inspector-panel-id]')].map((element) => element.dataset.inspectorPanelId)).toEqual(['layers', 'freeTileInstances']))
    expect(bottomHost.querySelector('.free-tile-instances-panel [data-free-tile-instance-id="standalone-instance"]')).not.toBeNull()

    const movingDocks = { ...panelDocks, layers: 'right' as const, freeTileInstances: 'bottom' as const }
    view.rerender(renderPanels(true, movingDocks))
    await waitFor(() => expect(onPanelDockChange).toHaveBeenCalledWith('freeTileInstances', 'right'))
    view.rerender(renderPanels(true, { ...movingDocks, freeTileInstances: 'right' }))
    await waitFor(() => expect([...document.querySelectorAll<HTMLElement>('[data-panel-dock-content="right"] [data-inspector-panel-id]')].map((element) => element.dataset.inspectorPanelId)).toEqual(['layers', 'freeTileInstances']))

    fireEvent.click(screen.getByRole('button', { name: '实例图层设置' }))
    fireEvent.click(screen.getByRole('button', { name: '实例图层位置' }))
    fireEvent.click(screen.getByRole('option', { name: '图层栏目内' }))
    await waitFor(() => expect(onPanelVisibilityChange).toHaveBeenCalledWith('freeTileInstances', false))
    expect(useWorkspace.getState().sessions[0].freeTileInstanceLayerId).toBe(target.layer.id)
  })
})
