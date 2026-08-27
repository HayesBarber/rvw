import { lstat } from 'node:fs/promises'

import { cleanup } from './dev-repository.mjs'

// `zig build` can terminate dev.mjs before its asynchronous shutdown handlers
// finish. This detached process watches the launcher's stdin: an unexpected EOF
// triggers validated cleanup, while a normal shutdown sends "cancel" first.
const path = process.argv[2]
const cacheRoot = process.argv[3]
if (!path) process.exit(2)

let cancelled = false
process.stdin.setEncoding('utf8')
process.stdin.on('data', (data) => {
  if (data.includes('cancel')) cancelled = true
})
process.stdin.resume()
process.stdin.on('end', async () => {
  if (cancelled) return
  try {
    await lstat(path)
  } catch (error) {
    if (error.code === 'ENOENT') return
    throw error
  }
  try {
    await cleanup(path, cacheRoot ? { cacheRoot } : undefined)
  } catch (error) {
    process.stderr.write(`[dev] cleanup guardian failed: ${error.message}\n`)
    process.exitCode = 1
  }
})
