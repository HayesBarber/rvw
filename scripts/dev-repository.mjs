#!/usr/bin/env node

import { execFile as execFileCallback } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  unlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { promisify } from 'node:util'
import { pathToFileURL } from 'node:url'

const execFile = promisify(execFileCallback)
const defaultCacheRoot = join(tmpdir(), 'rvw-dev-cache')
const maximumTextSize = 512 * 1024
const utf8 = new TextDecoder('utf-8', { fatal: true })

export const repositories = Object.freeze([
  {
    name: 'spaced-repetition-learning',
    url: 'https://github.com/HayesBarber/spaced-repetition-learning.git',
  },
  { name: 'dotfiles', url: 'https://github.com/HayesBarber/dotfiles.git' },
  { name: 'wpm', url: 'https://github.com/HayesBarber/wpm.git' },
])

function diagnostic(message) {
  process.stderr.write(`[dev-repository] ${message}\n`)
}

function commandError(command, args, error) {
  const detail = String(error.stderr || '').trim() || String(error.stdout || '').trim() || error.message
  return new Error(`command failed: ${command} ${args.join(' ')}${detail ? `\n${detail}` : ''}`)
}

async function run(command, args, options = {}) {
  try {
    return await execFile(command, args, {
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
      ...options,
    })
  } catch (error) {
    throw commandError(command, args, error)
  }
}

async function git(args, options = {}) {
  return run('git', args, options)
}

function parseSeed(value) {
  if (!/^-?\d+$/.test(value)) throw new Error(`invalid seed '${value}': expected an integer`)
  const number = Number(value)
  if (!Number.isSafeInteger(number)) {
    throw new Error(`invalid seed '${value}': expected a safe integer`)
  }
  return number
}

function randomSeed() {
  return Number(randomBytes(6).readUIntBE(0, 6))
}

// SplitMix64 gives stable, well-distributed choices without external packages.
function createRandom(seed) {
  let state = BigInt.asUintN(64, BigInt(seed))
  return () => {
    state = BigInt.asUintN(64, state + 0x9e3779b97f4a7c15n)
    let value = state
    value = BigInt.asUintN(64, (value ^ (value >> 30n)) * 0xbf58476d1ce4e5b9n)
    value = BigInt.asUintN(64, (value ^ (value >> 27n)) * 0x94d049bb133111ebn)
    value ^= value >> 31n
    return Number(value >> 11n) / 2 ** 53
  }
}

function shuffled(values, random) {
  const result = [...values]
  for (let index = result.length - 1; index > 0; index -= 1) {
    const other = Math.floor(random() * (index + 1))
    ;[result[index], result[other]] = [result[other], result[index]]
  }
  return result
}

function isWithin(parent, child) {
  const path = relative(parent, child)
  return path === '' || (!path.startsWith(`..${sep}`) && path !== '..' && !isAbsolute(path))
}

async function pathExists(path) {
  try {
    await lstat(path)
    return true
  } catch (error) {
    if (error.code === 'ENOENT') return false
    throw error
  }
}

async function validateCache(cachePath) {
  const cacheLink = await lstat(cachePath)
  if (cacheLink.isSymbolicLink()) {
    throw new Error(`repository cache must not be a symbolic link: ${cachePath}`)
  }
  const cacheStat = await stat(cachePath).catch((error) => {
    if (error.code === 'ENOENT') throw new Error(`repository cache is missing: ${cachePath}`)
    throw error
  })
  if (!cacheStat.isDirectory()) throw new Error(`repository cache is not a directory: ${cachePath}`)

  const bare = (await git(['--git-dir', cachePath, 'rev-parse', '--is-bare-repository'])).stdout.trim()
  if (bare !== 'true') throw new Error(`repository cache is not a bare Git repository: ${cachePath}`)
  await git(['--git-dir', cachePath, 'rev-parse', '--verify', 'HEAD^{commit}'])
}

async function ensureCache(repository, cacheRoot) {
  await mkdir(cacheRoot, { recursive: true })
  const cachePath = join(cacheRoot, `${repository.name}.git`)
  if (!(await pathExists(cachePath))) {
    const clonePath = await mkdtemp(join(cacheRoot, `.${repository.name}.clone-`))
    await rm(clonePath, { recursive: true })
    diagnostic(`cloning ${repository.name} into ${cachePath}`)
    try {
      await git(['clone', '--bare', '--', repository.url, clonePath])
      try {
        await rename(clonePath, cachePath)
      } catch (error) {
        if (error.code !== 'EEXIST' && error.code !== 'ENOTEMPTY') throw error
        // Another session won the initial-clone race.
        await rm(clonePath, { recursive: true, force: true })
      }
    } catch (error) {
      await rm(clonePath, { recursive: true, force: true })
      throw error
    }
  } else {
    diagnostic(`reusing cached ${repository.name}`)
  }
  await validateCache(cachePath)
  return cachePath
}

