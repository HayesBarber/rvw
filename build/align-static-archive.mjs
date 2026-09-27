import { chmod, mkdtemp, readdir, rm } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import path from 'node:path'
import process from 'node:process'

const [sourceArg, outputArg] = process.argv.slice(2)
if (!sourceArg || !outputArg) {
  console.error('usage: node build/align-static-archive.mjs <source.a> <output.a>')
  process.exit(2)
}

const source = path.resolve(sourceArg)
const output = path.resolve(outputArg)
const temporaryDir = await mkdtemp(path.join(tmpdir(), 'rvw-archive-'))

function runXcrun(args, cwd) {
  const result = spawnSync('xcrun', args, { cwd, stdio: 'inherit' })
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(`xcrun ${args[0]} failed with exit code ${result.status}`)
  }
}

try {
  runXcrun(['ar', '-x', source], temporaryDir)
  const members = (await readdir(temporaryDir))
    .filter((name) => name.endsWith('.o'))
    .sort()
  if (members.length === 0) throw new Error('static archive has no object members')

  const memberPaths = members.map((name) => path.join(temporaryDir, name))
  // Zig's archiver extracts members without read permission.
  for (const member of memberPaths) await chmod(member, 0o644)
  runXcrun(['libtool', '-static', '-o', output, ...memberPaths], temporaryDir)
} catch (error) {
  console.error(`error: unable to align static archive: ${error.message}`)
  process.exitCode = 1
} finally {
  await rm(temporaryDir, { recursive: true, force: true })
}
