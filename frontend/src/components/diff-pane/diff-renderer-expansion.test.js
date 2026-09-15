import assert from 'node:assert/strict'
import test from 'node:test'

import { DiffHunksRenderer, parseDiffFromFile } from '@pierre/diffs'

const source = Array.from(
  { length: 20 },
  (_, index) => `line ${index + 1}`,
).join('\n')
const diff = parseDiffFromFile(
  { name: 'example.txt', contents: source },
  { name: 'example.txt', contents: source.replace('line 10', 'changed 10') },
)

async function createReadyRenderer(expandUnchanged) {
  let markReady
  const ready = new Promise((resolve) => {
    markReady = resolve
  })
  const renderer = new DiffHunksRenderer({
    diffStyle: 'split',
    expandUnchanged,
    tokenizeMaxLength: 0,
  }, markReady)
  const immediate = renderer.renderDiff(diff)
  if (!immediate) await ready
  return renderer
}

test('Pierre renders every unchanged region and a fresh renderer collapses it again', async () => {
  const collapsedRenderer = await createReadyRenderer(false)
  const collapsedRows = collapsedRenderer.renderDiff(diff).rowCount

  collapsedRenderer.expandHunk(0, 'both', 2)
  const manuallyExpandedRows = collapsedRenderer.renderDiff(diff).rowCount
  collapsedRenderer.setOptions({
    diffStyle: 'split',
    expandUnchanged: true,
    tokenizeMaxLength: 0,
  })
  const expandedRows = collapsedRenderer.renderDiff(diff).rowCount

  assert(manuallyExpandedRows > collapsedRows)
  assert.equal(expandedRows, 20)
  assert(expandedRows > manuallyExpandedRows)

  // Pierre retains manual expansion state when the flag alone returns false.
  // DiffSurface therefore keys the component by mode to produce this fresh state.
  const resetRenderer = await createReadyRenderer(false)
  assert.equal(resetRenderer.getExpandedHunksMap().size, 0)
  assert.equal(resetRenderer.renderDiff(diff).rowCount, collapsedRows)
})