function parseIndex(output) {
  const entries = []
  for (const record of output.split('\0')) {
    if (!record) continue
    const tab = record.indexOf('\t')
    if (tab < 0) throw new Error('git ls-files returned malformed output')
    const metadata = record.slice(0, tab).split(' ')
    if (metadata.length !== 3) throw new Error('git ls-files returned malformed metadata')
    entries.push({ mode: metadata[0], path: record.slice(tab + 1) })
  }
  return entries
}

async function eligibleFiles(worktreePath) {
  const output = (await git(['-C', worktreePath, 'ls-files', '--stage', '-z'], { encoding: 'buffer' })).stdout
  const entries = parseIndex(output.toString('utf8'))
  const eligible = []
  for (const entry of entries) {
    if (entry.mode === '120000' || entry.mode === '160000') continue
    const absolutePath = join(worktreePath, entry.path)
    let metadata
    try {
      metadata = await lstat(absolutePath)
    } catch (error) {
      if (error.code === 'ENOENT') continue
      throw error
    }
    if (!metadata.isFile() || metadata.size > maximumTextSize) continue
    const contents = await readFile(absolutePath)
    if (contents.includes(0)) continue
    try {
      utf8.decode(contents)
    } catch {
      continue
    }
    eligible.push(entry.path)
  }
  return eligible
}

function mutationText(seed, identifier) {
  return `\n\nRVW dev mutation seed=${seed} id=${identifier}\n`
}

async function uniqueAdditionPath(worktreePath, directory, seed, identifier) {
  for (let suffix = 0; ; suffix += 1) {
    const name = `rvw-dev-${seed}-${identifier}${suffix ? `-${suffix}` : ''}.txt`
    const candidate = directory === '.' ? name : join(directory, name)
    if (!(await pathExists(join(worktreePath, candidate)))) return candidate
  }
}

async function applyMutations(worktreePath, seed) {
  const random = createRandom(seed)
  const eligible = shuffled(await eligibleFiles(worktreePath), random)
  if (eligible.length < 2) {
    throw new Error('repository needs at least two eligible tracked text files')
  }

  const modificationCount = Math.min(3, eligible.length - 1)
  const deletionCount = Math.min(2, eligible.length - modificationCount)
  const modificationPaths = eligible.slice(0, modificationCount)
  const deletionPaths = eligible.slice(modificationCount, modificationCount + deletionCount)
  const changes = []

  for (const [index, path] of modificationPaths.entries()) {
    const identifier = `modify-${index + 1}`
    await writeFile(join(worktreePath, path), mutationText(seed, identifier), { flag: 'a' })
    changes.push({ path, kind: 'modified', staged: index === 0, mutation: identifier })
  }
  for (const [index, path] of deletionPaths.entries()) {
    const identifier = `delete-${index + 1}`
    await unlink(join(worktreePath, path))
    changes.push({ path, kind: 'deleted', staged: index === 0, mutation: identifier })
  }

  const directories = shuffled(
    [...new Set(eligible.map((path) => dirname(path)))],
    random,
  )
  while (directories.length < 2) directories.push('.')
  for (let index = 0; index < 2; index += 1) {
    const identifier = `add-${index + 1}`
    const path = await uniqueAdditionPath(worktreePath, directories[index], seed, identifier)
    await writeFile(
      join(worktreePath, path),
      `RVW development fixture\nseed=${seed}\nmutation=${identifier}\n`,
      'utf8',
    )
    changes.push({ path, kind: 'added', staged: index === 0, mutation: identifier })
  }

  for (const change of changes.filter((item) => item.staged)) {
    await git(['-C', worktreePath, 'add', '--', change.path])
  }
  return changes
}

function chooseRepository(name, fixtures, random) {
  if (name === undefined || name === 'random') {
    return fixtures[Math.floor(random() * fixtures.length)]
  }
  const repository = fixtures.find((fixture) => fixture.name === name)
  if (!repository) {
    throw new Error(`unknown repository '${name}' (choose ${fixtures.map((item) => item.name).join(', ')}, or random)`)
  }
  return repository
}

export async function prepare({
  repo,
  seed = randomSeed(),
  fixtures = repositories,
  cacheRoot = defaultCacheRoot,
  temporaryRoot = tmpdir(),
} = {}) {
  if (!Number.isSafeInteger(seed)) throw new Error('seed must be a safe integer')
  const random = createRandom(seed)
  const repository = chooseRepository(repo, fixtures, random)
  const cachePath = await ensureCache(repository, resolve(cacheRoot))
  await git(['--git-dir', cachePath, 'worktree', 'prune'])
  const baseCommit = (await git(['--git-dir', cachePath, 'rev-parse', 'HEAD'])).stdout.trim()
  const worktreePath = await mkdtemp(join(resolve(temporaryRoot), `rvw-dev-${repository.name}-`))
  let worktreeAdded = false

  try {
    await git(['--git-dir', cachePath, 'worktree', 'add', '--detach', worktreePath, baseCommit])
    worktreeAdded = true
    const changes = await applyMutations(worktreePath, seed)
    return { repository: repository.name, path: worktreePath, baseCommit, seed, changes }
  } catch (error) {
    try {
      if (worktreeAdded) {
        await git(['--git-dir', cachePath, 'worktree', 'remove', '--force', worktreePath])
        await git(['--git-dir', cachePath, 'worktree', 'prune'])
      } else {
        await rm(worktreePath, { recursive: true })
      }
    } catch {
      diagnostic(`setup failed and the temporary path could not be removed: ${worktreePath}`)
    }
    throw error
  }
}

