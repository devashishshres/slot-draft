import { describe, expect, it } from 'vitest'
import { isOpen, nameFromEmail, parseRoster, validateRoundInput, validateSubmission } from './rounds'

describe('parseRoster', () => {
  it('reads one email per line and derives a display name', () => {
    const r = parseRoster('ana.lee@example.edu\nben_cho@example.edu\n')
    expect(r.valid).toEqual([
      { name: 'Ana Lee', email: 'ana.lee@example.edu' },
      { name: 'Ben Cho', email: 'ben_cho@example.edu' },
    ])
    expect(r.problems).toEqual([])
  })

  it('keeps a name written before the email', () => {
    const r = parseRoster('Ana Lee <ana.lee@example.edu>\nBen Cho, BEN.CHO@Example.edu')
    expect(r.valid).toEqual([
      { name: 'Ana Lee', email: 'ana.lee@example.edu' },
      { name: 'Ben Cho', email: 'ben.cho@example.edu' },
    ])
  })

  it('skips blank lines but keeps real line numbers in errors', () => {
    const r = parseRoster('ana@example.edu\n\n\ndana')
    expect(r.valid).toHaveLength(1)
    expect(r.problems).toEqual([
      { lineNumber: 4, message: 'Line 4, “dana”, isn’t an email address. Fix it or remove it.' },
    ])
  })

  it('flags a duplicate email (case-insensitive) with the first line number', () => {
    const r = parseRoster('ana@example.edu\nben@example.edu\nANA@example.edu')
    expect(r.valid).toHaveLength(2)
    expect(r.problems).toEqual([
      { lineNumber: 3, message: 'Line 3, “ANA@example.edu”, is already on line 1. Remove one of them.' },
    ])
  })

  it('flags a line with two emails', () => {
    const r = parseRoster('a@example.edu b@example.edu')
    expect(r.problems[0].message).toBe('Line 1 has more than one email address. Put one student on each line.')
  })

  it('rejects an address with no domain dot', () => {
    expect(parseRoster('ana@localhost').problems).toHaveLength(1)
  })

  it('falls back to the email name when the leftover text is not a name', () => {
    expect(parseRoster('12345, ana.lee@example.edu').valid[0].name).toBe('Ana Lee')
  })
})

describe('nameFromEmail', () => {
  it('turns separators into spaces and capitalizes', () => {
    expect(nameFromEmail('gus.moore-jr@example.edu')).toBe('Gus Moore Jr')
  })
})

describe('validateRoundInput', () => {
  const now = new Date('2026-11-20T12:00:00Z')
  const good = {
    title: 'CSE 360 project demos',
    timezone: 'America/Phoenix',
    deadline: '2026-11-23T06:59:00.000Z',
    windows: [{ date: '2026-11-30', start: '14:00', end: '14:20', capacity: 1 }],
  }

  it('accepts a good round', () => {
    expect(validateRoundInput(good, now)).toBeNull()
  })

  it('needs a name', () => {
    expect(validateRoundInput({ ...good, title: '   ' }, now)).toBe('Give the round a name.')
  })

  it('needs a real time zone', () => {
    expect(validateRoundInput({ ...good, timezone: 'Mars/Olympus' }, now)).toBe('Pick a time zone for this round.')
  })

  it('needs a future deadline', () => {
    expect(validateRoundInput({ ...good, deadline: '2026-11-19T00:00:00Z' }, now)).toBe(
      'The deadline has passed. Pick a time in the future.',
    )
    expect(validateRoundInput({ ...good, deadline: 'soon' }, now)).toBe('Set a deadline for responses.')
  })

  it('needs at least one window', () => {
    expect(validateRoundInput({ ...good, windows: [] }, now)).toBe('Add at least one time window.')
  })

  it('caps the number of windows', () => {
    const w = Array.from({ length: 101 }, (_, i) => ({ date: '2026-11-30', start: '14:00', end: `15:${String(i % 60).padStart(2, '0')}`, capacity: 1 }))
    expect(validateRoundInput({ ...good, windows: w }, now)).toBe('Keep it to 100 windows per round.')
  })

  it('rejects a window that ends before it starts', () => {
    const w = [{ date: '2026-11-30', start: '14:20', end: '14:00', capacity: 1 }]
    expect(validateRoundInput({ ...good, windows: w }, now)).toBe('Window 1 ends before it starts. Fix its times.')
  })

  it('rejects zero or fractional seats', () => {
    for (const capacity of [0, 1.5, -1]) {
      const w = [{ date: '2026-11-30', start: '14:00', end: '14:20', capacity }]
      expect(validateRoundInput({ ...good, windows: w }, now)).toBe('Window 1 needs a whole number of seats, at least 1.')
    }
  })

  it('rejects a malformed date or time', () => {
    const w = [{ date: '11/30/2026', start: '14:00', end: '14:20', capacity: 1 }]
    expect(validateRoundInput({ ...good, windows: w }, now)).toBe('Window 1 needs a date, a start time and an end time.')
  })

  it('rejects two identical windows', () => {
    const w = [good.windows[0], good.windows[0]]
    expect(validateRoundInput({ ...good, windows: w }, now)).toBe('Windows 1 and 2 are the same time. Remove one.')
  })
})

describe('validateSubmission', () => {
  const ids = ['mon', 'wed', 'fri']

  it('accepts ranked yes answers', () => {
    expect(validateSubmission({ available: ['fri', 'mon'], noneWork: false, note: '' }, ids)).toBeNull()
  })

  it('accepts none-work with an empty list and a note', () => {
    expect(validateSubmission({ available: [], noneWork: true, note: 'Thursdays after 3' }, ids)).toBeNull()
  })

  it('rejects a window from another round', () => {
    expect(validateSubmission({ available: ['tue'], noneWork: false, note: '' }, ids)).toBe(
      'Your answer has a time that isn’t in this round. Reload the page and try again.',
    )
  })

  it('rejects the same window twice', () => {
    expect(validateSubmission({ available: ['mon', 'mon'], noneWork: false, note: '' }, ids)).toBe(
      'Your answer has a time that isn’t in this round. Reload the page and try again.',
    )
  })

  it('rejects none-work together with yes answers', () => {
    expect(validateSubmission({ available: ['mon'], noneWork: true, note: '' }, ids)).toBe(
      'You said none of the times work. Change your yes answers to no, or untick the box.',
    )
  })

  it('rejects an empty answer', () => {
    expect(validateSubmission({ available: [], noneWork: false, note: '' }, ids)).toBe(
      'Say yes to at least one time, or tick “None of these times work for me”.',
    )
  })

  it('rejects a note over 500 characters', () => {
    expect(validateSubmission({ available: [], noneWork: true, note: 'x'.repeat(501) }, ids)).toBe(
      'Keep your note to 500 characters.',
    )
  })

  it('rejects wrong types from a forged request', () => {
    expect(validateSubmission({ available: 'mon', noneWork: false, note: '' } as never, ids)).not.toBeNull()
  })
})

describe('isOpen', () => {
  const deadline = '2026-11-23T06:59:00.000Z'
  it('is open before the deadline', () => {
    expect(isOpen({ status: 'open', deadline }, new Date('2026-11-23T06:58:59Z'))).toBe(true)
  })
  it('is closed at the deadline', () => {
    expect(isOpen({ status: 'open', deadline }, new Date('2026-11-23T06:59:00Z'))).toBe(false)
  })
  it('is closed once a draft exists, whatever the clock says', () => {
    expect(isOpen({ status: 'closed', deadline }, new Date('2026-11-01T00:00:00Z'))).toBe(false)
  })
})
