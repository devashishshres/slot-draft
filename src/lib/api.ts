/**
 * Calls a server action (src/actions/index.ts). DeepSpace serves every action
 * at POST /api/actions/<name>. The bearer token is the signed-in user's JWT;
 * the worker verifies it and passes the user id to the action as `userId`.
 * Resolves to the action's `data`, or throws an Error whose message is the
 * action's sentence for the person ("Responses closed at 11:59 PM...").
 */
import { getAuthToken } from 'deepspace'

export async function callAction<T = unknown>(name: string, params: Record<string, unknown>): Promise<T> {
  const res = await fetch(`/api/actions/${name}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await getAuthToken()}` },
    body: JSON.stringify(params),
  })
  const body = (await res.json().catch(() => null)) as { success?: boolean; data?: T; error?: string } | null
  if (!body?.success) throw new Error(body?.error ?? 'Something went wrong. Try again in a moment.')
  return body.data as T
}
