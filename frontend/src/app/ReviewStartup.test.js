import assert from 'node:assert/strict'
import test, { after, before } from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'

let server
let Content
let LoadError
before(async () => {
  server = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false, watch: null } })
  Content = (await server.ssrLoadModule('/src/app/ReviewStartup.jsx')).ReviewStartupContent
  LoadError = (await server.ssrLoadModule('/src/components/ReviewLoadError.jsx')).default
})
after(async () => { await server?.close() })

test('startup keeps the workspace unmounted while loading or showing a recoverable error', () => {
  for (const status of ['loading', 'error']) {
    const html = renderToStaticMarkup(createElement(Content, {
      state: { status, error: 'Temporary failure', attempt: 1 },
      onRetry: () => {},
      children: () => assert.fail('Mounted workspace before session startup succeeded'),
    }))
    if (status === 'loading') assert.match(html, /Loading review/)
    else {
      assert.match(html, /role="alert"/)
      assert.match(html, /Temporary failure/)
      assert.match(html, />Retry<\/button>/)
    }
  }
})

test('a successful startup supplies the same retry operation to the review workspace', () => {
  const retry = () => {}
  const html = renderToStaticMarkup(createElement(Content, {
    state: { status: 'success', attempt: 1 }, onRetry: retry,
    children: (onRetry) => { assert.equal(onRetry, retry); return createElement('main', null, 'Active review') },
  }))
  assert.match(html, /Active review/)
  assert.doesNotMatch(html, /Loading review|Retry/)
})

test('the review load error offers an accessible retry action', () => {
  let retries = 0
  const element = LoadError({ error: 'Temporary failure', onRetry: () => { retries++ } })
  const button = element.props.children.find((child) => child.type === 'button')
  button.props.onClick()
  assert.equal(retries, 1)
})
