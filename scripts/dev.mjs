import { existsSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const frontendRoot = resolve(projectRoot, 'frontend')
const viteEntrypoint = resolve(frontendRoot, 'node_modules/vite/bin/vite.js')
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

const environment = { ...process.env, RVW_PORT: port }
const children = [
  {
    name: 'rvw',
    process: spawn(serverExecutable, ['serve'], {
      cwd: projectRoot,
      env: environment,
      stdio: 'inherit',
    }),
  },
  {
    name: 'vite',
    process: spawn(process.execPath, [viteEntrypoint], {
      cwd: frontendRoot,
      env: environment,
      stdio: 'inherit',
    }),
  },
]

let shuttingDown = false
let requestedExitCode = 0
let forceExitTimer

function stopChildren(signal) {
  for (const child of children) {
    if (child.process.exitCode === null && child.process.signalCode === null) {
      child.process.kill(signal)
    }
  }
}

function beginShutdown(exitCode, signal = 'SIGTERM') {
  if (shuttingDown) return
  shuttingDown = true
  requestedExitCode = exitCode
  stopChildren(signal)
  forceExitTimer = setTimeout(() => stopChildren('SIGKILL'), 5000)
  forceExitTimer.unref()
}

function finishIfStopped() {
  const stopped = children.every(
    (child) => child.process.exitCode !== null || child.process.signalCode !== null,
  )
  if (!stopped) return
  if (forceExitTimer) clearTimeout(forceExitTimer)
  process.exit(requestedExitCode)
}

for (const child of children) {
  child.process.on('error', (error) => {
    console.error(`[dev] failed to start ${child.name}: ${error.message}`)
    beginShutdown(1)
  })
  child.process.on('exit', (code, signal) => {
    if (!shuttingDown) {
      const outcome = signal ? `signal ${signal}` : `status ${code}`
      console.error(`[dev] ${child.name} exited with ${outcome}`)
      beginShutdown(code ?? 1)
    }
    finishIfStopped()
  })
}

process.on('SIGINT', () => beginShutdown(0, 'SIGINT'))
process.on('SIGTERM', () => beginShutdown(0, 'SIGTERM'))
