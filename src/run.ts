// pnpm factory          watch the board: run each card a human drags to Ready
// pnpm factory 12       run one issue by number, then exit
// Studio does the same with buttons. This is the terminal version.
import { POLL_MS, cards, moveTo, nextReady, sweep, waitFor } from './mastra/board'
import { mastra } from './mastra'
import { next } from './mastra/workflows/issue-to-pr'

const workflow = mastra.getWorkflow('issueToPr')
type Run = Awaited<ReturnType<typeof workflow.createRun>>
type Result = Awaited<ReturnType<Run['start']>>

// Drive a run through the plan gate. No result means a re-attached run already waiting there.
async function drive(issue: number, run: Run, result?: Result) {
  while (!result || result.status === 'suspended') {
    const plan = result && (Object.values(result.suspendPayload ?? {})[0] as { plan?: string })?.plan
    console.log(plan ? `\n--- plan for #${issue} ---\n${plan}\n` : `#${issue} is waiting at the plan gate`)
    console.log('Approved: build it. Ready: comment first, then replan. Open: park it.')
    const decision = await waitFor(issue, ['Approved', 'Ready', 'Open'])
    if (decision !== 'Approved') {
      await run.cancel() // Ready: the watcher starts a fresh run that reads your comment. Open: parked.
      return console.log(`#${issue} ${decision === 'Ready' ? 'sent back for a new plan' : 'parked'}`)
    }
    result = await run.resume({ ...(result && { step: result.suspended[0] }), resumeData: { approved: true, notes: '' } })
  }
  if (result.status !== 'success') await moveTo(issue, 'Needs help') // any failure lands where a human looks
  console.log(JSON.stringify(result.status === 'success' ? result.result : result.status, null, 2))
  if (result.status === 'success' && next) console.log(next)
}

async function runIssue(issue: number) {
  const run = await workflow.createRun({ resourceId: `issue-${issue}` }) // findable after a restart
  await drive(issue, run, await run.start({ inputData: { issue } }))
}

// After a restart: pick up runs waiting at the plan gate, or approved while the watcher was down.
// Their state lives in factory.db.
async function reattach() {
  for (const card of (await cards()).filter((c) => c.status === 'Needs approval' || c.status === 'Approved')) {
    const n = card.content.number
    const { runs } = await workflow.listWorkflowRuns({ resourceId: `issue-${n}` })
    const waiting = runs.find((r) => (typeof r.snapshot === 'string' ? JSON.parse(r.snapshot) : r.snapshot).status === 'suspended')
    if (waiting) await drive(n, await workflow.createRun({ runId: waiting.runId, resourceId: `issue-${n}` }))
  }
}

const one = Number(process.argv[2])
if (one) await runIssue(one)
else {
  console.log('Watching the board. Drag a card from Open to Ready to start it.')
  // One watcher at a time: nothing makes the Ready → Triaging claim atomic across processes.
  await reattach()
  for (;;) {
    // A failed poll (rate limit, network blip) waits a beat instead of killing the watcher.
    const issue = await sweep()
      .then(nextReady)
      .catch((e) => console.error('Board poll failed, retrying:', e.message.trim().split('\n').at(-1)))
    if (issue)
      await runIssue(issue).catch(async (e) => {
        console.error(`#${issue} failed:`, e.message)
        await moveTo(issue, 'Needs help')
      })
    else await new Promise((r) => setTimeout(r, POLL_MS))
  }
}
