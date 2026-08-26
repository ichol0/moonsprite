import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { cloneShortcutBindings, DEFAULT_SHORTCUT_BINDINGS } from '@/core/shortcuts'
import { syncHeldShortcutModifiers, useQuickToolShortcut } from './useQuickToolShortcut'

afterEach(cleanup)

function QuickToolProbe({ shortcuts = DEFAULT_SHORTCUT_BINDINGS }: { shortcuts?: typeof DEFAULT_SHORTCUT_BINDINGS }) {
  const match = useQuickToolShortcut(shortcuts)
  return <output aria-label="quick-tool">{match?.id ?? ''}</output>
}

describe('useQuickToolShortcut', () => {
  it('activates while held, falls back to a less specific chord, and restores on release', () => {
    const shortcuts = cloneShortcutBindings(DEFAULT_SHORTCUT_BINDINGS)
    shortcuts['tool.pencil.quick'] = ['Ctrl+Shift+X']
    render(<QuickToolProbe shortcuts={shortcuts} />)

    fireEvent.keyDown(window, { key: 'Control', code: 'ControlLeft', ctrlKey: true })
    expect(screen.getByLabelText('quick-tool')).toHaveTextContent('tool.move.quick')
    fireEvent.keyDown(window, { key: 'Shift', code: 'ShiftLeft', ctrlKey: true, shiftKey: true })
    fireEvent.keyDown(window, { key: 'x', code: 'KeyX', ctrlKey: true, shiftKey: true })
    expect(screen.getByLabelText('quick-tool')).toHaveTextContent('tool.pencil.quick')

    fireEvent.keyUp(window, { key: 'x', code: 'KeyX', ctrlKey: true, shiftKey: true })
    expect(screen.getByLabelText('quick-tool')).toHaveTextContent('tool.move.quick')
    fireEvent.keyUp(window, { key: 'Control', code: 'ControlLeft' })
    expect(screen.getByLabelText('quick-tool')).toBeEmptyDOMElement()
  })

  it('clears held tools when the window loses focus', () => {
    render(<QuickToolProbe />)
    fireEvent.keyDown(window, { key: 'Alt', code: 'AltLeft', altKey: true })
    expect(screen.getByLabelText('quick-tool')).toHaveTextContent('tool.eyedropper.quick')

    fireEvent.blur(window)
    expect(screen.getByLabelText('quick-tool')).toBeEmptyDOMElement()
  })

  it('reconciles modifier state from pointer events when a key event was missed', () => {
    render(<QuickToolProbe />)

    act(() => syncHeldShortcutModifiers({ ctrlKey: true, metaKey: false, altKey: false, shiftKey: false }))
    expect(screen.getByLabelText('quick-tool')).toHaveTextContent('tool.move.quick')
    act(() => syncHeldShortcutModifiers({ ctrlKey: false, metaKey: false, altKey: false, shiftKey: false }))
    expect(screen.getByLabelText('quick-tool')).toBeEmptyDOMElement()
  })
})
