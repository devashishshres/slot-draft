/**
 * Personal invite links (decision R19). Each roster row has a secret token;
 * its link lets ANY Google/GitHub account answer as that student, because
 * DeepSpace has no email sign-up. The first account to use a link owns it.
 */
import { test, expect, loadAllTestAccounts } from 'deepspace/testing'
import { act, createRound, readAs, shot } from './helpers/slotdraft'

test.skip(loadAllTestAccounts().length < 4, 'Needs the 4 test accounts: TA One, TA Two, Student One, Student Two')

const ALREADY_USED = 'Someone already used this invite link with a different account. Sign in with that account, or ask your TA.'

async function rosterRow(ta: Parameters<typeof readAs>[0], roundId: string, email: string) {
  const rows = await readAs(ta, 'roster', { roundId })
  const row = rows.find((r) => r.data.email === email)
  if (!row) throw new Error(`${email} is not on the roster`)
  return row
}

test('an invite link connects any account to its roster row, and only one account', async ({ users }) => {
  const [ta, invited, other] = await users(['TA One', 'Student Two', 'TA Two'])
  const round = await createRound(ta.page, ['ana.lee@example.edu'])
  const { roundId } = round
  const invite = String((await rosterRow(ta.page, roundId, 'ana.lee@example.edu')).data.inviteToken)
  expect(invite).toMatch(/^[0-9a-f-]{36}$/)

  // A wrong token is simply "not on the roster"
  expect(await act(invited.page, 'joinRound', { roundId, invite: 'not-a-real-token' })).toMatchObject({ success: true, data: { onRoster: false } })

  // The right token: on the roster, as the email the TA has (result emails go there)
  expect(await act(invited.page, 'joinRound', { roundId, invite })).toMatchObject({ success: true, data: { onRoster: true, email: 'ana.lee@example.edu' } })
  // Later visits don't need the token, and the answer is saved against that row
  expect(await act(invited.page, 'joinRound', { roundId })).toMatchObject({ success: true, data: { onRoster: true } })
  const saved = await act(invited.page, 'submitResponse', { roundId, available: [round.windowIds[0]], noneWork: false, note: '' })
  expect(saved.success).toBe(true)
  const row = await rosterRow(ta.page, roundId, 'ana.lee@example.edu')
  const [submission] = await readAs(ta.page, 'submissions', { roundId })
  expect(submission?.data.studentId).toBe(row.data.userId)

  // A second account with the same link is refused
  expect(await act(other.page, 'joinRound', { roundId, invite })).toEqual({ success: false, error: ALREADY_USED })
})

test('the TA opening a student’s invite link does not take that spot', async ({ users }) => {
  const [ta] = await users(['TA One'])
  const { roundId } = await createRound(ta.page, ['ben.cho@example.edu'])
  const invite = String((await rosterRow(ta.page, roundId, 'ben.cho@example.edu')).data.inviteToken)
  expect(await act(ta.page, 'joinRound', { roundId, invite })).toMatchObject({ success: true, data: { onRoster: false } })
  expect((await rosterRow(ta.page, roundId, 'ben.cho@example.edu')).data.userId).toBe('')
})

test('a student already on the roster can’t take a second spot with someone else’s link', async ({ users }) => {
  const [ta, student] = await users(['TA One', 'Student One'])
  const { roundId } = await createRound(ta.page, [student.email, 'cara.diaz@example.edu'])
  const invite = String((await rosterRow(ta.page, roundId, 'cara.diaz@example.edu')).data.inviteToken)
  expect(await act(student.page, 'joinRound', { roundId, invite })).toMatchObject({ success: true, data: { onRoster: true, email: student.email } })
  expect((await rosterRow(ta.page, roundId, 'cara.diaz@example.edu')).data.userId).toBe('')
})

test('opening an invite link in the browser shows the response form and drops the token from the address', async ({ users }) => {
  const [ta, invited] = await users(['TA One', 'Student Two'])
  const { roundId } = await createRound(ta.page, ['dan.ito@example.edu'])
  const invite = String((await rosterRow(ta.page, roundId, 'dan.ito@example.edu')).data.inviteToken)
  await invited.page.goto(`/r/${roundId}?invite=${invite}`)
  await expect(invited.page.getByRole('heading', { name: 'Can you make it?' })).toBeVisible({ timeout: 15_000 })
  await expect(invited.page).toHaveURL(new RegExp(`/r/${roundId}$`))
})

// Invite emails (Task 4). Test accounts are @deepspace.test, so the sends are
// real calls to email/send ($0.013 each) that never reach a person.
test('sendInvites emails each roster student once and records it per row', async ({ users }) => {
  const [ta, s1, s2] = await users(['TA One', 'Student One', 'Student Two'])
  const { roundId } = await createRound(ta.page, [s1.email, s2.email])
  expect(await act(ta.page, 'sendInvites', { roundId })).toEqual({ success: true, data: { sent: 2, failed: 0 } })
  const rows = await readAs(ta.page, 'roster', { roundId })
  expect(rows.map((r) => r.data.inviteStatus)).toEqual(['sent', 'sent'])
  // Nobody is left to email, so a second call sends nothing
  expect(await act(ta.page, 'sendInvites', { roundId })).toEqual({ success: true, data: { sent: 0, failed: 0 } })
})

test('only the organizer sends invites, never for the sample round, and only while responses are open', async ({ users }) => {
  test.setTimeout(60_000)
  const [ta, other, student] = await users(['TA One', 'TA Two', 'Student One'])
  const { roundId } = await createRound(ta.page, [student.email], 5_000)
  expect(await act(other.page, 'sendInvites', { roundId })).toEqual({ success: false, error: 'Only the TA who made this round can do that.' })
  const sample = await act<{ roundId: string }>(ta.page, 'loadSampleRound', {})
  expect(await act(ta.page, 'sendInvites', { roundId: sample.data?.roundId })).toEqual({
    success: false,
    error: 'The sample round has no real students to email.',
  })
  await ta.page.waitForTimeout(6_000)
  expect(await act(ta.page, 'sendInvites', { roundId })).toEqual({
    success: false,
    error: 'Responses are closed, so there’s nothing to invite students to.',
  })
})

