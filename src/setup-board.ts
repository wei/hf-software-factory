// pnpm board:setup  (run once; safe to rerun, it reuses the board it made)
// Turns on Issues for your fork, creates the "HF Software Factory" board with the
// factory's Status lanes, links it to your fork, and writes the ids into .env.
import { readFile, writeFile } from 'node:fs/promises'
import { STATUSES } from './mastra/board'
import { TARGET_REPO, prepareTarget, sh } from './mastra/github'

const TITLE = 'HF Software Factory'
if (process.argv.includes('--help')) {
  console.log('pnpm board:setup: turns on Issues for TARGET_REPO, creates or reuses the "HF Software Factory" board,\nsets its lanes and Board view, links it to your fork, fills PROJECT_* in .env, and clones target/.')
  process.exit(0)
}
const gh = (...args: string[]) => sh('gh', args, '.')
const json = async (...args: string[]) => JSON.parse(await gh(...args, '--format', 'json'))

const owner = await gh('api', 'user', '--jq', '.login')
if (!TARGET_REPO.startsWith(`${owner}/`)) {
  console.error(`Set TARGET_REPO=${owner}/socialify in .env (your fork), then run this again.`)
  process.exit(1)
}
const boards = await json('project', 'list', '--owner', owner, '--limit', '100').catch(() => {
  console.error('Your gh token needs the "project" scope. Run:\n\n  gh auth refresh -s project\n')
  process.exit(1)
})

// Forks start with Issues off. The factory reads its issues from your fork.
await gh('repo', 'edit', TARGET_REPO, '--enable-issues')
console.log(`Issues enabled on ${TARGET_REPO}`)

const existing = boards.projects.find((p: { title: string }) => p.title === TITLE)
const project = existing ?? (await json('project', 'create', '--owner', owner, '--title', TITLE))
const number = String(project.number)
await gh('project', 'edit', number, '--owner', owner, '--visibility', 'PUBLIC')
console.log(`${existing ? 'Reusing' : 'Created'} board #${number}: ${project.url}`)

// Status lanes, in order. Only rewrite them if they differ (rewriting clears card statuses).
const field = async () =>
  (await json('project', 'field-list', number, '--owner', owner)).fields.find((f: { name: string }) => f.name === 'Status')
const status = await field()
if (status.options.map((o: { name: string }) => o.name).join() !== STATUSES.join()) {
  const color = { 'Needs approval': 'YELLOW', 'PR Review': 'PURPLE', Done: 'GREEN', 'Needs help': 'RED' } as Record<string, string>
  const options = STATUSES.map((name) => `{ name: "${name}", color: ${color[name] ?? 'GRAY'}, description: "" }`)
  await gh('api', 'graphql', '-f', `field=${status.id}`, '-f',
    `query=mutation($field: ID!) { updateProjectV2Field(input: { fieldId: $field, singleSelectOptions: [${options.join(', ')}] }) { clientMutationId } }`)
}
console.log(`Lanes: ${(await field()).options.map((o: { name: string }) => o.name).join(' → ')}`)

// A Board layout view: new board views group by Status, so you land on the columns.
const views = (await gh('api', 'graphql', '-f', `query={ node(id: "${project.id}") { ... on ProjectV2 { views(first: 20) { nodes { number layout } } } } }`, '--jq', '.data.node.views.nodes')) as string
let board = JSON.parse(views).find((v: { layout: string }) => v.layout === 'BOARD_LAYOUT')?.number
board ??= await gh('api', 'graphql', '-f', `project=${project.id}`, '-f',
  'query=mutation($project: ID!) { createProjectV2View(input: { projectId: $project, name: "Board", layout: BOARD_LAYOUT }) { projectV2View { number } } }',
  '--jq', '.data.createProjectV2View.projectV2View.number')

// Linking puts the board on your fork's Projects tab and in "+ Add item → Create new issue".
await gh('project', 'link', number, '--owner', owner, '--repo', TARGET_REPO).catch(() => {})

let env = await readFile('.env', 'utf8')
for (const [k, v] of [['PROJECT_OWNER', owner], ['PROJECT_NUMBER', number]]) {
  const line = new RegExp(`^${k}=.*$`, 'm')
  env = line.test(env) ? env.replace(line, `${k}=${v}`) : `${env.trimEnd()}\n${k}=${v}\n`
}
await writeFile('.env', env)
console.log(`Wrote PROJECT_OWNER=${owner} and PROJECT_NUMBER=${number} to .env`)

// Clone your fork and install its deps now, so the live build doesn't wait on it.
await prepareTarget()
console.log('target/ is cloned and installed.')
console.log(`\nOpen your board: ${project.url}/views/${board}`)
console.log(`In the Open column, click + Add item → Create new issue → ${TARGET_REPO}.`)
