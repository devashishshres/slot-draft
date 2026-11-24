/**
 * /rounds/:id: the TA's view of one round. Which screen shows depends on the
 * data, not on the URL:
 *   collecting  status open (or closed, no draft yet): live roster tracker
 *   draft       a draft exists: seating chart with a "+1 seat" result per window
 *   preview     local state on top of the draft: what one more seat would change
 *   published   final schedule and the email report
 *
 * All five collections are read with `useQuery`. Each is a live WebSocket
 * subscription to the RecordRoom, and the room only sends records this user
 * may read (roster: 'own' via organizerId; submissions and assignments:
 * 'collaborator' via `organizers`). That is why a new response shows up here
 * without a refresh. Every change goes through `callAction`.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { useAuth, useQuery, type RecordData } from 'deepspace'
import { button, DateTab, HeaderBand, listNames, Notice, SeatStrip, Section } from '@/components/slotdraft'
import type { SeatPreview } from '@/lib/allocator'
import { callAction } from '@/lib/api'
import { isOpen, parseRoster } from '@/lib/rounds'
import { dateParts, formatShortWhen, formatWhen, timeRange, tzAbbr } from '@/lib/time'
import type { Assignment, Round, RosterRow, Submission, TimeWindow } from '@/schemas/slotdraft'

type Rec<T> = RecordData<T>

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

const ORDINAL = { one: 'st', two: 'nd', few: 'rd', other: 'th', zero: 'th', many: 'th' } as const
const ordinalRule = new Intl.PluralRules('en-US', { type: 'ordinal' })
const ordinal = (n: number) => `${n}${ORDINAL[ordinalRule.select(n)]}`
const firstName = (name: string) => name.split(' ')[0] ?? name
const mailto = (email: string, subject: string) => `mailto:${email}?subject=${encodeURIComponent(subject)}`

/** Re-renders every `ms`, so the screen moves from collecting to "closed" at the deadline. */
function useNow(ms: number): Date {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), ms)
    return () => clearInterval(t)
  }, [ms])
  return now
}

