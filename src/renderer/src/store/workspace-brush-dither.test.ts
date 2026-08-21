import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createDocument } from '@/core/document'
import { useWorkspace } from './workspace'

beforeEach(() => {
  localStorage.clear()
  useWorkspace.setState({ sessions: [], activeId: null, message: null, dialog: null })
})

describe('workspace brush dither settings', () => {
  it('keeps dither settings per brush tool, persists them, and leaves document history untouched', () => {
    vi.useFakeTimers()
    try {
      const document = createDocument('brush dither profiles', 8, 8, 'rgba')
      useWorkspace.getState().addSession(document)
      useWorkspace.getState().setBrushDither({ enabled: true, template: 'bayer-4', stage: 5 })

      let session = useWorkspace.getState().sessions[0]
      expect(session.brushDither).toEqual({ enabled: true, template: 'bayer-4', stage: 5 })
      expect(document.dirty).toBe(false)
      expect(session.history.canUndo).toBe(false)

      useWorkspace.getState().setTool('eraser')
      expect(useWorkspace.getState().sessions[0].brushDither).toEqual({ enabled: false, template: 'bayer-4', stage: 8 })
      useWorkspace.getState().setBrushDither({ enabled: true, template: 'vertical', stage: 1 })
      useWorkspace.getState().setTool('pencil')
      expect(useWorkspace.getState().sessions[0].brushDither).toEqual({ enabled: true, template: 'bayer-4', stage: 5 })

      vi.advanceTimersByTime(101)
      useWorkspace.setState({ sessions: [], activeId: null, message: null, dialog: null })
      useWorkspace.getState().addSession(createDocument('restored brush dither profiles', 8, 8, 'rgba'))
      session = useWorkspace.getState().sessions[0]
      expect(session.brushDither).toEqual({ enabled: true, template: 'bayer-4', stage: 5 })
      useWorkspace.getState().setTool('eraser')
      expect(useWorkspace.getState().sessions[0].brushDither).toEqual({ enabled: true, template: 'vertical', stage: 1 })
    } finally {
      vi.useRealTimers()
    }
  })
})
