/**
 * UI states (CLAUDE.md §8.1 "every state in the 14 screens is reachable").
 * TA screens at 1440px, student screens at 390px.
 *
 * Set SLOTDRAFT_SHOTS=/some/dir to also save a full-page screenshot of each state.
 */
import { test, expect, loadAllTestAccounts } from 'deepspace/testing'
import { act, createRound, shot } from './helpers/slotdraft'

test.skip(loadAllTestAccounts().length < 4, 'Needs the 4 test accounts: TA One, TA Two, Student One, Student Two')

const TA = { width: 1440, height: 900 }
const PHONE = { width: 390, height: 844 }

test('set up a round in the form, then every student screen before the deadline', async ({ users }) => {
  test.setTimeout(120_000)
  const [ta, student, outsider] = await users(['TA One', 'Student One', 'Student Two'])
  await ta.page.setViewportSize(TA)
  await student.page.setViewportSize(PHONE)
  await outsider.page.setViewportSize(PHONE)

  // Screen 1: rounds list
  await ta.page.goto('/rounds')
  await expect(ta.page.getByRole('heading', { name: 'Retire the sign-up sheet on your office door.' })).toBeVisible({ timeout: 15_000 })
  await shot(ta.page, 'ta-01-rounds')

  // Screen 2: create round, with a roster error first
  await ta.page.getByRole('link', { name: 'Create round' }).click()
  await ta.page.getByLabel('Round name').fill(`__test-ui-${Date.now()}__`)
  await ta.page.getByLabel('Window 1 date').fill('2026-12-07')
  await ta.page.getByLabel('Window 1 starts').fill('10:00')
  await ta.page.getByLabel('Window 1 ends').fill('10:20')
  await ta.page.getByRole('button', { name: 'Add window' }).click()
  await ta.page.getByLabel('Window 2 date').fill('2026-12-08')
  await ta.page.getByLabel('Window 2 starts').fill('14:00')
  await ta.page.getByLabel('Window 2 ends').fill('15:00')
  await ta.page.getByLabel('Deadline date').fill('2026-12-01')
  await ta.page.getByLabel('Paste one email per line. A Canvas export works.').fill(`${student.email}\nnobody@deepspace.test\ndana`)
  await expect(ta.page.getByText('Line 3, “dana”, isn’t an email address. Fix it or remove it.')).toBeVisible()
  await expect(ta.page.getByRole('button', { name: 'Open round and email students' })).toBeDisabled()
  await expect(ta.page.getByText('Fix the roster to continue.')).toBeVisible()
  await shot(ta.page, 'ta-02-create-error')

  await ta.page.getByLabel('Paste one email per line. A Canvas export works.').fill(`${student.email}\nnobody@deepspace.test`)
  await expect(ta.page.getByText('2 students added')).toBeVisible()
  await expect(ta.page.getByText('2 seats, 2 students')).toBeVisible()
  await ta.page.getByRole('button', { name: 'Open round and email students' }).click()
  await expect(ta.page.getByTestId('responded-count')).toHaveText('0 of 2 responded', { timeout: 15_000 })
  const roundId = ta.page.url().split('/rounds/')[1] ?? ''
  // Opening the round emails both students; each row turns to Sent without a refresh (P9)
  await expect(ta.page.getByText('Invites emailed to all 2 students.')).toBeVisible({ timeout: 30_000 })
  await expect(ta.page.getByTestId('invite-status')).toHaveText(['Sent', 'Sent'])
  await shot(ta.page, 'ta-03a-invites-sent')

  // Screen 7: not on the roster
  await outsider.page.goto(`/r/${roundId}`)
  await expect(outsider.page.getByRole('heading', { name: 'You’re not on the roster for this round' })).toBeVisible({ timeout: 15_000 })
  await shot(outsider.page, 'st-07-not-on-roster')

  // Screens 8 and 9: respond, and the one-time warning for a single Yes
  await student.page.goto(`/r/${roundId}`)
  await expect(student.page.getByRole('heading', { name: 'Can you make it?' })).toBeVisible({ timeout: 15_000 })
  await student.page.getByText('Yes', { exact: true }).first().click()
  // Two Yes answers: the ranking says which end is the first choice
  await student.page.getByText('Yes', { exact: true }).nth(1).click()
  await expect(student.page.getByRole('heading', { name: 'Rank your times' })).toBeVisible()
  await expect(student.page.getByText('Most preferred', { exact: true })).toBeVisible()
  await expect(student.page.getByText('Least preferred', { exact: true })).toBeVisible()
  await shot(student.page, 'st-08b-rank')
  await student.page.getByText('No', { exact: true }).nth(1).click()
  await expect(student.page.getByRole('heading', { name: 'Rank your times' })).toHaveCount(0)
  await shot(student.page, 'st-08-respond')
  await student.page.getByRole('button', { name: 'Submit response' }).click()
  await expect(student.page.getByText('You picked only one time.')).toBeVisible()
  await shot(student.page, 'st-09-one-time')

  // Screen 11: submitted (the second press goes through)
  await student.page.getByRole('button', { name: 'Submit response' }).click()
  await expect(student.page.getByText('Response submitted')).toBeVisible({ timeout: 15_000 })
  await expect(student.page.getByText('You said no to the other 1 time.')).toBeVisible()
  await shot(student.page, 'st-11-submitted')

  // Screen 10: change to "none of these times work" with a note
  await student.page.getByRole('button', { name: 'Change response' }).click()
  await student.page.getByText('None of these times work for me').click()
  await student.page.getByLabel('Tell your TA when you could come').fill('I could come Thursday after 3 PM.')
  await expect(student.page.getByText('33 of 500 characters')).toBeVisible()
  await shot(student.page, 'st-10-none-work')
  await student.page.getByRole('button', { name: 'Submit response' }).click()
  await expect(student.page.getByText('You said none of the times work.')).toBeVisible({ timeout: 15_000 })

  // Screen 3: the TA's tracker shows the note
  await expect(ta.page.getByText('None of the times work', { exact: true })).toBeVisible({ timeout: 15_000 })
  await expect(ta.page.getByText('I could come Thursday after 3 PM.')).toBeVisible()
  await expect(ta.page.getByTestId('responded-count')).toHaveText('1 of 2 responded')
  await shot(ta.page, 'ta-03-collecting')
})

