/**
 * The "Load sample round" class (decisions P8, D11). One consistent story
 * across every screen: 7 on the roster, 6 responded, 4 of 6 placed, and only
 * +1 seat on Friday helps. Gus and Fay show the two different follow-up lists.
 *
 * Window `key`s are local names. `loadSampleRound` maps them to real record ids,
 * and the allocator tests use them as-is.
 */

export const SAMPLE_TITLE = 'CSE 360 project demos'
export const SAMPLE_TIMEZONE = 'America/Phoenix'

/**
 * Seed stored on the sample round, so its draft is the same for every reviewer.
 * TODO(Devashish): once allocate() exists, pick the seed whose draft leaves
 * Cara as the unplaced Friday student, to match the canvas. The sample test
 * in allocator.test.ts checks the counts for any seed.
 */
export const SAMPLE_SEED = 1

export interface SampleWindow {
  key: string
  date: string
  start: string
  end: string
  capacity: number
}

export const SAMPLE_WINDOWS: SampleWindow[] = [
  { key: 'mon', date: '2026-11-30', start: '14:00', end: '14:20', capacity: 1 },
  { key: 'wed1', date: '2026-12-02', start: '13:00', end: '13:20', capacity: 1 },
  { key: 'wed2', date: '2026-12-02', start: '13:20', end: '13:40', capacity: 1 },
  { key: 'fri', date: '2026-12-04', start: '14:00', end: '15:00', capacity: 2 },
]

export interface SampleStudent {
  id: string
  name: string
  email: string
  /** null = never answered (Fay). */
  response: { available: string[]; noneWork: boolean; note: string } | null
}

const GUS_NOTE =
  'I work Monday to Wednesday afternoons and have a lab on Friday from 2 to 4. I could come Thursday after 3 PM, or any weekday morning before 11 AM.'

export const SAMPLE_STUDENTS: SampleStudent[] = [
  { id: 'sample-ana', name: 'Ana Lee', email: 'ana.lee@example.edu', response: { available: ['fri'], noneWork: false, note: '' } },
  { id: 'sample-ben', name: 'Ben Cho', email: 'ben.cho@example.edu', response: { available: ['fri'], noneWork: false, note: '' } },
  { id: 'sample-cara', name: 'Cara Diaz', email: 'cara.diaz@example.edu', response: { available: ['fri'], noneWork: false, note: '' } },
  { id: 'sample-dan', name: 'Dan Ruiz', email: 'dan.ruiz@example.edu', response: { available: ['mon', 'wed1'], noneWork: false, note: '' } },
  { id: 'sample-eli', name: 'Eli Park', email: 'eli.park@example.edu', response: { available: ['wed1', 'mon'], noneWork: false, note: '' } },
  { id: 'sample-fay', name: 'Fay Kim', email: 'fay.kim@example.edu', response: null },
  { id: 'sample-gus', name: 'Gus Moore', email: 'gus.moore@example.edu', response: { available: [], noneWork: true, note: GUS_NOTE } },
]
