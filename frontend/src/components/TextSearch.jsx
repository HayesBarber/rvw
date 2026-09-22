import { useEffect, useRef, useState } from 'react'
import { matchSegments, runTextSearch } from '../review/text-search.js'

export default function TextSearch({ all, onOpen, onClose }) {
  const [query, setQuery] = useState('')
  const [response, setResponse] = useState(null)
  const [selected, setSelected] = useState(0)
  const input = useRef(null)
  const dialog = useRef(null)
  useEffect(() => {
    const previous = document.activeElement
    input.current?.focus()
    return () => previous?.focus()
  }, [])
  useEffect(() => {
    if (!query) return
    return runTextSearch(query, all, (result) => setResponse({ query, result }))
  }, [query, all])
  const result = response?.query === query ? response.result : null
  const matches = result?.matches ?? []
  const index = Math.min(selected, matches.length - 1)
  useEffect(() => {
    dialog.current?.querySelector(`[data-result="${index}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [index])
  return <div className="file-finder-backdrop" onMouseDown={(event) => {
    if (event.target === event.currentTarget) onClose()
  }}>
    <section ref={dialog} className="file-finder-dialog" role="dialog" aria-modal="true"
      aria-labelledby="text-search-title" data-vim-ignore onKeyDown={(event) => {
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose() }
        if (event.key === 'Tab') { event.preventDefault(); input.current?.focus() }
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault()
          if (matches.length) setSelected((index + (event.key === 'ArrowDown' ? 1 : matches.length - 1)) % matches.length)
        }
        if (event.key === 'Enter' && index >= 0) { event.preventDefault(); onOpen(matches[index]) }
      }}>
      <header className="file-finder-header"><h2 id="text-search-title">{all ? 'Search text · All files' : 'Search text · Respect ignores'}</h2></header>
      <input ref={input} className="file-finder-input" aria-label="Search file contents" placeholder="Search text…"
        role="combobox" aria-expanded="true" aria-controls="text-search-results"
        aria-activedescendant={index >= 0 ? `text-search-${index}` : undefined}
        value={query} onChange={(event) => { setQuery(event.target.value); setResponse(null); setSelected(0) }} />
      <div className="file-finder-body">
        <p className="file-finder-status" role="status">{!query ? 'Type literal text to search current files.'
          : !result || result.status === 'searching' ? 'Searching…'
            : result.status === 'cancelled' ? 'Search cancelled.'
              : `${matches.length} matching lines${result.truncated ? ' · Results truncated; narrow your search.' : matches.length === 0 ? ' · No matches.' : ''}`}</p>
        {result?.message && <p className="file-finder-error" role="alert">{result.message}</p>}
        <ul id="text-search-results" className="file-finder-results text-search-results" role="listbox" aria-label="Text matches">
          {matches.map((match, i) => <li key={`${match.path}:${match.line}`} id={`text-search-${i}`} data-result={i}
            role="option" aria-selected={i === index} onMouseMove={() => setSelected(i)}
            onMouseDown={(event) => event.preventDefault()} onClick={() => onOpen(match)}>
            <strong>{match.path}:{match.line}</strong>
            <code>{matchSegments(match.text, match.spans).map((part, j) => part.match
              ? <mark key={j}>{part.text}</mark> : <span key={j}>{part.text}</span>)}</code>
          </li>)}
        </ul>
      </div>
    </section>
  </div>
}
