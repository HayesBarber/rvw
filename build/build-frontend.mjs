import { access } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import path from 'node:path'
import process from 'node:process'

const projectRoot = path.resolve(import.meta.dirname, '..')
const frontendRoot = path.join(projectRoot, 'frontend')
const viteEntrypoint = path.join(frontendRoot, 'node_modules', 'vite', 'bin', 'vite.js')

try {
  await access(viteEntrypoint)
} catch {
  console.error(
    'error: frontend dependencies are missing; run `npm ci --prefix frontend` and retry',
  )
  process.exitCode = 1
  process.exit()
}

const child = spawn(process.execPath, [viteEntrypoint, 'build'], {
  cwd: frontendRoot,
  stdio: 'inherit',
})

child.on('error', (error) => {
  console.error(`error: unable to build the frontend: ${error.message}`)
  process.exitCode = 1
})
child.on('exit', (code, signal) => {
  if (signal) {
    console.error(`error: frontend build terminated by ${signal}`)
    process.exitCode = 1
    return
  }
  process.exitCode = code ?? 1
})
