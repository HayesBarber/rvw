import { execFile as execFileCallback, spawn, spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'

const execFile = promisify(execFileCallback)
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const frontendRoot = resolve(projectRoot, 'frontend')
const viteEntrypoint = resolve(frontendRoot, 'node_modules/vite/bin/vite.js')
const repositoryCommand = resolve(projectRoot, 'scripts/dev-repository.mjs')
const guardianCommand = resolve(projectRoot, 'scripts/dev-repository-guard.mjs')
const serverExecutable = process.argv[2]
const devArguments = process.argv.slice(3)

if (!serverExecutable) {
  console.error('[dev] missing rvw server executable')
  process.exit(1)
}

if (!existsSync(viteEntrypoint)) {
  console.error('[dev] frontend dependencies are missing; run `npm install` in frontend/')
  process.exit(1)
}

function takeOption(args, index, name) {
  const value = args[index + 1]
  if (value === undefined) throw new Error(`missing value for ${name}`)
  return value
}

function parseDevArguments(args) {
  let directory
  let range
  const fixtureArguments = []

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]
    if (argument === '-d' || argument === '--directory') {
      if (directory !== undefined) throw new Error('--directory may only be provided once')
      directory = takeOption(args, index, argument)
      index += 1
    } else if (argument === '-r' || argument === '--range') {
      if (range !== undefined) throw new Error('--range may only be provided once')
      range = takeOption(args, index, argument)
      index += 1
    } else {
      fixtureArguments.push(argument)
    }
  }

  if (range !== undefined && directory === undefined) {
    throw new Error('--range requires --directory DIR')
  }
  if (directory !== undefined && fixtureArguments.length > 0) {
    throw new Error('--directory cannot be combined with fixture options')
  }
  return { directory, range, fixtureArguments }
}

let options
try {
  options = parseDevArguments(devArguments)
} catch (error) {
  console.error(`[dev] ${error.message}`)
  console.error(
    '[dev] usage: zig build dev -- [-d DIR [-r A..B] | --repo NAME|random [--seed INTEGER]]',
  )
  process.exit(1)
}

const port = process.env.RVW_PORT || '7331'
const portNumber = Number(port)
if (!Number.isInteger(portNumber) || portNumber < 1 || portNumber > 65535) {
  console.error('[dev] RVW_PORT must be an integer from 1 through 65535')
  process.exit(1)
}

async function repository(args) {
  try {
    const result = await execFile(process.execPath, [repositoryCommand, ...args], {
      cwd: projectRoot,
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
    })
    if (result.stderr) process.stderr.write(result.stderr)
    return result.stdout
  } catch (error) {
    if (error.stderr) process.stderr.write(error.stderr)
    throw error
  }
}

let review
let managedRepository = false
if (options.directory !== undefined) {
  review = {
    path: resolve(projectRoot, options.directory),
    range: options.range,
  }
  console.log(`[dev] directory=${review.path}${review.range ? ` range=${review.range}` : ''}`)
} else {
  try {
    const output = await repository(['prepare', ...options.fixtureArguments])
    review = JSON.parse(output)
    if (
      typeof review.repository !== 'string' ||
      typeof review.path !== 'string' ||
      typeof review.baseCommit !== 'string' ||
      !Number.isSafeInteger(review.seed)
    ) {
      throw new Error('repository command returned an invalid result')
    }
    managedRepository = true
  } catch (error) {
    console.error(`[dev] unable to prepare repository: ${error.message}`)
    process.exit(1)
  }

  console.log(
    `[dev] repository=${review.repository} commit=${review.baseCommit} seed=${review.seed}`,
  )
  console.log(`[dev] worktree=${review.path}`)
}

