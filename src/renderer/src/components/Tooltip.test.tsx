import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { Tooltip } from './Tooltip'

afterEach(() => cleanup())

describe('Tooltip', () => {
  it('renders custom tooltip content on hover and removes it afterwards', () => {
    render(<Tooltip content="图层描述"><span>图层名称</span></Tooltip>)
    const anchor = screen.getByText('图层名称').parentElement!

    fireEvent.pointerEnter(anchor)
    expect(screen.getByRole('tooltip')).toHaveTextContent('图层描述')
    expect(anchor).not.toHaveAttribute('title')

    fireEvent.pointerLeave(anchor)
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
  })
})
