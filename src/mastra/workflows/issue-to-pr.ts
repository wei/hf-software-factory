import { createWorkflow } from '@mastra/core/workflows'
import { z } from 'zod'
import { implementStep } from '../stages/implement'
import { openPrStep } from '../stages/open-pr'
import { fastLane, planAndGate } from '../stages/plan'
import { intakeStep, triageStep } from '../stages/triage'

// Printed when a run ends here, so you know which step adds the next lane.
export const next = ''

export const issueToPr = createWorkflow({
  id: 'issue-to-pr',
  inputSchema: z.object({ issue: z.number() }),
  outputSchema: z.object({ pr: z.string() }),
})
  .then(intakeStep)
  .then(triageStep)
  .branch([
    [async ({ inputData }) => inputData.triage.needsPlan, planAndGate],
    [async ({ inputData }) => !inputData.triage.needsPlan, fastLane],
  ])
  .map(async ({ inputData }) => inputData['plan-and-gate'] ?? inputData['fast-lane'], { id: 'merge-lanes' })
  .dountil(implementStep, async ({ inputData }) => inputData.passed === true || (inputData.attempts ?? 0) >= 3)
  .then(openPrStep)
  .commit()
