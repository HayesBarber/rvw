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

if (!serverExecutable) {
  console.error('[dev] missing rvw server executable')
  process.exit(1)
}

if (!existsSync(viteEntrypoint)) {
  console.error('[dev] frontend dependencies are missing; run `npm install` in frontend/')
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

let prepared
try {
  const output = await repository(['prepare', ...process.argv.slice(3)])
  prepared = JSON.parse(output)
  if (
    typeof prepared.repository !== 'string' ||
    typeof prepared.path !== 'string' ||
    typeof prepared.baseCommit !== 'string' ||
    !Number.isSafeInteger(prepared.seed)
  ) {
    throw new Error('repository command returned an invalid result')
  }
} catch (error) {
  console.error(`[dev] unable to prepare repository: ${error.message}`)
  process.exit(1)
}

console.error(
  `[dev] repository=${prepared.repository} commit=${prepared.baseCommit} seed=${prepared.seed}`,
)
console.error(`[dev] worktree=${prepared.path}`)

const cleanupGuardian = spawn(process.execPath, [guardianCommand, prepared.path], {
  cwd: projectRoot,
  detached: true,
  stdio: ['pipe', 'ignore', 'inherit'],
})
cleanupGuardian.unref()
cleanupGuardian.on('error', (error) => {
  console.error(`[dev] unable to start cleanup guardian: ${error.message}`)
})
cleanupGuardian.stdin.on('error', () => {})

function cancelCleanupGuardian() {
  if (!cleanupGuardian.stdin.destroyed) cleanupGuardian.stdin.end('cancel\n')
}

const environment = { ...process.env, RVW_PORT: port }
const children = [
  {
    name: 'rvw',
    process: spawn(serverExecutable, ['serve', '--directory', prepared.path], {
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
let repositoryCleaned = false

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
      await repository(['cleanup', '--path', prepared.path])
      repositoryCleaned = true
      cancelCleanupGuardian()
      console.error(`[dev] removed worktree ${prepared.path}`)
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
    [repositoryCommand, 'cleanup', '--path', prepared.path],
    { cwd: projectRoot, encoding: 'utf8' },
  )
  if (result.stderr) process.stderr.write(result.stderr)
  if (result.status === 0) {
    repositoryCleaned = true
    cancelCleanupGuardian()
    console.error(`[dev] removed worktree ${prepared.path}`)
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
