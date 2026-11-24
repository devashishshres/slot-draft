/**
 * /r/:id: the link a TA sends to students (phone layout). Screens, picked from
 * the data:
 *   not on roster  joinRound says the signed-in email isn't on the class list
 *   respond        round open, no answer yet (or "Change response")
 *   submitted      round open, answer saved
 *   closed         deadline passed, TA hasn't published
 *   scheduled / not scheduled   round published
 *
 * Privacy comes from the RecordRoom read rules, not from this page: the
 * `submissions` query returns only this student's own answer, and
 * `assignments` returns nothing until publish sets readerId to this student
 * (decision R8). So a draft seat never reaches a student's browser.
 */
import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { signOut, useAuth, useQuery, type RecordData } from 'deepspace'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { button, DateTab, Notice, Section } from '@/components/slotdraft'
import { callAction } from '@/lib/api'
import { isOpen, NOTE_MAX, validateSubmission } from '@/lib/rounds'
import { dateParts, formatClock, formatShortWhen, formatWhen, timeRange, tzAbbr, tzLabel } from '@/lib/time'
import type { Assignment, Round, Submission, TimeWindow } from '@/schemas/slotdraft'

interface Join {
  onRoster: boolean
  email: string
  organizerEmail: string
}

const minutes = (hhmm: string) => {
  const [h = 0, m = 0] = hhmm.split(':').map(Number)
  return h * 60 + m
}

export default function StudentRoundPage() {
  const { id = '' } = useParams()
  const { userId } = useAuth()
  const [join, setJoin] = useState<Join | null>(null)
  const [joinError, setJoinError] = useState('')
  const [editing, setEditing] = useState(false)
  const [late, setLate] = useState(false)
  const [, tick] = useState(0)

  const rounds = useQuery<Round>('rounds', { where: { recordId: id } })
  const windowsQ = useQuery<TimeWindow>('windows', { where: { roundId: id } })
  const mySubmission = useQuery<Submission>('submissions', { where: { roundId: id, studentId: userId } })
  const myAssignment = useQuery<Assignment>('assignments', { where: { roundId: id, studentId: userId } })

  // Opening the link checks the roster and links this account to its roster row (R9).
  useEffect(() => {
    callAction<Join>('joinRound', { roundId: id }).then(setJoin, (e: Error) => setJoinError(e.message))
  }, [id])

  // Re-check open/closed every 30s, so the form closes at the deadline.
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 30_000)
    return () => clearInterval(t)
  }, [])

  const round = rounds.records[0]
  const windows = [...windowsQ.records].sort((a, b) =>
    `${a.data.date} ${a.data.start}`.localeCompare(`${b.data.date} ${b.data.start}`),
  )
  const submission = mySubmission.records[0]
  const assignment = myAssignment.records[0]

  if (joinError) return <Page><Notice tone="error" title={joinError} /></Page>
  if (!join || rounds.status === 'loading' || !round) return <Page><p className="text-muted-foreground">Loading…</p></Page>

  const { title, timezone, deadline, status, organizerId } = round.data
  const taEmail = join.organizerEmail
  const emailTa = taEmail && (
    <a className={`${button.outline} w-full`} href={`mailto:${taEmail}?subject=${encodeURIComponent(title)}`}>
      Email your TA
    </a>
  )

  if (!join.onRoster) {
    return (
      <Page>
        <h1 className="text-[28px] font-extrabold leading-tight">You’re not on the roster for this round</h1>
        <p className="mt-3">
          You signed in as <strong className="break-all">{join.email}</strong>. Ask your TA to add this email to {title}, then open the link
          again.
        </p>
        <p className="mt-3 text-muted-foreground">If your school uses a different email for you, sign in with that one.</p>
        <div className="mt-6 space-y-3">
          <button className={`${button.primary} w-full`} onClick={() => signOut()}>
            Sign in with a different email
          </button>
          {emailTa}
          {organizerId === userId && (
            <Link to={`/rounds/${id}`} className={`${button.outline} w-full`}>
              You made this round. Open the TA view
            </Link>
          )}
        </div>
      </Page>
    )
  }

  const deadlineText = `${formatWhen(deadline, timezone)} ${tzAbbr(timezone, new Date(deadline))}`

  if (status === 'published') {
    return (
      <Page>
        <Result round={round.data} windows={windows} submission={submission} assignment={assignment} email={join.email} />
        <div className="mt-6">{emailTa}</div>
      </Page>
    )
  }

  if (!isOpen(round.data, new Date())) {
    return (
      <Page>
        {late && (
          <div className="mb-6">
            <Notice tone="error" title={`Responses closed at ${formatClock(deadline, timezone)}.`}>
              {submission
                ? 'Your change wasn’t saved. Your last response is the one your TA has.'
                : 'Your answer wasn’t saved. Email your TA if you still need a time.'}
            </Notice>
          </div>
        )}
        <h1 className="text-[28px] font-extrabold leading-tight">Your TA is building the schedule</h1>
        <p className="mt-2">We’ll email {join.email} as soon as it’s published.</p>
        <div className="mt-8">
          <Section title="Your response">
            {submission ? (
              <>
                <p className="mb-3 text-muted-foreground">Last submitted {formatShortWhen(submission.updatedAt, timezone)}</p>
                <Summary submission={submission.data} windows={windows} timezone={timezone} />
              </>
            ) : (
              <p>You didn’t answer before the deadline. Email your TA if you still need a time.</p>
            )}
          </Section>
        </div>
        <div className="mt-6">{emailTa}</div>
      </Page>
    )
  }

  if (submission && !editing) {
    return (
      <Page>
        <div className="rounded-lg border-l-4 border-success bg-success-tint px-4 py-3" role="status">
          <p className="text-[22px] font-extrabold text-success">Response submitted</p>
          <p>You can change it until {deadlineText}.</p>
        </div>
        <div className="mt-8">
          <Summary submission={submission.data} windows={windows} timezone={timezone} />
        </div>
        <button className={`${button.outline} mt-6 w-full`} onClick={() => setEditing(true)}>
          Change response
        </button>
        <p className="mt-6 text-muted-foreground">After the deadline your TA builds the schedule. We’ll email {join.email} when it’s out.</p>
      </Page>
    )
  }

  return (
    <Page>
      <ResponseForm
        roundId={id}
        round={round.data}
        windows={windows}
        existing={submission?.data}
        deadlineText={deadlineText}
        onSaved={() => setEditing(false)}
        onLate={() => {
          setLate(true)
          setEditing(false)
          tick((n) => n + 1)
        }}
      />
    </Page>
  )
}

