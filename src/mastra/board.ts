// The GitHub Projects board. Its Status column is the factory's state machine.
// The factory only ever picks up Ready. It ignores Open and cards with no Status.
import { TARGET_REPO, sh } from './github'

export const STATUSES = ['Open', 'Ready', 'Triaging', 'Planning', 'Needs approval', 'Approved', 'Implementing', 'PR Review', 'Done', 'Needs help'] as const
export type Status = (typeof STATUSES)[number]
type Item = { id: string; status?: string; content: { number: number; type: string; repository?: string } }

const OWNER = process.env.PROJECT_OWNER
const NUMBER = process.env.PROJECT_NUMBER
export const POLL_MS = Number(process.env.BOARD_POLL_MS ?? 5000)
const gh = async (...args: string[]) => JSON.parse(await sh('gh', [...args, '--owner', OWNER!, '--format', 'json'], '.'))

let cache: Promise<{ projectId: string; fieldId: string; options: { id: string; name: string }[] }> | undefined
const meta = () =>
  (cache ??= Promise.all([gh('project', 'view', NUMBER!), gh('project', 'field-list', NUMBER!)]).then(([p, f]) => {
    const status = f.fields.find((x: { name: string }) => x.name === 'Status')
    return { projectId: p.id, fieldId: status.id, options: status.options }
  }))

// One GraphQL query per poll (cost 1). `gh project item-list` costs far more and
// empties the 5,000-point hourly budget in under an hour at a 5-second poll.
const ITEMS = `query($o: String!, $n: Int!) { repositoryOwner(login: $o) { ... on ProjectV2Owner { projectV2(number: $n) {
  items(first: 100) { nodes { id
    status: fieldValueByName(name: "Status") { ... on ProjectV2ItemFieldSingleSelectValue { name } }
    content { __typename ... on Issue { number repository { nameWithOwner } } } } } } } } }`

// Issue cards from your fork, in board order.
export const cards = async (): Promise<Item[]> => {
  const res = JSON.parse(await sh('gh', ['api', 'graphql', '-f', `query=${ITEMS}`, '-f', `o=${OWNER}`, '-F', `n=${NUMBER}`], '.'))
  type Node = { id: string; status?: { name: string }; content: { __typename: string; number: number; repository?: { nameWithOwner: string } } }
  return res.data.repositoryOwner.projectV2.items.nodes
    .map((i: Node) => ({ id: i.id, status: i.status?.name, content: { number: i.content.number, type: i.content.__typename, repository: i.content.repository?.nameWithOwner } }))
    .filter((i: Item) => i.content.type === 'Issue' && i.content.repository?.toLowerCase() === TARGET_REPO.toLowerCase())
}

export const nextReady = async () => (await cards()).find((i) => i.status === 'Ready')?.content.number

export async function moveTo(issue: number, status: Status) {
  if (!OWNER || !NUMBER) return // no board configured: the factory still runs
  const item = (await cards()).find((i) => i.content.number === issue)
  if (!item) return
  const { projectId, fieldId, options } = await meta()
  const option = options.find((o: { name: string }) => o.name === status)!
  await sh('gh', ['project', 'item-edit', '--id', item.id, '--project-id', projectId, '--field-id', fieldId, '--single-select-option-id', option.id], '.')
  console.log(`[board] #${issue} → ${status}`)
}

// Poll until a human drags the card into one of these columns.
export async function waitFor(issue: number, statuses: Status[]): Promise<Status> {
  for (;;) {
    const all = await cards().catch(() => []) // a failed poll just tries again next beat
    const s = all.find((i) => i.content.number === issue)?.status as Status | undefined
    if (s && statuses.includes(s)) return s
    await new Promise((r) => setTimeout(r, POLL_MS))
  }
}

// Each poll: PR Review → Done once the factory's PR for that issue is merged.
export async function sweep() {
  for (const card of (await cards()).filter((i) => i.status === 'PR Review')) {
    const n = card.content.number
    const merged = await sh('gh', ['pr', 'list', '--repo', TARGET_REPO, '--head', `factory/issue-${n}`, '--state', 'merged', '--json', 'number', '--jq', 'length'], '.')
    if (merged !== '0') await moveTo(n, 'Done')
  }
}
