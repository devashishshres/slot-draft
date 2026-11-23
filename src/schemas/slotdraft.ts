/**
 * SlotDraft collections and their read rules.
 *
 * How DeepSpace enforces these: every collection lives in the app's RecordRoom
 * Durable Object. Before a record goes out over the WebSocket, the room runs
 * the caller's role rule (`canRead`), so a record a user may not read never
 * reaches their browser. A role with no rule falls back to '*', and then to
 * deny. Signed-out visitors and viewers therefore see nothing here.
 *
 * Write rules: no client role may create, update or delete (decision R6).
 * Every write goes through a server action in src/actions/index.ts. Actions
 * bypass these rules, so each action checks the caller itself (decision R2).
 *
 * `admin` repeats the `member` rule on purpose. The app owner always connects
 * as admin, and must not be able to read every class's responses (R1).
 */
import type { CollectionSchema, PermissionLevel, RolePermissions } from 'deepspace/schema'

/** Read-only for clients; the same rule for member and admin. */
function readOnly(read: PermissionLevel): Record<string, RolePermissions> {
  const rule: RolePermissions = { read, create: false, update: false, delete: false }
  return { member: rule, admin: rule }
}

const text = (name: string) => ({ name, storage: 'text' as const, interpretation: 'plain' })
const number = (name: string) => ({ name, storage: 'number' as const, interpretation: 'plain' })
const bool = (name: string) => ({ name, storage: 'number' as const, interpretation: { kind: 'boolean' as const } })
const json = (name: string) => ({ name, storage: 'text' as const, interpretation: { kind: 'json' as const } })

/** Round settings. Nothing private: any signed-in member may read them. */
export const roundsSchema: CollectionSchema = {
  name: 'rounds',
  columns: [
    text('title'),
    text('timezone'),
    text('deadline'),
    { name: 'status', storage: 'text', interpretation: { kind: 'select', options: ['open', 'closed', 'published'] } },
    number('seed'),
    text('organizerId'),
    bool('sample'),
    text('draftAt'), // '' until the first "Generate draft"
    text('publishedAt'), // '' until published
  ],
  permissions: readOnly(true),
}

/** Time windows. Readable by members, so a student's form can list them. */
export const windowsSchema: CollectionSchema = {
  name: 'windows',
  columns: [text('roundId'), text('date'), text('start'), text('end'), number('capacity')],
  permissions: readOnly(true),
}

/**
 * The class list: emails are private, so only the round's organizer reads it.
 * `ownerField` points 'own' at organizerId instead of createdBy.
 */
export const rosterSchema: CollectionSchema = {
  name: 'roster',
  columns: [text('roundId'), text('name'), text('email'), text('userId'), text('organizerId')],
  ownerField: 'organizerId',
  permissions: readOnly('own'),
}

/**
 * One student's answer. 'collaborator' means owner OR listed in
 * collaboratorsField: the student (ownerField studentId) and the round's
 * organizer (organizers: [organizerId]). Nobody else (decision R1).
 */
export const submissionsSchema: CollectionSchema = {
  name: 'submissions',
  columns: [text('roundId'), text('studentId'), json('organizers'), json('available'), bool('noneWork'), text('note')],
  ownerField: 'studentId',
  collaboratorsField: 'organizers',
  permissions: readOnly('collaborator'),
}

/**
 * One responder's draft or final seat. `readerId` is the owner field and stays
 * '' while the draft is unpublished, so the student cannot read their draft
 * seat early. Publish sets it to the student's id (decision R8, amends R7).
 * The organizer reads all of them through `organizers`.
 */
export const assignmentsSchema: CollectionSchema = {
  name: 'assignments',
  columns: [
    text('roundId'),
    text('studentId'),
    text('windowId'), // '' = not placed
    number('rank'), // 1 = their first choice; 0 when not placed
    { name: 'reason', storage: 'text', interpretation: { kind: 'select', options: ['', 'full', 'none-work'] } },
    bool('published'),
    text('readerId'),
    json('organizers'),
    { name: 'emailStatus', storage: 'text', interpretation: { kind: 'select', options: ['', 'sent', 'failed', 'skipped'] } },
    number('groupSize'), // students in the same window, set at publish
  ],
  ownerField: 'readerId',
  collaboratorsField: 'organizers',
  permissions: readOnly('collaborator'),
}

export const slotdraftSchemas = [roundsSchema, windowsSchema, rosterSchema, submissionsSchema, assignmentsSchema]

// --- Record shapes (the `data` part of each envelope) ---
// Note: boolean columns are stored as numbers, so records read back carry 0/1.
// Test them for truthiness (`if (x.noneWork)`, `!!x.sample`), never `=== true`,
// and never as `{x && <jsx>}`, which would render a stray "0".

export type RoundStatus = 'open' | 'closed' | 'published'

export interface Round {
  title: string
  timezone: string
  deadline: string
  status: RoundStatus
  seed: number
  organizerId: string
  sample: boolean
  draftAt: string
  publishedAt: string
}

export interface TimeWindow {
  roundId: string
  date: string
  start: string
  end: string
  capacity: number
}

export interface RosterRow {
  roundId: string
  name: string
  email: string
  userId: string
  organizerId: string
}

export interface Submission {
  roundId: string
  studentId: string
  organizers: string[]
  available: string[]
  noneWork: boolean
  note: string
}

export interface Assignment {
  roundId: string
  studentId: string
  windowId: string
  rank: number
  reason: '' | 'full' | 'none-work'
  published: boolean
  readerId: string
  organizers: string[]
  emailStatus: '' | 'sent' | 'failed' | 'skipped'
  groupSize: number
}

/** Submissions and assignments use one deterministic id per student per round, so writes are upserts. */
export const studentRecordId = (roundId: string, studentId: string) => `${roundId}_${studentId}`
