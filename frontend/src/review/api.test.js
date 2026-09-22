import assert from 'node:assert/strict'
import test from 'node:test'

import {
  clearComments,
  closeApplication,
  copyFilePath,
  deleteComment,
  editComment,
  getConfiguration,
  getFilesNotIgnored,
  reloadReview,
} from './api.js'

test('review reload uses equivalent native and HTTP requests', async () => {
  const nativeRequests = []
  globalThis.window = {
    webkit: { messageHandlers: { native: { postMessage(request) {
      nativeRequests.push(request)
      return Promise.resolve({ generation: 1 })
    } } } },
  }
  assert.deepEqual(await reloadReview(), { generation: 1 })
  assert.deepEqual(nativeRequests, [{ type: 'reload_review' }])

  const httpRequests = []
  globalThis.window = {}
  globalThis.fetch = async (url, options) => {
    httpRequests.push({ url, options })
    return { ok: true, status: 200, json: async () => ({ generation: 2 }) }
  }
  try {
    assert.deepEqual(await reloadReview(), { generation: 2 })
    assert.equal(httpRequests[0].url, '/api/review/reload')
    assert.equal(httpRequests[0].options.method, 'POST')
    assert.deepEqual(JSON.parse(httpRequests[0].options.body), { type: 'reload_review' })
  } finally {
    delete globalThis.fetch
    delete globalThis.window
  }
})

test('file path copies use the same request through the native bridge', async () => {
  const requests = []
  globalThis.window = {
    webkit: { messageHandlers: { native: { postMessage(request) {
      requests.push(request)
      return Promise.resolve({ path: request.path, format: request.format })
    } } } },
  }

  try {
    assert.deepEqual(await copyFilePath('src/renamed ü.txt', 'absolute'), {
      path: 'src/renamed ü.txt',
      format: 'absolute',
    })
    assert.deepEqual(requests, [{
      type: 'copy_file_path',
      path: 'src/renamed ü.txt',
      format: 'absolute',
    }])
  } finally {
    delete globalThis.window
  }
})

test('file path copies use the dedicated HTTP endpoint', async () => {
  const requests = []
  globalThis.window = {}
  globalThis.fetch = async (url, options) => {
    requests.push({ url, options })
    return { ok: true, status: 200, json: async () => JSON.parse(options.body) }
  }

  try {
    await copyFilePath('deleted file.txt', 'relative')
    assert.equal(requests[0].url, '/api/files/copy-path')
    assert.equal(requests[0].options.method, 'POST')
    assert.deepEqual(JSON.parse(requests[0].options.body), {
      type: 'copy_file_path',
      path: 'deleted file.txt',
      format: 'relative',
    })
  } finally {
    delete globalThis.fetch
    delete globalThis.window
  }
})

test('application close is sent only through the native host boundary', async () => {
  const requests = []
  globalThis.window = {
    webkit: {
      messageHandlers: {
        native: {
          postMessage(request) {
            requests.push(request)
            return Promise.resolve({ closing: true })
          },
        },
      },
    },
  }

  try {
    assert.equal(closeApplication(), true)
    assert.deepEqual(requests, [{ type: 'application_close' }])
  } finally {
    delete globalThis.window
  }
})

test('application close is a safe no-op in HTTP development mode', () => {
  let fetchCalls = 0
  globalThis.window = {}
  globalThis.fetch = () => {
    fetchCalls += 1
    throw new Error('development server should not receive application close')
  }

  try {
    assert.equal(closeApplication(), false)
    assert.equal(fetchCalls, 0)
  } finally {
    delete globalThis.fetch
    delete globalThis.window
  }
})

test('application close does not throw when the native host is exiting', async () => {
  globalThis.window = {
    webkit: {
      messageHandlers: {
        native: {
          postMessage() {
            return Promise.reject(new Error('process exited'))
          },
        },
      },
    },
  }

  try {
    assert.equal(closeApplication(), true)
    await Promise.resolve()
  } finally {
    delete globalThis.window
  }
})

const configurationSnapshot = {
  configuration: {
    commandLine: { aliases: { clear: 'comments.clear' } },
    diff: { relativeLineNumbers: true },
    keybindings: {
      normal: {
        'focus.file_tree': [['g', 't']],
      },
    },
  },
  diagnostic: null,
}

test('configuration uses the native bridge request when available', async () => {
  const requests = []
  globalThis.window = {
    webkit: {
      messageHandlers: {
        native: {
          postMessage(request) {
            requests.push(request)
            return Promise.resolve(configurationSnapshot)
          },
        },
      },
    },
  }

  try {
    assert.deepEqual(await getConfiguration(), configurationSnapshot)
    assert.deepEqual(requests, [{ type: 'get_configuration' }])
  } finally {
    delete globalThis.window
  }
})

test('configuration uses the equivalent HTTP endpoint in development', async () => {
  const requests = []
  globalThis.window = {}
  globalThis.fetch = async (url, options) => {
    requests.push({ url, options })
    return {
      ok: true,
      status: 200,
      json: async () => configurationSnapshot,
    }
  }

  try {
    assert.deepEqual(await getConfiguration(), configurationSnapshot)
    assert.equal(requests.length, 1)
    assert.equal(requests[0].url, '/api/configuration')
    assert.equal(requests[0].options.headers.Accept, 'application/json')
  } finally {
    delete globalThis.fetch
    delete globalThis.window
  }
})

