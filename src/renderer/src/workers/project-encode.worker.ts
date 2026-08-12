import { zipSync, type Zippable } from 'fflate'

interface ProjectEncodeWorkerRequest {
  id: number
  files: Zippable
  compressionLevel: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9
}

interface ProjectEncodeWorkerResponse {
  id: number
  data?: Uint8Array
  error?: string
}

const scope = globalThis as unknown as {
  onmessage: ((event: MessageEvent<ProjectEncodeWorkerRequest>) => void) | null
  postMessage: (message: ProjectEncodeWorkerResponse, transfer: Transferable[]) => void
}

scope.onmessage = (event): void => {
  const { id, files, compressionLevel } = event.data
  try {
    const data = zipSync(files, { level: compressionLevel })
    scope.postMessage({ id, data }, [data.buffer])
  } catch (error) {
    scope.postMessage({ id, error: error instanceof Error ? error.message : String(error) }, [])
  }
}
