// Run: node --test build/homebrew-dispatch.test.mjs
// Requires Bash and jq. GitHub API calls are mocked.
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'

const workflow = await readFile(new URL('../.github/workflows/release.yml', import.meta.url), 'utf8')
const job = workflow.split('\n  update-homebrew:\n')[1]
function script(name) {
  const section = job.split(`      - name: ${name}\n`)[1]
  const lines = section.split('        run: |\n')[1].split('\n')
  const body = []
  for (const line of lines) {
    if (line && !line.startsWith('          ')) break
    body.push(line.slice(10))
  }
  return body.join('\n')
}
const check = script('Check the latest release asset')
const dispatch = script('Dispatch the Homebrew update')
const asset = { name: 'Rvw-1.0.0-beta.4.zip', digest: `sha256:${'a'.repeat(64)}` }
const release = { tag_name: 'v1.0.0-beta.4', assets: [asset] }

async function run(t, metadata = release, { apiFailure = false, dispatchFailure = false } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'rvw-dispatch-test-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const callsFile = path.join(root, 'calls.jsonl')
  const output = path.join(root, 'output')
  await writeFile(output, '')
  await writeFile(callsFile, '')
  const fake = path.join(root, 'gh')
  await writeFile(fake, `#!/usr/bin/env node
const fs = require('node:fs')
const args = process.argv.slice(2)
fs.appendFileSync(process.env.TEST_CALLS, JSON.stringify({ args, token: process.env.GH_TOKEN }) + '\\n')
if (args.includes('POST')) {
  process.exit(process.env.TEST_DISPATCH_FAILURE === 'true' ? 1 : 0)
}
if (process.env.TEST_API_FAILURE === 'true') process.exit(1)
console.log(process.env.TEST_RELEASE)
`, { mode: 0o755 })
  const env = { ...process.env, PATH: `${root}${path.delimiter}${process.env.PATH}`,
    GH_TOKEN: 'rvw-read-token', GITHUB_REPOSITORY: 'HayesBarber/rvw',
    GITHUB_REF_NAME: 'v1.0.0-beta.4', GITHUB_OUTPUT: output,
    TEST_CALLS: callsFile, TEST_RELEASE: JSON.stringify(metadata),
    TEST_API_FAILURE: String(apiFailure), TEST_DISPATCH_FAILURE: String(dispatchFailure) }
  const checked = spawnSync('bash', ['-e', '-o', 'pipefail', '-c', check], { env, encoding: 'utf8' })
  const ready = (await readFile(output, 'utf8')).includes('ready=true\n')
  let sent
  if (checked.status === 0 && ready) {
    sent = spawnSync('bash', ['-e', '-o', 'pipefail', '-c', dispatch], {
      env: { ...env, GH_TOKEN: 'tap-app-token' }, encoding: 'utf8',
    })
  }
  const calls = (await readFile(callsFile, 'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse)
  return { checked, ready, sent, calls }
}

test('valid Latest asset sends one dispatch using the tap token', async t => {
  const result = await run(t)
  assert.equal(result.checked.status, 0, result.checked.stderr)
  assert.equal(result.sent.status, 0, result.sent.stderr)
  assert.deepEqual(result.calls, [
    { args: ['api', 'repos/HayesBarber/rvw/releases/latest'], token: 'rvw-read-token' },
    { args: ['api', '--method', 'POST', 'repos/HayesBarber/homebrew-tap/dispatches', '-f', 'event_type=update_rvw'], token: 'tap-app-token' },
  ])
})

test('an older release skips dispatch successfully', async t => {
  const result = await run(t, { ...release, tag_name: 'v1.0.0-beta.5' })
  assert.equal(result.checked.status, 0)
  assert.equal(result.ready, false)
  assert.equal(result.sent, undefined)
  assert.equal(result.calls.length, 1)
})

test('missing, duplicate, or invalid assets and digests stop dispatch', async t => {
  const cases = [[], [asset, asset], [{ ...asset, name: `${asset.name}.sha256` }],
    ...[null, '', 'sha256:abc', `sha256:${'g'.repeat(64)}`, `sha512:${'a'.repeat(64)}`]
      .map(digest => [{ ...asset, digest }])]
  for (const assets of cases) {
    const result = await run(t, { ...release, assets })
    assert.notEqual(result.checked.status, 0)
    assert.equal(result.ready, false)
    assert.equal(result.sent, undefined)
  }
})

test('metadata API failures stop dispatch', async t => {
  const result = await run(t, release, { apiFailure: true })
  assert.notEqual(result.checked.status, 0)
  assert.equal(result.sent, undefined)
})

test('dispatch API failures fail the dispatch step', async t => {
  const result = await run(t, release, { dispatchFailure: true })
  assert.equal(result.checked.status, 0)
  assert.notEqual(result.sent.status, 0)
})

test('job requires successful publication and gates token creation and dispatch', () => {
  assert.match(job, /\n    needs: release\n/)
  assert.doesNotMatch(job, /always\(\)|continue-on-error/)
  assert.match(job, /name: Create the tap App token\n        if: steps\.release-asset\.outputs\.ready == 'true'/)
  assert.match(job, /name: Dispatch the Homebrew update\n        if: steps\.release-asset\.outputs\.ready == 'true'/)
  assert.match(job, /owner: HayesBarber\n          repositories: homebrew-tap\n          permission-contents: write/)
})
