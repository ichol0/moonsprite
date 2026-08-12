import type { SpriteDocument } from '@shared/types'
import { decodeAseprite } from '@/core/aseprite'
import { setRuntimeAppLocale, type AppLocale } from '@/core/localization'
import { decodeProject } from '@/core/project-format'
import { compositeDocument } from '@/core/document'
import { canPrepareInitialDocumentComposite } from '@/core/initial-document-composite'

interface DecodeWorkerRequest {
  id: number
  data: Uint8Array
  filePath: string
  locale: AppLocale
  prepareInitialComposite?: boolean
  reportProgress?: boolean
  returnDocument?: boolean
}

interface DecodeWorkerResponse {
  id: number
  document?: SpriteDocument
  initialComposite?: Uint8ClampedArray
  completed?: boolean
  error?: string
  progress?: number
}

const fileNameFromPath = (filePath: string): string => filePath.split(/[\\/]/).pop() ?? filePath
const fileExtension = (filePath: string): string => filePath.split('.').pop()?.toLowerCase() ?? ''

const collectTransferables = (root: unknown): Transferable[] => {
  const buffers = new Set<ArrayBuffer>()
  const visited = new WeakSet<object>()
  const visit = (value: unknown): void => {
    if (!value || typeof value !== 'object') return
    if (ArrayBuffer.isView(value)) {
      if (value.buffer instanceof ArrayBuffer) buffers.add(value.buffer)
      return
    }
    if (value instanceof ArrayBuffer) {
      buffers.add(value)
      return
    }
    if (visited.has(value)) return
    visited.add(value)
    if (Array.isArray(value)) for (const item of value) visit(item)
    else for (const item of Object.values(value)) visit(item)
  }
  visit(root)
  return [...buffers]
}

const scope = globalThis as unknown as {
  onmessage: ((event: MessageEvent<DecodeWorkerRequest>) => void) | null
  postMessage: (message: DecodeWorkerResponse, transfer: Transferable[]) => void
}

scope.onmessage = (event): void => {
  const { id, data, filePath, locale, prepareInitialComposite = true, reportProgress = false, returnDocument = true } = event.data
  setRuntimeAppLocale(locale)
  try {
    const suffix = fileExtension(filePath)
    const fileName = fileNameFromPath(filePath)
    const reportDecodeProgress = (progress: number): void => {
      if (reportProgress) scope.postMessage({ id, progress: prepareInitialComposite ? progress * 0.85 : progress }, [])
    }
    const document = suffix === 'moonsprite'
      ? decodeProject(data, reportDecodeProgress)
      : decodeAseprite(data, fileName.replace(/\.(aseprite|ase)$/i, ''), reportDecodeProgress)
    document.filePath = suffix === 'moonsprite' ? filePath : null
    document.sourceFilePath = filePath
    document.name = fileName
    if (prepareInitialComposite && reportProgress) scope.postMessage({ id, progress: 0.86 }, [])
    const initialComposite = prepareInitialComposite && canPrepareInitialDocumentComposite(document.width, document.height)
      ? compositeDocument(document)
      : undefined
    if (reportProgress) scope.postMessage({ id, progress: 1 }, [])
    const response = returnDocument
      ? { id, document, initialComposite }
      : { id, initialComposite, completed: true }
    scope.postMessage(response, collectTransferables(response))
  } catch (error) {
    scope.postMessage({ id, error: error instanceof Error ? error.message : String(error) }, [])
  }
}
