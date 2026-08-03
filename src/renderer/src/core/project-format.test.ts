import { describe, expect, it } from 'vitest'
import { createDocument } from './document'
import { decodeProject, encodeProject, PROJECT_SCHEMA_VERSION, migrateProjectManifest } from './project-format'

describe('project manifest migration boundary', () => {
  it('accepts the current schema through the migration entry point', () => {
    const manifest = { app: 'MoonSprite', schemaVersion: PROJECT_SCHEMA_VERSION, document: { schemaVersion: PROJECT_SCHEMA_VERSION } }
    expect(migrateProjectManifest(manifest)).toMatchObject({ ...manifest, document: { ...manifest.document, animation: { activeFrameId: 'frame-1' } } })
  })

  it('migrates the v1 single-frame document into the animation-ready schema', () => {
    expect(migrateProjectManifest({ app: 'MoonSprite', schemaVersion: 1, document: { schemaVersion: 1 } })).toMatchObject({ schemaVersion: PROJECT_SCHEMA_VERSION, document: { schemaVersion: PROJECT_SCHEMA_VERSION, animation: { frames: [{ id: 'frame-1', duration: 100 }] } } })
  })

  it('rejects unknown versions without guessing their fields', () => {
    expect(() => migrateProjectManifest({ app: 'MoonSprite', schemaVersion: 3, document: { schemaVersion: 3 } })).toThrow()
    expect(() => migrateProjectManifest({ app: 'Other', schemaVersion: 1, document: { schemaVersion: 1 } })).toThrow()
  })

  it('round-trips project-owned outline settings', () => {
    const document = createDocument('outline settings', 2, 2, 'rgba')
    document.outlineSettings = {
      color: { r: 10, g: 20, b: 30, a: 255 },
      thickness: 3,
      position: 'inside',
      kernel: 'square',
      directions: { nw: true, n: false, ne: true, w: true, e: true, sw: false, s: true, se: false },
      previewEnabled: false
    }

    expect(decodeProject(encodeProject(document)).outlineSettings).toEqual(document.outlineSettings)
  })
})