test('not-ignored files use the native bridge request when available', async () => {
  const requests = []
  globalThis.window = {
    webkit: {
      messageHandlers: {
        native: {
          postMessage(request) {
            requests.push(request)
            return Promise.resolve(['README.md'])
          },
        },
      },
    },
  }

  try {
    assert.deepEqual(await getFilesNotIgnored(), ['README.md'])
    assert.deepEqual(requests, [{ type: 'get_files_not_ignored' }])
  } finally {
    delete globalThis.window
  }
})

test('not-ignored files use the dedicated HTTP endpoint in development', async () => {
  const requests = []
  globalThis.window = {}
  globalThis.fetch = async (url, options) => {
    requests.push({ url, options })
    return {
      ok: true,
      status: 200,
      json: async () => ['README.md'],
    }
  }

  try {
    assert.deepEqual(await getFilesNotIgnored(), ['README.md'])
    assert.equal(requests.length, 1)
    assert.equal(requests[0].url, '/api/files/not-ignored')
  } finally {
    delete globalThis.fetch
    delete globalThis.window
  }
})

test('comment mutations use equivalent native bridge requests', async () => {
  const requests = []
  globalThis.window = {
    webkit: {
      messageHandlers: {
        native: {
          postMessage(request) {
            requests.push(request)
            if (request.type === 'edit_comment') {
              return Promise.resolve({ id: request.commentId, body: request.body, target: { kind: 'file', path: 'README.md' } })
            }
            if (request.type === 'clear_comments') {
              return Promise.resolve({ commentCount: 2 })
            }
            return Promise.resolve({ commentId: request.commentId })
          },
        },
      },
    },
  }

  try {
    assert.equal((await editComment('comment-1', 'updated', 'QUESTION')).body, 'updated')
    assert.deepEqual(await deleteComment('comment-1'), { commentId: 'comment-1' })
    assert.deepEqual(await clearComments(), { commentCount: 2 })
    assert.deepEqual(requests, [
      { type: 'edit_comment', commentId: 'comment-1', body: 'updated', commentType: 'QUESTION' },
      { type: 'delete_comment', commentId: 'comment-1' },
      { type: 'clear_comments' },
    ])
  } finally {
    delete globalThis.window
  }
})

test('comment mutations use ID-addressed HTTP endpoints and methods', async () => {
  const requests = []
  globalThis.window = {}
  globalThis.fetch = async (url, options) => {
    requests.push({ url, options })
    const request = JSON.parse(options.body)
    if (request.type === 'edit_comment') {
      return {
        ok: true,
        status: 200,
        json: async () => ({ id: request.commentId, body: request.body, target: { kind: 'file', path: 'README.md' } }),
      }
    }
    return {
      ok: true,
      status: 200,
      json: async () => request.type === 'clear_comments'
        ? { commentCount: 2 }
        : { commentId: request.commentId },
    }
  }

  try {
    await editComment('comment/1', 'updated', null)
    await deleteComment('comment/1')
    await clearComments()
    assert.deepEqual(requests.map(({ url, options }) => [url, options.method]), [
      ['/api/comments/comment%2F1', 'PATCH'],
      ['/api/comments/comment%2F1', 'DELETE'],
      ['/api/comments', 'DELETE'],
    ])
    assert.deepEqual(JSON.parse(requests[0].options.body), {
      type: 'edit_comment',
      commentId: 'comment/1',
      body: 'updated',
      commentType: null,
    })
    assert.deepEqual(JSON.parse(requests[2].options.body), {
      type: 'clear_comments',
    })
  } finally {
    delete globalThis.fetch
    delete globalThis.window
  }
})

test('range comments preserve normalized old-side coordinates across native and HTTP transports', async () => {
  const { createComment } = await import('./api.js')
  const { normalizeCommentRange } = await import('../components/diff-pane/comment-annotations.js')
  const target = normalizeCommentRange('deleted.txt', {
    start: 20, end: 3, side: 'deletions', endSide: 'deletions',
  }, true).target
  const requests = []
  const previousFetch = globalThis.fetch
  try {
    globalThis.window = { webkit: { messageHandlers: { native: {
      postMessage: async (request) => { requests.push(request); return { id: 'native', target: request.target } },
    } } } }
    assert.deepEqual((await createComment('Range', null, target)).target, target)
    globalThis.window = {}
    globalThis.fetch = async (url, options) => {
      assert.equal(url, '/api/comments')
      assert.equal(options.method, 'POST')
      const request = JSON.parse(options.body)
      requests.push(request)
      return { ok: true, json: async () => ({ id: 'http', target: request.target }) }
    }
    assert.deepEqual((await createComment('Range', null, target)).target, target)
    assert.deepEqual(requests[0], requests[1])
    assert.deepEqual(target, { kind: 'line', path: 'deleted.txt', side: 'old', startLine: 3, endLine: 20 })
  } finally {
    globalThis.fetch = previousFetch
    delete globalThis.window
  }
})
