/**
 * Test helpers that talk to the server AS a signed-in user, from inside that
 * user's browser page (so the session cookie and origin are real).
 *
 * - `act` calls a server action, the same way src/lib/api.ts does.
 * - `readAs` reads records through the SDK's agent record tool. It runs as
 *   the caller with the RecordRoom's read rules ON, so it shows exactly what
 *   that user's browser could receive. This is how the privacy tests check
 *   the server, not just what the UI chooses to render.
 */
import type { Page } from '@playwright/test'

export interface ActionBody<T = Record<string, unknown>> {
  success: boolean
  data?: T
  error?: string
}

async function ensureOnApp(page: Page) {
  if (!page.url().startsWith('http')) await page.goto('/rounds')
}

export async function act<T = Record<string, unknown>>(page: Page, name: string, params: Record<string, unknown>): Promise<ActionBody<T>> {
  await ensureOnApp(page)
  return page.evaluate(
    async ({ name, params }) => {
      const tokenRes = await fetch('/api/auth/token', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' } })
      const { token } = (await tokenRes.json()) as { token: string }
      const res = await fetch(`/api/actions/${name}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(params),
      })
      return res.json()
    },
    { name, params },
  )
}

/** Calls one SDK record tool as this user. Returns the raw tool response. */
export async function recordTool(page: Page, tool: string, input: Record<string, unknown>): Promise<{ ok: boolean; result?: unknown; error?: unknown }> {
  await ensureOnApp(page)
  return page.evaluate(
    async ({ tool, input }) => {
      const tokenRes = await fetch('/api/auth/token', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' } })
      const { token } = (await tokenRes.json()) as { token: string }
      const res = await fetch(`/_deepspace/agent/browser/tools/${tool}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ input }),
      })
      return res.json()
    },
    { tool, input },
  )
}

/** The records of `collection` matching `where` that this user may read. */
export async function readAs(page: Page, collection: string, where: Record<string, unknown>): Promise<Array<{ recordId: string; data: Record<string, unknown> }>> {
  const res = await recordTool(page, 'records_query', { collection, where })
  if (!res.ok) throw new Error(`records_query failed: ${JSON.stringify(res)}`)
  const result = res.result as { success?: boolean; data?: { records?: Array<{ recordId: string; data: Record<string, unknown> }> }; error?: string }
  if (!result.success) throw new Error(`records_query refused: ${result.error}`)
  return result.data?.records ?? []
}

/** A round owned by `ta`, closing `closesInMs` from now, with these emails on the roster. */
export async function createRound(ta: Page, emails: string[], closesInMs = 60 * 60 * 1000) {
  const title = `__test-${Date.now()}__`
  const res = await act<{ roundId: string }>(ta, 'createRound', {
    title,
    timezone: 'America/Phoenix',
    deadline: new Date(Date.now() + closesInMs).toISOString(),
    windows: [
      { date: '2026-12-07', start: '10:00', end: '10:20', capacity: 1 },
      { date: '2026-12-08', start: '14:00', end: '15:00', capacity: 1 },
    ],
    roster: emails.join('\n'),
  })
  if (!res.success || !res.data) throw new Error(`createRound failed: ${res.error}`)
  const windows = await readAs(ta, 'windows', { roundId: res.data.roundId })
  const ids = windows
    .sort((a, b) => String(a.data.date).localeCompare(String(b.data.date)))
    .map((w) => w.recordId)
  return { roundId: res.data.roundId, title, windowIds: ids }
}

/** Saves a full-page screenshot when SLOTDRAFT_SHOTS=/some/dir is set; does nothing otherwise. */
export async function shot(page: Page, name: string) {
  const dir = process.env.SLOTDRAFT_SHOTS
  if (dir) await page.screenshot({ path: `${dir}/${name}.png`, fullPage: true })
}
