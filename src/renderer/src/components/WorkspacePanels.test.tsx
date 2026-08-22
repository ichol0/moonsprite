import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createDocument } from '@/core/document'
import { I18nProvider } from '@/components/I18nProvider'
import { useWorkspace } from '@/store/workspace'
import { InspectorPanels, type PanelDock, type WorkspacePanelId } from './WorkspacePanels'

const panelDocks: Record<WorkspacePanelId, PanelDock> = {
  color: 'right',
  palette: 'right',
  layers: 'right',
  preview: 'right',
  tileset: 'right',
  brushes: 'right'
}

const panelVisibility = (tileset: boolean): Record<WorkspacePanelId, boolean> => ({
  color: false,
  palette: false,
  layers: false,
  preview: false,
  tileset,
  brushes: false
})

beforeEach(() => {
  localStorage.clear()
  useWorkspace.setState({ sessions: [], activeId: null, message: null, dialog: null })
})

afterEach(() => cleanup())

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
