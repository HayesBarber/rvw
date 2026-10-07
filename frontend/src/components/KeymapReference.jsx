import { useEffect, useMemo, useRef, useState } from 'react'
import {
  createKeymapReference,
  filterKeymapReference,
  keymapReferenceScrollDelta,
} from '../actions/keymap-reference.js'

function sequenceLabel(sequence) {
  return sequence.join(' ')
}

export default function KeymapReference({ keymap, leader, aliases, onClose }) {
  const dialogRef = useRef(null)
  const bodyRef = useRef(null)
  const searchRef = useRef(null)
  const searchButtonRef = useRef(null)
  const closeRef = useRef(null)
  const [searchVisible, setSearchVisible] = useState(false)
  const [query, setQuery] = useState('')
  const previousFocusRef = useRef(null)
  const groups = useMemo(
    () => createKeymapReference(keymap, leader, aliases),
    [keymap, leader, aliases],
  )
  const filteredGroups = useMemo(() => filterKeymapReference(groups, query), [groups, query])

  useEffect(() => {
    previousFocusRef.current = document.activeElement
    dialogRef.current?.focus({ preventScroll: true })
    return () => previousFocusRef.current?.focus({ preventScroll: true })
  }, [])

  useEffect(() => {
    if (searchVisible) searchRef.current?.focus({ preventScroll: true })
  }, [searchVisible])

  function openSearch() {
    setSearchVisible(true)
    searchRef.current?.focus({ preventScroll: true })
  }

  function handleKeyDown(event) {
    event.stopPropagation()
    if (event.isComposing) return
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      if (event.target === searchRef.current) {
        dialogRef.current?.focus({ preventScroll: true })
        return
      }
      if (event.repeat) return
      onClose()
      return
    }
    if (event.key === 'Tab') {
      event.preventDefault()
      const controls = [searchButtonRef.current, closeRef.current, searchRef.current].filter(Boolean)
      const index = controls.indexOf(document.activeElement)
      const next = index === -1
        ? (event.shiftKey ? controls.length - 1 : 0)
        : (index + (event.shiftKey ? -1 : 1) + controls.length) % controls.length
      controls[next]?.focus()
      return
    }
    if (event.target === searchRef.current) return
    if (event.key === '/' && !event.altKey && !event.ctrlKey && !event.metaKey) {
      event.preventDefault()
      openSearch()
      return
    }
    const scrollDelta = event.altKey || event.ctrlKey || event.metaKey
      ? null
      : keymapReferenceScrollDelta(event.key)
    if (scrollDelta !== null) {
      event.preventDefault()
      event.stopPropagation()
      bodyRef.current?.scrollBy({ top: scrollDelta })
      return
    }
    // Keep the header buttons' keyboard activation available.
    if ([searchButtonRef.current, closeRef.current].includes(event.target) &&
      (event.key === 'Enter' || event.key === ' ')) return
    event.preventDefault()
    event.stopPropagation()
  }

  return (
    <div
      className="keymap-reference-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <section
        ref={dialogRef}
        className="keymap-reference-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="keymap-reference-title"
        tabIndex={-1}
        data-vim-ignore
        onKeyDown={handleKeyDown}
      >
        <header className="keymap-reference-header">
          <div>
            <h2 id="keymap-reference-title">Keyboard reference</h2>
            <p>Press / to search or j/k to scroll. Esc leaves the input; Esc outside it closes the reference.</p>
          </div>
          <div className="keymap-reference-controls">
            <button
              ref={searchButtonRef}
              type="button"
              onClick={openSearch}
              aria-expanded={searchVisible}
              aria-controls={searchVisible ? 'keymap-reference-search-panel' : undefined}
            >
              Search
            </button>
            <button ref={closeRef} type="button" onClick={onClose} aria-label="Close keyboard reference">
              Close
            </button>
          </div>
        </header>
        {searchVisible && <div id="keymap-reference-search-panel" className="keymap-reference-search">
          <label htmlFor="keymap-reference-search">Search keyboard reference</label>
          <input
            ref={searchRef}
            id="keymap-reference-search"
            type="text"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value)
              bodyRef.current?.scrollTo({ top: 0 })
            }}
          />
        </div>}
        <div ref={bodyRef} className="keymap-reference-body">
          {filteredGroups.length === 0 && <p role="status">No matching actions.</p>}
          {filteredGroups.map((group) => (
            <section className="keymap-reference-group" key={group.id}>
              <h3>{group.label}</h3>
              <dl>
                {group.actions.map((action) => (
                  <div className="keymap-reference-action" key={action.id}>
                    <dt>
                      {action.sequences.length === 0 ? (
                        <span className="keymap-reference-disabled">Disabled</span>
                      ) : action.sequences.map((sequence) => (
                        <kbd key={sequenceLabel(sequence)}>{sequenceLabel(sequence)}</kbd>
                      ))}
                    </dt>
                    <dd>
                      <strong>{action.description}</strong>
                      <span>{action.id}</span>
                      {action.aliases.length > 0 && (
                        <span className="keymap-reference-aliases">
                          Aliases: {action.aliases.join(', ')}
                        </span>
                      )}
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
      </section>
    </div>
  )
}
