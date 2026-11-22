import { describe, expect, it } from 'vitest'
import { lintSchema } from 'deepspace/worker'
import { slotdraftSchemas } from './slotdraft'

describe('SlotDraft schemas', () => {
  it('pass the SDK schema lint (no visibility / ownership foot-guns)', () => {
    for (const schema of slotdraftSchemas) expect(lintSchema(schema), schema.name).toEqual([])
  })

  it('deny every client write: all writes go through server actions (R6)', () => {
    for (const schema of slotdraftSchemas) {
      for (const [role, p] of Object.entries(schema.permissions)) {
        expect([p.create, p.update, p.delete], `${schema.name}.${role}`).toEqual([false, false, false])
      }
    }
  })

  it('give admin no wider read than member (R1: the app owner is admin and still must not read every class)', () => {
    for (const schema of slotdraftSchemas) {
      expect(schema.permissions.admin.read, schema.name).toEqual(schema.permissions.member.read)
    }
  })

  it('give signed-out visitors and viewers nothing (no * or viewer rule falls back to deny)', () => {
    for (const schema of slotdraftSchemas) {
      expect(schema.permissions['*'], schema.name).toBeUndefined()
      expect(schema.permissions.viewer, schema.name).toBeUndefined()
    }
  })
})
