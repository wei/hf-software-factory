import { Agent } from '@mastra/core/agent'
import { createStep } from '@mastra/core/workflows'
import { z } from 'zod'
import { moveTo } from '../board'
import { intake } from '../github'
import { models } from '../models'

export const Issue = z.object({ number: z.number(), title: z.string(), body: z.string(), url: z.string(), comments: z.string() })

// The contract: triage must answer in exactly this shape.
export const Triage = z.object({
  type: z.enum(['bug', 'feature', 'docs', 'chore']),
  labels: z.array(z.string()),
  needsPlan: z.boolean().describe('false only if the issue names the one file and the exact change; otherwise true'),
  summary: z.string().describe('one sentence, what done looks like'),
})
export const Triaged = Issue.extend({ triage: Triage })

export const triageAgent = new Agent({
  id: 'triage',
  name: 'Triage',
  instructions: 'You triage GitHub issues for a Next.js + TypeScript repo. Be literal. Do not invent requirements. When unsure, set needsPlan to true.',
  model: models.triage,
  defaultOptions: { modelSettings: { temperature: 0 } },
})

export const intakeStep = createStep({
  id: 'intake',
  inputSchema: z.object({ issue: z.number() }),
  outputSchema: Issue,
  execute: async ({ inputData }) => {
    await moveTo(inputData.issue, 'Triaging') // moving the card is the lock
    return intake(inputData.issue)
  },
})

export const triageStep = createStep({
  id: 'triage',
  inputSchema: Issue,
  outputSchema: Triaged,
  execute: async ({ inputData: issue }) => {
    const res = await triageAgent.generate(`#${issue.number} ${issue.title}\n\n${issue.body}\n\nComments:\n${issue.comments || 'none'}`, {
      structuredOutput: { schema: Triage },
      abortSignal: AbortSignal.timeout(120_000),
    })
    if (!res.object) throw new Error('Triage returned nothing (timed out?)')
    const triage = { ...res.object, needsPlan: res.object.needsPlan || res.object.type === 'feature' } // features always get a plan
    await moveTo(issue.number, triage.needsPlan ? 'Planning' : 'Implementing')
    return { ...issue, triage }
  },
})