function windowLabel(w: TimeWindow, timezone: string) {
  const day = dateParts(w.date)
  const time = timeRange(w.start, w.end)
  return { ...day, time, abbr: tzAbbr(timezone, new Date(`${w.date}T12:00:00Z`)), text: `${day.short}, ${time.text}` }
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function RoundPage() {
  const { id = '' } = useParams()
  const { userId } = useAuth()
  const now = useNow(30_000)

  const rounds = useQuery<Round>('rounds', { where: { recordId: id } })
  const windowsQ = useQuery<TimeWindow>('windows', { where: { roundId: id } })
  const rosterQ = useQuery<RosterRow>('roster', { where: { roundId: id } })
  const submissionsQ = useQuery<Submission>('submissions', { where: { roundId: id } })
  const assignmentsQ = useQuery<Assignment>('assignments', { where: { roundId: id } })

  const round = rounds.records[0]
  const windows = useMemo(
    () => [...windowsQ.records].sort((a, b) => `${a.data.date} ${a.data.start}`.localeCompare(`${b.data.date} ${b.data.start}`)),
    [windowsQ.records],
  )

  if (rounds.status === 'loading') return <p className="mx-auto max-w-6xl px-6 py-10 text-muted-foreground">Loading round…</p>
  if (!round) return <Missing text="That round doesn’t exist. Check the link." />
  if (round.data.organizerId !== userId) {
    return <Missing text="Only the TA who made this round can see it. If you’re a student, open the link your TA sent you." />
  }

  const view = {
    round,
    windows,
    roster: rosterQ.records,
    submissions: submissionsQ.records,
    assignments: assignmentsQ.records,
  }
  if (round.data.status === 'published') return <Published {...view} />
  if (round.data.draftAt) return <Draft {...view} />
  return <Collecting {...view} open={isOpen(round.data, now)} />
}

interface ViewProps {
  round: Rec<Round>
  windows: Rec<TimeWindow>[]
  roster: Rec<RosterRow>[]
  submissions: Rec<Submission>[]
  assignments: Rec<Assignment>[]
}

function Missing({ text }: { text: string }) {
  return (
    <div className="mx-auto max-w-xl px-4 py-16">
      <p className="text-lg">{text}</p>
      <Link to="/rounds" className={`${button.outline} mt-6`}>
        Go to your rounds
      </Link>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Collecting
// ---------------------------------------------------------------------------

function Collecting({ round, windows, roster, submissions, open }: ViewProps & { open: boolean }) {
  const [copied, setCopied] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [sending, setSending] = useState(false)
  const [inviteError, setInviteError] = useState('')
  const [rosterError, setRosterError] = useState('')
  const location = useLocation()
  const navigate = useNavigate()
  const autoSent = useRef(false)
  const { title, timezone, deadline, sample } = round.data
  const link = `${window.location.origin}/r/${round.recordId}`
  const byStudent = new Map(submissions.map((s) => [s.data.studentId, s]))
  const abbr = tzAbbr(timezone, new Date(deadline))
  // A row's personal invite link (R19); rows from before invites fall back to the shared link.
  const inviteLink = (r: Rec<RosterRow>) => (r.data.inviteToken ? `${link}?invite=${r.data.inviteToken}` : link)

  /** Emails everyone not yet sent. Statuses arrive live through the roster query (P9). */
  async function sendInvites() {
    setSending(true)
    setInviteError('')
    try {
      await callAction('sendInvites', { roundId: round.recordId })
    } catch (e) {
      setInviteError((e as Error).message)
    } finally {
      setSending(false)
    }
  }

  /** Takes a student off the roster, with their answer, after a confirm (P10). */
  async function remove(r: Rec<RosterRow>, answered: boolean) {
    if (!window.confirm(`Remove ${r.data.name}?${answered ? ' Their answer will be deleted too.' : ''}`)) return
    setRosterError('')
    try {
      await callAction('removeStudent', { roundId: round.recordId, rosterId: r.recordId })
    } catch (e) {
      setRosterError((e as Error).message)
    }
  }

  // "Open round and email students" lands here with state.sendInvites. Clear
  // the state first, so a refresh doesn't send the batch again.
  useEffect(() => {
    if (autoSent.current || !(location.state as { sendInvites?: boolean } | null)?.sendInvites) return
    autoSent.current = true
    navigate(location.pathname, { replace: true, state: null })
    void sendInvites()
    // Once, on arrival from the create form.
  }, [])

  async function generate() {
    setBusy(true)
    setError('')
    try {
      await callAction('generateDraft', { roundId: round.recordId })
      // The live `rounds` subscription flips this page to the draft view.
    } catch (e) {
      setError((e as Error).message)
      setBusy(false)
    }
  }

  return (
    <>
      <title>{`${title} | SlotDraft`}</title>
      <HeaderBand title={title} step={open ? 2 : 3}>
        <p className="tabular mt-6 flex flex-wrap items-center gap-4 text-[28px] font-extrabold">
          <span data-testid="responded-count">
            {submissions.length} of {roster.length} responded
          </span>
          <SeatStrip filled={submissions.length} total={roster.length} onBand />
        </p>
        <p className="mt-2 text-band-muted">
          {open
            ? `Responses close ${formatWhen(deadline, timezone)} ${abbr}. This list updates as students answer.`
            : `Responses closed ${formatWhen(deadline, timezone)} ${abbr}.`}
        </p>
      </HeaderBand>

      <div className="mx-auto max-w-6xl space-y-12 px-4 py-10 sm:px-6">
        {open && !sample && <InviteNotice roster={roster} sending={sending} error={inviteError} onSend={() => void sendInvites()} />}

        <Section title="Link for students">
          <div className="flex flex-wrap gap-3">
            <input readOnly aria-label="Link for students" value={link} className="min-h-11 flex-1 rounded-lg border border-input px-3 text-base" />
            <button
              className={button.outline}
              onClick={() => {
                void navigator.clipboard.writeText(link).then(() => setCopied(true))
              }}
            >
              {copied ? 'Copied' : 'Copy link'}
            </button>
          </div>
          <p className="mt-2 text-muted-foreground">
            Works when students sign in with the email on your roster. Each student also gets their own link by email.
          </p>
        </Section>

        <Section title="Class roster" aside={<p className="text-muted-foreground">Rankings stay private. You see how many times each student can make.</p>}>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left">
              <thead className="text-sm text-muted-foreground">
                <tr className="border-b border-border">
                  <th className="py-2 font-semibold">Student</th>
                  <th className="py-2 font-semibold">Status</th>
                  {!sample && <th className="py-2 font-semibold">Invite</th>}
                  <th className="py-2 font-semibold">Times they can make</th>
                  <th className="py-2 font-semibold">Last answered</th>
                  <th className="py-2 font-semibold">
                    <span className="sr-only">Email</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {roster.map((r) => {
                  const sub = r.data.userId ? byStudent.get(r.data.userId) : undefined
                  const noneWork = sub?.data.noneWork
                  return (
                    <tr key={r.recordId} className={`border-b border-border align-top ${noneWork ? 'bg-attention-tint' : ''}`}>
                      <td className="max-w-[240px] py-3 pr-3">
                        <p className="truncate font-semibold" title={r.data.name}>
                          {r.data.name}
                        </p>
                        <p className="truncate text-sm text-subtle" title={r.data.email}>
                          {r.data.email}
                        </p>
                      </td>
                      <td className="py-3 pr-3">
                        {!sub ? (
                          <span className="inline-block rounded-full border border-dashed border-input px-3 py-0.5 text-muted-foreground">No response yet</span>
                        ) : noneWork ? (
                          <div className="max-w-sm">
                            <span className="font-semibold text-attention">None of the times work</span>
                            {sub.data.note && <Note text={sub.data.note} />}
                          </div>
                        ) : (
                          <span className="inline-block rounded-full bg-success-tint px-3 py-0.5 font-semibold text-success">Responded</span>
                        )}
                      </td>
                      {!sample && (
                        <td className="py-3 pr-3" data-testid="invite-status">
                          {r.data.inviteStatus === 'sent' ? (
                            <span className="text-muted-foreground">Sent</span>
                          ) : r.data.inviteStatus === 'failed' ? (
                            <span className="font-semibold text-destructive">Didn’t go through</span>
                          ) : (
                            <span className="text-muted-foreground">Not sent</span>
                          )}
                        </td>
                      )}
                      <td className="tabular py-3 pr-3">{sub && !noneWork ? `${sub.data.available.length} of ${windows.length}` : ''}</td>
                      <td className="tabular py-3 pr-3 text-muted-foreground">{sub ? formatShortWhen(sub.updatedAt, timezone) : ''}</td>
                      <td className="py-3">
                        <div className="flex justify-end gap-4">
                          {/* The body carries their personal link, so the TA can send it by hand if the invite didn't arrive. */}
                          <a
                            className="font-semibold text-primary underline"
                            href={`${mailto(r.data.email, title)}&body=${encodeURIComponent(`Pick the times you can make for ${title}: ${inviteLink(r)}`)}`}
                          >
                            Email<span className="sr-only"> {r.data.name}</span>
                          </a>
                          {open && !sample && (
                            <button className="font-semibold text-destructive underline" onClick={() => void remove(r, !!sub)}>
                              Remove<span className="sr-only"> {r.data.name}</span>
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          {rosterError && (
            <div className="mt-4">
              <Notice tone="error" title={rosterError} />
            </div>
          )}
          {open && !sample && (
            <AddStudents roundId={round.recordId} existing={roster.map((r) => r.data.email)} onAdded={() => void sendInvites()} />
          )}
        </Section>

        <div className="flex flex-wrap items-center justify-between gap-4 border-t-[3px] border-foreground pt-4">
          <p className="text-muted-foreground">
            {open ? 'You can build the draft after responses close.' : 'Responses are closed. Build the draft to see who fits where.'}
          </p>
          <button className={button.primary} disabled={open || busy} onClick={generate}>
            {busy ? 'Building draft…' : 'Generate draft'}
          </button>
        </div>
        {error && <Notice tone="error" title={error} />}
      </div>
    </>
  )
}

/** A student's note: clamped to 3 lines with "Show full note" (§6 long content). */
function Note({ text }: { text: string }) {
  const [full, setFull] = useState(false)
  return (
    <div className="mt-1">
      <p className={`whitespace-pre-line text-foreground ${full ? '' : 'line-clamp-3'}`}>{text}</p>
      {text.length > 140 && (
        <button className="mt-1 min-h-11 font-semibold text-primary underline" onClick={() => setFull((v) => !v)}>
          {full ? 'Show less' : 'Show full note'}
        </button>
      )}
    </div>
  )
}

/**
 * Adding students to an open round (P10): same live check as the create form,
 * plus "already on the roster". New students are emailed straight away.
 */
function AddStudents({ roundId, existing, onAdded }: { roundId: string; existing: string[]; onAdded: () => void }) {
  const [adding, setAdding] = useState(false)
  const [text, setText] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const parsed = useMemo(() => parseRoster(text, existing), [text, existing])
  const count = parsed.valid.length

  if (!adding) {
    return (
      <button className={`${button.outline} mt-6`} onClick={() => setAdding(true)}>
        Add students
      </button>
    )
  }

  async function add() {
    setSaving(true)
    setError('')
    try {
      await callAction('addStudents', { roundId, roster: text })
      setText('')
      setAdding(false)
      onAdded()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="mt-6 max-w-xl">
      <label htmlFor="add-students" className="block text-lg font-extrabold">
        Add students
      </label>
      <p className="mb-2 text-muted-foreground">One email per line. Each new student gets their invite right away.</p>
      <textarea
        id="add-students"
        rows={4}
        className="w-full rounded-lg border border-input p-3 text-base"
        placeholder="Eli Park <eli.park@example.edu>"
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <p className="mt-2 font-semibold" aria-live="polite">
        {count} new {count === 1 ? 'student' : 'students'}
      </p>
      {parsed.problems.length > 0 && (
        <ul className="mt-2 space-y-1 text-destructive" role="alert">
          {parsed.problems.map((p) => (
            <li key={p.lineNumber}>{p.message}</li>
          ))}
        </ul>
      )}
      {error && (
        <div className="mt-3">
          <Notice tone="error" title={error} />
        </div>
      )}
      <div className="mt-4 flex flex-wrap gap-3">
        <button className={button.primary} disabled={saving || count === 0 || parsed.problems.length > 0} onClick={() => void add()}>
          {saving ? 'Adding…' : 'Add and email invites'}
        </button>
        <button className={button.outline} disabled={saving} onClick={() => setAdding(false)}>
          Cancel
        </button>
      </div>
    </div>
  )
}

/**
 * Where the invite emails stand, from the live roster (P9). One notice at a
 * time: sending, failed (try again), not sent yet (send), or all sent.
 */
function InviteNotice(props: { roster: Rec<RosterRow>[]; sending: boolean; error: string; onSend: () => void }) {
  const { roster, sending, error, onSend } = props
  const total = roster.length
  const sent = roster.filter((r) => r.data.inviteStatus === 'sent').length
  const failed = roster.filter((r) => r.data.inviteStatus === 'failed').length
  const unsent = total - sent - failed
  if (total === 0) return null

  const action = (label: string) => (
    <button className={`${button.outline} mt-3`} disabled={sending} onClick={onSend}>
      {label}
    </button>
  )
  if (error) return <Notice tone="error" title={error}>{action('Try again')}</Notice>
  if (sending) return <Notice tone="attention" title={`Emailing invites… ${sent} of ${total} sent.`} />
  if (failed) {
    return (
      <Notice tone="error" title={`${failed} ${failed === 1 ? 'invite' : 'invites'} didn’t go through.`}>
        <p>Check the address in the roster, or use Email in their row to send their link yourself.</p>
        {action('Try again')}
      </Notice>
    )
  }
  if (unsent) {
    return (
      <Notice tone="attention" title={`${unsent} ${unsent === 1 ? 'student hasn’t' : 'students haven’t'} been emailed yet.`}>
        {action('Email invites')}
      </Notice>
    )
  }
  return <Notice tone="success" title={total === 1 ? 'Invite emailed to your student.' : `Invites emailed to all ${total} students.`} />
}

// ---------------------------------------------------------------------------
// Draft and preview
// ---------------------------------------------------------------------------

function Draft({ round, windows, roster, submissions, assignments }: ViewProps) {
  const { title, timezone } = round.data
  const [previews, setPreviews] = useState<Record<string, SeatPreview>>({})
  const [previewing, setPreviewing] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const bandRef = useRef<HTMLDivElement>(null)

  // "Preview this seat" sits low on the page; bring the Apply / Cancel band into view.
  useEffect(() => {
    if (previewing) bandRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [previewing])
  const [error, setError] = useState('')

  const names = new Map(roster.map((r) => [r.data.userId, r.data]))
  const draft: Record<string, string> = Object.fromEntries(
    assignments.filter((a) => a.data.windowId).map((a) => [a.data.studentId, a.data.windowId]),
  )
  const placed = Object.keys(draft).length
  const capacityKey = windows.map((w) => `${w.recordId}:${w.data.capacity}`).join(',')

  // Ask the server what one more seat would do, for every window at once.
  // Re-runs when a seat is applied (capacities change).
  useEffect(() => {
    let cancelled = false
    const ids = capacityKey ? capacityKey.split(',').map((s) => s.split(':')[0] ?? '') : []
    Promise.all(
      ids.map((windowId) =>
        callAction<SeatPreview>('previewSeat', { roundId: round.recordId, windowId }).then((p) => [windowId, p] as const),
      ),
    )
      .then((pairs) => !cancelled && setPreviews(Object.fromEntries(pairs)))
      .catch((e: Error) => !cancelled && setError(e.message))
    return () => {
      cancelled = true
    }
  }, [round.recordId, capacityKey, round.data.draftAt])

  const preview = previewing ? previews[previewing] : undefined
  const shown = preview ? preview.assignments : draft
  const unplaced = submissions.filter((s) => !shown[s.data.studentId])
  const unanswered = roster.filter((r) => !submissions.some((s) => s.data.studentId === r.data.userId))
  const nameOf = (studentId: string) => names.get(studentId)?.name ?? 'A student'

  async function act(name: 'applySeat' | 'publish', params: Record<string, unknown>) {
    setBusy(true)
    setError('')
    try {
      await callAction(name, { roundId: round.recordId, ...params })
      setPreviewing(null)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const previewWindow = windows.find((w) => w.recordId === previewing)
  const newlyPlaced = preview ? preview.moved.filter((s) => !draft[s]) : []
  const shifted = preview ? preview.moved.filter((s) => draft[s]) : []

  return (
    <>
      <title>{`${title} | SlotDraft`}</title>
      <HeaderBand title={title} step={3}>
        {preview && previewWindow ? (
          <>
            <p className="tabular mt-6 flex flex-wrap items-center gap-4 text-[28px] font-extrabold">
              <span data-testid="placed-count">
                {preview.placed} of {submissions.length} placed with this seat, up from {placed}
              </span>
              <SeatStrip filled={preview.placed} total={submissions.length} onBand />
            </p>
            <p className="mt-2 text-band-muted">The draw order stays the same, so the extra seat is the only thing that changes.</p>
          </>
        ) : (
          <>
            <p className="tabular mt-6 flex flex-wrap items-center gap-4 text-[28px] font-extrabold">
              <span data-testid="placed-count">
                {placed} of {submissions.length} placed
              </span>
              <SeatStrip filled={placed} total={submissions.length} onBand />
            </p>
            <p className="mt-2 max-w-3xl text-band-muted">
              {unplacedSummary(unplaced.map((s) => nameOf(s.data.studentId)), unanswered.map((r) => r.data.name))} Students can’t see this
              draft until you publish it.
            </p>
          </>
        )}
        <div className="mt-6 flex flex-wrap items-center gap-3">
          <button className={button.success} disabled={!!preview || busy} onClick={() => act('publish', {})}>
            {busy && !preview ? 'Publishing…' : 'Publish this draft'}
          </button>
          {preview && <span className="text-band-muted">Apply or cancel the preview first.</span>}
        </div>
      </HeaderBand>

      {preview && previewWindow && (
        <div ref={bandRef} className="border-b-2 border-preview bg-preview-tint" role="status">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-4 py-4 sm:px-6">
            <div>
              <p className="text-lg font-extrabold text-preview">
                Preview: 1 more seat on {windowLabel(previewWindow.data, timezone).text}
              </p>
              <p>
                {newlyPlaced.length ? `${listNames(newlyPlaced.map(nameOf))} ${newlyPlaced.length === 1 ? 'gets' : 'get'} placed.` : 'Nobody new gets placed.'}{' '}
                {shifted.length
                  ? `${listNames(shifted.map(nameOf))} ${shifted.length === 1 ? 'moves' : 'move'} to another time to make room.`
                  : 'Nobody else moves.'}
              </p>
            </div>
            <div className="flex gap-3">
              <button className={button.outline} onClick={() => setPreviewing(null)} disabled={busy}>
                Cancel preview
              </button>
              <button className={button.preview} onClick={() => act('applySeat', { windowId: previewing })} disabled={busy}>
                {busy ? 'Applying…' : 'Apply this seat'}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="mx-auto max-w-6xl space-y-12 px-4 py-10 sm:px-6">
        {error && <Notice tone="error" title={error} />}
        <Section title="Seating chart" aside={<p className="text-muted-foreground">Each row shows what one more seat would change.</p>}>
          <ul className="divide-y divide-border border-y border-border">
            {windows.map((w) => {
              const inPreview = w.recordId === previewing
              const p = previews[w.recordId]
              return (
                <ChartRow
                  key={w.recordId}
                  window={w}
                  timezone={timezone}
                  seated={Object.keys(shown).filter((s) => shown[s] === w.recordId)}
                  extraSeat={inPreview}
                  highlight={preview ? preview.moved : []}
                  nameOf={nameOf}
                  rankOf={(s) => (submissions.find((x) => x.data.studentId === s)?.data.available.indexOf(w.recordId) ?? -1) + 1}
                  explainOpenSeat={unplaced.length > 0}
                  side={
                    inPreview ? (
                      <span className="font-semibold text-preview">Previewing this row</span>
                    ) : !p ? (
                      <span className="text-subtle">Checking +1 seat…</span>
                    ) : p.placed > placed ? (
                      <div className="text-right">
                        <p className="tabular font-semibold text-preview">
                          +1 seat: {p.placed} of {submissions.length} placed
                        </p>
                        <button className={`${button.outline} mt-2 border-preview text-preview`} disabled={!!preview} onClick={() => setPreviewing(w.recordId)}>
                          Preview this seat
                        </button>
                      </div>
                    ) : (
                      <span className="text-muted-foreground">+1 seat: no change</span>
                    )
                  }
                />
              )
            })}
          </ul>
        </Section>

        <Section title={preview ? 'Still not placed' : 'Not placed'} aside={preview ? <p className="text-muted-foreground">Extra seats won’t place them.</p> : undefined}>
          <NotPlaced
            round={round}
            windows={windows}
            unplaced={unplaced}
            unanswered={unanswered}
            nameOf={nameOf}
            emailOf={(s) => names.get(s)?.email ?? ''}
            published={false}
          />
        </Section>
      </div>
    </>
  )
}

function unplacedSummary(unplaced: string[], unanswered: string[]): string {
  const who = (list: string[]) => (list.length <= 3 ? listNames(list.map(firstName)) : `${list.length} students`)
  const parts: string[] = []
  if (unplaced.length) parts.push(`${who(unplaced)} answered but ${unplaced.length === 1 ? 'doesn’t' : 'don’t'} fit yet.`)
  if (unanswered.length) parts.push(`${who(unanswered)} didn’t answer.`)
  if (!parts.length) parts.push('Everyone who answered has a time.')
  return parts.join(' ')
}

/** One seating-chart row: date tab, time, seat chips, and whatever goes on the right. */
function ChartRow(props: {
  window: Rec<TimeWindow>
  timezone: string
  seated: string[]
  extraSeat?: boolean
  highlight?: string[]
  nameOf: (s: string) => string
  rankOf: (s: string) => number
  explainOpenSeat?: boolean
  side?: React.ReactNode
}) {
  const { window: w, timezone, seated, extraSeat = false, highlight = [] } = props
  const label = windowLabel(w.data, timezone)
  const capacity = w.data.capacity + (extraSeat ? 1 : 0)
  const open = Math.max(0, capacity - seated.length)
  return (
    <li className={`grid gap-4 py-4 sm:grid-cols-[64px_200px_1fr_auto] sm:items-start ${extraSeat ? 'bg-preview-tint' : ''}`} data-testid="chart-row">
      <DateTab date={w.data.date} />
      <div>
        <p className="font-semibold">
          {label.weekday}
          {extraSeat ? `, ${capacity} seats in preview` : w.data.capacity > 1 ? ', group session' : ''}
        </p>
        <p className="tabular text-[22px] font-extrabold leading-tight">
          {label.time.main} <span className="text-base font-semibold">{label.time.meridiem}</span>
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        {seated.map((s) => {
          const moved = highlight.includes(s)
          const rank = props.rankOf(s)
          return (
            <span
              key={s}
              title={props.nameOf(s)}
              className={`inline-flex max-w-[220px] items-center gap-2 rounded px-3 py-1.5 ${moved ? 'bg-preview text-white' : 'bg-success text-success-foreground'}`}
            >
              <span className="truncate font-semibold">{props.nameOf(s)}</span>
              {rank > 0 && <span className="tabular text-sm opacity-90">{ordinal(rank)}</span>}
              {moved && <span className="sr-only">(changes in this preview)</span>}
            </span>
          )
        })}
        {Array.from({ length: open }, (_, i) => {
          const added = extraSeat && i === open - 1
          return (
            <span
              key={`open-${i}`}
              className={`inline-flex items-center rounded border border-dashed px-3 py-1.5 ${added ? 'border-preview text-preview' : 'border-input text-muted-foreground'}`}
            >
              {added ? 'added seat' : 'Open seat'}
            </span>
          )
        })}
        {open > 0 && !extraSeat && props.explainOpenSeat && (
          <p className="w-full text-sm text-muted-foreground">No unplaced student can make this time.</p>
        )}
      </div>
      <div className="sm:text-right">{props.side}</div>
    </li>
  )
}

/** The two follow-up lists: answered but unplaced, and never answered (P4). */
function NotPlaced(props: {
  round: Rec<Round>
  windows: Rec<TimeWindow>[]
  unplaced: Rec<Submission>[]
  unanswered: Rec<RosterRow>[]
  nameOf: (s: string) => string
  emailOf: (s: string) => string
  published: boolean
}) {
  const { round, windows, unplaced, unanswered, nameOf, emailOf, published } = props
  const { title, timezone } = round.data
  const labelOf = (id: string) => {
    const w = windows.find((x) => x.recordId === id)
    return w ? windowLabel(w.data, timezone).short : 'a time'
  }

  const Person = ({ name, email, children }: { name: string; email: string; children: React.ReactNode }) => (
    <li className="flex flex-wrap items-start justify-between gap-3 py-3">
      <div className="min-w-0 max-w-2xl">
        <p className="truncate font-semibold" title={name}>
          {name}
        </p>
        <div className="text-muted-foreground">{children}</div>
      </div>
      <a className={button.outline} href={mailto(email, title)}>
        Email<span className="sr-only"> {name}</span>
      </a>
    </li>
  )

  if (!unplaced.length && !unanswered.length) return <p className="text-muted-foreground">Everyone on the roster has a time.</p>

  return (
    <div className="grid gap-8 lg:grid-cols-2">
      <div>
        <h3 className="text-lg font-extrabold">Answered, but no time works</h3>
        {unplaced.length === 0 ? (
          <p className="mt-2 text-muted-foreground">Nobody.</p>
        ) : (
          <ul className="divide-y divide-border">
            {unplaced.map((s) => {
              const name = nameOf(s.data.studentId)
              const first = firstName(name)
              const times = s.data.available.map(labelOf)
              return (
                <Person key={s.recordId} name={name} email={emailOf(s.data.studentId)}>
                  {s.data.noneWork ? (
                    <>
                      <p>
                        {first} said none of the times work.{published ? ' They were told you have their note.' : ''}
                      </p>
                      {s.data.note && <Note text={s.data.note} />}
                    </>
                  ) : (
                    <p>
                      {first} can only make {listNames(times)}, which {times.length === 1 ? 'is' : 'are'} full.
                      {published ? ' They were told you’ll be in touch.' : ''}
                    </p>
                  )}
                </Person>
              )
            })}
          </ul>
        )}
      </div>
      <div>
        <h3 className="text-lg font-extrabold">Didn’t answer</h3>
        {unanswered.length === 0 ? (
          <p className="mt-2 text-muted-foreground">Nobody.</p>
        ) : (
          <ul className="divide-y divide-border">
            {unanswered.map((r) => (
              <Person key={r.recordId} name={r.data.name} email={r.data.email}>
                <p>
                  {firstName(r.data.name)}{' '}
                  {published ? 'didn’t answer before the deadline.' : 'isn’t scheduled because we don’t know when they’re free.'}
                </p>
              </Person>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Published
// ---------------------------------------------------------------------------

function Published({ round, windows, roster, submissions, assignments }: ViewProps) {
  const { title, timezone, publishedAt, sample } = round.data
  const [copied, setCopied] = useState(false)
  const names = new Map(roster.map((r) => [r.data.userId, r.data]))
  const nameOf = (s: string) => names.get(s)?.name ?? 'A student'
  const placed = assignments.filter((a) => a.data.windowId)
  const seatedIn = (windowId: string) => placed.filter((a) => a.data.windowId === windowId).map((a) => a.data.studentId)
  const unplaced = submissions.filter((s) => !placed.some((a) => a.data.studentId === s.data.studentId))
  const unanswered = roster.filter((r) => !submissions.some((s) => s.data.studentId === r.data.userId))
  const failed = assignments.filter((a) => a.data.emailStatus === 'failed')
  const sent = assignments.filter((a) => a.data.emailStatus === 'sent').length
  const pending = assignments.some((a) => !a.data.emailStatus)

  const scheduleText = [
    title,
    ...windows.map((w) => {
      const l = windowLabel(w.data, timezone)
      const who = seatedIn(w.recordId).map(nameOf)
      return `${l.text} ${l.abbr}: ${who.length ? who.join(', ') : 'Nobody. This time stays open.'}`
    }),
  ].join('\n')

  return (
    <>
      <title>{`${title} | SlotDraft`}</title>
      <HeaderBand title={title} step={4}>
        <p className="mt-6 text-[28px] font-extrabold text-success-light" data-testid="published-banner">
          Published. {placed.length} {placed.length === 1 ? 'student has' : 'students have'} a time.
        </p>
        <p className="mt-2 text-band-muted">
          {formatWhen(publishedAt, timezone)} {tzAbbr(timezone, new Date(publishedAt))}. Students can see their time in SlotDraft now. This round
          can’t be reopened.
        </p>
        <button
          className={`${button.outline} mt-6 border-white`}
          onClick={() => void navigator.clipboard.writeText(scheduleText).then(() => setCopied(true))}
        >
          {copied ? 'Copied' : 'Copy schedule as text'}
        </button>
      </HeaderBand>

      <div className="mx-auto max-w-6xl space-y-12 px-4 py-10 sm:px-6">
        {sample ? (
          <Notice tone="success" title="This is the sample round, so no emails were sent." />
        ) : pending ? (
          <Notice tone="attention" title="Sending result emails…" />
        ) : failed.length ? (
          <Notice
            tone="error"
            title={`${sent} of ${assignments.length} emails sent. ${failed.length} didn’t go through.`}
          >
            <ul className="space-y-2">
              {failed.map((a) => {
                const r = names.get(a.data.studentId)
                return (
                  <li key={a.recordId} className="flex flex-wrap items-center gap-3">
                    <span>
                      {r?.name} ({r?.email}) can still see their time in SlotDraft. You may want to email them yourself.
                    </span>
                    {r && (
                      <a className={button.outline} href={mailto(r.email, title)}>
                        Email {firstName(r.name)}
                      </a>
                    )}
                  </li>
                )
              })}
            </ul>
          </Notice>
        ) : (
          <Notice tone="success" title={`${sent} ${sent === 1 ? 'email' : 'emails'} sent.`} />
        )}

        <Section title="Final schedule">
          <ul className="divide-y divide-border border-y border-border">
            {windows.map((w) => (
              <ChartRow
                key={w.recordId}
                window={w}
                timezone={timezone}
                seated={seatedIn(w.recordId)}
                nameOf={nameOf}
                rankOf={(s) => (submissions.find((x) => x.data.studentId === s)?.data.available.indexOf(w.recordId) ?? -1) + 1}
                side={seatedIn(w.recordId).length === 0 ? <span className="text-muted-foreground">Nobody. This time stays open.</span> : undefined}
              />
            ))}
          </ul>
        </Section>

        <Section title="Not scheduled">
          <NotPlaced
            round={round}
            windows={windows}
            unplaced={unplaced}
            unanswered={unanswered}
            nameOf={nameOf}
            emailOf={(s) => names.get(s)?.email ?? ''}
            published
          />
        </Section>
      </div>
    </>
  )
}
