/**
 * Allocator tests. Every promise in allocator.ts has a test here.
 * Until Devashish writes allocate(), every test that calls it fails with
 * "allocate() not written yet (Q3)". That is the expected red state.
 */
import { describe, expect, it } from 'vitest'
import {
  allocate,
  mulberry32,
  previewSeat,
  seededShuffle,
  type AllocInput,
  type AllocResult,
} from './allocator'
import { SAMPLE_SEED, SAMPLE_STUDENTS, SAMPLE_WINDOWS } from './sample'

/** First seed (1..10000) whose draw order is exactly `order`. Lets a test pin the order. */
function seedFor(order: string[]): number {
  for (let seed = 1; seed <= 10_000; seed++) {
    if (seededShuffle(order, seed).join() === order.join()) return seed
  }
  throw new Error(`no seed gives order ${order.join(', ')}`)
}

const placedCount = (r: AllocResult) => Object.keys(r.assignments).length

describe('seededShuffle', () => {
  it('is deterministic for a seed', () => {
    expect(seededShuffle(['c', 'a', 'b', 'd'], 42)).toEqual(seededShuffle(['c', 'a', 'b', 'd'], 42))
  })

  it('ignores input order (sorts before shuffling)', () => {
    expect(seededShuffle(['d', 'c', 'b', 'a'], 7)).toEqual(seededShuffle(['a', 'b', 'c', 'd'], 7))
  })

  it('returns a permutation of the input', () => {
    expect(seededShuffle(['x', 'y', 'z'], 3).sort()).toEqual(['x', 'y', 'z'])
  })

  it('mulberry32 stays in [0, 1)', () => {
    const r = mulberry32(123)
    for (let i = 0; i < 1000; i++) {
      const v = r()
      expect(v >= 0 && v < 1).toBe(true)
    }
  })
})

describe('allocate: hand-picked cases', () => {
  it('Ana/Ben: a chain moves Ana to Friday so Ben gets Monday', () => {
    // One seat each on Monday and Friday. Ana prefers Monday but can make
    // Friday; Ben can only make Monday. Draw order [Ana, Ben].
    const seed = seedFor(['ana', 'ben'])
    expect(seededShuffle(['ana', 'ben'], seed)).toEqual(['ana', 'ben'])
    const result = allocate({
      windows: [{ id: 'mon', capacity: 1 }, { id: 'fri', capacity: 1 }],
      responses: [
        { studentId: 'ana', available: ['mon', 'fri'] },
        { studentId: 'ben', available: ['mon'] },
      ],
      seed,
    })
    expect(result).toEqual({ assignments: { ana: 'fri', ben: 'mon' }, unplaced: [] })
  })

  it('a chain needing two moves', () => {
    // Order [x, y, z]: x takes a, y takes b, z only fits a.
    // Chain: z → a (x moves) → x to b (y moves) → y to c (open).
    const seed = seedFor(['x', 'y', 'z'])
    const result = allocate({
      windows: [{ id: 'a', capacity: 1 }, { id: 'b', capacity: 1 }, { id: 'c', capacity: 1 }],
      responses: [
        { studentId: 'x', available: ['a', 'b'] },
        { studentId: 'y', available: ['b', 'c'] },
        { studentId: 'z', available: ['a'] },
      ],
      seed,
    })
    expect(result).toEqual({ assignments: { x: 'b', y: 'c', z: 'a' }, unplaced: [] })
  })

  it('a failed chain leaves the draft unchanged (promise 5)', () => {
    // Order [w, x, y]: w takes b, x takes a, y only fits a.
    // Chain: y → a (x moves) → x to b (w moves) → w has nowhere: dead end.
    // Nobody moves: x stays on a, w stays on b.
    const seed = seedFor(['w', 'x', 'y'])
    const result = allocate({
      windows: [{ id: 'a', capacity: 1 }, { id: 'b', capacity: 1 }],
      responses: [
        { studentId: 'w', available: ['b'] },
        { studentId: 'x', available: ['a', 'b'] },
        { studentId: 'y', available: ['a'] },
      ],
      seed,
    })
    expect(result).toEqual({ assignments: { w: 'b', x: 'a' }, unplaced: ['y'] })
  })

  it('fills a multi-seat window up to its capacity', () => {
    const result = allocate({
      windows: [{ id: 'g', capacity: 2 }],
      responses: [
        { studentId: 'p', available: ['g'] },
        { studentId: 'q', available: ['g'] },
        { studentId: 'r', available: ['g'] },
      ],
      seed: 5,
    })
    expect(placedCount(result)).toBe(2)
    expect(Object.values(result.assignments)).toEqual(['g', 'g'])
    expect(result.unplaced).toHaveLength(1)
  })

  it('leaves an open seat that no unplaced student can attend', () => {
    const result = allocate({
      windows: [{ id: 'a', capacity: 1 }, { id: 'b', capacity: 1 }],
      responses: [
        { studentId: 'x', available: ['a'] },
        { studentId: 'y', available: ['a'] },
      ],
      seed: 9,
    })
    expect(placedCount(result)).toBe(1)
    expect(Object.values(result.assignments)).not.toContain('b')
    expect(result.unplaced).toHaveLength(1)
  })

  it('an empty available list means unplaced', () => {
    const result = allocate({
      windows: [{ id: 'a', capacity: 3 }],
      responses: [{ studentId: 'gus', available: [] }],
      seed: 1,
    })
    expect(result).toEqual({ assignments: {}, unplaced: ['gus'] })
  })

  it('gives an uncontested student their first choice', () => {
    const result = allocate({
      windows: [{ id: 'a', capacity: 1 }, { id: 'b', capacity: 1 }],
      responses: [{ studentId: 'solo', available: ['b', 'a'] }],
      seed: 1,
    })
    expect(result.assignments).toEqual({ solo: 'b' })
  })
})

