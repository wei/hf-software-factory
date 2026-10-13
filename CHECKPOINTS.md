# Checkpoints

You start on `master`. Each step is a branch that builds on the one before it, and
`git switch step-N` jumps there. `step-4` is the whole factory.

| Branch | Adds | The card ends in |
|--------|------|------------------|
| `master` | Project, DigitalOcean wiring, `models.ts`, board helpers, `pnpm board:setup` | Open, where you create it |
| `step-1` | `stages/triage.ts`, `workflows/issue-to-pr.ts`, the real `src/run.ts` | Triaging, then Planning or Implementing |
| `step-2` | `stages/plan.ts` | Needs approval, then Approved (small fixes go straight to Implementing) |
| `step-3` | `stages/implement.ts` | Implementing, or Needs help after 3 failed attempts |
| `step-4` | `stages/open-pr.ts`, tracing in `index.ts` | PR Review, then Done when you merge |

Between steps, `src/mastra/workflows/issue-to-pr.ts` and `src/mastra/index.ts` change,
and `src/run.ts` changes once (master → step-1). Every other file only gets added. On `master`, `pnpm factory` tells you to switch to
step-1. On each step, a run stops at that step's last lane and names the step that adds
the next one.
