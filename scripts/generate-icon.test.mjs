import assert from 'node:assert/strict'
import test from 'node:test'

import {
  parseSipsMetadata,
  representations,
  validateMasterMetadata,
} from './generate-icon.mjs'

test('the icon generation plan covers every required macOS representation', () => {
  assert.deepEqual(
    representations.map(({ filename, pixels }) => [filename, pixels]),
    [
      ['icon_16x16.png', 16],
      ['icon_16x16@2x.png', 32],
      ['icon_32x32.png', 32],
      ['icon_32x32@2x.png', 64],
      ['icon_128x128.png', 128],
      ['icon_128x128@2x.png', 256],
      ['icon_256x256.png', 256],
      ['icon_256x256@2x.png', 512],
      ['icon_512x512.png', 512],
      ['icon_512x512@2x.png', 1024],
    ],
  )
})

test('sips metadata parsing retains format, dimensions, and transparency', () => {
  assert.deepEqual(
    parseSipsMetadata(`
/tmp/rvw-icon-1024.png
  format: png
  pixelWidth: 1024
  pixelHeight: 1024
  hasAlpha: yes
`),
    { format: 'png', width: 1024, height: 1024, hasAlpha: 'yes' },
  )
})

test('master validation requires a transparent 1024×1024 PNG', () => {
  assert.doesNotThrow(() =>
    validateMasterMetadata({ format: 'png', width: 1024, height: 1024, hasAlpha: 'yes' }),
  )
  assert.throws(
    () => validateMasterMetadata({ format: 'jpeg', width: 1024, height: 1024, hasAlpha: 'yes' }),
    /must use PNG format/,
  )
  assert.throws(
    () => validateMasterMetadata({ format: 'png', width: 512, height: 1024, hasAlpha: 'yes' }),
    /must be exactly 1024×1024/,
  )
  assert.throws(
    () => validateMasterMetadata({ format: 'png', width: 1024, height: 1024, hasAlpha: 'no' }),
    /must contain an alpha channel/,
  )
})
