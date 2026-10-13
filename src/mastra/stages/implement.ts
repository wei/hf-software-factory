import { Agent } from '@mastra/core/agent'
import { createTool } from '@mastra/core/tools'
import { createStep } from '@mastra/core/workflows'
import { LocalFilesystem, LocalSandbox, WORKSPACE_TOOLS, Workspace, getRecommendedIsolation } from '@mastra/core/workspace'
import { z } from 'zod'
import { moveTo } from '../board'
import { TARGET_DIR, sh } from '../github'
import { models } from '../models'
import { Planned } from './plan'

const FS = WORKSPACE_TOOLS.FILESYSTEM

// One sandbox for the agent AND the verifier. Swap LocalSandbox for Docker,
// a microVM, or a cloud sandbox and nothing else changes.
export const workspace = new Workspace({
  filesystem: new LocalFilesystem({ basePath: TARGET_DIR }),
  sandbox: new LocalSandbox({
    workingDirectory: TARGET_DIR,
    env: { PATH: process.env.PATH, HOME: process.env.HOME, CI: '1' },
    timeout: 300_000,
    isolation: getRecommendedIsolation(), // seatbelt on macOS, bwrap on Linux: writes only inside target/
    nativeSandbox: { allowNetwork: true }, // socialify's font tests download fonts from unpkg.com
  }),
  // Allowlist: the agent reads and edits files. No delete, no shell. verify is its only command.
  tools: {
    enabled: false,
    [FS.READ_FILE]: { enabled: true },
    [FS.WRITE_FILE]: { enabled: true },
    [FS.EDIT_FILE]: { enabled: true },
    [FS.LIST_FILES]: { enabled: true },
    [FS.GREP]: { enabled: true },
  },
})

// The evidence gate. The agent can call it, but it can't change what it checks.
const CHECK_CONFIG = /^(biome\.json|tsconfig.*\.json|jest\.config\..*|package\.json|pnpm-lock\.yaml|\.github\/)/
const SUPPRESSION = /^\+.*(@ts-ignore|@ts-expect-error|biome-ignore|eslint-disable)/m
const isTest = (f: string) => /\.test\.|__snapshots__/.test(f)
let allowedTestEdits: string[] = [] // from the approved plan; ponytail: module state, fine for one watcher

export async function verify() {
  await sh('git', ['add', '--intent-to-add', '.']) // so new files show up in the diff
  const changes = (await sh('git', ['diff', '--no-renames', '--name-status', 'HEAD'])).split('\n').filter(Boolean).map((l) => l.split('\t'))
  if (!changes.length) return { passed: false, log: 'No changes yet.' }
  for (const [status, f] of changes) {
    if (CHECK_CONFIG.test(f)) return { passed: false, log: `edited ${f}, a check config. Revert it.` }
    if (status !== 'A' && isTest(f) && !allowedTestEdits.includes(f))
      return { passed: false, log: `edited ${f}, which the approved plan doesn't list. Revert it, or add a new test file.` }
  }
  if (SUPPRESSION.test(await sh('git', ['diff', 'HEAD']))) return { passed: false, log: 'added a suppression comment. Fix the code instead.' }
  const code = changes.filter(([status, f]) => status !== 'D' && /\.(ts|tsx|js|jsx)$/.test(f)).map(([, f]) => f)
  // Only the tests related to the changed files, so one attempt takes seconds.
  const tests = `node_modules/.bin/jest --passWithNoTests --findRelatedTests ${code.join(' ')}`
  for (const cmd of ['node_modules/.bin/biome ci .', 'node_modules/.bin/tsc --noEmit', ...(code.length ? [tests] : [])]) {
    const r = await workspace.sandbox!.executeCommand!(cmd)
    if (r.exitCode !== 0) return { passed: false, log: `$ ${cmd}\n${(r.stdout + r.stderr).slice(-4000)}` }
  }
  return { passed: true, log: 'lint, typecheck and related unit tests pass' }
}

export const verifyTool = createTool({
  id: 'verify',
  description: 'Run lint, typecheck and unit tests. Call this before you finish.',
  inputSchema: z.object({}),
  outputSchema: z.object({ passed: z.boolean(), log: z.string() }),
  execute: verify,
})

export const maintainerAgent = new Agent({
  id: 'maintainer',
  name: 'Maintainer',
  instructions: `You are a TypeScript maintainer working in the target repo.
Follow the approved plan. Make the smallest correct change.
Read AGENTS.md first and follow it, including the .changeset/*.md rule.
You may add new tests. Only change an existing test or snapshot if the plan's "Test changes" line lists it.
Never add @ts-ignore or disable a lint rule.
You can't run shell commands. Call the verify tool to run lint, typecheck and tests.
If the plan is wrong, say so and stop.`,
  model: models.maintainer,
  workspace,
  tools: { verifyTool },
})

export const Work = Planned.extend({ attempts: z.number().optional(), passed: z.boolean().optional(), log: z.string().optional() })

export const implementStep = createStep({
  id: 'implement',
  inputSchema: Work,
  outputSchema: Work,
  execute: async ({ inputData: work }) => {
    const attempts = (work.attempts ?? 0) + 1
    allowedTestEdits = work.testChanges
    if (attempts === 1) await moveTo(work.number, 'Implementing')
    const retry = work.log ? `\n\nYour last attempt failed verification:\n${work.log}` : ''
    // A hung model call counts as a failed attempt instead of stalling the card forever.
    const signal = AbortSignal.timeout(Number(process.env.MAINTAINER_TIMEOUT_MS ?? 480_000))
    await maintainerAgent
      .generate(
        `Issue #${work.number}: ${work.title}\n${work.body}\n\nPlan:\n${work.plan || work.triage.summary}\n` +
          `Reviewer notes: ${work.notes || 'none'}${retry}`,
        { maxSteps: 40, abortSignal: signal },
      )
      .catch((e) => console.error(`maintainer: ${e.message}`))
    // The step re-checks; the agent's word is not evidence.
    const result = signal.aborted ? { passed: false, log: 'The maintainer timed out. Make a smaller change.' } : await verify()
    if (!result.passed && attempts >= 3) await moveTo(work.number, 'Needs help')
    return { ...work, attempts, ...result }
  },
})
