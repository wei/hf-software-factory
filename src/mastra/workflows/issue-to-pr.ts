import { createWorkflow } from '@mastra/core/workflows'
import { z } from 'zod'
import { Triaged, intakeStep, triageStep } from '../stages/triage'

// Printed when a run ends here, so you know which step adds the next lane.
export const next = 'This is where step-1 ends. Step 2 adds the plan and the human gate: git switch step-2'

export const issueToPr = createWorkflow({
  id: 'issue-to-pr',
  inputSchema: z.object({ issue: z.number() }),
  outputSchema: Triaged,
})
  .then(intakeStep)
  .then(triageStep)
  .commit()
