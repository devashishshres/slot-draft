# SlotDraft

**Fair appointment scheduling for TAs.** Students say which times they can make, and SlotDraft fits in as many of them as possible.

---

## The problem

When a TA has a few demo or office-hour slots and a whole class to fit in, a first-come sign-up sheet rewards whoever answers first. It can also leave out a student who can only make one time, even when a flexible classmate could have moved.

## What SlotDraft does

1. The TA posts time windows and a class list.
2. Every student gets an email with their own link.
3. Students mark each window **Yes** or **No** and rank their Yes windows.
4. After the deadline, SlotDraft builds a draft that places **as many students as possible**.
5. The TA reviews the draft and publishes it. Students get an email and see their time in the app.

### Its promises

| Promise | What it means |
|---|---|
| **Most students placed** | No other schedule could fit more students. To do this, it may move a flexible student to their second choice so another student gets a time at all. |
| **Never a "No" time** | A student is only placed in a window they said Yes to. |
| **Answering early doesn't help** | The order students answer in has no effect on the result. |
| **Fair and repeatable** | Ties are broken by a random order that is saved with the round, so the same answers always give the same draft. |

---

## Try it

Open https://slotdraft.app.space, sign in with **Google or GitHub**, and click **Load sample round**. It is a 7-student class you can take from draft to publish. No emails are sent for the sample round.

---

## How it works

### For the TA (laptop)

| Step | What happens |
|---|---|
| **1. Create a round** | Enter a name, the time windows (each with a number of seats), a deadline, and the class list (one email per line; a Canvas export works). Mistakes in the list are flagged by line number. |
| **2. Open it** | **Open round and email students** emails each student their personal link. An Invite column shows **Sent**, **Not sent** or **Didn't go through** per student, with a retry button. |
| **3. Collect answers** | The response count and each student's answer update live, without refreshing. Until the deadline you can **Add students** (they're emailed right away) or **Remove** one (their answer is deleted too). |
| **4. Generate the draft** | Available once the deadline passes. It shows who is placed where, who isn't placed, and why. |
| **5. Try one more seat** | Each window shows what one extra seat would gain, for example "+1 seat: 5 of 6 placed". **Preview this seat** shows exactly who moves; **Apply this seat** keeps it. |
| **6. Publish** | Students see their time and get an email. A published round can't be changed or reopened. **Copy schedule as text** gives you a plain list to paste anywhere. |

### For a student (phone)

| Step | What happens |
|---|---|
| **1. Open the invite link** | Sign in with **any** Google or GitHub account. No password is needed, and the account's email doesn't have to match the class list. |
| **2. Answer** | Say Yes or No to each time, then rank the Yes times from **most preferred** to **least preferred**. If nothing works, tick **None of these times work** and leave a note for the TA. |
| **3. Change it if needed** | Answers can be changed until the deadline. |
| **4. See the result** | After the TA publishes: **You're scheduled** with the time and time zone, or **You're not scheduled yet** with the reason. The same result is emailed to the address on the class list. |

---

## Rules and limits

| Rule | Value |
|---|---|
| Sign-in | Google or GitHub only. DeepSpace has closed email sign-up for every app, so the personal invite link is how a student with any account answers. |
| Invite links | Each link can be used by **one** account: the first one to open it. A second account is refused. The TA opening a student's link never uses it up. |
| Deadline | Enforced by the server. A change sent after the deadline is refused, and the student is told their earlier answer is the one the TA has. |
| Draft visibility | Students can't see the draft until the TA publishes it. |
| Result emails | Sent to every student who answered, placed or not. Students who never answered get none. |
| Emails | Come from "DeepSpace Apps". Replying reaches the TA. |
| Time zone | Every time is shown in the round's time zone, with its label (for example MST). |
| Size limits | 300 students, 100 windows and 100 seats per window per round. Notes up to 500 characters. |
| Invite cap | 600 invite emails per TA per day. Each email costs the app owner, so this stops the app being used to send mail at scale. |

### Left out on purpose

Reminders, swaps between students, chat, calendar sync, reopening a published round, CSV export and dark mode. Each one adds state and edge cases without changing the core job: placing as many students as possible, fairly.