function Page({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto max-w-md px-4 py-8">{children}</div>
}

function WindowText({ w, timezone }: { w: TimeWindow; timezone: string }) {
  const { weekday, month, day } = dateParts(w.date)
  return (
    <span>
      <span className="block font-semibold">
        {weekday}, {month} {day}
      </span>
      <span className="tabular block">
        {timeRange(w.start, w.end).text} {tzAbbr(timezone, new Date(`${w.date}T12:00:00Z`))}
      </span>
    </span>
  )
}

// ---------------------------------------------------------------------------
// Respond
// ---------------------------------------------------------------------------

function ResponseForm(props: {
  roundId: string
  round: Round
  windows: RecordData<TimeWindow>[]
  existing?: Submission
  deadlineText: string
  onSaved: () => void
  onLate: () => void
}) {
  const { round, windows, existing } = props
  // Yes windows in ranked order, and which windows got an explicit "No".
  const [ranked, setRanked] = useState<string[]>(existing?.available ?? [])
  const [noes, setNoes] = useState<string[]>(() =>
    existing ? windows.map((w) => w.recordId).filter((id) => !existing.available.includes(id)) : [],
  )
  // Boolean columns are stored as numbers (0/1), so coerce before sending them back.
  const [noneWork, setNoneWork] = useState(!!existing?.noneWork)
  const [note, setNote] = useState(existing?.note ?? '')
  const [warned, setWarned] = useState(false)
  const [showWarning, setShowWarning] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  function answer(id: string, yes: boolean) {
    setShowWarning(false)
    setRanked((r) => (yes ? (r.includes(id) ? r : [...r, id]) : r.filter((x) => x !== id)))
    setNoes((n) => (yes ? n.filter((x) => x !== id) : n.includes(id) ? n : [...n, id]))
  }

  function move(i: number, by: -1 | 1) {
    setRanked((r) => {
      const next = [...r]
      const [item] = next.splice(i, 1)
      if (item) next.splice(i + by, 0, item)
      return next
    })
  }

  function toggleNoneWork(on: boolean) {
    setNoneWork(on)
    setShowWarning(false)
    if (on) {
      setNoes(windows.map((w) => w.recordId))
      setRanked([])
    }
  }

  async function submit() {
    setError('')
    const answerData = { available: ranked, noneWork, note: noneWork ? note.trim() : '' }
    const problem = validateSubmission(answerData, windows.map((w) => w.recordId))
    if (problem) return setError(problem)
    // One-time warning: shown once, the next press submits anyway (P3).
    if (ranked.length === 1 && windows.length > 1 && !warned) {
      setWarned(true)
      setShowWarning(true)
      return
    }
    setSaving(true)
    try {
      await callAction('submitResponse', { roundId: props.roundId, ...answerData })
      props.onSaved()
    } catch (e) {
      setSaving(false)
      if (!isOpen(round, new Date())) return props.onLate()
      setError((e as Error).message)
    }
  }

  const labelOf = (id: string) => {
    const w = windows.find((x) => x.recordId === id)
    return w ? `${dateParts(w.data.date).short}, ${timeRange(w.data.start, w.data.end).text}` : ''
  }

  return (
    <>
      <h1 className="text-[28px] font-extrabold leading-tight">{round.title}</h1>
      <p className="mt-2">Answer by {props.deadlineText}. Only say yes if you can stay for the whole time.</p>

      {!noneWork && (
        <div className="mt-8">
          <Section title="Can you make it?">
            <ul className="space-y-4">
              {windows.map((w) => {
                const yes = ranked.includes(w.recordId)
                const no = noes.includes(w.recordId)
                return (
                  <li key={w.recordId}>
                    <fieldset className="flex items-center gap-3">
                      <legend className="sr-only">{labelOf(w.recordId)}</legend>
                      <DateTab date={w.data.date} muted={no} />
                      <div className="min-w-0 flex-1">
                        <WindowText w={w.data} timezone={round.timezone} />
                      </div>
                      <div className="flex shrink-0 overflow-hidden rounded-lg border border-input">
                        <label className={`flex min-h-11 min-w-14 cursor-pointer items-center justify-center px-3 font-semibold has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-primary ${yes ? 'bg-success text-white' : ''}`}>
                          <input type="radio" className="sr-only" name={w.recordId} checked={yes} onChange={() => answer(w.recordId, true)} />
                          Yes
                        </label>
                        <label className={`flex min-h-11 min-w-14 cursor-pointer items-center justify-center border-l border-input px-3 font-semibold has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-primary ${no ? 'bg-subtle text-white' : ''}`}>
                          <input type="radio" className="sr-only" name={w.recordId} checked={no} onChange={() => answer(w.recordId, false)} />
                          No
                        </label>
                      </div>
                    </fieldset>
                  </li>
                )
              })}
            </ul>
          </Section>
        </div>
      )}

      {!noneWork && ranked.length > 1 && (
        <div className="mt-8">
          <Section title="Rank your times">
            {/* The two ends say which way the ranking runs, without a paragraph (D29). */}
            <p className="mb-2 text-sm font-semibold text-muted-foreground">Most preferred</p>
            <ol className="space-y-2">
              {ranked.map((id, i) => (
                <li key={id} className="flex items-center gap-3 rounded-lg border border-border px-3 py-2">
                  <span className="tabular w-6 text-[22px] font-extrabold text-primary">{i + 1}</span>
                  <span className="min-w-0 flex-1 truncate">{labelOf(id)}</span>
                  <button className={`${button.outline} w-11 px-0`} aria-label={`Move ${labelOf(id)} up`} disabled={i === 0} onClick={() => move(i, -1)}>
                    <ChevronUp aria-hidden />
                  </button>
                  <button
                    className={`${button.outline} w-11 px-0`}
                    aria-label={`Move ${labelOf(id)} down`}
                    disabled={i === ranked.length - 1}
                    onClick={() => move(i, 1)}
                  >
                    <ChevronDown aria-hidden />
                  </button>
                </li>
              ))}
            </ol>
            <p className="mt-2 text-sm font-semibold text-muted-foreground">Least preferred</p>
          </Section>
        </div>
      )}

      <label className="mt-8 flex min-h-11 cursor-pointer items-center gap-3">
        <input type="checkbox" className="h-5 w-5 accent-primary" checked={noneWork} onChange={(e) => toggleNoneWork(e.target.checked)} />
        <span className="font-semibold">None of these times work for me</span>
      </label>

      {noneWork && (
        <div className="mt-4">
          <label htmlFor="note" className="block text-lg font-extrabold">
            Tell your TA when you could come
          </label>
          <p className="text-muted-foreground">Your TA sees this next to the schedule. Classmates don’t.</p>
          <textarea
            id="note"
            rows={5}
            maxLength={NOTE_MAX}
            className="mt-2 w-full rounded-lg border border-input p-3 text-base"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <p className="tabular text-sm text-muted-foreground">
            {note.length} of {NOTE_MAX} characters
          </p>
        </div>
      )}

      {showWarning && (
        <div className="mt-6">
          <Notice tone="attention" title="You picked only one time.">
            If this time fills, you may not be scheduled. Say yes to any other time you could make.
          </Notice>
        </div>
      )}
      {error && (
        <div className="mt-6">
          <Notice tone="error" title={error} />
        </div>
      )}

      <button className={`${button.success} mt-6 w-full`} onClick={submit} disabled={saving}>
        {saving ? 'Submitting…' : 'Submit response'}
      </button>
      <p className="mt-4 text-muted-foreground">
        {noneWork
          ? 'You won’t be put in a time automatically. Your TA will get in touch about another option.'
          : 'You can change this until the deadline. Answering early doesn’t give you priority. Only your TA sees your answers.'}
      </p>
    </>
  )
}

/** What the student answered, in their order. */
function Summary({ submission, windows, timezone }: { submission: Submission; windows: RecordData<TimeWindow>[]; timezone: string }) {
  if (submission.noneWork) {
    return (
      <>
        <p className="font-semibold">You said none of the times work.</p>
        {submission.note && <p className="mt-2 whitespace-pre-line rounded-lg bg-muted p-3">{submission.note}</p>}
      </>
    )
  }
  const noCount = windows.length - submission.available.length
  return (
    <>
      <h2 className="text-lg font-extrabold">Times you can make, in your order</h2>
      <ol className="mt-3 space-y-3">
        {submission.available.map((id, i) => {
          const w = windows.find((x) => x.recordId === id)
          return (
            w && (
              <li key={id} className="flex items-center gap-3">
                <span className="tabular w-6 text-[22px] font-extrabold text-primary">{i + 1}</span>
                <DateTab date={w.data.date} />
                <WindowText w={w.data} timezone={timezone} />
              </li>
            )
          )
        })}
      </ol>
      {noCount > 0 && (
        <p className="mt-3 text-muted-foreground">
          You said no to the other {noCount} {noCount === 1 ? 'time' : 'times'}.
        </p>
      )}
    </>
  )
}

// ---------------------------------------------------------------------------
// Result (published)
// ---------------------------------------------------------------------------

function Result(props: {
  round: Round
  windows: RecordData<TimeWindow>[]
  submission?: RecordData<Submission>
  assignment?: RecordData<Assignment>
  email: string
}) {
  const { round, windows, submission, assignment, email } = props
  const w = windows.find((x) => x.recordId === assignment?.data.windowId)?.data
  const published = `Published ${formatShortWhen(round.publishedAt, round.timezone)} ${tzAbbr(round.timezone, new Date(round.publishedAt))}.`

  if (w && assignment) {
    const length = minutes(w.end) - minutes(w.start)
    const others = assignment.data.groupSize - 1
    const { weekday, month, day } = dateParts(w.date)
    return (
      <>
        <h1 className="text-[28px] font-extrabold leading-tight">You’re scheduled</h1>
        <div className="mt-4 flex gap-4 rounded-lg border-2 border-success bg-success-tint p-4" data-testid="scheduled-card">
          <DateTab date={w.date} />
          <div>
            <p className="font-semibold">
              {weekday}, {month} {day}
            </p>
            <p className="tabular text-[28px] font-extrabold leading-tight">{timeRange(w.start, w.end).text}</p>
            <p className="text-muted-foreground">{tzLabel(round.timezone, new Date(`${w.date}T12:00:00Z`))}</p>
          </div>
        </div>
        <p className="mt-4">
          Stay for {length === 60 ? 'the whole hour' : `all ${length} minutes`}.
          {others > 0 ? ` It’s a group session with ${others} other ${others === 1 ? 'student' : 'students'}.` : ''}
        </p>
        <p className="mt-3">Can’t make it anymore? Email your TA as soon as you can. The schedule is final, so changes go through them.</p>
        <p className="mt-3 text-muted-foreground">
          {published}
          {assignment.data.emailStatus === 'sent' ? ` We also emailed this to ${email}.` : ''}
        </p>
      </>
    )
  }

  const [heading, body] = !submission
    ? ['You didn’t answer before the deadline', 'Email your TA to find a time.']
    : submission.data.noneWork
      ? ['Your TA has your note', 'You said none of the times work. Your TA will get in touch about another time.']
      : ['Your times filled up', 'The times you could make were full. Your TA will get in touch about another time.']

  return (
    <>
      <h1 className="text-[28px] font-extrabold leading-tight">You’re not scheduled yet</h1>
      <div className="mt-4 rounded-lg border-2 border-dashed border-input p-4" data-testid="not-scheduled-card">
        <p className="text-lg font-extrabold">{heading}</p>
        <p className="mt-1">{body}</p>
      </div>
      {!!submission?.data.noneWork && submission.data.note && (
        <div className="mt-6">
          <Section title="What you told your TA">
            <p className="whitespace-pre-line">{submission.data.note}</p>
          </Section>
        </div>
      )}
      <p className="mt-4 text-muted-foreground">{published}</p>
    </>
  )
}
