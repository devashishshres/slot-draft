import { describe, expect, it } from 'vitest'
import { dateParts, formatClock, formatShortWhen, formatWhen, timeRange, tzAbbr, zonedToUtc } from './time'

describe('zonedToUtc', () => {
  it('converts Arizona wall time (no DST, UTC-7)', () => {
    expect(zonedToUtc('2026-11-22', '23:59', 'America/Phoenix')).toBe('2026-11-23T06:59:00.000Z')
  })

  it('handles a zone in DST (New York in July is UTC-4)', () => {
    expect(zonedToUtc('2026-07-01', '09:00', 'America/New_York')).toBe('2026-07-01T13:00:00.000Z')
  })

  it('handles a zone out of DST (New York in December is UTC-5)', () => {
    expect(zonedToUtc('2026-12-01', '09:00', 'America/New_York')).toBe('2026-12-01T14:00:00.000Z')
  })
})

describe('labels', () => {
  const deadline = '2026-11-23T06:59:00.000Z'

  it('formats a deadline in the round’s zone', () => {
    expect(formatWhen(deadline, 'America/Phoenix')).toBe('Sun, Nov 22 at 11:59 PM')
  })

  it('formats a short timestamp', () => {
    expect(formatShortWhen('2026-11-20T23:12:00.000Z', 'America/Phoenix')).toBe('Nov 20, 4:12 PM')
  })

  it('formats a clock time', () => {
    expect(formatClock(deadline, 'America/Phoenix')).toBe('11:59 PM')
  })

  it('gives the zone abbreviation', () => {
    expect(tzAbbr('America/Phoenix', new Date(deadline))).toBe('MST')
  })

  it('splits a date into tab parts without shifting the day', () => {
    expect(dateParts('2026-11-30')).toEqual({ month: 'Nov', day: '30', weekday: 'Monday', short: 'Mon, Nov 30' })
  })

  it('shares the meridiem when both ends match', () => {
    expect(timeRange('14:00', '14:20')).toEqual({ main: '2:00–2:20', meridiem: 'PM', text: '2:00–2:20 PM' })
  })

  it('keeps both meridiems when they differ', () => {
    expect(timeRange('11:30', '12:10')).toEqual({
      main: '11:30 AM–12:10',
      meridiem: 'PM',
      text: '11:30 AM–12:10 PM',
    })
  })
})
