/**
 * Server actions: the ONLY write path in SlotDraft (decision R6).
 *
 * How DeepSpace runs these: the client POSTs to /api/actions/<name> with its
 * JWT. src/server/action-routes.ts verifies that token, then calls the
 * handler with `userId` (the verified caller) and `tools`. The tools reach
 * the RecordRoom with RBAC switched OFF, so collection permissions protect
 * nothing here. Every action therefore checks, in this order, before it
 * writes (decision R2):
 *   1. who is calling (userId, and the email in their verified JWT)
 *   2. their role in THIS round (organizer, or on the roster)
 *   3. the round's status and deadline
 *   4. the input itself
 *
 * A failed check throws `Refusal`. `guarded()` turns it into
 * `{ success: false, error }`, and the UI shows that sentence as-is.
 */
import type { ActionContext, ActionHandler, ActionResult, ActionTools } from 'deepspace/worker'
import type { Env } from '../../worker'
import { allocate, previewSeat as previewOneSeat, type AllocInput, type AllocResult } from '../lib/allocator'
import { isOpen, parseRoster, ROSTER_MAX, validateRoundInput, validateSubmission, type WindowInput } from '../lib/rounds'
import { SAMPLE_SEED, SAMPLE_STUDENTS, SAMPLE_TIMEZONE, SAMPLE_TITLE, SAMPLE_WINDOWS } from '../lib/sample'
import { dateParts, formatClock, formatWhen, timeRange, tzAbbr } from '../lib/time'
import {
  studentRecordId,
  type Assignment,
  type Round,
  type RosterRow,
  type Submission,
  type TimeWindow,
} from '../schemas/slotdraft'

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

interface Rec<T> {
  recordId: string
  data: T
  createdAt: string
  updatedAt: string
  createdBy: string
}

/** A check failed. The message is shown to the person, so it says what to do. */
class Refusal extends Error {}
const refuse = (message: string): never => {
  throw new Refusal(message)
}

/** Wraps a handler so refusals become `{ success: false, error }` instead of a 500. */
function guarded<T>(handler: (ctx: ActionContext<Env>) => Promise<T>): ActionHandler<Env> {
  return async (ctx): Promise<ActionResult> => {
    try {
      return { success: true, data: await handler(ctx) }
    } catch (err) {
      if (err instanceof Refusal) return { success: false, error: err.message }
      console.error(`[action] failed: ${err instanceof Error ? err.message : String(err)}`)
      return { success: false, error: 'Something went wrong on the server. Try again in a moment.' }
    }
  }
}

async function getOne<T>(tools: ActionTools, collection: string, id: unknown): Promise<Rec<T> | null> {
  if (typeof id !== 'string' || !id) return null
  const r = await tools.get<T & Record<string, unknown>>(collection, id)
  return r.success ? (r.data.record as unknown as Rec<T>) : null
}

/** Every record in `collection` matching `where`. RBAC is off, so `where` must scope the read. */
async function getAll<T>(tools: ActionTools, collection: string, where: Record<string, unknown>): Promise<Rec<T>[]> {
  const r = await tools.query<T & Record<string, unknown>>(collection, { where })
  if (!r.success) throw new Error(`query ${collection} failed: ${r.error}`)
  return r.data.records as unknown as Rec<T>[]
}

/** Throws if a write failed, so a half-done write is never reported as success. */
async function must(write: Promise<ActionResult<{ recordId: string }>>): Promise<string> {
  const r = await write
  if (!r.success) throw new Error(r.error)
  return r.data.recordId
}

/**
 * The caller's email, from the JWT that action-routes.ts has already verified
 * (signature, issuer, expiry). Real accounts sign in only with Google or GitHub,
 * so this email can be trusted for roster matching (CLAUDE.md §10.3).
 * Reading it from the token avoids a race with the users row, which only
 * exists once the browser's WebSocket has connected.
 */
function callerEmail(callerJwt: string): string {
  try {
    const part = callerJwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')
    const claims = JSON.parse(atob(part + '='.repeat((4 - (part.length % 4)) % 4))) as { email?: unknown }
    return typeof claims.email === 'string' ? claims.email.toLowerCase() : ''
  } catch {
    return ''
  }
}

/** Step 2 for TA actions: the round exists and the caller is its organizer (R2). */
async function organizedRound(tools: ActionTools, userId: string, roundId: unknown): Promise<Rec<Round>> {
  const round = await getOne<Round>(tools, 'rounds', roundId)
  if (!round) refuse('That round doesn’t exist.')
  if (round!.data.organizerId !== userId) refuse('Only the TA who made this round can do that.')
  return round!
}

