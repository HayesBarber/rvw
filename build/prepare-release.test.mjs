import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { cp, lstat, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { nestedCode, parseKeychains, prepareRelease, runTool } from './prepare-release.mjs'

const env = {
  RVW_CERTIFICATE_BASE64: Buffer.from('test certificate').toString('base64'),
  RVW_CERTIFICATE_PASSWORD: 'secret-"password\nwith-newline',
  RVW_SIGNING_IDENTITY: 'Developer ID Application: Test (ABCDEFGHIJ)',
  RVW_NOTARY_KEY_BASE64: Buffer.from('-----BEGIN PRIVATE KEY-----\ntest\n-----END PRIVATE KEY-----').toString('base64'),
  RVW_NOTARY_KEY_ID: 'ABCDEFGHIJ',
  RVW_NOTARY_ISSUER_ID: '11111111-2222-3333-4444-555555555555',
}
const id = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
const macho = Buffer.from('cffaedfe00000000', 'hex')

async function fixture(t, { fail, rejected = false, abort } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'rvw-release-test-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const app = path.join(root, 'Rvw.app')
  const output = path.join(root, 'release')
  await mkdir(path.join(app, 'Contents/MacOS'), { recursive: true })
  await mkdir(path.join(app, 'Contents/Resources/web'), { recursive: true })
  await writeFile(path.join(app, 'Contents/MacOS/Rvw'), macho)
  await writeFile(path.join(app, 'Contents/MacOS/rvw-cli'), macho)
  await writeFile(path.join(app, 'Contents/Info.plist'), 'plist')
  await writeFile(path.join(app, 'Contents/Resources/web/index.html'), 'assets')
  await mkdir(output)
  const options = { app, output, version: '1.2.3-beta.1' }
  const zip = path.join(output, 'Rvw-1.2.3-beta.1.zip')
  // Old output must not survive a failed attempt.
  await writeFile(zip, 'old zip')
  await writeFile(`${zip}.sha256`, 'old checksum')
  const calls = []
  let securityCalls = 0
  const run = async (command, args, opts = {}) => {
    const name = path.basename(command)
    calls.push([name, ...args])
    if (fail?.(name, args, calls)) throw new Error('simulated tool failure')
    if (name === 'security' && args[0] === 'list-keychains' && !args.includes('-s')) {
      securityCalls++
      return { stdout: '    "/Users/test/Library/Keychains/login.keychain-db"\n    "/Library/Keychains/System.keychain"\n', code: 0 }
    }
    if (name === 'ditto') {
      if (args[0] === '-x') {
        await cp(path.join(output, '.release-lock/Rvw.app'), path.join(args.at(-1), 'Rvw.app'), { recursive: true })
      } else if (args[0] === '-c') {
        await writeFile(args.at(-1), 'exact validated zip bytes')
      } else await cp(args[0], args[1], { recursive: true })
    }
    if (name === 'xcrun' && args[0] === 'notarytool' && args[1] === 'submit') {
      assert.equal((await lstat(path.join(output, '.release-lock/notary-key.p8'))).mode & 0o777, 0o600)
      assert.equal((await lstat(path.join(output, '.release-lock'))).mode & 0o777, 0o700)
      if (abort) {
        abort.abort(new Error('Release interrupted'))
        opts.signal.throwIfAborted()
      }
      return { stdout: JSON.stringify({ id, status: rejected ? 'Invalid' : 'Accepted' }), code: rejected ? 1 : 0 }
    }
    if (name === 'xcrun' && args[1] === 'log') {
      return { stdout: JSON.stringify({ issues: [{ severity: 'error', path: 'Rvw.app', message: `diagnostic ${env.RVW_CERTIFICATE_PASSWORD}` }], secret: env.RVW_NOTARY_KEY_BASE64 }), code: 0 }
    }
    return { stdout: '', code: 0 }
  }
  return { options, zip, calls, run, output, app, keychainReads: () => securityCalls }
}
async function absent(file) {
  await assert.rejects(lstat(file), { code: 'ENOENT' })
}
async function noArtifacts(f) {
  await absent(f.zip)
  await absent(`${f.zip}.sha256`)
}
function restored(f) {
  assert.deepEqual(f.calls.at(-1), ['security', 'list-keychains', '-d', 'user', '-s', '/Users/test/Library/Keychains/login.keychain-db', '/Library/Keychains/System.keychain'])
  assert.ok(f.calls.some((call) => call[1] === 'delete-keychain'))
}

test('signs inside out, verifies the extracted final ZIP, hashes exact bytes, and cleans up', async (t) => {
  const f = await fixture(t)
  await prepareRelease(f.options, { env, platform: 'darwin', run: f.run })
  const signed = f.calls.filter((call) => call[0] === 'codesign' && call.includes('--sign'))
  assert.deepEqual(signed.map((call) => path.basename(call.at(-1))), ['rvw-cli', 'Rvw.app'])
  for (const call of signed) {
    assert.ok(call.includes('--timestamp'))
    assert.ok(call.includes('runtime'))
    assert.ok(!call.includes('--deep'))
  }
  const finalVerify = f.calls.findIndex((call) => call[0] === 'codesign' && call.at(-1).endsWith('unpacked/Rvw.app'))
  const finalZip = f.calls.findIndex((call) => call[0] === 'ditto' && call.at(-1).endsWith('1.2.3-beta.1.zip'))
  const staple = f.calls.findIndex((call) => call[1] === 'stapler' && call[2] === 'staple')
  assert.ok(staple < finalZip && finalZip < finalVerify)
  assert.ok(f.calls.some((call) => call[0] === 'spctl' && call.at(-1).endsWith('unpacked/Rvw.app')))
  const hash = createHash('sha256').update(await readFile(f.zip)).digest('hex')
  assert.equal(await readFile(`${f.zip}.sha256`, 'utf8'), `${hash}  ${path.basename(f.zip)}\n`)
  assert.equal(await readFile(path.join(f.app, 'Contents/Info.plist'), 'utf8'), 'plist')
  assert.deepEqual(await readFile(path.join(f.app, 'Contents/MacOS/Rvw')), macho)
  restored(f)
  await absent(path.join(f.output, '.release-lock'))
})

test('preflight invalidates old artifacts without accessing a keychain or submitting', async (t) => {
  const f = await fixture(t)
  await prepareRelease({ ...f.options, checkOnly: true }, { env, platform: 'darwin', run: f.run })
  await noArtifacts(f)
  assert.equal(f.keychainReads(), 0)
  assert.ok(f.calls.every((call) => call[1] === '--find'))
})

for (const [name, config] of [
  ['missing credentials', {}],
  ['invalid certificate encoding', { ...env, RVW_CERTIFICATE_BASE64: 'bad!' }],
  ['wrong identity type', { ...env, RVW_SIGNING_IDENTITY: '-' }],
  ['invalid private key', { ...env, RVW_NOTARY_KEY_BASE64: Buffer.from('bad key').toString('base64') }],
]) test(`${name} fails before tools and removes old artifacts`, async (t) => {
  const f = await fixture(t)
  await assert.rejects(prepareRelease(f.options, { env: config, platform: 'darwin', run: f.run }))
  await noArtifacts(f)
  assert.equal(f.calls.length, 0)
  await absent(path.join(f.output, '.release-lock'))
})

test('unsupported host fails clearly', async (t) => {
  const f = await fixture(t)
  await assert.rejects(prepareRelease(f.options, { env, platform: 'linux', run: f.run }), /requires macOS/)
  await noArtifacts(f)
})

for (const step of ['create-keychain', 'import', 'set-key-partition-list', 'codesign', 'staple', 'validate', 'spctl', 'extract']) {
  test(`${step} failure prevents publication and restores keychains`, async (t) => {
    const f = await fixture(t, { fail: (name, args) => name === step || args[0] === step || args[1] === step || (step === 'extract' && args[0] === '-x') })
    await assert.rejects(prepareRelease(f.options, { env, platform: 'darwin', run: f.run }), /failed/)
    await noArtifacts(f)
    restored(f)
    await absent(path.join(f.output, '.release-lock'))
  })
}

test('rejected notarization retains redacted diagnostics and never staples', async (t) => {
  const f = await fixture(t, { rejected: true })
  await assert.rejects(prepareRelease(f.options, { env, platform: 'darwin', run: f.run }), /not accepted/)
  const report = await readFile(path.join(f.output, 'Rvw-1.2.3-beta.1.notary.json'), 'utf8')
  assert.equal(JSON.parse(report).id, id)
  assert.ok(report.includes('[REDACTED]'))
  for (const value of Object.values(env)) assert.ok(!report.includes(value))
  assert.ok(!f.calls.some((call) => call[1] === 'stapler'))
  await noArtifacts(f)
  restored(f)
})

test('interruption cleans secrets without using an aborted signal for cleanup', async (t) => {
  const abort = new AbortController()
  const f = await fixture(t, { abort })
  await assert.rejects(prepareRelease(f.options, { env, platform: 'darwin', run: f.run, signal: abort.signal }), /interrupted/)
  restored(f)
  await noArtifacts(f)
  await absent(path.join(f.output, '.release-lock'))
  // A second attempt after failure must perform notarization again.
  await prepareRelease(f.options, { env, platform: 'darwin', run: async (command, args, opts) => {
    if (args[1] === 'submit') return { stdout: JSON.stringify({ id, status: 'Accepted' }), code: 0 }
    return f.run(command, args, opts)
  } })
  assert.ok(await lstat(f.zip))
})

test('cleanup failure removes artifacts and secrets but keeps recovery metadata', async (t) => {
  const f = await fixture(t)
  const run = (command, args, opts) => {
    if (args[0] === 'list-keychains' && args[4]?.startsWith('/Users/test')) throw new Error('restore failure')
    return f.run(command, args, opts)
  }
  await assert.rejects(prepareRelease(f.options, { env, platform: 'darwin', run }), /cleanup failed/)
  await noArtifacts(f)
  assert.deepEqual(await readdir(path.join(f.output, '.release-lock')), ['original-keychains.json'])
})

test('a concurrent or interrupted run is refused without deleting its artifacts', async (t) => {
  const f = await fixture(t)
  await mkdir(path.join(f.output, '.release-lock'))
  await assert.rejects(prepareRelease(f.options, { env, platform: 'darwin', run: f.run }), /locked/)
  assert.equal(await readFile(f.zip, 'utf8'), 'old zip')
  assert.equal(f.calls.length, 0)
})

test('discovers additional nested code before its container and rejects external symlinks', async (t) => {
  const f = await fixture(t)
  const framework = path.join(f.app, 'Contents/Frameworks/Helper.framework')
  await mkdir(framework, { recursive: true })
  await writeFile(path.join(framework, 'Helper'), macho)
  const code = await nestedCode(f.app)
  assert.ok(code.indexOf(path.join(framework, 'Helper')) < code.indexOf(framework))
  await symlink('/usr/bin/true', path.join(f.app, 'Contents/MacOS/outside'))
  await assert.rejects(nestedCode(f.app), /external symlink/)
})

test('keychain list parsing preserves spaces and refuses malformed output', () => {
  assert.deepEqual(parseKeychains('  "/Users/test/with spaces.keychain-db"\n'), ['/Users/test/with spaces.keychain-db'])
  assert.throws(() => parseKeychains('unquoted output'))
})

test('real command adapter never includes arguments or stderr in errors', async () => {
  await assert.rejects(runTool(process.execPath, ['-e', 'console.error("private-secret");process.exit(1)']), (error) => {
    assert.ok(!error.message.includes('private-secret'))
    assert.ok(!('stderr' in error))
    return true
  })
})

for (const step of ['codesign', 'stapler']) test(`final extracted artifact ${step} failure removes output`, async (t) => {
  const f = await fixture(t, { fail: (name, args) => args.at(-1)?.includes('/unpacked/') && (name === step || args[0] === step) })
  await assert.rejects(prepareRelease(f.options, { env, platform: 'darwin', run: f.run }))
  assert.ok(f.calls.some((call) => call.includes('-x')))
  await noArtifacts(f)
  restored(f)
})

for (const response of [
  { stdout: 'authentication failed', code: 1 },
  { stdout: JSON.stringify({ id, status: 'In Progress' }), code: 0 },
  { stdout: JSON.stringify({ id, status: 'Accepted' }), code: 1 },
]) test(`notary response fails closed: ${response.stdout}`, async (t) => {
  const f = await fixture(t)
  const run = (command, args, opts) => args[1] === 'submit' ? response : f.run(command, args, opts)
  await assert.rejects(prepareRelease(f.options, { env, platform: 'darwin', run }))
  assert.ok(!f.calls.some((call) => call[1] === 'stapler'))
  await noArtifacts(f)
  restored(f)
})

test('interruption during cleanup cannot leave a successful release', async (t) => {
  const f = await fixture(t)
  const abort = new AbortController()
  const run = (command, args, opts) => {
    if (args[0] === 'delete-keychain') abort.abort(new Error('Release interrupted'))
    return f.run(command, args, opts)
  }
  await assert.rejects(prepareRelease(f.options, { env, platform: 'darwin', run, signal: abort.signal }), /interrupted/)
  await noArtifacts(f)
  restored(f)
  await absent(path.join(f.output, '.release-lock'))
})
