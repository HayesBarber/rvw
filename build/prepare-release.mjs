import { execFile } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { lstat, mkdir, open, readdir, realpath, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const credentialNames = [
  'RVW_CERTIFICATE_BASE64', 'RVW_CERTIFICATE_PASSWORD', 'RVW_SIGNING_IDENTITY',
  'RVW_NOTARY_KEY_BASE64', 'RVW_NOTARY_KEY_ID', 'RVW_NOTARY_ISSUER_ID',
]

// Never print command arguments or raw tool output: they can contain secrets.
export function runTool(command, args, { signal, allowFailure = false } = {}) {
  const env = { ...process.env }
  for (const name of credentialNames) delete env[name]
  return new Promise((resolve, reject) => {
    const child = execFile(command, args, { env, signal, maxBuffer: 8 * 1024 * 1024 }, (error, stdout) => {
      if (error && !allowFailure) reject(new Error(`${path.basename(command)} failed; check release configuration and tool availability`))
      else resolve({ stdout, code: error ? error.code ?? 1 : 0 })
    })
    child.stdin.end()
  })
}

function decodeBase64(value, name) {
  const compact = value.replace(/\s/g, '')
  if (!compact || compact.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(compact)) {
    throw new Error(`${name} must contain base64 data`)
  }
  return Buffer.from(compact, 'base64')
}

function configuration(env, version, platform) {
  if (platform !== 'darwin') throw new Error('Release preparation requires macOS')
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error('Release version must be a numeric major.minor.patch with an optional prerelease/build suffix')
  }
  for (const name of credentialNames) {
    if (!env[name]?.trim()) throw new Error(`Missing release configuration: ${name}`)
  }
  if (!/^Developer ID Application: .+ \([A-Z0-9]{10}\)$/.test(env.RVW_SIGNING_IDENTITY)) {
    throw new Error('RVW_SIGNING_IDENTITY must be a full Developer ID Application identity')
  }
  if (!/^[A-Z0-9]{10}$/.test(env.RVW_NOTARY_KEY_ID) ||
      !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(env.RVW_NOTARY_ISSUER_ID)) {
    throw new Error('Invalid App Store Connect team key ID or issuer ID')
  }
  const certificate = decodeBase64(env.RVW_CERTIFICATE_BASE64, 'RVW_CERTIFICATE_BASE64')
  const key = decodeBase64(env.RVW_NOTARY_KEY_BASE64, 'RVW_NOTARY_KEY_BASE64')
  if (!key.toString().includes('-----BEGIN PRIVATE KEY-----')) throw new Error('Notarization key must be a PEM private key')
  return { certificate, key }
}

export function parseKeychains(stdout) {
  return stdout.split('\n').map((line) => line.trim()).filter(Boolean).map((line) => {
    // security prints one quoted path per line. Fail before changing settings
    // if that format changes, rather than guessing a restoration command.
    const value = JSON.parse(line)
    if (typeof value !== 'string' || !path.isAbsolute(value)) throw new Error('Invalid keychain search list')
    return value
  })
}

// Inspect actual code instead of relying on a list that can miss a new helper.
export async function nestedCode(app) {
  const root = await realpath(app)
  const code = []
  const magic = new Set(['feedface', 'cefaedfe', 'feedfacf', 'cffaedfe', 'cafebabe', 'bebafeca', 'cafebabf', 'bfbafeca'])
  async function walk(directory) {
    let containsCode = false
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name)
      if (entry.isSymbolicLink()) {
        const target = await realpath(file)
        if (!target.startsWith(`${root}${path.sep}`)) throw new Error('Bundle contains an external symlink')
        continue // The target is visited at its real location inside the bundle.
      }
      if (entry.isDirectory()) {
        const childHasCode = await walk(file)
        if (childHasCode && /\.(app|framework|xpc|bundle)$/.test(entry.name)) code.push(file)
        containsCode ||= childHasCode
      } else if (entry.isFile()) {
        const handle = await open(file, 'r')
        const header = Buffer.alloc(4)
        try { await handle.read(header, 0, 4, 0) } finally { await handle.close() }
        if (magic.has(header.toString('hex'))) {
          code.push(file)
          containsCode = true
        }
      } else throw new Error('Bundle contains an unsupported filesystem entry')
    }
    return containsCode
  }
  await walk(app)
  const main = path.join(app, 'Contents/MacOS/Rvw')
  const cli = path.join(app, 'Contents/MacOS/rvw-cli')
  if (!code.includes(main) || !code.includes(cli)) throw new Error('Bundle must contain the Mach-O app and CLI executables')
  // The outer app signing operation signs its main executable.
  return code.filter((file) => file !== main)
}

