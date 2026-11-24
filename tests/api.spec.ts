/**
 * Server-side checks (decision R2): every action refuses callers it shouldn't
 * serve, because actions bypass the collection permissions.
 * Uses the four named test accounts (TA One, TA Two, Student One, Student Two).
 */
import { test as base, expect } from '@playwright/test'
import { test, loadAllTestAccounts } from 'deepspace/testing'
import { act, createRound, recordTool } from './helpers/slotdraft'

const ACTIONS = ['createRound', 'joinRound', 'submitResponse', 'generateDraft', 'previewSeat', 'applySeat', 'publish', 'loadSampleRound', 'sendInvites']

base('every action returns 401 without a token', async ({ request }) => {
  for (const name of ACTIONS) {
    const res = await request.post(`/api/actions/${name}`, { data: {} })
    expect(res.status(), name).toBe(401)
  }
})

test.describe('with test accounts', () => {
  test.skip(loadAllTestAccounts().length < 4, 'Needs the 4 test accounts: TA One, TA Two, Student One, Student Two')

  test('a non-organizer cannot generate, preview, apply or publish', async ({ users }) => {
    const [ta, other, student] = await users(['TA One', 'TA Two', 'Student One'])
    const round = await createRound(ta.page, [student.email])
    for (const name of ['generateDraft', 'previewSeat', 'applySeat', 'publish']) {
      const res = await act(other.page, name, { roundId: round.roundId, windowId: round.windowIds[0] })
      expect(res, name).toEqual({ success: false, error: 'Only the TA who made this round can do that.' })
    }
  })

  test('the organizer cannot build a draft before the deadline', async ({ users }) => {
    const [ta, student] = await users(['TA One', 'Student One'])
    const round = await createRound(ta.page, [student.email])
    const res = await act(ta.page, 'generateDraft', { roundId: round.roundId })
    expect(res.success).toBe(false)
    expect(res.error).toMatch(/^You can build the draft after responses close/)
  })

  test('someone not on the roster cannot submit', async ({ users }) => {
    const [ta, outsider] = await users(['TA One', 'Student Two'])
    const round = await createRound(ta.page, ['someone.else@example.edu'])
    const join = await act(outsider.page, 'joinRound', { roundId: round.roundId })
    expect(join).toMatchObject({ success: true, data: { onRoster: false } })
    const res = await act(outsider.page, 'submitResponse', { roundId: round.roundId, available: [round.windowIds[0]], noneWork: false, note: '' })
    expect(res).toEqual({ success: false, error: 'You’re not on the roster for this round. Ask your TA to add your email.' })
  })

  test('a submission after the deadline is rejected by the server', async ({ users }) => {
    test.setTimeout(60_000)
    const [ta, student] = await users(['TA One', 'Student One'])
    const round = await createRound(ta.page, [student.email], 8_000)
    const early = await act(student.page, 'submitResponse', { roundId: round.roundId, available: [round.windowIds[0]], noneWork: false, note: '' })
    expect(early.success).toBe(true)
    await student.page.waitForTimeout(9_000)
    const late = await act(student.page, 'submitResponse', { roundId: round.roundId, available: [round.windowIds[1]], noneWork: false, note: '' })
    expect(late.success).toBe(false)
    expect(late.error).toMatch(/^Responses closed at \d{1,2}:\d{2} [AP]M\. Your change wasn’t saved\.$/)
  })

  test('invalid input is rejected with a sentence that says how to fix it', async ({ users }) => {
    const [ta, student] = await users(['TA One', 'Student One'])
    const bad = await act(ta.page, 'createRound', {
      title: 'Bad roster',
      timezone: 'America/Phoenix',
      deadline: new Date(Date.now() + 3600_000).toISOString(),
      windows: [{ date: '2026-12-07', start: '10:00', end: '10:20', capacity: 1 }],
      roster: 'ana@example.edu\ndana',
    })
    expect(bad).toEqual({ success: false, error: 'Line 2, “dana”, isn’t an email address. Fix it or remove it.' })

    const round = await createRound(ta.page, [student.email])
    const forged = await act(student.page, 'submitResponse', { roundId: round.roundId, available: ['not-a-window'], noneWork: false, note: '' })
    expect(forged).toEqual({ success: false, error: 'Your answer has a time that isn’t in this round. Reload the page and try again.' })
    const both = await act(student.page, 'submitResponse', { roundId: round.roundId, available: [round.windowIds[0]], noneWork: true, note: '' })
    expect(both.success).toBe(false)
  })

  test('clients cannot write records directly: every write goes through an action (R6)', async ({ users }) => {
    const [ta, student] = await users(['TA One', 'Student One'])
    const round = await createRound(ta.page, [student.email])
    const res = await recordTool(student.page, 'records_create', {
      collection: 'submissions',
      data: { roundId: round.roundId, studentId: 'x', organizers: [], available: [round.windowIds[0]], noneWork: false, note: '' },
    })
    // The RecordRoom refuses: no client role has create permission.
    expect(res.ok).toBe(false)
    expect(String(res.error)).toContain('CREATE DENIED: role=member, collection=submissions')
  })
})
