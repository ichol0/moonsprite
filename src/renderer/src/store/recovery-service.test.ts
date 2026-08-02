import { describe, expect, it, vi } from 'vitest'
import type { MoonSpriteApi, RecoveryRecord } from '@shared/types'
import { createDocument } from '@/core/document'
import { encodeProject } from '@/core/project-format'
import { RecoveryService } from './recovery-service'

const api = (changes: Partial<MoonSpriteApi> = {}): MoonSpriteApi => ({
  listRecoveries: async () => [],
  readRecovery: async () => new Uint8Array(),
  writeRecovery: async () => {},
  deleteRecovery: async () => {},
  ...changes
} as MoonSpriteApi)

describe('recovery service', () => {
  it('serializes discard after an in-flight autosave', async () => {
    let releaseWrite!: () => void
    const events: string[] = []
    const bridge = api({
      writeRecovery: vi.fn(async () => {
        events.push('write:start')
        await new Promise<void>((resolve) => { releaseWrite = resolve })
        events.push('write:end')
      }),
      deleteRecovery: vi.fn(async () => { events.push('delete') })
    })
    const service = new RecoveryService()
    const autosave = service.autosave(bridge, [createDocument('draft', 8, 8, 'rgba')])
    await vi.waitFor(() => expect(events).toEqual(['write:start']))
    const discard = service.discard(bridge, 'doc')
    expect(events).toEqual(['write:start'])
    releaseWrite()
    await Promise.all([autosave, discard])
    expect(events).toEqual(['write:start', 'write:end', 'delete'])
  })

  it('restores a project as a dirty recovery document', async () => {
    const document = createDocument('draft', 8, 8, 'rgba')
    const record: RecoveryRecord = { id: document.id, name: 'draft', updatedAt: '1' }
    const service = new RecoveryService()
    const restored = await service.restore(api({ readRecovery: async () => encodeProject(document) }), record)
    expect(restored.name).toBe('draft（恢复）')
    expect(restored.dirty).toBe(true)
  })
})
