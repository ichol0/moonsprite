import type { MoonSpriteApi, RecoveryRecord, SpriteDocument } from '@shared/types'
import { decodeProject, encodeProjectAsync } from '@/core/project-format'
import { translateCurrent as tr } from '@/core/localization'

export class RecoveryService {
  private queue: Promise<void> = Promise.resolve()

  private enqueue(task: () => Promise<void>): Promise<void> {
    const operation = this.queue.then(task, task)
    this.queue = operation.then(() => undefined, () => undefined)
    return operation
  }

  list(api: MoonSpriteApi, retentionDays: number): Promise<RecoveryRecord[]> {
    return api.listRecoveries(retentionDays)
  }

  async restore(api: MoonSpriteApi, record: RecoveryRecord): Promise<SpriteDocument> {
    const document = decodeProject(await api.readRecovery(record.id))
    document.name = tr('core.recovery.restoredName', { name: record.name })
    document.dirty = true
    return document
  }

  autosave(api: MoonSpriteApi, documents: readonly SpriteDocument[]): Promise<void> {
    return this.enqueue(async () => {
      const results = await Promise.allSettled(documents.map(async (document) => {
        // Recovery only needs the manifest and editable layer data. Avoid
        // generating a full-canvas gallery preview and use light compression.
        await api.writeRecovery(document.id, document.name, await encodeProjectAsync(document, { includePreview: false, compressionLevel: 1 }))
      }))
      const failures = results.flatMap((result, index) => result.status === 'rejected'
        ? [new Error(`${documents[index].name}: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`)]
        : [])
      if (failures.length > 0) throw new AggregateError(failures, tr('core.recovery.autosaveFailed', { count: failures.length }))
    })
  }

  delete(api: MoonSpriteApi, id: string): Promise<void> {
    return this.enqueue(() => api.deleteRecovery(id))
  }

  discard(api: MoonSpriteApi, id: string): Promise<void> {
    return this.enqueue(() => api.deleteRecovery(id))
  }
}
