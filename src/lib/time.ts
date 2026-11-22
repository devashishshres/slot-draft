/**
 * Time helpers, built on Intl only (no date library).
 *
 * Storage rules:
 *  - A round's deadline is an ISO instant (UTC). Compare it with Date.now().
 *  - A window's date/start/end are wall-clock strings in the round's time
 *    zone ("2026-12-04", "14:00"). Every assigned student attends the same
 *    local time, so there is nothing to convert. They are shown as written,
 *    next to the zone's abbreviation.
 */

/** Offset in ms between `timeZone`'s wall clock and UTC at instant `ms`. */
function offsetMs(ms: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(ms))
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value)
  const wallAsUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'))
  return wallAsUtc - Math.floor(ms / 1000) * 1000
}

/**
 * "2026-11-22" + "23:59" in America/Phoenix → "2026-11-23T06:59:00.000Z".
 * The second pass corrects the offset when the guess lands on the other side
 * of a DST change.
 */
export function zonedToUtc(date: string, time: string, timeZone: string): string {
  const wallAsUtc = Date.parse(`${date}T${time}:00Z`)
  let utc = wallAsUtc - offsetMs(wallAsUtc, timeZone)
  const corrected = wallAsUtc - offsetMs(utc, timeZone)
  if (corrected !== utc) utc = corrected
  return new Date(utc).toISOString()
}

/** "MST" for America/Phoenix (at the given instant, since DST changes it). */
export function tzAbbr(timeZone: string, at: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'short' }).formatToParts(at)
  return parts.find((p) => p.type === 'timeZoneName')?.value ?? timeZone
}

/** "Eastern Time (EST)": the zone's name plus the abbreviation, for "Times are in …". */
export function tzLabel(timeZone: string, at: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'longGeneric' }).formatToParts(at)
  const long = parts.find((p) => p.type === 'timeZoneName')?.value ?? timeZone
  return `${long} (${tzAbbr(timeZone, at)})`
}

/** The browser's zone: the default for a new round. */
export function browserTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone
}

function fmt(iso: string | number, timeZone: string, options: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat('en-US', { timeZone, ...options }).format(new Date(iso))
}

/** "Sun, Nov 22 at 11:59 PM" */
export function formatWhen(iso: string | number, timeZone: string): string {
  const day = fmt(iso, timeZone, { weekday: 'short', month: 'short', day: 'numeric' })
  return `${day} at ${formatClock(iso, timeZone)}`
}

/** "Nov 20, 4:12 PM" */
export function formatShortWhen(iso: string | number, timeZone: string): string {
  return `${fmt(iso, timeZone, { month: 'short', day: 'numeric' })}, ${formatClock(iso, timeZone)}`
}

/** "11:59 PM" */
export function formatClock(iso: string | number, timeZone: string): string {
  return fmt(iso, timeZone, { hour: 'numeric', minute: '2-digit' })
}

/**
 * Parts of a window date for the calendar-page date tab.
 * Formatted at noon UTC with timeZone UTC, so the day can never shift.
 */
export function dateParts(date: string): { month: string; day: string; weekday: string; short: string } {
  const noon = `${date}T12:00:00Z`
  return {
    month: fmt(noon, 'UTC', { month: 'short' }),
    day: fmt(noon, 'UTC', { day: 'numeric' }),
    weekday: fmt(noon, 'UTC', { weekday: 'long' }),
    short: fmt(noon, 'UTC', { weekday: 'short', month: 'short', day: 'numeric' }),
  }
}

function clock12(hhmm: string): { time: string; meridiem: 'AM' | 'PM' } {
  const [h, m] = hhmm.split(':').map(Number)
  return { time: `${h % 12 || 12}:${String(m).padStart(2, '0')}`, meridiem: h < 12 ? 'AM' : 'PM' }
}

/**
 * "14:00"–"14:20" → { main: "2:00–2:20", meridiem: "PM", text: "2:00–2:20 PM" }.
 * `main` + `meridiem` let the seating chart print the numbers large and "PM" small.
 */
export function timeRange(start: string, end: string): { main: string; meridiem: string; text: string } {
  const a = clock12(start)
  const b = clock12(end)
  const main = a.meridiem === b.meridiem ? `${a.time}–${b.time}` : `${a.time} ${a.meridiem}–${b.time}`
  return { main, meridiem: b.meridiem, text: `${main} ${b.meridiem}` }
}