test('closed screen: a late change is refused and the student sees the closed screen', async ({ users }) => {
  test.setTimeout(60_000)
  const [ta, student] = await users(['TA One', 'Student One'])
  await student.page.setViewportSize(PHONE)
  const round = await createRound(ta.page, [student.email], 12_000)
  await act(student.page, 'submitResponse', { roundId: round.roundId, available: [round.windowIds[0]], noneWork: false, note: '' })

  await student.page.goto(`/r/${round.roundId}`)
  await student.page.getByRole('button', { name: 'Change response' }).click()
  await student.page.getByText('Yes', { exact: true }).nth(1).click()
  await student.page.waitForTimeout(13_000) // the deadline passes while the form is open
  await student.page.getByRole('button', { name: 'Submit response' }).click()
  await expect(student.page.getByText(/^Responses closed at \d{1,2}:\d{2} [AP]M\.$/)).toBeVisible({ timeout: 15_000 })
  await expect(student.page.getByText('Your change wasn’t saved. Your last response is the one your TA has.')).toBeVisible()
  await expect(student.page.getByRole('heading', { name: 'Your TA is building the schedule' })).toBeVisible()
  // The answer the TA has is still the early one: only the first window.
  await expect(student.page.getByText('You said no to the other 1 time.')).toBeVisible()
  await shot(student.page, 'st-12-closed-late')
})

test('screens 4 to 6: the sample round from draft to publish', async ({ users }) => {
  test.setTimeout(90_000)
  const [ta] = await users(['TA One'])
  await ta.page.setViewportSize(TA)
  await ta.page.goto('/rounds')
  await ta.page.getByRole('button', { name: 'Load sample round' }).click()
  await expect(ta.page.getByTestId('responded-count')).toHaveText('6 of 7 responded', { timeout: 15_000 })
  await ta.page.getByRole('button', { name: 'Generate draft' }).click()

  // Screen 4: draft. 4 of 6, and only Friday's extra seat helps (D11)
  await expect(ta.page.getByTestId('placed-count')).toHaveText('4 of 6 placed', { timeout: 15_000 })
  await expect(ta.page.getByText('+1 seat: 5 of 6 placed')).toHaveCount(1, { timeout: 15_000 })
  await expect(ta.page.getByText('+1 seat: no change')).toHaveCount(3)
  await shot(ta.page, 'ta-04-draft')

  // Screen 5: preview, then apply
  await ta.page.getByRole('button', { name: 'Preview this seat' }).click()
  await expect(ta.page.getByText('Cara Diaz gets placed. Nobody else moves.')).toBeVisible()
  // The band with Apply / Cancel scrolls into view, even though the button pressed was low on the page.
  await expect(ta.page.getByRole('button', { name: 'Apply this seat' })).toBeInViewport()
  await expect(ta.page.getByRole('button', { name: 'Publish this draft' })).toBeDisabled()
  await shot(ta.page, 'ta-05-preview')
  await ta.page.getByRole('button', { name: 'Apply this seat' }).click()
  await expect(ta.page.getByTestId('placed-count')).toHaveText('5 of 6 placed', { timeout: 15_000 })

  // Screen 6: published, no emails for the sample
  await ta.page.getByRole('button', { name: 'Publish this draft' }).click()
  await expect(ta.page.getByTestId('published-banner')).toHaveText('Published. 5 students have a time.', { timeout: 15_000 })
  await expect(ta.page.getByText('This is the sample round, so no emails were sent.')).toBeVisible()
  await shot(ta.page, 'ta-06-published')
})
