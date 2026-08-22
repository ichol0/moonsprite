import { encodeProjectWorkerPayload, type ProjectEncodeWorkerPayload, type ProjectEncodeWorkerResult } from '@/core/project-format'

interface ProjectEncodeWorkerRequest {
  id: number
  payload: ProjectEncodeWorkerPayload
}

interface ProjectEncodeWorkerResponse {
  id: number
  result?: ProjectEncodeWorkerResult
  error?: string
}

const scope = globalThis as unknown as {
  onmessage: ((event: MessageEvent<ProjectEncodeWorkerRequest>) => void) | null
  postMessage: (message: ProjectEncodeWorkerResponse, transfer: Transferable[]) => void
}

scope.onmessage = (event): void => {
  const { id, payload } = event.data
  try {
    const result = encodeProjectWorkerPayload(payload)
    scope.postMessage({ id, result }, [result.data.buffer])
  } catch (error) {
    scope.postMessage({ id, error: error instanceof Error ? error.message : String(error) }, [])
  }
}
