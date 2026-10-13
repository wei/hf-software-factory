import { createWorkflow } from '@mastra/core/workflows'
import { z } from 'zod'
import { Planned, fastLane, planAndGate } from '../stages/plan'
import { intakeStep, triageStep } from '../stages/triage'

// Printed when a run ends here, so you know which step adds the next lane.
export const next = 'This is where step-2 ends. Step 3 adds the maintainer and verify: git switch step-3'

export const issueToPr = createWorkflow({
  id: 'issue-to-pr',
  inputSchema: z.object({ issue: z.number() }),
  outputSchema: Planned,
})
  .then(intakeStep)
  .then(triageStep)
  .branch([
    [async ({ inputData }) => inputData.triage.needsPlan, planAndGate],
    [async ({ inputData }) => !inputData.triage.needsPlan, fastLane],
  ])
  .map(async ({ inputData }) => inputData['plan-and-gate'] ?? inputData['fast-lane'], { id: 'merge-lanes' })
  .commit()