export async function prepareRelease({ app, output, version, checkOnly = false }, {
  env = process.env, platform = process.platform, run = runTool, signal,
} = {}) {
  if (!app || !output || !path.isAbsolute(app) || !path.isAbsolute(output) || path.basename(app) !== 'Rvw.app') {
    throw new Error('Release requires absolute app and output paths')
  }
  if (!version || !/^[0-9A-Za-z.+-]+$/.test(version)) throw new Error('Invalid release artifact version')
  if (output === app || output.startsWith(`${app}${path.sep}`)) throw new Error('Release output must be outside the app')
  await mkdir(output, { recursive: true })
  const lock = path.join(output, '.release-lock')
  try { await mkdir(lock, { mode: 0o700 }) } catch (error) {
    if (error.code === 'EEXIST') throw new Error('Release is locked; see docs/releases.md for interrupted-run recovery')
    throw error
  }
  const zipName = `Rvw-${version}.zip`
  const zip = path.join(output, zipName)
  const checksum = `${zip}.sha256`
  const diagnostics = path.join(output, `Rvw-${version}.notary.json`)
  const keychain = path.join(lock, 'release.keychain-db')
  let originalKeychains
  let keychainAttempted = false
  let completed = false
  let cleanupFailed = false
  let stage = 'release configuration'
  const invoke = async (command, args, options = {}) => {
    signal?.throwIfAborted()
    return run(command, args, { signal, ...options })
  }
  try {
    await Promise.all([zip, checksum, diagnostics].map((file) => rm(file, { force: true })))
    const credentials = configuration(env, version, platform)
    stage = 'Apple tool prerequisites'
    await invoke('/usr/bin/xcrun', ['--find', 'notarytool'])
    await invoke('/usr/bin/xcrun', ['--find', 'stapler'])
    if (checkOnly) return
    stage = 'bundle inspection'
    if ((await lstat(app)).isSymbolicLink()) throw new Error('Source app must not be a symlink')
    const stagedApp = path.join(lock, 'Rvw.app')
    await invoke('/usr/bin/ditto', [app, stagedApp])
    const nested = await nestedCode(stagedApp)
    const plist = path.join(stagedApp, 'Contents/Info.plist')
    // Keep the complete release version in the artifact and CLI. Apple bundle
    // version fields use the numeric portion, including for prerelease tags.
    const numericVersion = version.match(/^\d+\.\d+\.\d+/)[0]
    for (const name of ['CFBundleShortVersionString', 'CFBundleVersion']) {
      await invoke('/usr/bin/plutil', ['-replace', name, '-string', numericVersion, plist])
    }
    stage = 'temporary keychain setup'
    originalKeychains = parseKeychains((await invoke('/usr/bin/security', ['list-keychains', '-d', 'user'])).stdout)
    await writeFile(path.join(lock, 'original-keychains.json'), JSON.stringify(originalKeychains), { mode: 0o600 })
    const password = randomBytes(32).toString('hex')
    const certFile = path.join(lock, 'certificate.p12')
    const keyFile = path.join(lock, 'notary-key.p8')
    await writeFile(certFile, credentials.certificate, { mode: 0o600 })
    await writeFile(keyFile, credentials.key, { mode: 0o600 })
    keychainAttempted = true
    await invoke('/usr/bin/security', ['create-keychain', '-p', password, keychain])
    await invoke('/usr/bin/security', ['set-keychain-settings', '-lut', '21600', keychain])
    await invoke('/usr/bin/security', ['unlock-keychain', '-p', password, keychain])
    await invoke('/usr/bin/security', ['import', certFile, '-k', keychain, '-P', env.RVW_CERTIFICATE_PASSWORD, '-T', '/usr/bin/codesign'])
    await invoke('/usr/bin/security', ['set-key-partition-list', '-S', 'apple-tool:,apple:,codesign:', '-s', '-k', password, keychain])
    await invoke('/usr/bin/security', ['list-keychains', '-d', 'user', '-s', keychain, ...originalKeychains])
    stage = 'Developer ID signing'
    for (const target of [...nested, stagedApp]) {
      await invoke('/usr/bin/codesign', ['--force', '--sign', env.RVW_SIGNING_IDENTITY, '--keychain', keychain, '--timestamp', '--options', 'runtime', target])
    }
    await invoke('/usr/bin/codesign', ['--verify', '--deep', '--strict', stagedApp])
    const auth = ['--key', keyFile, '--key-id', env.RVW_NOTARY_KEY_ID, '--issuer', env.RVW_NOTARY_ISSUER_ID]
    const submission = path.join(lock, 'submission.zip')
    await invoke('/usr/bin/ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', stagedApp, submission])
    stage = 'Apple notarization'
    const response = await invoke('/usr/bin/xcrun', ['notarytool', 'submit', submission, ...auth, '--wait', '--timeout', '30m', '--output-format', 'json'], { allowFailure: true })
    let result
    try { result = JSON.parse(response.stdout) } catch { throw new Error('Notary service returned no valid result; check credentials and connectivity') }
    // Retain only diagnostic fields. Do not preserve raw command output.
    const report = { status: result.status, id: result.id }
    if (/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(result.id ?? '')) {
      const log = await invoke('/usr/bin/xcrun', ['notarytool', 'log', result.id, ...auth], { allowFailure: true })
      try {
        report.issues = JSON.parse(log.stdout).issues?.map(({ severity, path: file, message, architecture }) => ({ severity, path: file, message, architecture }))
      } catch { report.logUnavailable = true }
      if (log.code !== 0) report.logUnavailable = true
    }
    const secrets = [...credentialNames.map((name) => env[name]), credentials.key.toString()]
    const safeReport = JSON.stringify(report, (_name, value) => {
      if (typeof value !== 'string') return value
      // Redact before JSON escaping, including passwords with quotes/newlines.
      for (const secret of secrets) value = value.split(secret).join('[REDACTED]')
      return value
    }, 2)
    await writeFile(diagnostics, `${safeReport}\n`, { mode: 0o600 })
    if (response.code !== 0 || result.status !== 'Accepted') throw new Error('Notarization was not accepted; see the release .notary.json file')
    stage = 'stapling and artifact validation'
    await invoke('/usr/bin/xcrun', ['stapler', 'staple', stagedApp])
    await invoke('/usr/bin/xcrun', ['stapler', 'validate', stagedApp])
    const candidate = path.join(lock, zipName)
    await invoke('/usr/bin/ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', stagedApp, candidate])
    const unpacked = path.join(lock, 'unpacked')
    await invoke('/usr/bin/ditto', ['-x', '-k', candidate, unpacked])
    const finalApp = path.join(unpacked, 'Rvw.app')
    await invoke('/usr/bin/codesign', ['--verify', '--deep', '--strict', finalApp])
    await invoke('/usr/bin/codesign', ['--verify', '--strict', path.join(finalApp, 'Contents/MacOS/rvw-cli')])
    await invoke('/usr/bin/xcrun', ['stapler', 'validate', finalApp])
    await invoke('/usr/sbin/spctl', ['--assess', '--type', 'execute', '--verbose=2', finalApp])
    stage = 'artifact checksum'
    const hash = createHash('sha256')
    for await (const chunk of createReadStream(candidate)) hash.update(chunk)
    await writeFile(path.join(lock, 'checksum'), `${hash.digest('hex')}  ${zipName}\n`)
    signal?.throwIfAborted()
    await rename(candidate, zip)
    await rename(path.join(lock, 'checksum'), checksum)
    completed = true
  } catch (error) {
    // Only our own controlled errors reach the CLI. Tool errors must not carry
    // captured stderr, the command line, or credential values to Zig/CI logs.
    throw new Error(`${stage} failed: ${error.message}`, { cause: error })
  } finally {
    // Cleanup deliberately ignores the aborted signal and attempts every step.
    if (keychainAttempted) {
      try { await run('/usr/bin/security', ['delete-keychain', keychain]) } catch { cleanupFailed = true }
      try { await run('/usr/bin/security', ['list-keychains', '-d', 'user', '-s', ...originalKeychains]) } catch { cleanupFailed = true }
    }
    try {
      if (cleanupFailed) {
        // Keep only restoration metadata; attempt every removal even if one fails.
        const removals = (await readdir(lock)).filter((entry) => entry !== 'original-keychains.json')
        const results = await Promise.allSettled(removals.map((entry) => rm(path.join(lock, entry), { recursive: true, force: true })))
        if (results.some((result) => result.status === 'rejected')) cleanupFailed = true
      } else await rm(lock, { recursive: true, force: true })
    } catch { cleanupFailed = true }
    if (!completed || cleanupFailed || signal?.aborted) await Promise.all([zip, checksum].map((file) => rm(file, { force: true })))
    if (cleanupFailed) throw new Error('Keychain cleanup failed; artifacts removed. See docs/releases.md for recovery')
    signal?.throwIfAborted()
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const [app, output, version, mode] = process.argv.slice(2)
  const abort = new AbortController()
  const interrupt = () => abort.abort(new Error('Release interrupted'))
  process.on('SIGINT', interrupt)
  process.on('SIGTERM', interrupt)
  try {
    if (mode && mode !== '--check') throw new Error('Unknown release preparation option')
    await prepareRelease({ app, output, version, checkOnly: mode === '--check' }, { signal: abort.signal })
  } catch (error) {
    console.error(`error: ${error.message}`)
    process.exitCode = 1
  } finally {
    process.off('SIGINT', interrupt)
    process.off('SIGTERM', interrupt)
  }
}
