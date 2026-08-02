import { describe, expect, it } from 'vitest'
import { HistoryStack } from './history'

const entry = (state: { value: number }, next: number, label = 'edit') => ({
  label,
  bytes: 10,
  undo: () => { state.value -= 1 },
  redo: () => { state.value = next }
})

describe('HistoryStack', () => {
  it('keeps memory accounting consistent across undo and redo', () => {
    const state = { value: 1 }
    const history = new HistoryStack()
    history.push(entry(state, 2))
    expect(history.memoryBytes).toBe(10)
    history.undo()
    expect(history.memoryBytes).toBe(0)
    history.redo()
    expect(history.memoryBytes).toBe(10)
  })

  it('preserves an entry when undo or redo throws', () => {
    const history = new HistoryStack()
    history.push({ label: 'bad undo', bytes: 7, undo: () => { throw new Error('undo') }, redo: () => undefined })
    expect(() => history.undo()).toThrow('undo')
    expect(history.canUndo).toBe(true)
    expect(history.memoryBytes).toBe(7)

    history.clear()
    history.push({ label: 'bad redo', bytes: 9, undo: () => undefined, redo: () => { throw new Error('redo') } })
    history.undo()
    expect(() => history.redo()).toThrow('redo')
    expect(history.canRedo).toBe(true)
    expect(history.memoryBytes).toBe(0)
  })

  it('clears both directions and compound state', () => {
    const history = new HistoryStack()
    history.beginCompound()
    history.push({ label: 'part', bytes: 2, undo: () => undefined, redo: () => undefined })
    history.clear()
    history.endCompound('ignored')
    expect(history.canUndo).toBe(false)
    expect(history.canRedo).toBe(false)
    expect(history.memoryBytes).toBe(0)
  })
})
