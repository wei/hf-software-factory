import { readFile } from 'node:fs/promises'
import { Agent } from '@mastra/core/agent'
import { createStep, createWorkflow } from '@mastra/core/workflows'
import { LocalFilesystem, WORKSPACE_TOOLS, Workspace } from '@mastra/core/workspace'
import { z } from 'zod'
import { moveTo } from '../board'
import { TARGET_DIR, TARGET_REPO, sh } from '../github'
import { models } from '../models'
import { Triaged } from './triage'

export const Planned = Triaged.extend({ plan: z.string(), testChanges: z.array(z.string()), notes: z.string() })

const FS = WORKSPACE_TOOLS.FILESYSTEM

const readOnly = new Workspace({
  filesystem: new LocalFilesystem({ basePath: TARGET_DIR, readOnly: true }),
  tools: { enabled: false, [FS.READ_FILE]: { enabled: true }, [FS.LIST_FILES]: { enabled: true }, [FS.GREP]: { enabled: true } },
})

export const plannerAgent = new Agent({
  id: 'planner',
  name: 'Planner',
  instructions: `You plan changes for the target repo. Output a short markdown plan:
files to touch, the change in each, and how the tests prove it works.
Name only files you were shown or that appear in the Files list.
Follow the repo's AGENTS.md. If the issue's premise is wrong, say so instead of planning.
If the plan must change existing test or snapshot files, give each one a one-line reason.
End with one line: "Test changes: <comma-separated paths>" or "Test changes: none".`,
  model: models.planner,
})

// The reader opens the code the issue touches. Read-only: it can't change a file.
// It writes no plan; the planner gets the files it opened.
export const readerAgent = new Agent({
  id: 'reader',
  name: 'Reader',
  instructions: `Find and open the files a change for this issue would touch, plus one example
of similar existing code. Use grep to locate them. Don't write a plan.`,
  model: models.planner,
  workspace: readOnly,
})

// The context compiler: pick what the planner sees. Everything else stays out.
const planStep = createStep({
  id: 'plan',
  inputSchema: Triaged,
  outputSchema: Triaged.extend({ plan: z.string(), testChanges: z.array(z.string()) }),
  execute: async ({ inputData: work }) => {
    const rules = await readFile(`${TARGET_DIR}/AGENTS.md`, 'utf8')
    const files = await sh('git', ['ls-files', 'app', 'src', 'common'])
    const issue = `Issue #${work.number}: ${work.title}\n${work.body}\n\nComments (feedback on earlier plans):\n${work.comments || 'none'}\n\nTriage: ${work.triage.summary}`
    const signal = AbortSignal.timeout(180_000)
    const read = await readerAgent.generate(`${issue}\n\nFiles:\n${files}`, { maxSteps: 8, abortSignal: signal })
    const opened = [...new Set(read.steps.flatMap((s) => s.toolCalls).filter((c) => c.payload.toolName === FS.READ_FILE).map((c) => (c.payload.args as { path: string }).path))]
    const code = (await Promise.all(opened.map(async (f) => `--- ${f}\n${(await readFile(`${TARGET_DIR}/${f}`, 'utf8').catch(() => '')).slice(0, 6000)}`))).join('\n\n')
    const res = await plannerAgent.generate(`${issue}\n\nAGENTS.md:\n${rules}\n\nCode the reader opened:\n${code}\n\nFiles:\n${files}`, { abortSignal: signal })
    if (!res.text) throw new Error('The planner returned no plan (timed out?)')
    // Existing tests the plan may edit. The human approves this list along with the plan.
    const line = res.text.match(/^\W*Test changes:\s*(.*)$/im)?.[1] ?? ''
    const testChanges = line.split(',').map((s) => s.replace(/[`*]/g, '').trim()).filter((s) => s && !/^none\b/i.test(s))
    // Models like to open with their own "## Plan" heading; the PR body already has one.
    return { ...work, plan: res.text.replace(/^#+\s*Plan\s*\n+/i, ''), testChanges }
  },
})

// The human gate: the run stops here until someone approves the plan.
const gateStep = createStep({
  id: 'human-gate',
  inputSchema: Triaged.extend({ plan: z.string(), testChanges: z.array(z.string()) }),
  outputSchema: Planned,
  suspendSchema: z.object({ plan: z.string(), testChanges: z.array(z.string()) }),
  resumeSchema: z.object({ approved: z.boolean(), notes: z.string() }),
  execute: async ({ inputData: work, resumeData, suspend }) => {
    // To reject, a human comments on the issue and drags the card back to Ready:
    // the runner cancels this run and a fresh one re-triages with the comment.
    if (!resumeData?.approved) {
      // Post the plan where the reviewer is: on the issue the card links to.
      const body = `**Plan from the factory**\n\n${work.plan}\n\nDrag the card to Approved to build it. To change it, comment here and drag it back to Ready.`
      await sh('gh', ['issue', 'comment', String(work.number), '-R', TARGET_REPO, '--body', body], '.')
      await moveTo(work.number, 'Needs approval')
      return suspend({ plan: work.plan, testChanges: work.testChanges })
    }
    return { ...work, notes: resumeData.notes }
  },
})

export const planAndGate = createWorkflow({ id: 'plan-and-gate', inputSchema: Triaged, outputSchema: Planned })
  .then(planStep)
  .then(gateStep)
  .commit()

// Small, obvious issues skip planning and go straight to the maintainer.
export const fastLane = createStep({
  id: 'fast-lane',
  inputSchema: Triaged,
  outputSchema: Planned,
  execute: async ({ inputData }) => ({ ...inputData, plan: '', testChanges: [], notes: '' }),
})
