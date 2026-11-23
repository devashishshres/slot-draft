/**
 * Multi-user end-to-end (CLAUDE.md §8.1): separate accounts in separate
 * browser contexts, via the deepspace/testing `users()` fixture.
 */
import { test, expect, loadAllTestAccounts } from 'deepspace/testing'
import { act, createRound, readAs, shot } from './helpers/slotdraft'

test.skip(loadAllTestAccounts().length < 4, 'Needs the 4 test accounts: TA One, TA Two, Student One, Student Two')

test('a student submits and the TA sees it without a refresh', async ({ users }) => {
  const [ta, student] = await users(['TA One', 'Student One'])
  const round = await createRound(ta.page, [student.email, 'nobody@example.edu'])

  await ta.page.goto(`/rounds/${round.roundId}`)
  await expect(ta.page.getByTestId('responded-count')).toHaveText('0 of 2 responded', { timeout: 15_000 })

  await student.page.goto(`/r/${round.roundId}`)
  // The radios are visually hidden inside their labels, so click the label text.
  await student.page.getByText('Yes', { exact: true }).first().click()
  await student.page.getByText('Yes', { exact: true }).nth(1).click()
  await student.page.getByRole('button', { name: 'Submit response' }).click()
  await expect(student.page.getByText('Response submitted')).toBeVisible({ timeout: 15_000 })

  // No reload on the TA side: the live useQuery subscription delivers it.
  await expect(ta.page.getByTestId('responded-count')).toHaveText('1 of 2 responded', { timeout: 15_000 })
  await expect(ta.page.getByText('2 of 2')).toBeVisible()
})

test('only the student and their round’s TA can read a submission', async ({ users }) => {
  const [ta, otherTa, student, otherStudent] = await users(['TA One', 'TA Two', 'Student One', 'Student Two'])
  const round = await createRound(ta.page, [student.email, otherStudent.email])
  const saved = await act(student.page, 'submitResponse', { roundId: round.roundId, available: [round.windowIds[1]], noneWork: false, note: '' })
  expect(saved.success).toBe(true)

  expect(await readAs(ta.page, 'submissions', { roundId: round.roundId })).toHaveLength(1)
  expect(await readAs(student.page, 'submissions', { roundId: round.roundId })).toHaveLength(1)
  expect(await readAs(otherStudent.page, 'submissions', { roundId: round.roundId })).toHaveLength(0)
  expect(await readAs(otherTa.page, 'submissions', { roundId: round.roundId })).toHaveLength(0)
  // The class list is the organizer's alone.
  expect(await readAs(otherTa.page, 'roster', { roundId: round.roundId })).toHaveLength(0)
  expect(await readAs(student.page, 'roster', { roundId: round.roundId })).toHaveLength(0)
  expect(await readAs(ta.page, 'roster', { roundId: round.roundId })).toHaveLength(2)
})

test('the draft is hidden from students until publish, then each sees only their own result', async ({ users }) => {
  test.setTimeout(90_000)
  const [ta, student, otherStudent] = await users(['TA One', 'Student One', 'Student Two'])
  const round = await createRound(ta.page, [student.email, otherStudent.email], 8_000)
  await act(student.page, 'submitResponse', { roundId: round.roundId, available: [round.windowIds[0]], noneWork: false, note: '' })
  await act(otherStudent.page, 'submitResponse', { roundId: round.roundId, available: [], noneWork: true, note: 'Thursdays after 3' })
  await ta.page.waitForTimeout(9_000)

  const draft = await act(ta.page, 'generateDraft', { roundId: round.roundId })
  expect(draft).toEqual({ success: true, data: { placed: 1, responded: 2 } })
  expect(await readAs(ta.page, 'assignments', { roundId: round.roundId })).toHaveLength(2)
  expect(await readAs(student.page, 'assignments', { roundId: round.roundId })).toHaveLength(0) // R8

  const published = await act(ta.page, 'publish', { roundId: round.roundId })
  expect(published.success).toBe(true)
  const mine = await readAs(student.page, 'assignments', { roundId: round.roundId })
  expect(mine).toHaveLength(1)
  expect(mine[0]?.data.windowId).toBe(round.windowIds[0])

  await student.page.setViewportSize({ width: 390, height: 844 })
  await otherStudent.page.setViewportSize({ width: 390, height: 844 })
  await student.page.goto(`/r/${round.roundId}`)
  await expect(student.page.getByText('You’re scheduled')).toBeVisible({ timeout: 15_000 })
  await expect(student.page.getByTestId('scheduled-card')).toContainText('Monday, Dec 7')
  await otherStudent.page.goto(`/r/${round.roundId}`)
  await expect(otherStudent.page.getByText('You’re not scheduled yet')).toBeVisible({ timeout: 15_000 })
  await expect(otherStudent.page.getByTestId('not-scheduled-card')).toContainText('Your TA has your note')
  await shot(student.page, 'st-13-scheduled')
  await shot(otherStudent.page, 'st-14-not-scheduled')

  const again = await act(ta.page, 'publish', { roundId: round.roundId })
  expect(again).toEqual({ success: false, error: 'This round is published and can’t change.' })
})
