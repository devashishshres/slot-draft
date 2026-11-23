import { describe, expect, it } from 'vitest'
import { resultEmail } from './index'
import type { Assignment, Round, RosterRow } from '../schemas/slotdraft'

const round = {
  recordId: 'r1',
  data: { title: 'CSE 360 project demos', timezone: 'America/Phoenix' } as Round,
  createdAt: '',
  updatedAt: '',
  createdBy: '',
}
const student: RosterRow = { roundId: 'r1', name: 'Ana Lee', email: 'ana@example.edu', userId: 'u1', organizerId: 'ta' }
const assignment = (patch: Partial<Assignment>): Assignment => ({
  roundId: 'r1', studentId: 'u1', windowId: '', rank: 0, reason: '', published: true,
  readerId: 'u1', organizers: ['ta'], emailStatus: '', groupSize: 0, ...patch,
})

describe('resultEmail', () => {
  it('tells a placed student their time, zone, group and link', () => {
    const fri = { roundId: 'r1', date: '2026-12-04', start: '14:00', end: '15:00', capacity: 3 }
    const m = resultEmail(round, student, fri, assignment({ windowId: 'w', rank: 1, groupSize: 3 }), 3, 'slotdraft')
    expect(m.subject).toBe('SlotDraft: your CSE 360 project demos time is Fri, Dec 4')
    expect(m.text).toContain('Friday, Dec 4, 2:00–3:00 PM MST')
    expect(m.text).toContain("It's a group session with 2 other students.")
    expect(m.text).toContain('https://slotdraft.app.space/r/r1')
  })

  it('explains why an answered student was not placed', () => {
    const none = resultEmail(round, student, undefined, assignment({ reason: 'none-work' }), 0, 'slotdraft')
    expect(none.subject).toBe("SlotDraft: you're not scheduled yet for CSE 360 project demos")
    expect(none.text).toContain('Your TA has your note')
    const full = resultEmail(round, student, undefined, assignment({ reason: 'full' }), 0, 'slotdraft')
    expect(full.text).toContain('The times you could make filled up.')
  })
})