// Roster edits while responses are open (Task 5)
const ROSTER_CLOSED = 'Responses are closed, so the roster can’t change.'

test('the organizer adds students while responses are open; duplicates and other TAs are refused', async ({ users }) => {
  const [ta, other, student] = await users(['TA One', 'TA Two', 'Student One'])
  const { roundId } = await createRound(ta.page, [student.email])
  expect(await act(other.page, 'addStudents', { roundId, roster: 'eli.park@example.edu' })).toEqual({
    success: false,
    error: 'Only the TA who made this round can do that.',
  })
  const shouted = student.email.toUpperCase()
  expect(await act(ta.page, 'addStudents', { roundId, roster: shouted })).toEqual({
    success: false,
    error: `Line 1, “${shouted}”, is already on the roster. Remove it.`,
  })
  expect(await act(ta.page, 'addStudents', { roundId, roster: ' \n ' })).toEqual({ success: false, error: 'Add at least one student email.' })
  expect(await act(ta.page, 'addStudents', { roundId, roster: 'Eli Park <eli.park@example.edu>' })).toEqual({ success: true, data: { added: 1 } })
  const eli = await rosterRow(ta.page, roundId, 'eli.park@example.edu')
  expect(eli.data).toMatchObject({ name: 'Eli Park', userId: '', inviteStatus: '' })
  expect(String(eli.data.inviteToken)).toMatch(/^[0-9a-f-]{36}$/)
})

test('removing a student deletes their answer; only the organizer, only before the deadline', async ({ users }) => {
  test.setTimeout(60_000)
  const [ta, other, student] = await users(['TA One', 'TA Two', 'Student One'])
  const round = await createRound(ta.page, [student.email, 'typo@exmaple.edu'], 15_000)
  const { roundId } = round
  expect((await act(student.page, 'submitResponse', { roundId, available: [round.windowIds[0]], noneWork: false, note: '' })).success).toBe(true)
  const row = await rosterRow(ta.page, roundId, student.email)

  expect(await act(other.page, 'removeStudent', { roundId, rosterId: row.recordId })).toEqual({
    success: false,
    error: 'Only the TA who made this round can do that.',
  })
  expect(await act(ta.page, 'removeStudent', { roundId, rosterId: 'not-a-row' })).toEqual({
    success: false,
    error: 'That student isn’t on this round’s roster.',
  })
  expect(await act(ta.page, 'removeStudent', { roundId, rosterId: row.recordId })).toEqual({ success: true, data: { removed: true } })
  expect((await readAs(ta.page, 'roster', { roundId })).map((r) => r.data.email)).toEqual(['typo@exmaple.edu'])
  expect(await readAs(ta.page, 'submissions', { roundId })).toEqual([])
  expect(await act(student.page, 'joinRound', { roundId })).toMatchObject({ success: true, data: { onRoster: false } })

  // Once responses close, the roster is fixed
  await ta.page.waitForTimeout(15_000)
  const typo = await rosterRow(ta.page, roundId, 'typo@exmaple.edu')
  expect(await act(ta.page, 'removeStudent', { roundId, rosterId: typo.recordId })).toEqual({ success: false, error: ROSTER_CLOSED })
  expect(await act(ta.page, 'addStudents', { roundId, roster: 'late@example.edu' })).toEqual({ success: false, error: ROSTER_CLOSED })
})

test('on the collecting screen the TA adds a student (emailed at once) and removes one', async ({ users }) => {
  test.setTimeout(90_000)
  const [ta, student] = await users(['TA One', 'Student One'])
  await ta.page.setViewportSize({ width: 1440, height: 900 })
  const { roundId } = await createRound(ta.page, [student.email])
  await ta.page.goto(`/rounds/${roundId}`)
  await expect(ta.page.getByText('1 student hasn’t been emailed yet.')).toBeVisible({ timeout: 15_000 })

  await ta.page.getByRole('button', { name: 'Add students' }).click()
  const box = ta.page.getByLabel('Add students')
  await box.fill(student.email)
  await expect(ta.page.getByText(`Line 1, “${student.email}”, is already on the roster. Remove it.`)).toBeVisible()
  await expect(ta.page.getByRole('button', { name: 'Add and email invites' })).toBeDisabled()
  await box.fill('Eli Park <eli.park@deepspace.test>')
  await expect(ta.page.getByText('1 new student')).toBeVisible()
  await expect(ta.page.getByRole('button', { name: 'Add and email invites' })).toBeEnabled()
  await shot(ta.page, 'ta-03b-add-students')
  await ta.page.getByRole('button', { name: 'Add and email invites' }).click()

  // The new row appears live, and adding also sends the invites nobody got yet
  await expect(ta.page.getByText('eli.park@deepspace.test')).toBeVisible({ timeout: 15_000 })
  await expect(ta.page.getByText('Invites emailed to all 2 students.')).toBeVisible({ timeout: 30_000 })
  await expect(ta.page.getByTestId('responded-count')).toHaveText('0 of 2 responded')

  ta.page.once('dialog', (d) => void d.accept())
  await ta.page.getByRole('button', { name: 'Remove Eli Park' }).click()
  await expect(ta.page.getByText('eli.park@deepspace.test')).toHaveCount(0, { timeout: 15_000 })
  await expect(ta.page.getByTestId('responded-count')).toHaveText('0 of 1 responded')
})
