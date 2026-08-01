import type { FixedPanelDock } from '@/components/floating-panel'

export interface DockDragProps {
  docked?: boolean
  onDockDragStart?: (event: React.PointerEvent<HTMLElement>, detach: (clientX: number, clientY: number, continueDrag?: boolean) => void) => void
  onFloatingDock?: (dock: FixedPanelDock) => void
  onRestoreSquare?: (preferBottom?: boolean) => void
}
