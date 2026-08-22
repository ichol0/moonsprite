import { beforeEach, describe, expect, it } from 'vitest'
import { createDocument } from '@/core/document'
import { flushColorRolePreferences, loadColorRolePreferences } from '@/core/color-role-preferences'
import { useWorkspace } from './workspace'

beforeEach(() => {
  flushColorRolePreferences()
  localStorage.clear()
  useWorkspace.setState({
    sessions: [],
    activeId: null,
    sharedPrimaryColor: { r: 41, g: 121, b: 255, a: 255 },
    sharedSecondaryColor: { r: 241, g: 244, b: 248, a: 255 }
  })
})

describe('workspace color role persistence', () => {
  it('persists shared colors and applies them to the next opened project', () => {
    const primary = { r: 24, g: 68, b: 112, a: 255 }
    const secondary = { r: 222, g: 180, b: 96, a: 200 }

    useWorkspace.getState().setPrimaryColor(primary)
    useWorkspace.getState().setSecondaryColor(secondary)
    flushColorRolePreferences()

    expect(loadColorRolePreferences()).toEqual({ primary, secondary })

    useWorkspace.getState().addSession(createDocument('reopened colors', 8, 8, 'rgba'))
    const session = useWorkspace.getState().sessions[0]
    expect(session.primaryColor).toEqual(primary)
    expect(session.secondaryColor).toEqual(secondary)
  })
})
