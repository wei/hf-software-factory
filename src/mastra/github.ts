import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { promisify } from 'node:util'

const run = promisify(execFile)
export const TARGET_REPO = process.env.TARGET_REPO ?? 'wei/socialify' // your fork: issues, code and PRs all live here
export const TARGET_DIR = resolve(process.env.TARGET_DIR ?? `${process.env.INIT_CWD ?? process.cwd()}/target`)

export async function sh(cmd: string, args: string[], cwd = TARGET_DIR) {
  const { stdout } = await run(cmd, args, { cwd, maxBuffer: 20e6 })
  return stdout.trim()
}

// Clone your fork into ./target and install its deps, once.
export async function prepareTarget() {
  if (!existsSync(TARGET_DIR)) await sh('gh', ['repo', 'clone', TARGET_REPO, TARGET_DIR], '.')
  if (!existsSync(`${TARGET_DIR}/node_modules`)) await sh('pnpm', ['install', '--frozen-lockfile'])
}

// Fetch the issue and put a fresh branch for it in ./target.
export async function intake(number: number) {
  const issue = JSON.parse(
    await sh('gh', ['issue', 'view', String(number), '-R', TARGET_REPO, '--json', 'number,title,body,url,comments'], '.'),
  )
  // Comments carry the human's feedback when a plan gets sent back.
  const comments = issue.comments.map((c: { author: { login: string }; body: string }) => `@${c.author.login}: ${c.body}`).join('\n\n')
  await prepareTarget()
  await sh('git', ['fetch', 'origin'])
  const base = await sh('git', ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'])
  await sh('git', ['checkout', '-f', '-B', `factory/issue-${number}`, base])
  await sh('git', ['clean', '-fd'])
  return { ...issue, comments } as { number: number; title: string; body: string; url: string; comments: string }
}