---

## Privacy and security

- **Who can read what:**

  | Data | Who can read it |
  |---|---|
  | Round settings and windows | Any signed-in user |
  | Class list, emails and invite tokens | Only the TA who made the round |
  | A student's answer | That student and the round's TA |
  | A draft seat | The TA only, until it is published. After that, that student too. |

- **Every write goes through a server action.** Each action checks who is calling, their role, the round's state, and then the input, so a forged request is refused.
- **No secrets in the repo or the browser.** DeepSpace holds the platform credentials. Local secret files (`.dev.vars`, `.env`) and test-account passwords are gitignored.

---

## How it's built

SlotDraft runs on the [DeepSpace SDK](https://docs.deep.space) and uses its built-in pieces rather than rebuilding them:

| DeepSpace piece | Used for |
|---|---|
| **RecordRoom** (live data store) with read rules | Storing rounds, answers and seats. The rules above are enforced here, so data a user may not see never reaches their browser. |
| **`useQuery`** | Live updates: the response count, invite status and student screens change without a refresh. |
| **Server actions** | The only way to write data (11 actions). |
| **Auth** | Google and GitHub sign-in. |
| **`email/send` integration** | Invite and result emails. A failed email is recorded and shown, and never blocks publishing. |
| **`deepspace/testing`** | Tests with several real accounts at once. |

**Stack:** React 19, Vite, Tailwind CSS, a Hono worker on Cloudflare Workers.

**The algorithm** ([src/lib/allocator.ts](src/lib/allocator.ts)) is plain TypeScript with no DeepSpace imports:

1. Shuffle the students in a random order, using the round's saved seed.
2. In that order, each student takes their highest-ranked window that still has room.
3. For each student left over, look for a chain of moves ("you move to your other Yes window, so I can take yours") that ends at an empty seat. If the chain ends at an empty seat, everyone in it moves. If it dead-ends, nobody does.

---

## Run it locally

**You need:** Node.js 22.15+, 24 or 26, npm 11.6+, and a DeepSpace account.

```bash
npm install
npx deepspace auth login     # once per machine
npx deepspace dev start      # http://localhost:5173
```

Sign in, then click **Load sample round**.

## Test it

```bash
npm run type-check                       # TypeScript
npx deepspace test run unit              # algorithm, parsing, time and email text
npx deepspace test run e2e --port 5174   # end-to-end, with several accounts at once
```

The end-to-end tests need four test accounts: `TA One`, `TA Two`, `Student One` and `Student Two`, all `@deepspace.test`. Create each once per machine:

```bash
npx deepspace test accounts create --email <name>@deepspace.test --name "<Name>" --password-stdin
```

Passwords stay in `~/.deepspace/`, never in the repo.

The tests send real invite emails to `@deepspace.test` addresses, which never reach a person. Each one is billed to the app owner.

## Deploy

```bash
npx deepspace deploy         # publishes to https://slotdraft.app.space
```

This app ships from GitHub, so `deploy` sends your **local checkout as it is**, including uncommitted changes. Commit and push first, so GitHub matches what's live.

---

## Where things live

| Path | What it is |
|---|---|
| [src/lib/allocator.ts](src/lib/allocator.ts) | The scheduling algorithm |
| [src/lib/rounds.ts](src/lib/rounds.ts) | Class-list parsing, input checks and size limits |
| [src/actions/index.ts](src/actions/index.ts) | All 11 server actions, plus the email text |
| [src/schemas/slotdraft.ts](src/schemas/slotdraft.ts) | The 5 collections (`rounds`, `windows`, `roster`, `submissions`, `assignments`) and who may read them |
| [src/pages/(app)/(protected)/rounds/](src/pages/(app)/(protected)/rounds/) | TA screens: rounds list, create round, and one round (collecting, draft, preview, published) |
| [src/pages/(app)/(protected)/r/[id].tsx](src/pages/(app)/(protected)/r/[id].tsx) | The student page (built for phones) |
| [tests/](tests/) | End-to-end tests: API rules, several users at once, invites and class-list changes, every UI state |
