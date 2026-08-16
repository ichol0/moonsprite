import { describe, expect, it } from 'vitest'
import { resolveFloatingDocumentReturnTarget } from './floating-document-return'

describe('resolveFloatingDocumentReturnTarget', () => {
  it('keeps the current workspace active when a floating document is dragged back to the tabs', () => {
    expect(resolveFloatingDocumentReturnTarget({
      returnedDocumentId: 'floating',
      workspaceDocumentId: 'canvas',
      preserveWorkspace: true,
      openDocumentIds: ['canvas', 'floating'],
      remainingFloatingDocumentIds: []
    })).toBe('canvas')
  })

  it('activates the returned document for an explicit return command or when no workspace remains', () => {
    expect(resolveFloatingDocumentReturnTarget({
      returnedDocumentId: 'floating',
      workspaceDocumentId: 'canvas',
      preserveWorkspace: false,
      openDocumentIds: ['canvas', 'floating'],
      remainingFloatingDocumentIds: []
    })).toBe('floating')
    expect(resolveFloatingDocumentReturnTarget({
      returnedDocumentId: 'floating',
      workspaceDocumentId: null,
      preserveWorkspace: true,
      openDocumentIds: ['floating'],
      remainingFloatingDocumentIds: []
    })).toBe('floating')
  })
})
