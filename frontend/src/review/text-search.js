import { textSearch } from './api.js'

/** Each query owns its cancellation and suppresses every late response. */
export function runTextSearch(query, all, onResult, request = textSearch) {
  const id = crypto.randomUUID()
  let active = true
  let timer
  async function poll(start = false) {
    try {
      const result = await request({ id, ...(start ? { query, all } : {}) })
      if (!active) return
      onResult(result)
      if (result.status === 'searching') timer = setTimeout(poll, 75)
    } catch (error) {
      if (active) onResult({ status: 'complete', matches: [], message: error.message })
    }
  }
  timer = setTimeout(() => poll(true), 180)
  return () => {
    active = false
    clearTimeout(timer)
    request({ id, cancel: true }).catch(() => {})
  }
}

/** rg reports UTF-8 byte offsets; JavaScript string offsets are UTF-16. */
export function matchSegments(text, spans) {
  const bytes = new TextEncoder().encode(text)
  const decoder = new TextDecoder()
  const parts = []
  let offset = 0
  for (const span of spans) {
    parts.push({ text: decoder.decode(bytes.slice(offset, span.start)), match: false })
    parts.push({ text: decoder.decode(bytes.slice(span.start, span.end)), match: true })
    offset = span.end
  }
  parts.push({ text: decoder.decode(bytes.slice(offset)), match: false })
  return parts
}
