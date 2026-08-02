import { describe, expect, it, vi } from 'vitest'
import { createResourceInfoReader } from './resource-info-cache'

describe('resource info cache', () => {
  it('shares the initial system probe and serves cached data immediately', async () => {
    let resolve!: (value: { totalBytes: number; freeBytes: number }) => void
    const loader = vi.fn(() => new Promise<{ totalBytes: number; freeBytes: number }>((done) => { resolve = done }))
    const read = createResourceInfoReader(loader)
    const first = read()
    const second = read()

    expect(loader).toHaveBeenCalledTimes(1)
    resolve({ totalBytes: 8_000, freeBytes: 4_000 })
    await expect(first).resolves.toEqual({ totalBytes: 8_000, freeBytes: 4_000 })
    await expect(second).resolves.toEqual({ totalBytes: 8_000, freeBytes: 4_000 })
    await expect(read()).resolves.toEqual({ totalBytes: 8_000, freeBytes: 4_000 })
    expect(loader).toHaveBeenCalledTimes(1)
  })

  it('returns stale data while refreshing it in the background', async () => {
    let now = 0
    const loader = vi.fn()
      .mockResolvedValueOnce({ totalBytes: 8_000, freeBytes: 4_000 })
      .mockResolvedValueOnce({ totalBytes: 8_000, freeBytes: 3_000 })
    const read = createResourceInfoReader(loader, { refreshAfterMs: 100, now: () => now })

    await expect(read()).resolves.toEqual({ totalBytes: 8_000, freeBytes: 4_000 })
    now = 101
    await expect(read()).resolves.toEqual({ totalBytes: 8_000, freeBytes: 4_000 })
    await vi.waitFor(() => expect(loader).toHaveBeenCalledTimes(2))
    await expect(read()).resolves.toEqual({ totalBytes: 8_000, freeBytes: 3_000 })
  })
})
