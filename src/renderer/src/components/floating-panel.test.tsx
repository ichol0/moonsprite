import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useFloatingPanel } from './floating-panel'

function FloatingPanelHarness({ onDock }: { onDock: (dock: 'left' | 'right' | 'bottom') => void }) {
  const floating = useFloatingPanel({ x: 120, y: 100, width: 200, height: 160 }, false, true, undefined, false, onDock)
  return <section ref={floating.ref} className={floating.style ? 'floating-panel' : ''} style={floating.style}>
    <header data-testid="floating-header" onPointerDown={floating.startDrag}>Panel</header>
  </section>
}

afterEach(() => {
  cleanup()
  document.querySelectorAll('[data-panel-dock-zone]').forEach((element) => element.remove())
  vi.restoreAllMocks()
})

describe('floating panel docking', () => {
  it('rechecks the release point when no pointer move was delivered inside the dock zone', async () => {
    const dockZone = document.createElement('aside')
    dockZone.dataset.panelDockZone = 'left'
    document.body.append(dockZone)
    vi.spyOn(dockZone, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 40, right: 90, bottom: 600, width: 90, height: 560, x: 0, y: 40, toJSON: () => ({}) })

    const onDock = vi.fn()
    render(<FloatingPanelHarness onDock={onDock} />)
    const panel = document.querySelector<HTMLElement>('.floating-panel')
    if (!panel) throw new Error('Floating panel was not rendered')
    vi.spyOn(panel, 'getBoundingClientRect').mockReturnValue({ left: 120, top: 100, right: 320, bottom: 260, width: 200, height: 160, x: 120, y: 100, toJSON: () => ({}) })

    fireEvent.pointerDown(screen.getByTestId('floating-header'), { button: 0, pointerId: 7, clientX: 150, clientY: 116 })
    fireEvent.pointerUp(window, { pointerId: 7, clientX: 40, clientY: 220 })

    await waitFor(() => expect(onDock).toHaveBeenCalledWith('left'))
  })
})
