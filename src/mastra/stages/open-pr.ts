import { createStep } from '@mastra/core/workflows'
import { z } from 'zod'
import { moveTo } from '../board'
import { TARGET_REPO, sh } from '../github'
import { Work } from './implement'

const gitmoji = { bug: '🐛', feature: '✨', docs: '📝', chore: '🔧' } as const

// Last stage: a DRAFT pull request on your own fork. A human reads it and decides.
export const openPrStep = createStep({
  id: 'open-pr',
  inputSchema: Work,
  outputSchema: z.object({ pr: z.string() }),
  execute: async ({ inputData: work }) => {
    if (!work.passed) throw new Error(`Still failing after ${work.attempts} attempts:\n${work.log}`)
    const me = await sh('gh', ['api', 'user', '-q', '.login'], '.')
    if (TARGET_REPO.split('/')[0] !== me) throw new Error(`TARGET_REPO ${TARGET_REPO} isn't yours (${me}). Point it at your fork.`)

    const branch = `factory/issue-${work.number}`
    const base = (await sh('git', ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'])).replace('origin/', '')
    const title = `${gitmoji[work.triage.type]} ${work.title}`
    const body = `Closes #${work.number}\n\n## Plan\n${work.plan || work.triage.summary}\n\n## Evidence\n${work.log}\n\nOpened as a draft by a software factory. A human reviews before merge.`
    await sh('git', ['add', '-A'])
    // --no-verify: the verify stage already ran lint + typecheck + tests; CI still runs the build.
    await sh('git', ['commit', '--no-verify', '-m', title])
    await sh('git', ['push', '-u', 'origin', branch, '--force-with-lease'])
    // --repo and --base pinned, so gh never targets your fork's upstream parent.
    const pr = await sh('gh', ['pr', 'create', '--draft', '--repo', TARGET_REPO, '--head', branch, '--base', base, '--title', title, '--body', body])
    await moveTo(work.number, 'PR Review')
    return { pr }
  },
})
