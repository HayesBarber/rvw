import { useEffect, useMemo, useRef, useState } from 'react'
import { fuzzyFind } from '../fuzzy.js'

const maximumResults = 100

function splitPath(path) {
  const separator = path.lastIndexOf('/')
  if (separator === -1) return { directory: '', filename: path }
  return {
    directory: path.slice(0, separator + 1),
    filename: path.slice(separator + 1),
  }
}

export default function FileFinder({ files, status, error, onRetry, onOpen, onClose }) {
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const inputRef = useRef(null)
  const dialogRef = useRef(null)
  const previousFocusRef = useRef(null)
  const paths = useMemo(() => files.map((file) => file.path), [files])
  const results = useMemo(
    () => fuzzyFind(paths, query).slice(0, maximumResults),
    [paths, query],
  )
  const selectedIndex = results.length === 0
    ? -1
    : Math.min(activeIndex, results.length - 1)

  useEffect(() => {
    previousFocusRef.current = document.activeElement
    inputRef.current?.focus()
    return () => previousFocusRef.current?.focus()
  }, [])

  useEffect(() => {
    if (selectedIndex < 0) return
    dialogRef.current
      ?.querySelector(`#file-finder-option-${selectedIndex}`)
      ?.scrollIntoView({ block: 'nearest' })
  }, [selectedIndex])

  function handleInputKeyDown(event) {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActiveIndex(results.length === 0 ? 0 : (selectedIndex + 1) % results.length)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActiveIndex(results.length === 0
        ? 0
        : (selectedIndex - 1 + results.length) % results.length)
    } else if (event.key === 'Enter' && selectedIndex >= 0) {
      event.preventDefault()
      onOpen(results[selectedIndex])
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
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  const ready = status === 'success'
  const activeDescendant = selectedIndex >= 0
    ? `file-finder-option-${selectedIndex}`
    : undefined

  return (
    <div
      className="file-finder-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <section
        ref={dialogRef}
        className="file-finder-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="file-finder-title"
        onKeyDown={handleDialogKeyDown}
      >
        <header className="file-finder-header">
          <h2 id="file-finder-title">Find a file</h2>
          <span aria-hidden="true">⌘P / Ctrl+P</span>
        </header>
        <label className="visually-hidden" htmlFor="file-finder-input">
          Search repository files
        </label>
        <input
          ref={inputRef}
          id="file-finder-input"
          className="file-finder-input"
          type="text"
          value={query}
          placeholder="Search files…"
          autoComplete="off"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded="true"
          aria-controls="file-finder-results"
          aria-activedescendant={activeDescendant}
          onChange={(event) => {
            setQuery(event.target.value)
            setActiveIndex(0)
          }}
          onKeyDown={handleInputKeyDown}
        />
        <div className="file-finder-body">
          {status === 'loading' && (
            <p className="file-finder-status" role="status">Loading repository files…</p>
          )}
          {status === 'error' && (
            <div className="file-finder-error" role="alert">
              <span>Unable to load files: {error}</span>
              <button type="button" onClick={onRetry}>Retry</button>
            </div>
          )}
          {ready && paths.length === 0 && (
            <p className="file-finder-status">No files found in this repository.</p>
          )}
          {ready && paths.length > 0 && results.length === 0 && (
            <p className="file-finder-status">No files match “{query}”.</p>
          )}
          {ready && results.length > 0 && (
            <ul id="file-finder-results" className="file-finder-results" role="listbox">
              {results.map((path, index) => {
                const parts = splitPath(path)
                return (
                  <li
                    id={`file-finder-option-${index}`}
                    key={path}
                    role="option"
                    aria-selected={index === selectedIndex}
                    onMouseDown={(event) => event.preventDefault()}
                    onMouseMove={() => setActiveIndex(index)}
                    onClick={() => onOpen(path)}
                  >
                    <span className="file-finder-directory">{parts.directory}</span>
                    <strong>{parts.filename}</strong>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </section>
    </div>
  )
}
