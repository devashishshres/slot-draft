# SlotDraft

Fair appointment scheduling for TAs. Opening a round emails each student their own link. Students say which time windows they can make and rank them. After the deadline, SlotDraft places the maximum possible number of students, never in a time they said no to, and answering early gives no advantage. The TA can preview what one more seat would change, then publish. Everyone gets an email.

Built on the [DeepSpace SDK](https://docs.deep.space): React + Vite frontend, Hono worker, a RecordRoom Durable Object for live data, server actions for every write, and the `email/send` integration for invites and results.

## Run it

```bash
npm install
npx deepspace auth login     # once per machine
npx deepspace dev start      # http://localhost:5173
```

Sign in, then click **Load sample round** to try the whole TA flow on a 7-student class (no emails are sent).

## Check it

```bash
npm run type-check
npx deepspace test run unit
npx deepspace test run e2e --port 5174
```

The multi-user tests need four test accounts: `TA One`, `TA Two`, `Student One` and `Student Two` (all `@deepspace.test`). Create each once per machine with `npx deepspace test accounts create --email <name>@deepspace.test --name "<Name>" --password-stdin`. Passwords stay in `~/.deepspace/`, never in the repo.

## Where things live

| Path | What it is |
|---|---|
| `src/lib/allocator.ts` | The draft algorithm: pure TypeScript, no DeepSpace imports |
| `src/actions/index.ts` | Every write: 11 server actions, each checks caller, role, round state, then input |
| `src/schemas/slotdraft.ts` | The 5 collections and who may read them |
| `src/pages/(app)/(protected)/rounds/` | TA screens: rounds list, create round, one round (collecting, draft, preview, published) |
| `src/pages/(app)/(protected)/r/[id].tsx` | The student link (phone layout) |
| `tests/` | Playwright end-to-end tests (multi-user, via `deepspace/testing`) |
