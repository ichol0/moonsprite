import { describe, expect, it } from 'vitest'
import { compositeDocument, createDocument, createLayer } from '@/core/document'
import { decodeProject, encodeProject } from '@/core/project-format'
import { rehydrateRuntimeRasterDocument } from '@/core/runtime-raster'
import { processDocumentDecodeRequest, type DecodeWorkerResponse } from './document-decode.worker'

describe('document decode worker integration', () => {
  it('preserves the exact decoded document and initial composite pixels', () => {
    const source = createDocument('worker integration', 3, 2, 'rgba')
    source.layers[0].pixels.set([
      255, 0, 0, 255,
      0, 0, 0, 0,
      0, 0, 0, 0,
      0, 0, 0, 0,
      0, 0, 0, 0,
      0, 0, 0, 0
    ])
    const overlay = createLayer('Overlay', 2, 1, 'rgba')
    overlay.offsetX = 1
    overlay.offsetY = 1
    overlay.opacity = 0.5
    overlay.pixels.set([0, 255, 0, 255, 0, 0, 255, 255])
    source.layers.push(overlay)
    const archive = encodeProject(source, { includePreview: false })
    const expected = compositeDocument(decodeProject(archive))
    const responses: DecodeWorkerResponse[] = []
    const deferred: Array<() => void> = []

    processDocumentDecodeRequest(
      { id: 11, data: archive, filePath: 'integration.moonsprite', locale: 'zh-CN', prepareInitialComposite: true },
      (message) => { responses.push(message) },
      (work) => { deferred.push(work) }
    )
    deferred[0]()

    const document = responses.find((response) => response.document)?.document
    const initialComposite = responses.find((response) => response.initialComposite)?.initialComposite
    expect(document).toBeDefined()
    expect(initialComposite).toBeDefined()
    rehydrateRuntimeRasterDocument(document!)
    expect(Array.from(compositeDocument(document!))).toEqual(Array.from(expected))
    expect(Array.from(initialComposite!)).toEqual(Array.from(expected))
  })
})
