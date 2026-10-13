import { Mastra } from '@mastra/core'
import { LibSQLStore } from '@mastra/libsql'
import { maintainerAgent } from './stages/implement'
import { plannerAgent, readerAgent } from './stages/plan'
import { triageAgent } from './stages/triage'
import { issueToPr } from './workflows/issue-to-pr'

export const mastra = new Mastra({
  agents: { triageAgent, readerAgent, plannerAgent, maintainerAgent },
  workflows: { issueToPr },
  storage: new LibSQLStore({ id: 'factory', url: `file:${process.env.INIT_CWD ?? process.cwd()}/factory.db` }),
})
