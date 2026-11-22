/**
 * SlotDraft allocator — pure TypeScript, no DeepSpace imports, so it runs the
 * same in Vitest, in the worker (server actions) and in a REPL.
 *
 * Contract (CLAUDE.md §5). Each promise has a test in allocator.test.ts:
 *   1. Never assigns a student to a window not in their `available` list.
 *   2. Places the maximum possible number of students.
 *   3. Submission order has no effect: same seed + same responses in any
 *      order → identical result.
 *   4. Adding one seat changes the placed count by exactly 0 or 1.
 *   5. A failed chain leaves existing assignments unchanged.
 *
 * Ownership (decision Q3): Devashish writes the bodies of `allocate()` and
 * `tryPlace()`. Claude Code wrote the types, `mulberry32`, `seededShuffle`,
 * `previewSeat` and the tests.
 */

export type WindowId = string
export type StudentId = string

export interface AllocWindow {
  id: WindowId
  capacity: number
}

/** `available` is ranked, best first. An empty list means "none of these times work". */
export interface AllocResponse {
  studentId: StudentId
  available: WindowId[]
}

export interface AllocInput {
  windows: AllocWindow[]
  responses: AllocResponse[]
  seed: number
}

/**
 * `assignments` maps every placed student to their window.
 * `unplaced` lists everyone else, sorted by id, so two results compare with a
 * plain deep-equal (that is how the promise-3 test checks order independence).
 */
export interface AllocResult {
  assignments: Record<StudentId, WindowId>
  unplaced: StudentId[]
}

/**
 * What one extra seat in a window would do.
 * `assignments` is the whole previewed draft. The preview screen draws the
 * full seating chart, so it needs more than the count (decision A5).
 */
export interface SeatPreview {
  placed: number
  /** Students whose window differs from the current draft, newly placed ones included. Sorted by id. */
  moved: StudentId[]
  assignments: Record<StudentId, WindowId>
}

/**
 * Small seeded PRNG (mulberry32). Returns floats in [0, 1).
 * The same seed always gives the same sequence, which is what makes a stored
 * seed reproduce the same draw order for every preview (decision A3).
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * Sort ids, then Fisher–Yates shuffle with the seeded PRNG (decision A2).
 * Sorting first means the input order never matters: only the set of ids and
 * the seed decide the output. `allocate()` should take its draw order from
 * here, and the tests rely on that.
 */
export function seededShuffle(ids: readonly string[], seed: number): string[] {
  const out = [...ids].sort()
  const random = mulberry32(seed)
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

/**
 * Build the draft.
 *
 * The rule, in one breath: sort students by id, shuffle with the seeded PRNG
 * (`seededShuffle(ids, input.seed)`), let each pick their best window that
 * still has room; then, for each unplaced student, look for a chain of moves.
 * Move a student only after you know they have somewhere to go; if the chain
 * reaches an open seat, commit every move; if it dead-ends, nobody moves.
 *
 * TODO(Devashish): write this body and `tryPlace()` (decision Q3).
 * `npm run test:unit` runs allocator.test.ts, which covers every promise above.
 */
export function allocate(input: AllocInput): AllocResult {
  void input
  throw new Error('allocate() not written yet (Q3): Devashish writes this body')
}

/**
 * Suggested helper for the chain search. The signature is yours to change.
 * Returns true and commits the moves if `studentId` can be seated, possibly
 * by moving others along a chain. `visited` stops the search from looping
 * through the same window twice in one attempt.
 *
 * TODO(Devashish): write this body (decision Q3).
 */
export function tryPlace(
  studentId: StudentId,
  seats: Map<WindowId, StudentId[]>,
  visited: Set<WindowId>,
): boolean {
  void studentId
  void seats
  void visited
  throw new Error('tryPlace() not written yet (Q3): Devashish writes this body')
}

/**
 * Preview one more seat in `windowId` without writing anything. Runs the
 * allocator twice with the SAME seed (decision A3), so the extra seat is the
 * only thing that changes between the two runs.
 */
export function previewSeat(input: AllocInput, windowId: WindowId): SeatPreview {
  const before = allocate(input)
  const after = allocate({
    ...input,
    windows: input.windows.map((w) => (w.id === windowId ? { ...w, capacity: w.capacity + 1 } : w)),
  })
  const moved = Object.keys(after.assignments)
    .filter((s) => after.assignments[s] !== before.assignments[s])
    .sort()
  return { placed: Object.keys(after.assignments).length, moved, assignments: after.assignments }
}