let cleanupGuardian
if (managedRepository) {
  cleanupGuardian = spawn(process.execPath, [guardianCommand, review.path], {
    cwd: projectRoot,
    detached: true,
    stdio: ['pipe', 'ignore', 'inherit'],
  })
  cleanupGuardian.unref()
  cleanupGuardian.on('error', (error) => {
    console.error(`[dev] unable to start cleanup guardian: ${error.message}`)
  })
  cleanupGuardian.stdin.on('error', () => {})
}

function cancelCleanupGuardian() {
  if (cleanupGuardian && !cleanupGuardian.stdin.destroyed) {
    cleanupGuardian.stdin.end('cancel\n')
  }
}

const environment = { ...process.env, RVW_PORT: port }
const serverArguments = ['serve', '--directory', review.path]
if (review.range !== undefined) serverArguments.push('--range', review.range)
const children = [
  {
    name: 'rvw',
    process: spawn(serverExecutable, serverArguments, {
      cwd: projectRoot,
      env: environment,
      stdio: 'inherit',
    }),
    stopped: false,
  },
  {
    name: 'vite',
    process: spawn(process.execPath, [viteEntrypoint], {
      cwd: frontendRoot,
      env: environment,
      stdio: 'inherit',
    }),
    stopped: false,
  },
]

let shuttingDown = false
let requestedExitCode = 0
let forceExitTimer
let finishing = false
let repositoryCleaned = !managedRepository

function stopChildren(signal) {
  for (const child of children) {
    if (!child.stopped) child.process.kill(signal)
  }
}

function beginShutdown(exitCode, signal = 'SIGTERM') {
  if (shuttingDown) {
    stopChildren('SIGKILL')
    return
  }
  shuttingDown = true
  requestedExitCode = exitCode
  stopChildren(signal)
  forceExitTimer = setTimeout(() => stopChildren('SIGKILL'), 5000)
  forceExitTimer.unref()
}

async function finishIfStopped() {
  if (finishing || !children.every((child) => child.stopped)) return
  finishing = true
  if (forceExitTimer) clearTimeout(forceExitTimer)
  if (!repositoryCleaned) {
    try {
      await repository(['cleanup', '--path', review.path])
      repositoryCleaned = true
      cancelCleanupGuardian()
      console.log(`[dev] removed worktree ${review.path}`)
    } catch (error) {
      console.error(`[dev] repository cleanup failed: ${error.message}`)
      requestedExitCode = requestedExitCode || 1
    }
  }
  process.exit(requestedExitCode)
}

function cleanupAfterSignal() {
  if (repositoryCleaned) return
  // The Zig build runner also receives terminal signals and may stop this process
  // before asynchronous close handlers run, so complete this bounded cleanup now.
  const result = spawnSync(
    process.execPath,
    [repositoryCommand, 'cleanup', '--path', review.path],
    { cwd: projectRoot, encoding: 'utf8' },
  )
  if (result.stderr) process.stderr.write(result.stderr)
  if (result.status === 0) {
    repositoryCleaned = true
    cancelCleanupGuardian()
    console.log(`[dev] removed worktree ${review.path}`)
  } else {
    console.error(`[dev] repository cleanup failed after signal`)
    requestedExitCode = requestedExitCode || 1
  }
}

for (const child of children) {
  child.process.on('error', (error) => {
    console.error(`[dev] failed to start ${child.name}: ${error.message}`)
    beginShutdown(1)
  })
  child.process.on('close', (code, signal) => {
    child.stopped = true
    if (!shuttingDown) {
      const outcome = signal ? `signal ${signal}` : `status ${code}`
      console.error(`[dev] ${child.name} exited with ${outcome}`)
      beginShutdown(code ?? 1)
    }
    finishIfStopped().catch((error) => {
      console.error(`[dev] shutdown failed: ${error.message}`)
      process.exit(1)
    })
  })
}

process.on('SIGINT', () => {
  beginShutdown(0, 'SIGINT')
  cleanupAfterSignal()
})
process.on('SIGTERM', () => {
  beginShutdown(0, 'SIGTERM')
  cleanupAfterSignal()
})
