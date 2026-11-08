import assert from 'node:assert/strict'
import test, { after, before } from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'

let server
let FileTreeReviewProgress
before(async () => {
  server = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false, watch: null } })
  FileTreeReviewProgress = (await server.ssrLoadModule('/src/components/FileTreeReviewProgress.jsx')).default
})
after(async () => { await server?.close() })

function renderProgress(changedFiles, viewedPaths) {
  return renderToStaticMarkup(createElement(FileTreeReviewProgress, { changedFiles, viewedPaths }))
}

test('the bar and count track only files in the current review', () => {
  const changedFiles = [{ path: 'first.js' }, { path: 'second.js' }]
  const states = [
    { viewedPaths: ['stale.js'], count: 0 },
    { viewedPaths: ['stale.js', 'first.js'], count: 1 },
    { viewedPaths: ['stale.js', 'first.js', 'second.js'], count: 2 },
    { viewedPaths: ['stale.js', 'second.js'], count: 1 },
  ]

  for (const { viewedPaths, count } of states) {
    const html = renderProgress(changedFiles, viewedPaths)
    assert.match(html, new RegExp(`<progress value="${count}" max="2"`))
    assert.ok(html.includes(`${count} of 2 files viewed`))
  }
})

test('a one-file review uses the singular label', () => {
  assert.match(renderProgress([{ path: 'only.js' }], []), /0 of 1 file viewed/)
})

test('a review with no changed files has no progress indicator', () => {
  assert.equal(renderProgress([], ['stale.js']), '')
})
