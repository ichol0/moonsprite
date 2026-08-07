import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createDocument } from '@/core/document'
import { useWorkspace } from '@/store/workspace'
import { PalettePanel } from './PalettePanel'

beforeEach(() => {
  localStorage.clear()
  useWorkspace.setState({ sessions: [], activeId: null, message: null, dialog: null })
})

afterEach(() => cleanup())

describe('PalettePanel editing lock', () => {
  it('keeps the swatch grid unchanged when unlocking and selecting a swatch', () => {
    localStorage.setItem('moonsprite.palette-edit-locked', 'false')
    const document = createDocument('palette panel', 2, 2, 'rgba')
    useWorkspace.getState().addSession(document)
    const session = useWorkspace.getState().sessions[0]
    const { container } = render(<PalettePanel session={session} docked />)
    const swatchCount = container.querySelectorAll('.palette-swatch-wrap').length

    const swatch = container.querySelector<HTMLElement>('[data-palette-id]')
    expect(swatch).not.toBeNull()
    fireEvent.pointerDown(swatch!, { button: 0, pointerId: 1, clientX: 0, clientY: 0 })

    expect(container.querySelectorAll('.palette-swatch-wrap')).toHaveLength(swatchCount)
    expect(container.querySelector('.palette-inline-editor')).not.toBeInTheDocument()
  })
})
