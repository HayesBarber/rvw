import assert from 'node:assert/strict'
import {
  lstat,
  mkdtemp,
  mkdir,
  readFile,
  readlink,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, test } from 'node:test'
import { bundleIdentifier, bundledCLIPath, installSystem } from './system-install.mjs'

const temporaryRoots = []

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  )
})

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'rvw-system-install-'))
  temporaryRoots.push(root)
  const stagedApp = path.join(root, 'stage', 'Rvw.app')
  const applicationDestination = path.join(root, 'Applications', 'Rvw.app')
  const cliLinkDestination = path.join(root, 'bin', 'rvw')
  await mkdir(path.join(stagedApp, 'Contents', 'MacOS'), { recursive: true })
  await mkdir(path.join(stagedApp, 'Contents', 'Resources', 'web'), { recursive: true })
  await mkdir(path.dirname(applicationDestination), { recursive: true })
  await mkdir(path.dirname(cliLinkDestination), { recursive: true })
  await writeFile(
    path.join(stagedApp, 'Contents', 'Info.plist'),
    `<plist><dict><key>CFBundleIdentifier</key><string>${bundleIdentifier}</string></dict></plist>`,
  )
  await writeFile(path.join(stagedApp, 'Contents', 'MacOS', 'Rvw'), 'native')
  await writeFile(path.join(stagedApp, bundledCLIPath), 'cli-v1')
  await writeFile(path.join(stagedApp, 'Contents', 'Resources', 'web', 'index.html'), 'v1')
  return { root, stagedApp, applicationDestination, cliLinkDestination }
}

test('installs a complete bundle and links its bundled CLI', async () => {
  const options = await fixture()
  await installSystem(options)

  assert.equal(
    await readlink(options.cliLinkDestination),
    path.join(options.applicationDestination, bundledCLIPath),
  )
  assert.equal(
    await readFile(
      path.join(options.applicationDestination, 'Contents', 'Resources', 'web', 'index.html'),
      'utf8',
    ),
    'v1',
  )
})

test('repeated installs replace the bundle and discard obsolete assets', async () => {
  const options = await fixture()
  await installSystem(options)
  const obsoleteAsset = path.join(
    options.applicationDestination,
    'Contents',
    'Resources',
    'web',
    'assets',
    'obsolete.js',
  )
  await mkdir(path.dirname(obsoleteAsset), { recursive: true })
  await writeFile(obsoleteAsset, 'obsolete')
  await writeFile(path.join(options.stagedApp, bundledCLIPath), 'cli-v2')

  await installSystem(options)

  await assert.rejects(lstat(obsoleteAsset), { code: 'ENOENT' })
  assert.equal(
    await readFile(path.join(options.applicationDestination, bundledCLIPath), 'utf8'),
    'cli-v2',
  )
})

test('repairs an identifiable but incomplete previous application install', async () => {
  const options = await fixture()
  await mkdir(path.join(options.applicationDestination, 'Contents'), { recursive: true })
  await writeFile(
    path.join(options.applicationDestination, 'Contents', 'Info.plist'),
    `<plist><dict><key>CFBundleIdentifier</key><string>${bundleIdentifier}</string></dict></plist>`,
  )

  await installSystem(options)

  assert.equal(
    await readFile(path.join(options.applicationDestination, bundledCLIPath), 'utf8'),
    'cli-v1',
  )
})

test('refuses to overwrite a regular file at the CLI destination', async () => {
  const options = await fixture()
  await writeFile(options.cliLinkDestination, 'unrelated command')

  await assert.rejects(installSystem(options), /refusing to overwrite non-symlink CLI path/)
  assert.equal(await readFile(options.cliLinkDestination, 'utf8'), 'unrelated command')
  await assert.rejects(lstat(options.applicationDestination), { code: 'ENOENT' })
})

test('refuses to overwrite an unrelated CLI symlink', async () => {
  const options = await fixture()
  await symlink('/usr/bin/true', options.cliLinkDestination)

  await assert.rejects(installSystem(options), /refusing to overwrite unrelated CLI symlink/)
  assert.equal(await readlink(options.cliLinkDestination), '/usr/bin/true')
})

test('refuses to replace an unrelated application bundle', async () => {
  const options = await fixture()
  await mkdir(options.applicationDestination)
  await writeFile(path.join(options.applicationDestination, 'marker'), 'keep')

  await assert.rejects(installSystem(options), /not an Rvw bundle/)
  assert.equal(
    await readFile(path.join(options.applicationDestination, 'marker'), 'utf8'),
    'keep',
  )
})

test('requires explicit, existing destination directories', async () => {
  const options = await fixture()
  await rm(path.dirname(options.cliLinkDestination), { recursive: true })

  await assert.rejects(installSystem(options), /directory does not exist.*create it and make it writable/)
})
