import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TextAreaInput } from './TextAreaInput'

afterEach(() => cleanup())

describe('TextAreaInput', () => {
  it('uses the shared fixed-size description input and forwards edits', () => {
    const onChange = vi.fn()
    render(<TextAreaInput aria-label="描述" rows={4} value="图层说明" onChange={onChange} />)

    const input = screen.getByRole('textbox', { name: '描述' })
    expect(input).toHaveClass('text-area-input')
    expect(input).toHaveAttribute('rows', '4')
    fireEvent.change(input, { target: { value: '新的说明' } })
    expect(onChange).toHaveBeenCalled()
  })
})