async function validatedCleanupTarget(target, cacheRoot) {
  if (!isAbsolute(target)) throw new Error('cleanup path must be absolute')
  const canonicalTarget = await realpath(target).catch(() => {
    throw new Error(`cleanup path does not exist: ${target}`)
  })
  const canonicalTemporaryRoots = [await realpath(tmpdir()), await realpath('/tmp')]
  const isTemporary = canonicalTemporaryRoots.some((root) => isWithin(root, canonicalTarget))
  if (!isTemporary || !basename(canonicalTarget).startsWith('rvw-dev-')) {
    throw new Error(`refusing to clean up unsafe path: ${canonicalTarget}`)
  }

  const commonOutput = (await git(['-C', canonicalTarget, 'rev-parse', '--path-format=absolute', '--git-common-dir'])).stdout.trim()
  const commonPath = await realpath(commonOutput)
  const canonicalCacheRoot = await realpath(cacheRoot).catch(() => {
    throw new Error(`cache root does not exist: ${cacheRoot}`)
  })
  if (!isWithin(canonicalCacheRoot, commonPath) || commonPath === canonicalCacheRoot) {
    throw new Error(`worktree is not connected to the rvw cache: ${canonicalTarget}`)
  }
  const listedRoot = (await git(['-C', canonicalTarget, 'rev-parse', '--show-toplevel'])).stdout.trim()
  if ((await realpath(listedRoot)) !== canonicalTarget) {
    throw new Error(`cleanup path is not a Git worktree root: ${canonicalTarget}`)
  }
  return { canonicalTarget, commonPath }
}

export async function cleanup(target, { cacheRoot = defaultCacheRoot } = {}) {
  let validated
  try {
    validated = await validatedCleanupTarget(target, resolve(cacheRoot))
    await git(['--git-dir', validated.commonPath, 'worktree', 'remove', '--force', validated.canonicalTarget])
  } catch (error) {
    diagnostic(`cleanup failed; preserved worktree: ${target}`)
    if (validated) {
      diagnostic(
        `manual cleanup: git --git-dir ${JSON.stringify(validated.commonPath)} worktree remove --force -- ${JSON.stringify(validated.canonicalTarget)}`,
      )
    } else {
      diagnostic('manual cleanup requires validating that this is the intended temporary worktree')
    }
    throw error
  }
  try {
    await git(['--git-dir', validated.commonPath, 'worktree', 'prune'])
  } catch (error) {
    diagnostic(`worktree was removed, but stale metadata could not be pruned: ${error.message}`)
  }
}

function parseCommandLine(args) {
  const command = args[0]
  if (!['list', 'prepare', 'cleanup'].includes(command)) {
    throw new Error('usage: dev-repository.mjs list | prepare [--repo NAME|random] [--seed INTEGER] | cleanup --path PATH')
  }
  let repo
  let seed
  let path
  for (let index = 1; index < args.length; index += 1) {
    const argument = args[index]
    const value = args[index + 1]
    if (argument === '--repo' && command === 'prepare') {
      if (value === undefined) throw new Error('missing value for --repo')
      repo = value
      index += 1
    } else if (argument === '--seed' && command === 'prepare') {
      if (value === undefined) throw new Error('missing value for --seed')
      seed = parseSeed(value)
      index += 1
    } else if (argument === '--path' && command === 'cleanup') {
      if (value === undefined) throw new Error('missing value for --path')
      path = value
      index += 1
    } else {
      throw new Error(`unknown argument '${argument}'`)
    }
  }
  if (command === 'cleanup' && !path) throw new Error('cleanup requires --path PATH')
  return { command, repo, seed, path }
}

async function main() {
  const options = parseCommandLine(process.argv.slice(2))
  if (options.command === 'list') {
    process.stdout.write(`${JSON.stringify(repositories)}\n`)
  } else if (options.command === 'prepare') {
    const result = await prepare({ repo: options.repo, seed: options.seed })
    process.stdout.write(`${JSON.stringify(result)}\n`)
  } else {
    await cleanup(options.path)
  }
}

const isEntrypoint = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href
if (isEntrypoint) {
  main().catch((error) => {
    diagnostic(error.message)
    process.exitCode = 1
  })
}
