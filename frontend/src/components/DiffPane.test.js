import assert from 'node:assert/strict'
import test, { after, before } from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { parseDiffFromFile } from '@pierre/diffs'
import { createServer } from 'vite'

let server
let DiffPane
let VimProvider
before(async () => {
  globalThis.requestAnimationFrame = () => 0
  globalThis.cancelAnimationFrame = () => {}
  server = await createServer({
    configFile: false,
    server: { middlewareMode: true, hmr: false, watch: null },
  })
  DiffPane = (await server.ssrLoadModule('/src/components/DiffPane.jsx')).default
  VimProvider = (await server.ssrLoadModule('/src/vim/react.jsx')).VimProvider
})
after(async () => {
  await server?.close()
  delete globalThis.requestAnimationFrame
  delete globalThis.cancelAnimationFrame
})

function textDiff(oldContents, newContents, oldName = 'old.txt', newName = 'new.txt') {
  const oldFile = { name: oldName, contents: oldContents }
  const newFile = { name: newName, contents: newContents }
  return {
    path: newName,
    previousPath: oldName,
    status: oldName === newName ? 'modified' : 'renamed',
    content: { kind: 'diff', oldFile, newFile },
    parsedDiff: parseDiffFromFile(oldFile, newFile),
  }
}

function render(fileDiff, extra = {}) {
  return renderToStaticMarkup(createElement(VimProvider, null,
    createElement(DiffPane, {
      fileDiff,
      comments: [],
      commentTypes: [],
      registerActionAdapter: () => {},
      ...extra,
    }),
  ))
}

test('pure text renames show the complete file and keep both paths and header controls', () => {
  for (const contents of ['first line\nlast line', '']) {
    const html = render(textDiff(contents, contents), {
      renderHeaderFilenameSuffix: (file) => {
        assert.equal(file.name, 'new.txt')
        assert.equal(file.contents, contents)
        return 'Copy path control'
      },
      renderHeaderMetadata: () => 'File actions',
    })
    assert.match(html, /class="diff-scroll"/)
    assert.match(html, /title="old\.txt">Renamed from <bdi>old\.txt<\/bdi>/)
    assert.match(html, /Copy path control/)
    assert.match(html, /File actions/)
  }
})

test('renames with content changes and normal text diffs keep the diff surface', () => {
  for (const file of [
    textDiff('before\n', 'after\n'),
    textDiff('before\n', 'after\n', 'same.txt', 'same.txt'),
  ]) {
    const html = render(file, {
      renderHeaderFilenameSuffix: (diff) => {
        assert.equal(diff, file.parsedDiff)
        return null
      },
    })
    assert.match(html, /class="diff-scroll"/)
    assert.doesNotMatch(html, /Renamed from/)
  }
})

test('binary renames retain the unavailable-content message', () => {
  const html = render({
    path: 'new.icns',
    previousPath: 'old.icns',
    status: 'renamed',
    content: { kind: 'unavailable', reason: 'binary' },
  })
  assert.equal(html, '<p class="pane-status">Binary file contents cannot be displayed.</p>')
})

test('loading and errors take priority over the file view', () => {
  const file = textDiff('same\n', 'same\n')
  assert.equal(render(file, { loading: true }), '<p class="pane-status">Loading file…</p>')
  assert.equal(render(file, { error: 'Request failed.' }), '<p class="pane-status">Request failed.</p>')
})
