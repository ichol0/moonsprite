import { describe, expect, it } from 'vitest'
import { PROJECT_SCHEMA_VERSION, migrateProjectManifest } from './project-format'

describe('project manifest migration boundary', () => {
  it('accepts the current schema through the migration entry point', () => {
    const manifest = { app: 'MoonSprite', schemaVersion: PROJECT_SCHEMA_VERSION, document: { schemaVersion: PROJECT_SCHEMA_VERSION } }
    expect(migrateProjectManifest(manifest)).toEqual(manifest)
  })

  it('rejects unknown versions without guessing their fields', () => {
    expect(() => migrateProjectManifest({ app: 'MoonSprite', schemaVersion: 2, document: { schemaVersion: 2 } })).toThrow()
    expect(() => migrateProjectManifest({ app: 'Other', schemaVersion: 1, document: { schemaVersion: 1 } })).toThrow()
  })
})