/** A draft exists and nothing is published yet. Used by applySeat and publish. */
function requireEditableDraft(round: Rec<Round>): void {
  if (round.data.status === 'published') refuse('This round is published and can’t change.')
  if (!round.data.draftAt) refuse('Generate the draft first.')
}

/** The windows and responses of a round, as allocator input. */
async function loadAllocInput(tools: ActionTools, roundId: string, seed: number) {
  const windows = await getAll<TimeWindow>(tools, 'windows', { roundId })
  const submissions = await getAll<Submission>(tools, 'submissions', { roundId })
  const windowIds = new Set(windows.map((w) => w.recordId))
  const input: AllocInput = {
    windows: windows.map((w) => ({ id: w.recordId, capacity: w.data.capacity })),
    responses: submissions.map((s) => ({
      studentId: s.data.studentId,
      available: s.data.available.filter((id) => windowIds.has(id)),
    })),
    seed,
  }
  return { input, windows, submissions }
}

/**
 * Upserts one assignment per responder from an allocator result. The record
 * id is fixed per student per round, so re-running the draft overwrites
 * instead of duplicating. Drafts stay unreadable to students (readerId '').
 */
async function writeDraft(
  tools: ActionTools,
  round: Rec<Round>,
  submissions: Rec<Submission>[],
  result: AllocResult,
): Promise<void> {
  // ponytail: one write per student, not transactional. A crash mid-way leaves
  // a partial draft that the next Generate/Apply overwrites. Fine at class size.
  await Promise.all(
    submissions.map((s) => {
      const windowId = result.assignments[s.data.studentId] ?? ''
      const assignment: Assignment = {
        roundId: round.recordId,
        studentId: s.data.studentId,
        windowId,
        rank: windowId ? s.data.available.indexOf(windowId) + 1 : 0,
        reason: windowId ? '' : s.data.noneWork ? 'none-work' : 'full',
        published: false,
        readerId: '',
        organizers: [round.data.organizerId],
        emailStatus: '',
        groupSize: 0,
      }
      return must(tools.create('assignments', { ...assignment }, studentRecordId(round.recordId, s.data.studentId)))
    }),
  )
}

/** A new roster row, with the secret for its personal invite link (R19). */
function newRosterRow(roundId: string, entry: { name: string; email: string }, organizerId: string): RosterRow {
  return { roundId, ...entry, userId: '', organizerId, inviteToken: crypto.randomUUID(), inviteStatus: '' }
}

/**
 * Finds the caller's roster row, and links their account to it the first time
 * (CLAUDE.md §4, R19). In order:
 *   1. a row already linked to this account
 *   2. the row with the email on their verified sign-in
 *   3. the row whose invite token they brought (any Google/GitHub account
 *      works, because DeepSpace has no email sign-up). Never for the
 *      organizer, so a TA testing a student's link doesn't take that spot.
 * A row belongs to the first account that links it.
 */
async function rosterRowFor(tools: ActionTools, round: Rec<Round>, email: string, userId: string, invite = '') {
  const rows = await getAll<RosterRow>(tools, 'roster', { roundId: round.recordId })
  const mine = rows.find((r) => r.data.userId === userId)
  if (mine) return mine

  const byEmail = email ? rows.find((r) => r.data.email === email) : undefined
  const byInvite =
    invite && userId !== round.data.organizerId ? rows.find((r) => r.data.inviteToken === invite) : undefined
  const row = byEmail ?? byInvite
  if (!row) return null
  if (row.data.userId) {
    refuse(
      byEmail
        ? 'Another account already answered for this email. Ask your TA to check the roster.'
        : 'Someone already used this invite link with a different account. Sign in with that account, or ask your TA.',
    )
  }
  await must(tools.update('roster', row.recordId, { userId }))
  return row
}

/**
 * Sends one email; true if the platform accepted it. Never throws, so one bad
 * address can't stop a publish or a batch of invites (CLAUDE.md §4).
 * The platform sends every app's mail as "DeepSpace Apps" and ignores `from`
 * (`npx deepspace integrations info email/send`), so subjects start with
 * "SlotDraft:" and reply_to points at the TA. $0.013 per email, billed to the
 * app owner.
 */
