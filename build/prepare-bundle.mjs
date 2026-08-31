import { lstat, rm } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

const [stagedApp] = process.argv.slice(2)

if (!stagedApp || !path.isAbsolute(stagedApp) || path.basename(stagedApp) !== 'Rvw.app') {
  console.error('error: refusing to prepare an invalid staged application path')
  process.exitCode = 1
} else {
  try {
    const status = await lstat(stagedApp).catch((error) => {
      if (error.code === 'ENOENT') return null
      throw error
    })
    if (status?.isSymbolicLink()) {
      throw new Error(`refusing to replace staged bundle symlink: ${stagedApp}`)
    }
    await rm(stagedApp, { recursive: true, force: true })
  } catch (error) {
    console.error(`error: unable to prepare staged application: ${error.message}`)
    process.exitCode = 1
  }
}
