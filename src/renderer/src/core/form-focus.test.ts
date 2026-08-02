import { describe, expect, it } from 'vitest'
import { adjacentFormInput } from './form-focus'

describe('form input focus navigation', () => {
  it('moves forward and backward only between editable text and number inputs', () => {
    document.body.innerHTML = `<form>
      <input aria-label="宽度" type="number">
      <button type="button">交换</button>
      <input aria-label="高度" type="number">
      <input type="hidden">
      <input aria-label="锁定" type="checkbox">
      <textarea aria-label="说明"></textarea>
    </form>`
    const width = document.querySelector<HTMLInputElement>('[aria-label="宽度"]')!
    const height = document.querySelector<HTMLInputElement>('[aria-label="高度"]')!
    const description = document.querySelector<HTMLTextAreaElement>('[aria-label="说明"]')!

    expect(adjacentFormInput(width, false)).toBe(height)
    expect(adjacentFormInput(height, false)).toBe(description)
    expect(adjacentFormInput(width, true)).toBe(description)
  })

  it('keeps shortcut capture inputs out of ordinary Tab navigation', () => {
    document.body.innerHTML = `<section role="dialog">
      <input aria-label="搜索">
      <input data-shortcut-capture aria-label="快捷键">
      <input aria-label="名称">
    </section>`
    const search = document.querySelector<HTMLInputElement>('[aria-label="搜索"]')!
    const name = document.querySelector<HTMLInputElement>('[aria-label="名称"]')!
    expect(adjacentFormInput(search, false)).toBe(name)
  })
})
