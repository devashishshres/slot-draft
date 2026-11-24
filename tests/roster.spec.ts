/**
 * Personal invite links (decision R19). Each roster row has a secret token;
 * its link lets ANY Google/GitHub account answer as that student, because
 * DeepSpace has no email sign-up. The first account to use a link owns it.
 */
import { test, expect, loadAllTestAccounts } from 'deepspace/testing'
import { act, createRound, readAs } from './helpers/slotdraft'

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
