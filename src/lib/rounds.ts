/**
 * Pure validation for rounds, rosters and responses. The create-round form
 * (live feedback) and the server actions (the real check) both use it, so
 * the browser and the server agree on what counts as valid.
 *
 * Each error string is shown to the person as-is: it says what happened and
 * how to fix it (CLAUDE.md §6, copy rules).
 */

export const NOTE_MAX = 500
export const TITLE_MAX = 120
export const SEATS_MAX = 100
export const WINDOWS_MAX = 100
export const ROSTER_MAX = 1000

export interface RosterEntry {
  name: string
  email: string
}

export interface RosterProblem {
  lineNumber: number
  message: string
}

const EMAIL_TOKEN = /[^\s,;<>"'()]+@[^\s,;<>"'()]+/g
const EMAIL_SHAPE = /^[^@\s]+@[^@\s]+\.[A-Za-z]{2,}$/
const NAME_SHAPE = /^[\p{L}][\p{L} .'-]*$/u

/** "gus.moore-jr@x.edu" becomes "Gus Moore Jr". Used when a line has only an email. */
export function nameFromEmail(email: string): string {
  return email
    .split('@')[0]
    .split(/[._-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ')
}

/**
 * One student per line: an email, optionally with a name ("Ana Lee <ana@x.edu>",
 * "Ana Lee, ana@x.edu"). Emails are lowercased so roster matching on sign-in is
 * case-insensitive. Blank lines are ignored; line numbers in errors are the
 * real ones, so the TA can find the line.
 */
export function parseRoster(text: string): { valid: RosterEntry[]; problems: RosterProblem[] } {
  const valid: RosterEntry[] = []
  const problems: RosterProblem[] = []
  const firstLineOf = new Map<string, number>()

  text.split(/\r?\n/).forEach((raw, index) => {
    const line = raw.trim()
    const lineNumber = index + 1
    if (!line) return

    const tokens = line.match(EMAIL_TOKEN) ?? []
    if (tokens.length > 1) {
      problems.push({ lineNumber, message: `Line ${lineNumber} has more than one email address. Put one student on each line.` })
      return
    }
    const token = tokens[0]
    if (!token || !EMAIL_SHAPE.test(token)) {
      problems.push({ lineNumber, message: `Line ${lineNumber}, “${line}”, isn’t an email address. Fix it or remove it.` })
      return
    }

    const email = token.toLowerCase()
    const seenOn = firstLineOf.get(email)
    if (seenOn) {
      problems.push({ lineNumber, message: `Line ${lineNumber}, “${token}”, is already on line ${seenOn}. Remove one of them.` })
      return
    }
    firstLineOf.set(email, lineNumber)

    // Whatever is left once the email is removed is a name, if it looks like one.
    const leftover = line.replace(token, '').replace(/[<>,;"]/g, ' ').replace(/\s+/g, ' ').trim()
    valid.push({ name: NAME_SHAPE.test(leftover) ? leftover : nameFromEmail(email), email })
  })

  return { valid, problems }
}

export interface WindowInput {
  date: string // YYYY-MM-DD, in the round's time zone
  start: string // HH:MM, 24-hour
  end: string // HH:MM, 24-hour
  capacity: number
}

export interface RoundInput {
  title: string
  timezone: string
  deadline: string // ISO instant (UTC)
  windows: WindowInput[]
}

function isTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz })
    return true
  } catch {
    return false
  }
}

/** Returns the first problem as a sentence, or null when the round is valid. */
export function validateRoundInput(input: RoundInput, now: Date): string | null {
  if (typeof input.title !== 'string' || !input.title.trim()) return 'Give the round a name.'
  if (input.title.trim().length > TITLE_MAX) return `Keep the round name to ${TITLE_MAX} characters.`
  if (typeof input.timezone !== 'string' || !isTimeZone(input.timezone)) return 'Pick a time zone for this round.'

  const deadline = Date.parse(input.deadline)
  if (Number.isNaN(deadline)) return 'Set a deadline for responses.'
  if (deadline <= now.getTime()) return 'The deadline has passed. Pick a time in the future.'

  if (!Array.isArray(input.windows) || input.windows.length === 0) return 'Add at least one time window.'
  if (input.windows.length > WINDOWS_MAX) return `Keep it to ${WINDOWS_MAX} windows per round.`
  const seen = new Map<string, number>()
  for (const [i, w] of input.windows.entries()) {
    const n = i + 1
    const shaped =
      /^\d{4}-\d{2}-\d{2}$/.test(w.date) && /^\d{2}:\d{2}$/.test(w.start) && /^\d{2}:\d{2}$/.test(w.end)
    if (!shaped) return `Window ${n} needs a date, a start time and an end time.`
    // Same-length HH:MM strings compare correctly as text.
    if (w.start >= w.end) return `Window ${n} ends before it starts. Fix its times.`
    if (!Number.isInteger(w.capacity) || w.capacity < 1 || w.capacity > SEATS_MAX) {
      return `Window ${n} needs a whole number of seats, at least 1.`
    }
    const key = `${w.date} ${w.start} ${w.end}`
    const first = seen.get(key)
    if (first) return `Windows ${first} and ${n} are the same time. Remove one.`
    seen.set(key, n)
  }
  return null
}

export interface SubmissionInput {
  available: string[] // ranked window ids, best first
  noneWork: boolean
  note: string
}

/** Server-side shape and rule check for one student's answer. */
export function validateSubmission(sub: SubmissionInput, windowIds: readonly string[]): string | null {
  if (!Array.isArray(sub.available) || typeof sub.noneWork !== 'boolean' || typeof sub.note !== 'string') {
    return 'That answer couldn’t be read. Reload the page and try again.'
  }
  const known = new Set(windowIds)
  const unique = new Set(sub.available)
  if (unique.size !== sub.available.length || sub.available.some((id) => !known.has(id))) {
    return 'Your answer has a time that isn’t in this round. Reload the page and try again.'
  }
  if (sub.noneWork && sub.available.length > 0) {
    return 'You said none of the times work. Change your yes answers to no, or untick the box.'
  }
  if (!sub.noneWork && sub.available.length === 0) {
    return 'Say yes to at least one time, or tick “None of these times work for me”.'
  }
  if (sub.note.length > NOTE_MAX) return `Keep your note to ${NOTE_MAX} characters.`
  return null
}

/** Students can answer only while the round is open and the deadline hasn't passed (decision R3). */
export function isOpen(round: { status: string; deadline: string }, now: Date): boolean {
  return round.status === 'open' && now.getTime() < Date.parse(round.deadline)
}