async function sendEmail(tools: ActionTools, to: string, replyTo: string, message: { subject: string; text: string }) {
  try {
    const r = await tools.integration('email/send', { to, ...(replyTo ? { reply_to: replyTo } : {}), ...message })
    if (!r.success) console.error(`[email] send failed: ${r.error}`)
    return r.success
  } catch (err) {
    console.error(`[email] send threw: ${err instanceof Error ? err.message : String(err)}`)
    return false
  }
}

/**
 * Invites can go to any address and the app owner pays for each one, so one
 * TA can't use SlotDraft to send unlimited mail (R20).
 */
const INVITES_PER_DAY = 600

async function organizerEmail(tools: ActionTools, organizerId: string): Promise<string> {
  const user = await getOne<{ email?: string }>(tools, 'users', organizerId)
  return user?.data.email ?? ''
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

export const actions: Record<string, ActionHandler<Env>> = {
  /** TA: create a round with its windows and roster. The caller becomes its organizer. */
  createRound: guarded(async ({ userId, params, tools }) => {
    const rawWindows = Array.isArray(params.windows) ? (params.windows as Partial<WindowInput>[]) : []
    const input = {
      title: typeof params.title === 'string' ? params.title.trim() : '',
      timezone: typeof params.timezone === 'string' ? params.timezone : '',
      deadline: typeof params.deadline === 'string' ? params.deadline : '',
      windows: rawWindows.map((w) => ({
        date: String(w?.date ?? ''),
        start: String(w?.start ?? ''),
        end: String(w?.end ?? ''),
        capacity: Number(w?.capacity),
      })),
    }
    const problem = validateRoundInput(input, new Date())
    if (problem) refuse(problem)

    const roster = parseRoster(typeof params.roster === 'string' ? params.roster : '')
    if (roster.problems.length) refuse(roster.problems[0].message)
    if (roster.valid.length === 0) refuse('Add at least one student email to the roster.')
    if (roster.valid.length > ROSTER_MAX) refuse(`Keep the roster to ${ROSTER_MAX} students.`)

    const round: Round = {
      title: input.title,
      timezone: input.timezone,
      deadline: input.deadline,
      status: 'open',
      seed: 0,
      organizerId: userId,
      sample: false,
      draftAt: '',
      publishedAt: '',
    }
    const roundId = await must(tools.create('rounds', { ...round }))
    await Promise.all(input.windows.map((w) => must(tools.create('windows', { roundId, ...w }))))
    await Promise.all(roster.valid.map((s) => must(tools.create('roster', { ...newRosterRow(roundId, s, userId) }))))
    return { roundId }
  }),

  /**
   * Student: opening the link (optionally a personal invite link). Says
   * whether the caller is on the roster and links their account to their
   * roster row (decisions R9, R19). `email` is the roster email when they're
   * on it, because that's where their result goes. Also returns the TA's
   * email for the "Email your TA" mailto links.
   */
  joinRound: guarded(async ({ userId, params, tools, callerJwt }) => {
    const round = await getOne<Round>(tools, 'rounds', params.roundId)
    if (!round) refuse('This link doesn’t match a round. Check the link with your TA.')
    const signedInAs = callerEmail(callerJwt)
    const invite = typeof params.invite === 'string' ? params.invite : ''
    if (!signedInAs && !invite) refuse('We couldn’t read the email on your account. Sign out and sign in again.')
    const row = await rosterRowFor(tools, round!, signedInAs, userId, invite)
    return {
      onRoster: !!row,
      email: row?.data.email ?? signedInAs,
      organizerEmail: await organizerEmail(tools, round!.data.organizerId),
    }
  }),

  /** Student: save or replace their answer. Rejected once the deadline passes (R3). */
  submitResponse: guarded(async ({ userId, params, tools, callerJwt }) => {
    const round = await getOne<Round>(tools, 'rounds', params.roundId)
    if (!round) refuse('This link doesn’t match a round. Check the link with your TA.')
    const row = await rosterRowFor(tools, round!, callerEmail(callerJwt), userId)
    if (!row) refuse('You’re not on the roster for this round. Ask your TA to add your email.')
    if (!isOpen(round!.data, new Date())) {
      refuse(`Responses closed at ${formatClock(round!.data.deadline, round!.data.timezone)}. Your change wasn’t saved.`)
    }

    const windows = await getAll<TimeWindow>(tools, 'windows', { roundId: round!.recordId })
    const answer = {
      available: params.available as string[],
      noneWork: params.noneWork as boolean,
      note: typeof params.note === 'string' ? params.note.trim() : (params.note as string),
    }
    const problem = validateSubmission(answer, windows.map((w) => w.recordId))
    if (problem) refuse(problem)

    const submission: Submission = {
      roundId: round!.recordId,
      studentId: userId,
      organizers: [round!.data.organizerId],
      available: answer.available,
      noneWork: answer.noneWork,
      note: answer.noneWork ? answer.note : '',
    }
    await must(tools.create('submissions', { ...submission }, studentRecordId(round!.recordId, userId)))
    return { saved: true }
  }),

  /** TA: build (or rebuild) the draft once responses have closed. */
  generateDraft: guarded(async ({ userId, params, tools }) => {
    const round = await organizedRound(tools, userId, params.roundId)
    if (round.data.status === 'published') refuse('This round is published and can’t change.')
    if (isOpen(round.data, new Date())) {
      refuse(`You can build the draft after responses close, ${formatWhen(round.data.deadline, round.data.timezone)}.`)
    }
    // The seed is drawn once and stored, so every later preview and apply
    // reuses the same draw order (decision A3).
    const seed = round.data.seed || crypto.getRandomValues(new Uint32Array(1))[0] || 1
    const { input, submissions } = await loadAllocInput(tools, round.recordId, seed)
    const result = allocate(input)
    await writeDraft(tools, round, submissions, result)
    await must(tools.update('rounds', round.recordId, { status: 'closed', seed, draftAt: new Date().toISOString() }))
    return { placed: Object.keys(result.assignments).length, responded: submissions.length }
  }),

  /** TA: what one more seat in `windowId` would change. Writes nothing (P6). */
  previewSeat: guarded(async ({ userId, params, tools }) => {
    const round = await organizedRound(tools, userId, params.roundId)
    if (!round.data.draftAt) refuse('Generate the draft first.')
    const { input } = await loadAllocInput(tools, round.recordId, round.data.seed)
    if (!input.windows.some((w) => w.id === params.windowId)) refuse('That window isn’t in this round.')
    return previewOneSeat(input, params.windowId as string)
  }),

  /** TA: commit one more seat, then re-run with the SAME seed (A3). */
  applySeat: guarded(async ({ userId, params, tools }) => {
    const round = await organizedRound(tools, userId, params.roundId)
    requireEditableDraft(round)
    const window = await getOne<TimeWindow>(tools, 'windows', params.windowId)
    if (!window || window.data.roundId !== round.recordId) refuse('That window isn’t in this round.')
    await must(tools.update('windows', window!.recordId, { capacity: window!.data.capacity + 1 }))
    const { input, submissions } = await loadAllocInput(tools, round.recordId, round.data.seed)
    const result = allocate(input)
    await writeDraft(tools, round, submissions, result)
    return { placed: Object.keys(result.assignments).length }
  }),

  /**
   * TA: publish exactly the reviewed draft (P5), then email each responder.
   * Order matters: the round is marked published first, so a crash during
   * emails can't lead to a second publish. A failed send never fails the
   * publish. It is recorded per student as emailStatus 'failed' (CLAUDE.md §4).
   */
  publish: guarded(async ({ userId, params, tools, env, callerJwt }) => {
    const round = await organizedRound(tools, userId, params.roundId)
    requireEditableDraft(round)
    const publishedAt = new Date().toISOString()
    await must(tools.update('rounds', round.recordId, { status: 'published', publishedAt }))

    const assignments = await getAll<Assignment>(tools, 'assignments', { roundId: round.recordId })
    const windows = new Map(
      (await getAll<TimeWindow>(tools, 'windows', { roundId: round.recordId })).map((w) => [w.recordId, w.data]),
    )
    const roster = new Map(
      (await getAll<RosterRow>(tools, 'roster', { roundId: round.recordId })).map((r) => [r.data.userId, r.data]),
    )
    const groupSize = (windowId: string) => assignments.filter((a) => a.data.windowId === windowId).length
    const replyTo = callerEmail(callerJwt)

    let sent = 0
    let failed = 0
    for (const a of assignments) {
      // readerId = studentId is what lets the student read their own row (R8).
      const size = a.data.windowId ? groupSize(a.data.windowId) : 0
      await must(tools.update('assignments', a.recordId, { published: true, readerId: a.data.studentId, groupSize: size }))

      const student = roster.get(a.data.studentId)
      let emailStatus: Assignment['emailStatus'] = 'skipped'
      if (!round.data.sample && student) {
        const message = resultEmail(round, student, windows.get(a.data.windowId), a.data, size, env.APP_NAME)
        emailStatus = (await sendEmail(tools, student.email, replyTo, message)) ? 'sent' : 'failed'
      }
      if (emailStatus === 'sent') sent++
      if (emailStatus === 'failed') failed++
      await must(tools.update('assignments', a.recordId, { emailStatus }))
    }
    return { sent, failed }
  }),

  /**
   * TA: email each roster student their personal invite link (P9, R19).
   * Sends to everyone not yet 'sent', so it is also "try again" for failures
   * and "send the rest" if an earlier batch was cut off. Each row's status is
   * written as it goes, so the TA's roster table updates live.
   */
  sendInvites: guarded(async ({ userId, params, tools, env, callerJwt }) => {
    const round = await organizedRound(tools, userId, params.roundId)
    if (round.data.sample) refuse('The sample round has no real students to email.')
    if (!isOpen(round.data, new Date())) refuse('Responses are closed, so there’s nothing to invite students to.')

    const rows = await getAll<RosterRow>(tools, 'roster', { roundId: round.recordId })
    const pending = rows.filter((r) => r.data.inviteStatus !== 'sent')
    const dayAgo = Date.now() - 24 * 60 * 60 * 1000
    const sentToday = (await getAll<RosterRow>(tools, 'roster', { organizerId: userId })).filter(
      (r) => r.data.inviteStatus === 'sent' && Date.parse(r.updatedAt) > dayAgo,
    ).length
    if (sentToday + pending.length > INVITES_PER_DAY) {
      refuse(`SlotDraft sends up to ${INVITES_PER_DAY} invites a day for each TA, and this would go over. Try again tomorrow, or share the round link yourself.`)
    }

    // ponytail: one at a time (about 0.3s each), the same as publish. Two calls
    // at the same moment could email a student twice; the button is disabled
    // while sending, so that takes two tabs.
    const replyTo = callerEmail(callerJwt)
    let sent = 0
    for (const row of pending) {
      // Rows from before invites existed have no token yet.
      const inviteToken = row.data.inviteToken || crypto.randomUUID()
      const ok = await sendEmail(tools, row.data.email, replyTo, inviteEmail(round, { ...row.data, inviteToken }, env.APP_NAME))
      await must(tools.update('roster', row.recordId, { inviteToken, inviteStatus: ok ? 'sent' : 'failed' }))
      if (ok) sent++
    }
    return { sent, failed: pending.length - sent }
  }),

  /**
   * TA: add students to an open round (P10). A student added after the
   * deadline couldn't answer, so it's refused then. The client sends the new
   * students' invites right after, with sendInvites.
   */
  addStudents: guarded(async ({ userId, params, tools }) => {
    const round = await organizedRound(tools, userId, params.roundId)
    if (!isOpen(round.data, new Date())) refuse('Responses are closed, so the roster can’t change.')
    const current = await getAll<RosterRow>(tools, 'roster', { roundId: round.recordId })
    const roster = parseRoster(
      typeof params.roster === 'string' ? params.roster : '',
      current.map((r) => r.data.email),
    )
    if (roster.problems.length) refuse(roster.problems[0].message)
    if (roster.valid.length === 0) refuse('Add at least one student email.')
    if (current.length + roster.valid.length > ROSTER_MAX) refuse(`Keep the roster to ${ROSTER_MAX} students.`)
    await Promise.all(roster.valid.map((s) => must(tools.create('roster', { ...newRosterRow(round.recordId, s, userId) }))))
    return { added: roster.valid.length }
  }),

  /**
   * TA: take a student off an open round, e.g. a mistyped email or an invite
   * link someone else claimed (P10). Their answer goes too, so it can't sit in
   * the draft without a roster row. Re-adding them issues a new invite link.
   */
  removeStudent: guarded(async ({ userId, params, tools }) => {
    const round = await organizedRound(tools, userId, params.roundId)
    if (!isOpen(round.data, new Date())) refuse('Responses are closed, so the roster can’t change.')
    const row = await getOne<RosterRow>(tools, 'roster', params.rosterId)
    if (!row || row.data.roundId !== round.recordId) refuse('That student isn’t on this round’s roster.')
    if (row!.data.userId) {
      const answer = await getOne<Submission>(tools, 'submissions', studentRecordId(round.recordId, row!.data.userId))
      if (answer) await must(tools.remove('submissions', answer.recordId))
    }
    await must(tools.remove('roster', row!.recordId))
    return { removed: true }
  }),

  /** Anyone signed in: the 7-student sample class (P8), owned by the caller, never emailed. */
  loadSampleRound: guarded(async ({ userId, tools }) => {
    const round: Round = {
      title: SAMPLE_TITLE,
      timezone: SAMPLE_TIMEZONE,
      deadline: new Date().toISOString(), // already closed, so the TA can generate the draft at once
      status: 'closed',
      seed: SAMPLE_SEED,
      organizerId: userId,
      sample: true,
      draftAt: '',
      publishedAt: '',
    }
    const roundId = await must(tools.create('rounds', { ...round }))
    const windowIds = new Map<string, string>()
    for (const w of SAMPLE_WINDOWS) {
      const { key, ...data } = w
      windowIds.set(key, await must(tools.create('windows', { roundId, ...data })))
    }
    for (const s of SAMPLE_STUDENTS) {
      // Fake, pre-linked user ids ("sample-ana"): no real account can have them.
      const row: RosterRow = { roundId, name: s.name, email: s.email, userId: s.id, organizerId: userId, inviteToken: '', inviteStatus: '' }
      await must(tools.create('roster', { ...row }))
      if (!s.response) continue
      const submission: Submission = {
        roundId,
        studentId: s.id,
        organizers: [userId],
        available: s.response.available.map((key) => windowIds.get(key)!),
        noneWork: s.response.noneWork,
        note: s.response.note,
      }
      await must(tools.create('submissions', { ...submission }, studentRecordId(roundId, s.id)))
    }
    return { roundId }
  }),
}

/** Plain-text invite with the student's personal link (R19). */
export function inviteEmail(round: Rec<Round>, student: RosterRow, appName: string): { subject: string; text: string } {
  const { title, timezone, deadline } = round.data
  const link = `https://${appName}.app.space/r/${round.recordId}?invite=${student.inviteToken}`
  return {
    subject: `SlotDraft: pick your times for ${title}`,
    text: [
      `Hi ${student.name},`,
      '',
      `Your TA is scheduling ${title}. Mark the times you can make by ${formatWhen(deadline, timezone)} ${tzAbbr(timezone, new Date(deadline))}:`,
      link,
      '',
      "Sign in with any Google or GitHub account. No password needed. This link is yours, so don't forward it.",
      "Answering early doesn't give you priority. You can change your answer until the deadline.",
      '',
      'Questions? Reply to this email to reach your TA.',
    ].join('\n'),
  }
}

/** Plain-text result email. Same facts as the student's result screen. */
export function resultEmail(
  round: Rec<Round>,
  student: RosterRow,
  window: TimeWindow | undefined,
  assignment: Assignment,
  groupSize: number,
  appName: string,
): { subject: string; text: string } {
  const link = `https://${appName}.app.space/r/${round.recordId}`
  const { title, timezone } = round.data
  if (window) {
    const when = `${dateParts(window.date).weekday}, ${dateParts(window.date).short.split(', ')[1]}, ${timeRange(window.start, window.end).text} ${tzAbbr(timezone, new Date(`${window.date}T12:00:00Z`))}`
    const group = groupSize > 1 ? ` It's a group session with ${groupSize - 1} other student${groupSize > 2 ? 's' : ''}.` : ''
    return {
      subject: `SlotDraft: your ${title} time is ${dateParts(window.date).short}`,
      text: [
        `Hi ${student.name},`,
        '',
        `You're scheduled for ${title}:`,
        when,
        '',
        `Stay for the whole time.${group}`,
        "Can't make it anymore? Reply to this email to reach your TA. The schedule is final, so changes go through them.",
        '',
        `See it in SlotDraft: ${link}`,
      ].join('\n'),
    }
  }
  const why =
    assignment.reason === 'none-work'
      ? 'You said none of the times work. Your TA has your note and will get in touch about another time.'
      : 'The times you could make filled up. Your TA will get in touch about another time.'
  return {
    subject: `SlotDraft: you're not scheduled yet for ${title}`,
    text: [`Hi ${student.name},`, '', `You're not scheduled yet for ${title}.`, why, '', `See it in SlotDraft: ${link}`].join('\n'),
  }
}
