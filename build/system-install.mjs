import {
  access,
  constants,
  cp,
  lstat,
  readFile,
  readlink,
  rename,
  rm,
  symlink,
} from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { pathToFileURL } from 'node:url'

export const bundleIdentifier = 'dev.rvw.app'
export const bundledCLIPath = path.join('Contents', 'MacOS', 'rvw-cli')

async function pathStatus(target) {
  try {
    return await lstat(target)
  } catch (error) {
    if (error.code === 'ENOENT') return null
    throw error
  }
}

async function requireWritableParent(target, description) {
  const parent = path.dirname(target)
  const status = await pathStatus(parent)
  if (!status?.isDirectory()) {
    throw new Error(
      `${description} directory does not exist: ${parent}; create it and make it writable`,
    )
  }
  try {
    await access(parent, constants.W_OK)
  } catch {
    throw new Error(
      `${description} directory is not writable: ${parent}; correct its permissions and retry (the installer never invokes sudo)`,
    )
  }
}

async function requireRvwIdentity(bundlePath, description) {
  const status = await pathStatus(bundlePath)
  if (!status?.isDirectory() || status.isSymbolicLink()) {
    throw new Error(`${description} is not an application directory: ${bundlePath}`)
  }

  const plistPath = path.join(bundlePath, 'Contents', 'Info.plist')
  const plist = await readFile(plistPath, 'utf8').catch(() => '')
  const identifierPattern = new RegExp(
    `<key>\\s*CFBundleIdentifier\\s*</key>\\s*<string>\\s*${bundleIdentifier.replaceAll('.', '\\.')}`,
  )
  if (!identifierPattern.test(plist)) {
    throw new Error(
      `${description} is not an Rvw bundle (${bundleIdentifier}): ${bundlePath}`,
    )
  }
}

async function requireCompleteRvwBundle(bundlePath, description) {
  await requireRvwIdentity(bundlePath, description)

  for (const relativePath of [
    path.join('Contents', 'MacOS', 'Rvw'),
    bundledCLIPath,
    path.join('Contents', 'Resources', 'web', 'index.html'),
  ]) {
    const item = await pathStatus(path.join(bundlePath, relativePath))
    if (!item?.isFile()) {
      throw new Error(`${description} is incomplete; missing ${relativePath}`)
    }
  }
}

function resolvedLinkTarget(linkPath, target) {
  return path.resolve(path.dirname(linkPath), target)
}

async function validateDestinations(applicationDestination, cliLinkDestination) {
  await requireWritableParent(applicationDestination, 'application destination')
  await requireWritableParent(cliLinkDestination, 'CLI link destination')

  const existingApp = await pathStatus(applicationDestination)
  if (existingApp) {
    if (existingApp.isSymbolicLink() || !existingApp.isDirectory()) {
      throw new Error(
        `refusing to overwrite a non-Rvw application destination: ${applicationDestination}`,
      )
    }
    await requireRvwIdentity(applicationDestination, 'existing application destination')
  }

  const expectedTarget = path.join(applicationDestination, bundledCLIPath)
  const existingLink = await pathStatus(cliLinkDestination)
  if (existingLink) {
    if (!existingLink.isSymbolicLink()) {
      throw new Error(
        `refusing to overwrite non-symlink CLI path: ${cliLinkDestination}; move or remove it explicitly`,
      )
    }
    const currentTarget = await readlink(cliLinkDestination)
    if (resolvedLinkTarget(cliLinkDestination, currentTarget) !== expectedTarget) {
      throw new Error(
        `refusing to overwrite unrelated CLI symlink: ${cliLinkDestination} -> ${currentTarget}; move or remove it explicitly`,
      )
    }
  }
  return {
    existingApp: Boolean(existingApp),
    existingLink: Boolean(existingLink),
    expectedTarget,
  }
}

export async function installSystem({
  stagedApp,
  applicationDestination,
  cliLinkDestination,
}) {
  for (const [name, value] of Object.entries({
    stagedApp,
    applicationDestination,
    cliLinkDestination,
  })) {
    if (!value || !path.isAbsolute(value)) {
      throw new Error(`${name} must be an absolute path`)
    }
  }
  stagedApp = path.resolve(stagedApp)
  applicationDestination = path.resolve(applicationDestination)
  cliLinkDestination = path.resolve(cliLinkDestination)
  if (path.basename(applicationDestination) !== 'Rvw.app') {
    throw new Error('applicationDestination must end in Rvw.app')
  }
  if (path.basename(cliLinkDestination) !== 'rvw') {
    throw new Error('cliLinkDestination must end in rvw')
  }

  await requireCompleteRvwBundle(stagedApp, 'staged application')
  const { existingApp, existingLink, expectedTarget } = await validateDestinations(
    applicationDestination,
    cliLinkDestination,
  )

  const suffix = `.rvw-install-${process.pid}-${Date.now()}`
  const temporaryApp = `${applicationDestination}${suffix}`
  const backupApp = `${applicationDestination}${suffix}.backup`
  const temporaryLink = `${cliLinkDestination}${suffix}`
  let appReplaced = false
  let appBackedUp = false
  let linkReplaced = false

  try {
    await cp(stagedApp, temporaryApp, {
      recursive: true,
      preserveTimestamps: true,
      errorOnExist: true,
      force: false,
    })
    await symlink(expectedTarget, temporaryLink)

    if (existingApp) {
      await rename(applicationDestination, backupApp)
      appBackedUp = true
    }
    await rename(temporaryApp, applicationDestination)
    appReplaced = true
    await rename(temporaryLink, cliLinkDestination)
    linkReplaced = true
    if (appBackedUp) await rm(backupApp, { recursive: true })
  } catch (error) {
    await rm(temporaryLink, { force: true }).catch(() => {})
    await rm(temporaryApp, { recursive: true, force: true }).catch(() => {})
    if (linkReplaced) {
      await rm(cliLinkDestination, { force: true }).catch(() => {})
      if (existingLink) await symlink(expectedTarget, cliLinkDestination).catch(() => {})
    }
    if (appReplaced) {
      await rm(applicationDestination, { recursive: true, force: true }).catch(() => {})
    }
    if (appBackedUp) {
      await rename(backupApp, applicationDestination).catch(() => {})
    }
    throw error
  }
}

async function main() {
  const [stagedApp, applicationDestination, cliLinkDestination] = process.argv.slice(2)
  if (!cliLinkDestination) {
    throw new Error(
      'usage: system-install.mjs STAGED_APP APPLICATION_DESTINATION CLI_LINK_DESTINATION',
    )
  }
  await installSystem({ stagedApp, applicationDestination, cliLinkDestination })
  console.log(`installed ${applicationDestination}`)
  console.log(`linked ${cliLinkDestination} -> ${path.join(applicationDestination, bundledCLIPath)}`)
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((error) => {
    console.error(`error: system installation failed: ${error.message}`)
    process.exitCode = 1
  })
}
