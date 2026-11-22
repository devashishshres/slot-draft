/**
 * /rounds: the TA's home. Lists the rounds the signed-in user organizes.
 *
 * `useQuery` subscribes to the RecordRoom over the WebSocket: the list
 * updates live when a round is created or changes status. `rounds` is
 * readable by every member, so the `where` here is a filter, not the privacy
 * boundary; nothing private lives on a round.
 */
import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth, useQuery } from 'deepspace'
import { button, HeaderBand, Notice, Section, STEPS } from '@/components/slotdraft'
import { callAction } from '@/lib/api'
import { roundStatusText } from '@/lib/roundStatus'
import type { Round } from '@/schemas/slotdraft'

const STEP_TEXT: Record<(typeof STEPS)[number], string> = {
  'Set up': 'Add your time windows, paste the class list and pick a deadline.',
  Collect: 'Students say yes or no to each time and rank the ones they can make.',
  Draft: 'After the deadline, SlotDraft places as many students as it can. You can try adding seats.',
  Publish: 'Publish the schedule. Each student gets an email with their time.',
}

export default function RoundsPage() {
  const { userId } = useAuth()
  const navigate = useNavigate()
  const { records: rounds, status } = useQuery<Round>('rounds', {
    where: { organizerId: userId },
    orderBy: 'createdAt',
    orderDir: 'desc',
  })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const now = new Date()

  async function loadSample() {
    setLoading(true)
    setError('')
    try {
      const { roundId } = await callAction<{ roundId: string }>('loadSampleRound', {})
      navigate(`/rounds/${roundId}`)
    } catch (e) {
      setError((e as Error).message)
      setLoading(false)
    }
  }

  return (
    <>
      <title>Your rounds | SlotDraft</title>
      <HeaderBand title="Retire the sign-up sheet on your office door.">
        <p className="mt-4 max-w-2xl text-lg text-band-muted">
          Students tell you when they can come. SlotDraft fits as many of them as possible into your time windows, so
          nobody loses a slot for signing up late.
        </p>
        <div className="mt-8 flex flex-wrap items-center gap-3">
          <Link to="/rounds/new" className={`${button.outline} border-white`}>
            Create round
          </Link>
          <button className={button.onBand} onClick={loadSample} disabled={loading}>
            {loading ? 'Loading sample…' : 'Load sample round'}
          </button>
        </div>
        <p className="mt-3 text-band-muted">The sample is a small class you can try as the TA. Nobody gets emailed.</p>
      </HeaderBand>

      <div className="mx-auto max-w-6xl space-y-12 px-4 py-10 sm:px-6">
        {error && <Notice tone="error" title={error} />}

        <ol className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((step, i) => (
            <li key={step} className="border-t-[3px] border-foreground pt-3">
              <p className="font-extrabold">
                <span className="tabular text-primary">{i + 1}</span> {step}
              </p>
              <p className="mt-1 text-muted-foreground">{STEP_TEXT[step]}</p>
            </li>
          ))}
        </ol>

        <Section title="Your rounds">
          {status === 'loading' ? (
            <p className="text-muted-foreground">Loading your rounds…</p>
          ) : rounds.length === 0 ? (
            <p className="text-muted-foreground">No rounds yet. Your first one will show up here.</p>
          ) : (
            <ul className="divide-y divide-border border-y border-border">
              {rounds.map((r) => (
                <li key={r.recordId}>
                  <Link
                    to={`/rounds/${r.recordId}`}
                    className="flex flex-wrap items-baseline justify-between gap-2 px-1 py-4 hover:bg-accent"
                  >
                    <span className="font-semibold text-primary">
                      {r.data.title}
                      {r.data.sample && <span className="ml-2 font-normal text-subtle">(sample)</span>}
                    </span>
                    <span className="text-muted-foreground">{roundStatusText(r.data, now)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>
    </>
  )
}
