import assert from 'node:assert/strict'
import test from 'node:test'

import {
  commentScrollTarget,
  scrollCommentIntoView,
} from './scroll-comment-into-view.js'

test('comment scroll targets leave a fully visible form untouched', () => {
  assert.equal(commentScrollTarget({
    scrollTop: 100,
    viewportHeight: 300,
    elementTop: 120,
    elementHeight: 150,
  }), 100)
  assert.equal(commentScrollTarget({
    scrollTop: 100,
    viewportHeight: 300,
    elementTop: 100,
    elementHeight: 150,
    margin: 24,
  }), 100)
})

test('comment scroll targets reveal a form clipped below the viewport', () => {
  assert.equal(commentScrollTarget({
    scrollTop: 100,
    viewportHeight: 300,
    elementTop: 500,
    elementHeight: 120,
  }), 444)
  assert.equal(commentScrollTarget({
    scrollTop: 100,
    viewportHeight: 300,
    elementTop: 420,
    elementHeight: 120,
    margin: 24,
  }), 364)
})

test('comment scroll targets reveal a form clipped above the viewport', () => {
  assert.equal(commentScrollTarget({
    scrollTop: 100,
    viewportHeight: 300,
    elementTop: -80,
    elementHeight: 120,
    margin: 0,
  }), 20)
  assert.equal(commentScrollTarget({
    scrollTop: 100,
    viewportHeight: 300,
    elementTop: -60,
    elementHeight: 120,
    margin: 24,
  }), 16)
})

test('comment scroll targets align the bottom of forms taller than the viewport', () => {
  assert.equal(commentScrollTarget({
    scrollTop: 100,
    viewportHeight: 200,
    elementTop: 150,
    elementHeight: 500,
  }), 574)
  assert.equal(commentScrollTarget({
    scrollTop: 100,
    viewportHeight: 200,
    elementTop: -350,
    elementHeight: 500,
    margin: 24,
  }), -274)
})

test('comment scroll targets keep degenerate viewports unchanged', () => {
  assert.equal(commentScrollTarget({
    scrollTop: 0,
    viewportHeight: 0,
    elementTop: 0,
    elementHeight: 0,
    margin: 0,
  }), 0)
  assert.equal(commentScrollTarget({
    scrollTop: 0,
    viewportHeight: 500,
    elementTop: 0,
    elementHeight: 0,
    margin: 0,
  }), 0)
})

test('scroll comment into view scrolls only when the form is clipped', () => {
  const scrolls = []
  const container = {
    scrollTop: 100,
    clientHeight: 300,
    getBoundingClientRect: () => ({ top: 0 }),
    scrollTo: (options) => scrolls.push(options),
  }

  const below = { getBoundingClientRect: () => ({ top: 500, height: 120 }) }
  assert.equal(scrollCommentIntoView(container, below), true)
  assert.deepEqual(scrolls, [{ top: 444 }])

  const visible = { getBoundingClientRect: () => ({ top: 200, height: 60 }) }
  assert.equal(scrollCommentIntoView(container, visible), false)
  assert.deepEqual(scrolls, [{ top: 444 }])
})

test('scroll comment into view safely ignores missing targets and non-scrollable containers', () => {
  const container = {
    scrollTop: 100,
    clientHeight: 300,
    getBoundingClientRect: () => ({ top: 0 }),
    scrollTo: () => assert.fail('should not scroll'),
  }

  assert.equal(scrollCommentIntoView(null, { getBoundingClientRect: () => ({}) }), false)
  assert.equal(scrollCommentIntoView(container, null), false)
  assert.equal(scrollCommentIntoView(undefined, undefined), false)

  const alreadyVisible = { getBoundingClientRect: () => ({ top: 200, height: 60 }) }
  assert.equal(scrollCommentIntoView(container, alreadyVisible), false)
})