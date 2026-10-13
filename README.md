# Build Your Own Software Factory

You write an issue on your fork of socialify and drag its card to Ready on a GitHub
Projects board. The factory picks it up, moves the card across the board as it works,
and finishes with a draft pull request on your fork. Three open-weight models do the
work on DigitalOcean inference. You approve the plan in the middle and you review the
PR at the end.

```
Open → Ready → Triaging → Planning → Needs approval → Approved → Implementing → PR Review → Done
                              (small fixes skip planning) ↗            ↘ Needs help
```

We build it live at Global Hack Week: Hacktoberfest, one stage at a time. You start on
`master`, the empty starting point. Each step has a branch, so if you fall behind,
`git switch step-N` puts you where the stream is.

## Before you start

- Node 24 (socialify, the repo the factory works on, needs it) and pnpm
- macOS or Linux. On Windows, use WSL. On Linux, install bubblewrap (`apt install bubblewrap`) so verify runs isolated
- The GitHub CLI, logged in (`gh auth login`)
- A DigitalOcean model access key: Control Panel → Inference → Model Access Keys

## Setup

1. Fork socialify on GitHub (github.com/wei/socialify → Fork). The factory reads issues
   from your fork, edits code there, and opens PRs there.
2. Clone this repo. You're on `master`, the starting point.
   ```bash
   git clone https://github.com/wei/hf-software-factory && cd hf-software-factory
   pnpm install
   cp .env.example .env
   ```
3. In `.env`, paste your DigitalOcean key and set `TARGET_REPO=<you>/socialify`.
4. Give the GitHub CLI access to Projects, then build your board:
   ```bash
   gh auth refresh -s project
   pnpm board:setup
   ```
   `board:setup` turns on Issues for your fork (forks start with them off), creates a
   board called "HF Software Factory" with the factory's lanes and a Board view, links
   it to your fork, writes `PROJECT_OWNER` and `PROJECT_NUMBER` into `.env`, and clones
   your fork into `target/` with its dependencies. You can run it again; it reuses the
   same board. It prints your board's URL at the end.
5. Open the board. In the **Open** column, click **+ Add item → Create new issue →
   \<you>/socialify** and write your first issue. Something small works best, such as
   "Add Topography Hero Pattern to the backgrounds dropdown".

## How you run it

Every step uses the same loop:

```bash
pnpm factory
```

The watcher polls the board every 5 seconds (`BOARD_POLL_MS`). Drag a card from Open
to Ready and the factory picks it up. It leaves Open and cards with no Status alone,
so nothing starts until you drag. Run one watcher at a time. `pnpm factory 12` runs
issue #12 once and exits.

Prefer buttons? `pnpm dev` opens Mastra Studio at http://localhost:4111, where you can
run **Workflows → issue-to-pr** with an issue number and watch the graph.

## The starting point (`master`)

You add nothing yet. `master` holds the project, the DigitalOcean wiring, the board
helpers and `pnpm board:setup`. Run setup and create your first issue. If you run
`pnpm factory` here, it tells you to switch to step-1.

Files: `src/mastra/models.ts`, `src/mastra/github.ts`, `src/mastra/board.ts`,
`src/setup-board.ts`, `src/mastra/index.ts`.

## Step 1: triage (`git switch step-1`)

You add an intake step and a triage agent with a typed contract. Intake reads the
issue and its comments and puts a fresh branch for it in `target/`. Triage answers in
one exact shape: `{ type, labels, needsPlan, summary }`, checked by a Zod schema.

Files: `src/mastra/stages/triage.ts`, `src/mastra/workflows/issue-to-pr.ts`, `src/run.ts`.

Drag your card to Ready. It moves to **Triaging**, then to **Planning** if it needs a
plan or **Implementing** if it's a one-file fix. The run stops there and tells you
step-2 adds the next lane.

## Step 2: the plan and the human gate (`git switch step-2`)

You add a planner and a gate. First a reader agent opens the code the issue touches,
with read-only file tools. Then the planner reads the issue, its comments, socialify's
`AGENTS.md` and that code, and writes a plan. The plan ends with a "Test changes"
line naming any existing tests it needs to edit. Then the run suspends and the card
moves to **Needs approval**.

Files: `src/mastra/stages/plan.ts`.

Read the plan on the issue, where the factory posts it as a comment (it's in the
terminal too). Then move the card:

- **Approved** builds it.
- **Ready** asks for a new plan. Leave a comment on the issue first saying what to
  change. The factory cancels this run and starts over from triage, and both triage
  and the planner read your comment.
- **Open** parks it. Nothing happens until you drag it to Ready again.

Small fixes skip this step and go straight to Implementing. If you stop the watcher
while a card waits here, the run survives in `factory.db`. Start `pnpm factory` again
and it picks up where it left off.

## Step 3: the maintainer and the verify loop (`git switch step-3`)

You add a maintainer agent, a sandbox and the evidence gate. The maintainer gets five
tools: read, write, edit, list and grep. It can't delete files or run a shell. Its one
way to run anything is `verify`, which runs lint, typecheck and the unit tests related
to the files it changed. After the agent finishes, the workflow runs `verify` again
itself, and only that result counts. Three failed attempts send the card to
**Needs help**.

Files: `src/mastra/stages/implement.ts`.

Watch the card sit in **Implementing** while the agent works and verify decides.

## Step 4: the draft PR (`git switch step-4`)

You add the last stage: commit, push to your fork, and open a draft PR. The card moves
to **PR Review**. When you mark it ready and merge it, the watcher moves the card to
**Done**. You also add tracing, so Studio shows the tokens each agent spent.

Files: `src/mastra/stages/open-pr.ts`.

## Rules the factory follows

- It opens **draft** PRs only, and only on a repo you own. If `TARGET_REPO` belongs to
  someone else, the last step stops and the card goes to Needs help.
- Needs help means the factory failed: three failed verify attempts, the owner check,
  or an error. Rejecting a plan never sends a card there. To retry, fix the issue or add a
  comment, then drag the card back to Ready. The factory never picks up cards in Needs help.
- Each maintainer attempt gets 8 minutes (`MAINTAINER_TIMEOUT_MS`). A model that hangs
  counts as a failed attempt, so a stuck card still ends up in Needs help.
- The agent may add new tests. It may change an existing test or snapshot only if the
  approved plan lists that file. Editing `biome.json`, `tsconfig*.json`,
  `jest.config.*`, `package.json`, the lockfile or `.github/`, or adding `@ts-ignore`,
  `@ts-expect-error`, `biome-ignore` or `eslint-disable`, fails the attempt.
- Commands run under OS isolation (seatbelt on macOS, bubblewrap on Linux), so they
  can only write inside `target/`. Network stays on because socialify's font tests
  download fonts.

## Swapping models

`src/mastra/models.ts` holds three model ids. DigitalOcean lists the rest at
`GET https://inference.do-ai.run/v1/models`. Mastra's `digitalocean/` provider reads
`DIGITALOCEAN_ACCESS_TOKEN` from `.env`, so changing an id is the whole change.

## Hacktoberfest

Point the factory at your own fork. Read every PR it drafts, and put your own name on
anything you send upstream.
