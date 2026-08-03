import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ModalShell } from './ModalShell'

beforeEach(() => localStorage.clear())
afterEach(cleanup)

describe('ModalShell', () => {
  it('restores the saved bounds and exposes eight resize directions', async () => {
    localStorage.setItem('moonsprite.modal.test', JSON.stringify({
      x: 40,
      y: 50,
      width: 500,
      height: 300,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight
    }))

    render(<ModalShell storageKey="test" role="dialog"><header>测试弹窗</header></ModalShell>)
    const dialog = screen.getByRole('dialog')

    expect(dialog).toHaveStyle({ left: '40px', top: '50px', width: '500px', height: '300px' })
    expect(dialog).toHaveStyle({ overflow: 'hidden' })
    await waitFor(() => expect(document.querySelectorAll('.floating-resize-portal .floating-resize-handle')).toHaveLength(8))
  })

  it('clamps restored bounds to the modal minimum size', () => {
    localStorage.setItem('moonsprite.modal.small', JSON.stringify({
      x: 20,
      y: 20,
      width: 120,
      height: 80,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight
    }))

    render(<ModalShell storageKey="small" role="dialog"><header>小弹窗</header></ModalShell>)

    expect(screen.getByRole('dialog')).toHaveStyle({ width: '300px', height: '220px' })
  })

  it('places right-side dialogs midway between the stage center and right edge', () => {
    const stage = document.createElement('div')
    stage.className = 'stage-wrap'
    stage.getBoundingClientRect = () => new DOMRect(100, 50, 800, 600)
    document.body.appendChild(stage)

    render(<ModalShell storageKey="right" placement="right" defaultWidth={400} defaultHeight={300} role="dialog"><header>右侧弹窗</header></ModalShell>)

    expect(screen.getByRole('dialog')).toHaveStyle({ left: '500px' })
    stage.remove()
  })
})
