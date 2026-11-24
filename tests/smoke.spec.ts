import { test, expect } from '@playwright/test'
import { captureConsoleErrors } from './helpers/errors'
import { shot } from './helpers/slotdraft'

/**
 * Smoke tests covering both page kinds this template ships:
 *   - '/'      → the static landing (top level of src/pages/): no providers,
 *                so no auth fetch and no records WebSocket on load.
 *   - '/rounds' → a dynamic, sign-in-gated page (under src/pages/(app)/(protected)/):
 *                the providers mount, the nav shell renders, and the records WebSocket connects.
 *
 * The "static contract" test is the guardrail for the per-page opt-out: if
 * someone moves the providers back up into _app.tsx, it fails.
 */

/** Wait for the React app shell (present on every page). */
async function waitForApp(page: import('@playwright/test').Page) {
  await page.waitForSelector('[data-testid="app-root"]', { timeout: 15000 })
}

test.describe('Smoke tests', () => {
  test('static landing loads without JS errors', async ({ page }) => {
    const errors = captureConsoleErrors(page)
    await page.goto('/')
    await waitForApp(page)
    await expect(page.getByTestId('static-landing')).toBeVisible()
    expect(errors).toEqual([])
  })

  test('landing carries one title, one description, one canonical', async ({ page }) => {
    // <Seo> (src/pages/index.tsx, values from src/seo.ts) hoists these into
    // <head>. Exactly one of each: index.html ships no static description or
    // canonical, because React 19 would not dedupe against them on mount.
    await page.goto('/')
    await expect(page.getByTestId('static-landing')).toBeVisible()
    await expect(page).toHaveTitle(/\S/)
    expect(await page.locator('head meta[name="description"]').count()).toBe(1)
    expect(await page.locator('head link[rel="canonical"]').count()).toBe(1)
  })

  test('static contract: landing fires no auth request, opens no websocket', async ({ page }) => {
    const offenders: string[] = []
    page.on('request', (req) => {
      if (req.url().includes('/api/auth/')) offenders.push(req.url())
    })
    // Only the DO room route counts — vite's own HMR socket is a dev artifact.
    page.on('websocket', (ws) => {
      if (new URL(ws.url()).pathname.startsWith('/ws/')) offenders.push(`ws: ${ws.url()}`)
    })
    await page.goto('/')
    await expect(page.getByTestId('static-landing')).toBeVisible()
    await page.waitForTimeout(1500)
    expect(offenders).toEqual([])
  })

  test('dynamic app boundary mounts on /rounds', async ({ page }) => {
    await page.goto('/rounds')
    await expect(page.getByTestId('app-navigation')).toBeVisible({ timeout: 15000 })
  })

  test('signed out: the rounds page and a student link ask to sign in', async ({ page }) => {
    await page.goto('/rounds')
    await expect(page.getByTestId('nav-sign-in-button')).toBeVisible({ timeout: 15000 })
    await expect(page.getByRole('heading', { name: 'Sign in to SlotDraft' })).toBeVisible()
    await expect(page.getByTestId('nav-user-name')).toHaveCount(0)
    await page.goto('/r/some-round')
    await expect(page.getByRole('heading', { name: 'Sign in to answer' })).toBeVisible({ timeout: 15000 })
    await expect(page.getByText('Use the Google or GitHub account with the email your TA has for you.')).toBeVisible()
    await page.goto('/r/some-round?invite=abc')
    await expect(page.getByText('No password needed. Any Google or GitHub account works with your invite link.')).toBeVisible({ timeout: 15000 })
  })

  // Real users can't create an email account on DeepSpace (public email sign-up
  // is closed), so the card offers only Google and GitHub (decision D28).
  test('the sign-in card offers Google and GitHub, and no email option', async ({ page }) => {
    await page.goto('/rounds')
    await page.getByTestId('nav-sign-in-button').click()
    const card = page.getByTestId('auth-overlay')
    await expect(card.getByRole('heading', { name: 'Sign in to SlotDraft' })).toBeVisible({ timeout: 15000 })
    await expect(card.getByRole('button', { name: 'Continue with Google' })).toBeVisible()
    await expect(card.getByRole('button', { name: 'Continue with GitHub' })).toBeVisible()
    await expect(card.getByText('Sign in with email')).toBeHidden()
    await expect(card.getByText('or', { exact: true })).toBeHidden()
    if (process.env.SLOTDRAFT_SHOTS) await page.waitForTimeout(800) // let the card fade in
    await shot(page, 'sign-in-card')
  })

  test('unknown route shows the not-found page', async ({ page }) => {
    await page.goto('/nonexistent-page-xyz')
    await waitForApp(page)
    await expect(page.getByRole('heading', { name: 'This page doesn’t exist' })).toBeVisible()
  })
})
