import type { MoonSpriteApi, RecoveryRecord, SpriteDocument } from '@shared/types'
import { decodeProject, encodeProject } from '@/core/project-format'
import { translateCurrent as tr } from '@/core/localization'

export class RecoveryService {
  private queue: Promise<void> = Promise.resolve()

  private enqueue(task: () => Promise<void>): Promise<void> {
    const operation = this.queue.catch(() => undefined).then(task)
    this.queue = operation
    return operation
  }

  list(api: MoonSpriteApi): Promise<RecoveryRecord[]> {
    return api.listRecoveries()
  }

  async restore(api: MoonSpriteApi, record: RecoveryRecord): Promise<SpriteDocument> {
    const document = decodeProject(await api.readRecovery(record.id))
    document.name = tr('core.recovery.restoredName', { name: record.name })
    document.dirty = true
    return document
  }

  autosave(api: MoonSpriteApi, documents: readonly SpriteDocument[]): Promise<void> {
    return this.enqueue(async () => {
      await Promise.all(documents.map(async (document) => {
        try {
          // Recovery only needs the manifest and editable layer data. Avoid
          // generating a full-canvas gallery preview and use light compression
          // so autosave cannot monopolize the renderer for large documents.
          await api.writeRecovery(document.id, document.name, encodeProject(document, { includePreview: false, compressionLevel: 1 }))
        } catch { /* Autosave remains non-blocking per document. */ }
      }))
    })
  }

  delete(api: MoonSpriteApi, id: string): Promise<void> {
    return this.enqueue(() => api.deleteRecovery(id))
  }

  discard(api: MoonSpriteApi, id: string): Promise<void> {
    return this.enqueue(async () => {
      try { await api.deleteRecovery(id) } catch { /* Closing should not be blocked by stale recovery cleanup. */ }
    })
  }
}
