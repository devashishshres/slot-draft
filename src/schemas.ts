/**
 * Collection Schemas
 *
 * All collections with columns and RBAC permissions.
 * Single source of truth — imported by both worker and frontend.
 * The SlotDraft collections and their read rules live in src/schemas/slotdraft.ts.
 */

import type { CollectionSchema } from 'deepspace/schema'
import { usersSchema } from './schemas/users-schema'
import { slotdraftSchemas } from './schemas/slotdraft'

export const schemas: CollectionSchema[] = [usersSchema, ...slotdraftSchemas]
