import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
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

  it('submits the evaluated value after the controlled state is updated', async () => {
    const submitted: number[] = []
    const Form = () => {
      const [value, setValue] = useState(4)
      return <form onSubmit={(event) => { event.preventDefault(); submitted.push(value) }}><NumberInput aria-label="尺寸" value={value} onValueChange={setValue} /></form>
    }
    render(<Form />)
    const input = screen.getByRole('spinbutton', { name: '尺寸' })
    fireEvent.change(input, { target: { value: '8 * 2' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(submitted).toEqual([16]))
  })
})
