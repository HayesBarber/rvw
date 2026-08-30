import assert from 'node:assert/strict'
import test from 'node:test'

import {
  closeApplication,
  deleteComment,
  editComment,
  getConfiguration,
} from './api.js'

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

test('comment mutations use equivalent native bridge requests', async () => {
  const requests = []
  globalThis.window = {
    webkit: {
      messageHandlers: {
        native: {
          postMessage(request) {
            requests.push(request)
            return Promise.resolve(request.type === 'edit_comment'
              ? { id: request.commentId, body: request.body, target: { kind: 'file', path: 'README.md' } }
              : { commentId: request.commentId })
          },
        },
      },
    },
  }

  try {
    assert.equal((await editComment('comment-1', 'updated')).body, 'updated')
    assert.deepEqual(await deleteComment('comment-1'), { commentId: 'comment-1' })
    assert.deepEqual(requests, [
      { type: 'edit_comment', commentId: 'comment-1', body: 'updated' },
      { type: 'delete_comment', commentId: 'comment-1' },
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
    return {
      ok: true,
      status: 200,
      json: async () => request.type === 'edit_comment'
        ? { id: request.commentId, body: request.body, target: { kind: 'file', path: 'README.md' } }
        : { commentId: request.commentId },
    }
  }

  try {
    await editComment('comment/1', 'updated')
    await deleteComment('comment/1')
    assert.deepEqual(requests.map(({ url, options }) => [url, options.method]), [
      ['/api/comments/comment%2F1', 'PATCH'],
      ['/api/comments/comment%2F1', 'DELETE'],
    ])
    assert.deepEqual(JSON.parse(requests[0].options.body), {
      type: 'edit_comment',
      commentId: 'comment/1',
      body: 'updated',
    })
  } finally {
    delete globalThis.fetch
    delete globalThis.window
  }
})
