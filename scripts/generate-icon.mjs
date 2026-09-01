import { access, constants, mkdir, rm } from 'node:fs/promises'
import { execFile as execFileCallback } from 'node:child_process'
import path from 'node:path'
import process from 'node:process'
import { promisify } from 'node:util'
import { pathToFileURL } from 'node:url'

const execFile = promisify(execFileCallback)
const projectRoot = path.resolve(import.meta.dirname, '..')

export const masterPath = path.join(projectRoot, 'assets', 'icon', 'rvw-icon-1024.png')
export const iconsetPath = path.join(projectRoot, 'assets', 'icon', 'Rvw.iconset')
export const icnsPath = path.join(projectRoot, 'macos', 'Rvw.icns')

export const representations = Object.freeze([
  { filename: 'icon_16x16.png', pixels: 16 },
  { filename: 'icon_16x16@2x.png', pixels: 32 },
  { filename: 'icon_32x32.png', pixels: 32 },
  { filename: 'icon_32x32@2x.png', pixels: 64 },
  { filename: 'icon_128x128.png', pixels: 128 },
  { filename: 'icon_128x128@2x.png', pixels: 256 },
  { filename: 'icon_256x256.png', pixels: 256 },
  { filename: 'icon_256x256@2x.png', pixels: 512 },
  { filename: 'icon_512x512.png', pixels: 512 },
  { filename: 'icon_512x512@2x.png', pixels: 1024 },
])

export function parseSipsMetadata(output) {
  const values = new Map()
  for (const line of output.split('\n')) {
    const match = line.match(/^\s*([A-Za-z]+):\s*(.+?)\s*$/)
    if (match) values.set(match[1], match[2])
  }
  return {
    format: values.get('format'),
    width: Number(values.get('pixelWidth')),
    height: Number(values.get('pixelHeight')),
    hasAlpha: values.get('hasAlpha'),
  }
}

export function validateMasterMetadata(metadata) {
  if (metadata.format?.toLowerCase() !== 'png') {
    throw new Error('master image must use PNG format')
  }
  if (metadata.width !== 1024 || metadata.height !== 1024) {
    throw new Error(
      `master image must be exactly 1024×1024 pixels; found ${metadata.width}×${metadata.height}`,
    )
  }
  if (metadata.hasAlpha !== 'yes') {
    throw new Error('master image must contain an alpha channel for transparent padding')
  }
}

async function requireMaster() {
  try {
    await access(masterPath, constants.R_OK)
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new Error(
        'approved master image is missing; add assets/icon/rvw-icon-1024.png and retry',
      )
    }
    throw new Error(`master image is not readable: ${error.message}`)
  }

  const { stdout } = await execFile('/usr/bin/sips', [
    '-g',
    'format',
    '-g',
    'pixelWidth',
    '-g',
    'pixelHeight',
    '-g',
    'hasAlpha',
    masterPath,
  ])
  validateMasterMetadata(parseSipsMetadata(stdout))
}

export async function generateIcon() {
  if (process.platform !== 'darwin') {
    throw new Error('icon generation requires macOS')
  }
  await requireMaster()

  await rm(iconsetPath, { recursive: true, force: true })
  await mkdir(iconsetPath, { recursive: true })

  for (const representation of representations) {
    const pixels = String(representation.pixels)
    await execFile('/usr/bin/sips', [
      '-z',
      pixels,
      pixels,
      masterPath,
      '--out',
      path.join(iconsetPath, representation.filename),
    ])
  }

  await execFile('/usr/bin/iconutil', [
    '--convert',
    'icns',
    '--output',
    icnsPath,
    iconsetPath,
  ])

  process.stdout.write(`generated ${path.relative(projectRoot, icnsPath)}\n`)
}

function usage() {
  process.stdout.write(`usage: node scripts/generate-icon.mjs\n\n`)
  process.stdout.write(`Generate macos/Rvw.icns from assets/icon/rvw-icon-1024.png.\n`)
}

async function main() {
  const args = process.argv.slice(2)
  if (args.length === 1 && (args[0] === '-h' || args[0] === '--help')) {
    usage()
    return
  }
  if (args.length !== 0) {
    usage()
    throw new Error(`unknown argument: ${args[0]}`)
  }
  await generateIcon()
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((error) => {
    process.stderr.write(`error: icon generation failed: ${error.message}\n`)
    process.exitCode = 1
  })
}