describe('allocate: the sample round (D11)', () => {
  const input: AllocInput = {
    windows: SAMPLE_WINDOWS.map((w) => ({ id: w.key, capacity: w.capacity })),
    responses: SAMPLE_STUDENTS.filter((s) => s.response).map((s) => ({
      studentId: s.id,
      available: s.response!.available,
    })),
    seed: SAMPLE_SEED,
  }

  it('places 4 of 6', () => {
    expect(placedCount(allocate(input))).toBe(4)
  })

  it('+1 seat on Friday places 5; +1 anywhere else changes nothing', () => {
    expect(previewSeat(input, 'fri').placed).toBe(5)
    for (const key of ['mon', 'wed1', 'wed2']) expect(previewSeat(input, key).placed).toBe(4)
  })

  it('previewSeat on Friday only adds the unplaced Friday student', () => {
    const before = allocate(input)
    const preview = previewSeat(input, 'fri')
    const added = preview.moved.filter((s) => !(s in before.assignments))
    expect(added).toHaveLength(1)
    expect(['sample-ana', 'sample-ben', 'sample-cara']).toContain(added[0])
  })
})

// ---------------------------------------------------------------------------
// Property tests: 500 seeded random classes, compared with a brute-force oracle.
// ---------------------------------------------------------------------------

/** Random class: ≤6 students, ≤4 windows, capacity 1-2, random ranked subsets. */
function randomInput(caseSeed: number): AllocInput {
  const r = mulberry32(caseSeed)
  const int = (lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1))
  const windows = Array.from({ length: int(1, 4) }, (_, i) => ({ id: `w${i}`, capacity: int(1, 2) }))
  const responses = Array.from({ length: int(1, 6) }, (_, i) => {
    const subset = windows.filter(() => r() < 0.5).map((w) => w.id)
    return { studentId: `s${i}`, available: seededShuffle(subset, int(1, 1e6)) }
  })
  return { windows, responses, seed: int(1, 1e9) }
}

/** Most students placeable, by trying every assignment. Fine for ≤6 students × ≤4 windows. */
function bruteForceMax(input: AllocInput): number {
  const room = new Map(input.windows.map((w) => [w.id, w.capacity]))
  const go = (i: number): number => {
    if (i === input.responses.length) return 0
    let best = go(i + 1) // this student unplaced
    for (const w of input.responses[i].available) {
      const left = room.get(w) ?? 0
      if (left === 0) continue
      room.set(w, left - 1)
      best = Math.max(best, 1 + go(i + 1))
      room.set(w, left)
    }
    return best
  }
  return go(0)
}

describe('allocate: property tests (500 seeded cases)', () => {
  const cases = Array.from({ length: 500 }, (_, i) => randomInput(i + 1))

  it('promise 1 and capacity: every seat is in the student’s list, no window overfills', () => {
    for (const input of cases) {
      const result = allocate(input)
      const used = new Map<string, number>()
      for (const [student, window] of Object.entries(result.assignments)) {
        const response = input.responses.find((x) => x.studentId === student)!
        expect(response.available).toContain(window)
        used.set(window, (used.get(window) ?? 0) + 1)
      }
      for (const w of input.windows) expect(used.get(w.id) ?? 0).toBeLessThanOrEqual(w.capacity)
      // Everyone is placed or unplaced, never both, never missing.
      const all = [...Object.keys(result.assignments), ...result.unplaced].sort()
      expect(all).toEqual(input.responses.map((x) => x.studentId).sort())
      expect(result.unplaced).toEqual([...result.unplaced].sort())
    }
  })

  it('promise 2: places as many as the brute-force oracle', () => {
    for (const input of cases) expect(placedCount(allocate(input))).toBe(bruteForceMax(input))
  })

  it('promise 3: response and window order make no difference', () => {
    for (const [i, input] of cases.entries()) {
      const reordered: AllocInput = {
        ...input,
        responses: [...input.responses].reverse(),
        windows: [...input.windows].reverse(),
      }
      expect(allocate(reordered), `case ${i + 1}`).toEqual(allocate(input))
    }
  })

  it('promise 4: one more seat changes placed by exactly 0 or 1', () => {
    for (const input of cases) {
      const placed = placedCount(allocate(input))
      for (const w of input.windows) {
        const delta = previewSeat(input, w.id).placed - placed
        expect([0, 1]).toContain(delta)
      }
    }
  })
})
