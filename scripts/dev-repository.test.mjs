import assert from 'node:assert/strict'
import { execFile as execFileCallback, spawn } from 'node:child_process'
import { once } from 'node:events'
import { lstat, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

import { cleanup, prepare, repositories } from './dev-repository.mjs'

const execFile = promisify(execFileCallback)
const scriptsRoot = dirname(fileURLToPath(import.meta.url))
const commandPath = resolve(scriptsRoot, 'dev-repository.mjs')
const guardianPath = resolve(scriptsRoot, 'dev-repository-guard.mjs')

async function git(args, options = {}) {
  return execFile('git', args, { encoding: 'utf8', ...options })
}

async function commitAll(repository, message) {
  await git(['-C', repository, 'add', '-A'])
  await git(['-C', repository, '-c', 'user.name=Rvw Test', '-c', 'user.email=rvw@example.invalid', 'commit', '-m', message])
}

async function createOrigin(root, name, { small = false, special = false } = {}) {
  const repository = join(root, name)
  await mkdir(repository)
  await git(['init', '--initial-branch=main', repository])
  const count = small ? 2 : 7
  for (let index = 0; index < count; index += 1) {
    const directory = index % 2 === 0 ? 'src' : 'docs'
    await mkdir(join(repository, directory), { recursive: true })
    await writeFile(join(repository, directory, `file-${index}.txt`), `fixture ${name} ${index}\n`)
  }
  if (special) {
    await writeFile(join(repository, 'binary.dat'), Buffer.from([1, 0, 2, 3]))
    await writeFile(join(repository, 'invalid.txt'), Buffer.from([0xc3, 0x28]))
    await writeFile(join(repository, 'oversized.txt'), Buffer.alloc(512 * 1024 + 1, 65))
    await symlink('src/file-0.txt', join(repository, 'linked.txt'))

    const submodule = join(root, `${name}-submodule`)
    await mkdir(submodule)
    await git(['init', '--initial-branch=main', submodule])
    await writeFile(join(submodule, 'submodule.txt'), 'submodule\n')
    await commitAll(submodule, 'submodule fixture')
    await git(['-C', repository, '-c', 'protocol.file.allow=always', 'submodule', 'add', submodule, 'vendor/submodule'])
  }
  await commitAll(repository, 'fixture')
  return repository
}

async function status(path) {
  return (await git(['-C', path, 'status', '--porcelain=v1'])).stdout.trim().split('\n').filter(Boolean)
}

async function cleanupIfPresent(path, cacheRoot) {
  try {
    await lstat(path)
  } catch (error) {
    if (error.code === 'ENOENT') return
    throw error
  }
  await cleanup(path, { cacheRoot })
}

test('lists the configured real repositories', async () => {
  const result = await execFile(process.execPath, [commandPath, 'list'], { encoding: 'utf8' })
  assert.deepEqual(JSON.parse(result.stdout), repositories)
  assert.equal(result.stderr, '')
})

test('clones once, reuses the cache, and reproduces seeded changes', async (context) => {
  const root = await mkdtemp(join(tmpdir(), 'rvw-repository-test-'))
  context.after(() => rm(root, { recursive: true, force: true }))
  const origin = await createOrigin(root, 'fixture')
  const fixture = [{ name: 'fixture', url: origin }]
  const cacheRoot = join(root, 'cache')

  const first = await prepare({ repo: 'fixture', seed: 12345, fixtures: fixture, cacheRoot })
  context.after(() => cleanupIfPresent(first.path, cacheRoot).catch(() => {}))
  assert.equal(first.repository, 'fixture')
  assert.equal(first.seed, 12345)
  assert.equal(first.changes.filter((change) => change.kind === 'modified').length, 3)
  assert.equal(first.changes.filter((change) => change.kind === 'deleted').length, 2)
  assert.equal(first.changes.filter((change) => change.kind === 'added').length, 2)
  assert.equal(first.changes.filter((change) => change.staged).length, 3)
  assert.equal((await status(first.path)).length, 7)
  const staged = (await git(['-C', first.path, 'diff', '--cached', '--name-only'])).stdout.trim().split('\n')
  assert.deepEqual(staged.sort(), first.changes.filter((change) => change.staged).map((change) => change.path).sort())
  const untracked = (await git(['-C', first.path, 'ls-files', '--others', '--exclude-standard'])).stdout.trim()
  assert.equal(untracked, first.changes.find((change) => change.kind === 'added' && !change.staged).path)
  const modified = first.changes.find((change) => change.kind === 'modified')
  assert.match(await readFile(join(first.path, modified.path), 'utf8'), /seed=12345 id=modify-/)

  await writeFile(join(origin, 'later.txt'), 'not in the cache\n')
  await commitAll(origin, 'later origin commit')

  const second = await prepare({ repo: 'fixture', seed: 12345, fixtures: fixture, cacheRoot })
  context.after(() => cleanupIfPresent(second.path, cacheRoot).catch(() => {}))
  assert.notEqual(first.path, second.path)
  assert.equal(second.baseCommit, first.baseCommit)
  assert.deepEqual(second.changes, first.changes)
  await assert.rejects(readFile(join(second.path, 'later.txt')), { code: 'ENOENT' })

  await cleanup(first.path, { cacheRoot })
  await cleanup(second.path, { cacheRoot })
})

test('keeps binary, oversized, invalid UTF-8, symlink, and submodule entries untouched', async (context) => {
  const root = await mkdtemp(join(tmpdir(), 'rvw-repository-special-'))
  context.after(() => rm(root, { recursive: true, force: true }))
  const origin = await createOrigin(root, 'special', { special: true })
  const fixture = [{ name: 'special', url: origin }]
  const cacheRoot = join(root, 'cache')
  const result = await prepare({ repo: 'special', seed: -9, fixtures: fixture, cacheRoot })
  context.after(() => cleanupIfPresent(result.path, cacheRoot).catch(() => {}))

  const excluded = new Set(['binary.dat', 'invalid.txt', 'oversized.txt', 'linked.txt', 'vendor/submodule'])
  for (const change of result.changes) assert.equal(excluded.has(change.path), false)
  assert.deepEqual(await readFile(join(result.path, 'binary.dat')), Buffer.from([1, 0, 2, 3]))
  assert.equal((await readFile(join(result.path, 'oversized.txt'))).length, 512 * 1024 + 1)
  assert.equal((await git(['-C', result.path, 'status', '--porcelain=v1', '--', ...excluded])).stdout, '')
  await cleanup(result.path, { cacheRoot })
})

test('scales down, creates isolated simultaneous worktrees, and cleans each independently', async (context) => {
  const root = await mkdtemp(join(tmpdir(), 'rvw-repository-parallel-'))
  context.after(() => rm(root, { recursive: true, force: true }))
  const origin = await createOrigin(root, 'small', { small: true })
  const fixture = [{ name: 'small', url: origin }]
  const cacheRoot = join(root, 'cache')

  const [first, second] = await Promise.all([
    prepare({ repo: 'small', seed: 1, fixtures: fixture, cacheRoot, temporaryRoot: '/tmp' }),
    prepare({ repo: 'small', seed: 2, fixtures: fixture, cacheRoot }),
  ])
  context.after(() => cleanupIfPresent(first.path, cacheRoot).catch(() => {}))
  context.after(() => cleanupIfPresent(second.path, cacheRoot).catch(() => {}))
  assert.notEqual(first.path, second.path)
  assert.deepEqual(
    first.changes.map((change) => change.kind),
    ['modified', 'deleted', 'added', 'added'],
  )
  await cleanup(first.path, { cacheRoot })
  assert.equal((await status(second.path)).length, 4)
  await cleanup(second.path, { cacheRoot })
})

test('random selection is seeded and selects only configured fixtures', async (context) => {
  const root = await mkdtemp(join(tmpdir(), 'rvw-repository-random-'))
  context.after(() => rm(root, { recursive: true, force: true }))
  const origin = await createOrigin(root, 'shared-origin')
  const fixtures = [
    { name: 'alpha', url: origin },
    { name: 'beta', url: origin },
  ]
  const cacheRoot = join(root, 'cache')
  const first = await prepare({ repo: 'random', seed: 9876, fixtures, cacheRoot })
  const second = await prepare({ seed: 9876, fixtures, cacheRoot })
  context.after(() => cleanupIfPresent(first.path, cacheRoot).catch(() => {}))
  context.after(() => cleanupIfPresent(second.path, cacheRoot).catch(() => {}))
  assert.ok(['alpha', 'beta'].includes(first.repository))
  assert.equal(second.repository, first.repository)
  assert.deepEqual(second.changes, first.changes)
  await cleanup(first.path, { cacheRoot })
  await cleanup(second.path, { cacheRoot })
})

test('cleanup guardian removes a worktree when its launcher pipe closes', async (context) => {
  const root = await mkdtemp(join(tmpdir(), 'rvw-repository-guardian-'))
  context.after(() => rm(root, { recursive: true, force: true }))
  const origin = await createOrigin(root, 'guarded', { small: true })
  const fixture = [{ name: 'guarded', url: origin }]
  const cacheRoot = join(root, 'cache')
  const result = await prepare({ repo: 'guarded', seed: 44, fixtures: fixture, cacheRoot })
  context.after(() => cleanupIfPresent(result.path, cacheRoot).catch(() => {}))

  const guardian = spawn(process.execPath, [guardianPath, result.path, cacheRoot], {
    stdio: ['pipe', 'ignore', 'pipe'],
  })
  guardian.stdin.end()
  const [code] = await once(guardian, 'exit')
  assert.equal(code, 0)
  await assert.rejects(lstat(result.path), { code: 'ENOENT' })
})

test('rejects invalid selection, seeds, caches, origins, and cleanup targets', async (context) => {
  const root = await mkdtemp(join(tmpdir(), 'rvw-repository-errors-'))
  context.after(() => rm(root, { recursive: true, force: true }))
  const origin = await createOrigin(root, 'valid')
  const fixture = [{ name: 'valid', url: origin }]
  const cacheRoot = join(root, 'cache')

  await assert.rejects(prepare({ repo: 'missing', fixtures: fixture, cacheRoot }), /unknown repository/)
  await assert.rejects(prepare({ repo: 'valid', seed: 1.5, fixtures: fixture, cacheRoot }), /safe integer/)
  await assert.rejects(
    prepare({ repo: 'broken', fixtures: [{ name: 'broken', url: join(root, 'absent') }], cacheRoot }),
    /command failed/,
  )

  await mkdir(join(cacheRoot, 'corrupt.git'), { recursive: true })
  await assert.rejects(
    prepare({ repo: 'corrupt', fixtures: [{ name: 'corrupt', url: origin }], cacheRoot }),
    /command failed/,
  )
  await assert.rejects(cleanup(root, { cacheRoot }), /unsafe path/)

  const invalidSeed = await execFile(process.execPath, [commandPath, 'prepare', '--seed', '1.5'], {
    encoding: 'utf8',
  }).catch((error) => error)
  assert.equal(invalidSeed.code, 1)
  assert.match(invalidSeed.stderr, /expected an integer/)
  assert.equal(invalidSeed.stdout, '')

  const unknownFixture = await execFile(
    process.execPath,
    [commandPath, 'prepare', '--repo', 'not-configured'],
    { encoding: 'utf8' },
  ).catch((error) => error)
  assert.equal(unknownFixture.code, 1)
  assert.match(unknownFixture.stderr, /unknown repository/)
  assert.equal(unknownFixture.stdout, '')
})
