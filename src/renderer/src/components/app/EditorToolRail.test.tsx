import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createDocument } from '@/core/document'
import { useWorkspace } from '@/store/workspace'
import { EditorToolRail } from './EditorToolRail'
import { ALL_EDITOR_TOOL_ICONS, SELECTION_KIND_ICONS, SHAPE_KIND_DEFINITIONS } from './editor-tools'

beforeEach(() => {
  localStorage.clear()
  useWorkspace.setState({ sessions: [], activeId: null, message: null, dialog: null })
  useWorkspace.getState().addSession(createDocument('tool rail', 2, 2, 'rgba'))
})

afterEach(cleanup)

describe('EditorToolRail', () => {
  it('keeps every child-tool icon mounted for immediate decoding', () => {
    const { container } = render(<EditorToolRail side="left" onGripPointerDown={vi.fn()} />)
    const preloaded = [...container.querySelectorAll<HTMLElement>('.tool-icon-preload .pixel-asset-icon')].map((icon) => icon.style.getPropertyValue('--pixel-icon-source'))

    expect(preloaded).toHaveLength(ALL_EDITOR_TOOL_ICONS.length)
    expect(preloaded).toEqual(expect.arrayContaining(ALL_EDITOR_TOOL_ICONS.map((source) => `url("${source}")`)))
  })

  it('updates the main tool button in the same click that selects a child tool', () => {
    render(<EditorToolRail side="left" onGripPointerDown={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: '矩形框选工具' }))
    fireEvent.click(screen.getByRole('button', { name: '多边形套索工具' }))
    const polygonButton = screen.getByRole('button', { name: '多边形套索工具' })
    expect(polygonButton.querySelector('.pixel-asset-icon')).toHaveStyle({ '--pixel-icon-source': `url("${SELECTION_KIND_ICONS['polygon-lasso']}")` })

    fireEvent.click(screen.getByRole('button', { name: '矩形填充工具' }))
    fireEvent.click(screen.getByRole('button', { name: '椭圆工具' }))
    const ellipseButton = screen.getByRole('button', { name: '椭圆工具' })
    expect(ellipseButton.querySelector('.pixel-asset-icon')).toHaveStyle({ '--pixel-icon-source': `url("${SHAPE_KIND_DEFINITIONS.find((item) => item.id === 'ellipse-outline')?.icon}")` })
  })
})
