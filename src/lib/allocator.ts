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
 * Ownership: Claude Code wrote this whole file and its tests. The bodies of
 * `allocate()` and `tryPlace()` were first reserved for Devashish (decision
 * Q3); on Nov 23 he asked Claude Code to write them (decision Q5).
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

/** Everything the chain search needs to look at and change while building one draft. */
interface Draft {
  /** Seats per window. */
  capacity: Map<WindowId, number>
  /** Each student's Yes windows, best first. */
  available: Map<StudentId, WindowId[]>
  /** Who sits in each window right now. This is the only thing that changes. */
  seats: Map<WindowId, StudentId[]>
}

/**
 * Build the draft.
 *
 * The rule, in one breath: sort students by id, shuffle with the seeded PRNG,
 * let each pick their best window that still has room; then, for each
 * unplaced student, look for a chain of moves. Move a student only after you
 * know they have somewhere to go; if the chain reaches an open seat, commit
 * every move; if it dead-ends, nobody moves.
 *
 * Why this places the maximum (promise 2): the chain search is the classic
 * "augmenting path" step of bipartite matching (Kuhn's algorithm). A draft
 * that no chain can grow is a maximum matching, and a student for whom no
 * chain exists now will never get one later in the same run, so one pass over
 * the unplaced students is enough.
 */
export function allocate(input: AllocInput): AllocResult {
  const draft: Draft = {
    capacity: new Map(input.windows.map((w) => [w.id, w.capacity])),
    available: new Map(input.responses.map((r) => [r.studentId, r.available])),
    seats: new Map(input.windows.map((w) => [w.id, []])),
  }

  // The draw order depends only on the ids and the seed, never on the order
  // submissions arrived in (promise 3).
  const order = seededShuffle([...draft.available.keys()], input.seed)

  // 1. Serial pick: in draw order, each student takes their best window with room.
  const waiting: StudentId[] = []
  for (const student of order) {
    const best = (draft.available.get(student) ?? []).find((w) => hasRoom(draft, w))
    if (best) draft.seats.get(best)?.push(student)
    else waiting.push(student)
  }

  // 2. Chains: each student still waiting (in draw order) gets one search,
  //    with a fresh `visited` set.
  for (const student of waiting) tryPlace(student, draft, new Set())

  // 3. Read the result off the seats.
  const assignments: Record<StudentId, WindowId> = {}
  for (const [windowId, students] of draft.seats) {
    for (const student of students) assignments[student] = windowId
  }
  const unplaced = order.filter((s) => !(s in assignments)).sort()
  return { assignments, unplaced }
}

function hasRoom(draft: Draft, windowId: WindowId): boolean {
  return (draft.seats.get(windowId)?.length ?? 0) < (draft.capacity.get(windowId) ?? 0)
}

/**
 * Try to seat `student`, moving others along a chain if needed.
 *
 * For each of the student's windows, best first:
 *   - a seat is open: sit down. The chain ends here, so it succeeds.
 *   - it's full: ask each person sitting there, "can YOU move somewhere
 *     else?" (the same question, one level deeper). If one of them can, they
 *     have already moved by the time the call returns, so take their seat.
 *
 * Seats change only on the way back from a successful search, so a chain that
 * dead-ends changes nothing (promise 5). `visited` makes each window part of
 * at most one step of the chain, which stops loops (A to B to A) and keeps it fast.
 * Returns true if the student was seated.
 */
function tryPlace(student: StudentId, draft: Draft, visited: Set<WindowId>): boolean {
  for (const windowId of draft.available.get(student) ?? []) {
    const seated = draft.seats.get(windowId)
    if (!seated || visited.has(windowId)) continue // not in this round, or already in this chain
    visited.add(windowId)

    if (seated.length < (draft.capacity.get(windowId) ?? 0)) {
      seated.push(student)
      return true
    }
    for (let i = 0; i < seated.length; i++) {
      const occupant = seated[i]
      if (occupant !== undefined && tryPlace(occupant, draft, visited)) {
        seated[i] = student // the occupant moved on, so `student` takes their seat
        return true
      }
    }
  }
  return false
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
