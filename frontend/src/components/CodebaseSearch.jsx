import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { createFileFinderActionAdapter, moveFileFinderSelection } from '../actions/file-finder-actions.js'
import { searchText } from '../review/api.js'
import { createTextSearchRequest } from '../review/text-search-request.js'
import SearchMatch from './SearchMatch.js'

export default function CodebaseSearch({ initialMode, onClose, registerActionAdapter }) {
  const [request] = useState(() => createTextSearchRequest({ search: searchText, mode: initialMode }))
  const state = useSyncExternalStore(request.subscribe, request.getSnapshot)
  const { query, mode, status, error, matches: results, activeIndex, truncated } = state
  const selectedIndex = results.length ? activeIndex : -1
  const inputRef = useRef(null)
  const dialogRef = useRef(null)
  const listRef = useRef(null)
  const previousFocusRef = useRef(null)
  useEffect(() => registerActionAdapter(createFileFinderActionAdapter({
    getResults: () => results,
    getActiveIndex: () => selectedIndex,
    setActiveIndex: request.select,
    onOpen: () => listRef.current?.focus({ preventScroll: true }),
  })), [request, results, selectedIndex, registerActionAdapter])
  useEffect(() => () => request.cancel(), [request])

  useEffect(() => {
    previousFocusRef.current = document.activeElement
    inputRef.current?.focus()
    return () => previousFocusRef.current?.focus()
  }, [])

  useEffect(() => {
    if (selectedIndex < 0) return
    dialogRef.current
      ?.querySelector(`#text-search-option-${selectedIndex}`)
      ?.scrollIntoView({ block: 'nearest' })
  }, [selectedIndex, results])

  function handleInputKeyDown(event) {
    if (event.nativeEvent.isComposing) return
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      request.select(moveFileFinderSelection(results.length, selectedIndex, 1))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      request.select(moveFileFinderSelection(results.length, selectedIndex, -1))
    } else if (event.key === 'Enter' && selectedIndex >= 0) {
      event.preventDefault()
      listRef.current?.focus({ preventScroll: true })
    } else if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      if (listRef.current) listRef.current.focus({ preventScroll: true })
      else dialogRef.current?.focus({ preventScroll: true })
    }
  }

  function handleDialogKeyDown(event) {
    if (event.key === 'Escape') {
      event.preventDefault()
      onClose()
      return
    }
    if (event.key !== 'Tab') return

    const focusable = [...dialogRef.current.querySelectorAll(
      'input, button:not([disabled]), [tabindex]:not([tabindex="-1"])',
    )]
    if (focusable.length === 0) return
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    if (
      document.activeElement === dialogRef.current ||
      document.activeElement === listRef.current
    ) {
      event.preventDefault()
      const nextFocus = event.shiftKey ? last : first
      nextFocus.focus()
    } else if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }


  const activeDescendant = selectedIndex < 0 ? undefined : `text-search-option-${selectedIndex}`
  return (
    <div className="file-finder-backdrop" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose()
    }}>
      <section ref={dialogRef} className="file-finder-dialog"
        role="dialog" aria-modal="true" aria-labelledby="text-search-title"
        tabIndex={-1} data-vim-capture onKeyDown={handleDialogKeyDown}>
        <header className="file-finder-header">
          <h2 id="text-search-title">
            {mode === 'all-files' ? 'Search codebase including ignored' : 'Search codebase'}
          </h2>
        </header>
        <label className="visually-hidden" htmlFor="text-search-input">Search text</label>
        <input ref={inputRef} id="text-search-input" className="file-finder-input"
          type="text" value={query} placeholder="Search text…" autoComplete="off"
          role="combobox" aria-autocomplete="list" aria-expanded="true"
          aria-controls="text-search-results" aria-activedescendant={activeDescendant}
          onChange={(event) => request.update(event.target.value)} onKeyDown={handleInputKeyDown} />
        <div className="file-finder-body">
          <div role="status" aria-live="polite">
            {status === 'idle' && <p className="file-finder-status">Enter text to search the opened directory.</p>}
            {status === 'loading' && <p className="file-finder-status">Searching…</p>}
            {status === 'success' && <p className="file-finder-status">
              {results.length ? `${results.length} matching lines.` : 'No matching lines.'}
              {truncated && ' Results are limited. Use a more specific query.'}
            </p>}
          </div>
          {status === 'error' && <div className="file-finder-error" role="alert">
            <span>Unable to search: {error}</span>
            <button data-vim-ignore type="button" onClick={() => request.update(query)}>Retry</button>
          </div>}
          <ul ref={listRef} id="text-search-results" className="file-finder-results text-search-results"
            role="listbox" aria-label="Matching lines" tabIndex={-1} aria-activedescendant={activeDescendant}>
            {results.map((match, index) => (
              <li id={`text-search-option-${index}`} key={`${match.path}:${match.lineNumber}:${index}`}
                role="option" aria-selected={index === selectedIndex}
                onMouseDown={(event) => event.preventDefault()}
                onMouseMove={() => request.select(index)}
                onClick={() => {
                  request.select(index)
                  listRef.current?.focus({ preventScroll: true })
                }}>
                <SearchMatch match={match} />
              </li>
            ))}
          </ul>
        </div>
      </section>
    </div>
  )
}
