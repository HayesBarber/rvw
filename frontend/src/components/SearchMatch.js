import { createElement } from 'react'

// API spans are half-open UTF-16 offsets, as used by String.slice.
export default function SearchMatch({ match }) {
  const parts = []
  let offset = 0
  for (const { start, end } of match.spans) {
    parts.push(match.lineText.slice(offset, start))
    parts.push(createElement('mark', { key: `${start}:${end}` }, match.lineText.slice(start, end)))
    offset = end
  }
  parts.push(match.lineText.slice(offset))
  return createElement('div', null,
    createElement('div', { className: 'text-search-location' }, `${match.path}:${match.lineNumber}`),
    createElement('code', { className: 'text-search-line' }, ...parts),
  )
}
