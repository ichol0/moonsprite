import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { NumberInput } from './NumberInput'

afterEach(cleanup)

describe('NumberInput', () => {
  it('evaluates an arithmetic expression before applying bounds', () => {
    const onValueChange = vi.fn()
    render(<NumberInput aria-label="尺寸" min={1} max={20} value={4} onValueChange={onValueChange} />)
    const input = screen.getByRole('spinbutton', { name: '尺寸' })
    fireEvent.change(input, { target: { value: '2 + 3 * 4' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onValueChange).toHaveBeenCalledWith(14)
  })

  it('restores the current value when the expression is invalid', () => {
    const onValueChange = vi.fn()
    render(<NumberInput aria-label="尺寸" value={7} onValueChange={onValueChange} />)
    const input = screen.getByRole('spinbutton', { name: '尺寸' })
    fireEvent.change(input, { target: { value: '7 / 0' } })
    fireEvent.blur(input)
    expect(input).toHaveValue('7')
    expect(onValueChange).not.toHaveBeenCalled()
  })
})
