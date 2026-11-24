/**
 * /rounds/new: the "Set up" step. The form runs the same validators as the
 * server (src/lib/rounds.ts) for live feedback; `createRound` re-checks
 * everything, since a request can skip this page.
 */
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { button, HeaderBand, Notice, Section } from '@/components/slotdraft'
import { callAction } from '@/lib/api'
import { parseRoster, validateRoundInput, type WindowInput } from '@/lib/rounds'
import { browserTimeZone, formatWhen, tzAbbr, tzLabel, zonedToUtc } from '@/lib/time'

const input = 'min-h-11 rounded-lg border border-input bg-background px-3 text-base'
const emptyWindow = (): WindowInput => ({ date: '', start: '', end: '', capacity: 1 })

export default function NewRoundPage() {
  const navigate = useNavigate()
  const [title, setTitle] = useState('')
  const [timezone, setTimezone] = useState(browserTimeZone)
  const [changingZone, setChangingZone] = useState(false)
  const [windows, setWindows] = useState<WindowInput[]>([emptyWindow()])
  const [rosterText, setRosterText] = useState('')
  const [deadlineDate, setDeadlineDate] = useState('')
  const [deadlineTime, setDeadlineTime] = useState('23:59')
  const [saving, setSaving] = useState(false)
  const [serverError, setServerError] = useState('')

  const roster = useMemo(() => parseRoster(rosterText), [rosterText])
  const deadline = deadlineDate && deadlineTime ? zonedToUtc(deadlineDate, deadlineTime, timezone) : ''
  const seats = windows.reduce((sum, w) => sum + (Number.isInteger(w.capacity) ? w.capacity : 0), 0)
  const students = roster.valid.length
  const abbr = tzAbbr(timezone, deadline ? new Date(deadline) : new Date())

  // The first thing to fix, in form order. null = ready.
  const problem =
    validateRoundInput({ title, timezone, deadline, windows }, new Date()) ??
    (roster.problems.length ? 'Fix the roster to continue.' : students === 0 ? 'Add at least one student email.' : null)

  function setWindow(i: number, patch: Partial<WindowInput>) {
    setWindows((ws) => ws.map((w, j) => (j === i ? { ...w, ...patch } : w)))
  }

  async function submit() {
    setSaving(true)
    setServerError('')
    try {
      const { roundId } = await callAction<{ roundId: string }>('createRound', {
        title,
        timezone,
        deadline,
        windows,
        roster: rosterText,
      })
      // The round page sends the invites, so the TA watches each one go out (P9).
      navigate(`/rounds/${roundId}`, { state: { sendInvites: true } })
    } catch (e) {
      setServerError((e as Error).message)
      setSaving(false)
    }
  }

  return (
    <>
      <title>Create round | SlotDraft</title>
      <HeaderBand title="Create a round" step={1} />
      <div className="mx-auto grid max-w-6xl gap-10 px-4 py-10 sm:px-6 lg:grid-cols-[1fr_320px]">
        <div className="space-y-12">
          <div>
            <label htmlFor="title" className="block font-semibold">
              Round name
            </label>
            <input
              id="title"
              className={`${input} mt-2 w-full text-[22px] font-extrabold`}
              placeholder="CSE 360 project demos"
              value={title}
              maxLength={120}
              onChange={(e) => setTitle(e.target.value)}
            />
            <p className="mt-3 text-muted-foreground">
              Times are in {tzLabel(timezone)}.{' '}
              <button className="font-semibold text-primary underline" onClick={() => setChangingZone((v) => !v)}>
                Change
              </button>
            </p>
            {changingZone && (
              <label className="mt-2 block">
                <span className="sr-only">Time zone</span>
                <select className={input} value={timezone} onChange={(e) => setTimezone(e.target.value)}>
                  {Intl.supportedValuesOf('timeZone').map((tz) => (
                    <option key={tz}>{tz}</option>
                  ))}
                </select>
              </label>
            )}
          </div>

          <Section title="Time windows">
            <p className="mb-4 text-muted-foreground">
              Everyone in a window attends all of it. For one-on-one appointments, give each window 1 seat.
            </p>
            <table className="w-full">
              <thead>
                <tr className="text-left text-sm text-muted-foreground">
                  <th className="pb-2 font-semibold">Date</th>
                  <th className="pb-2 font-semibold">Starts</th>
                  <th className="pb-2 font-semibold">Ends</th>
                  <th className="pb-2 font-semibold">Seats</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {windows.map((w, i) => (
                  <tr key={i}>
                    <td className="py-1 pr-2">
                      <input type="date" aria-label={`Window ${i + 1} date`} className={`${input} tabular w-full`} value={w.date} onChange={(e) => setWindow(i, { date: e.target.value })} />
                    </td>
                    <td className="py-1 pr-2">
                      <input type="time" aria-label={`Window ${i + 1} starts`} className={`${input} tabular w-full`} value={w.start} onChange={(e) => setWindow(i, { start: e.target.value })} />
                    </td>
                    <td className="py-1 pr-2">
                      <input type="time" aria-label={`Window ${i + 1} ends`} className={`${input} tabular w-full`} value={w.end} onChange={(e) => setWindow(i, { end: e.target.value })} />
                    </td>
                    <td className="py-1 pr-2">
                      <input
                        type="number"
                        min={1}
                        max={100}
                        aria-label={`Window ${i + 1} seats`}
                        className={`${input} tabular w-20`}
                        value={Number.isNaN(w.capacity) ? '' : w.capacity}
                        onChange={(e) => setWindow(i, { capacity: e.target.valueAsNumber })}
                      />
                    </td>
                    <td className="py-1">
                      {windows.length > 1 && (
                        <button
                          aria-label={`Remove window ${i + 1}`}
                          className="min-h-11 px-2 font-semibold text-destructive"
                          onClick={() => setWindows((ws) => ws.filter((_, j) => j !== i))}
                        >
                          Remove
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <button className={`${button.outline} mt-3`} onClick={() => setWindows((ws) => [...ws, emptyWindow()])}>
              Add window
            </button>
          </Section>

          <Section title="Who’s in the class">
            <label htmlFor="roster" className="mb-2 block text-muted-foreground">
              Paste one email per line. A Canvas export works.
            </label>
            <textarea
              id="roster"
              rows={8}
              className="w-full rounded-lg border border-input p-3 text-base"
              placeholder={'ana.lee@example.edu\nBen Cho <ben.cho@example.edu>'}
              value={rosterText}
              onChange={(e) => setRosterText(e.target.value)}
            />
            <p className="mt-2 font-semibold" aria-live="polite">
              {students} {students === 1 ? 'student' : 'students'} added
            </p>
            {roster.problems.length > 0 && (
              <ul className="mt-2 space-y-1 text-destructive" role="alert">
                {roster.problems.map((p) => (
                  <li key={p.lineNumber}>{p.message}</li>
                ))}
              </ul>
            )}
          </Section>

          <Section title="Deadline">
            <div className="flex flex-wrap gap-3">
              <input type="date" aria-label="Deadline date" className={`${input} tabular`} value={deadlineDate} onChange={(e) => setDeadlineDate(e.target.value)} />
              <input type="time" aria-label="Deadline time" className={`${input} tabular`} value={deadlineTime} onChange={(e) => setDeadlineTime(e.target.value)} />
            </div>
            {deadline && (
              <p className="mt-3">
                Responses close on {formatWhen(deadline, timezone)} {abbr}.
              </p>
            )}
            <p className="mt-1 text-muted-foreground">Students can change their answers until then.</p>
          </Section>
        </div>

        <aside className="space-y-4 lg:sticky lg:top-6 lg:self-start">
          <div className="border-t-[3px] border-foreground pt-4">
            <p className="tabular text-[28px] font-extrabold">
              {seats} {seats === 1 ? 'seat' : 'seats'}, {students} {students === 1 ? 'student' : 'students'}
            </p>
            <p className="text-muted-foreground">
              across {windows.length} {windows.length === 1 ? 'window' : 'windows'}
            </p>
          </div>
          {students > seats && seats > 0 && (
            <Notice tone="attention" title={`If everyone responds, at least ${students - seats} ${students - seats === 1 ? 'student won’t' : 'students won’t'} fit.`}>
              The draft shows who, and you can try adding seats there.
            </Notice>
          )}
          <p className="text-muted-foreground">Windows can’t change once the round opens. You can add seats on the draft.</p>
          <p className="text-muted-foreground">Each student gets an email with their own link.</p>
          {serverError && <Notice tone="error" title={serverError} />}
          <button className={`${button.primary} w-full`} disabled={!!problem || saving} onClick={submit}>
            {saving ? 'Opening round…' : 'Open round and email students'}
          </button>
          {problem && <p className="text-muted-foreground">{problem}</p>}
        </aside>
      </div>
    </>
  )
}
