import assert from 'node:assert/strict'
import test from 'node:test'
import { getConfiguration } from './api.js'

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
