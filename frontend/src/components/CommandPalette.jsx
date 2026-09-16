import { useEffect, useRef, useState } from 'react'
import { commandPaletteActions } from '../actions/command-palette.js'

export default function CommandPalette({ activeSurface, onClose, onExecute }) {
  const [query, setQuery] = useState('')
  const dialogRef = useRef(null)
  const inputRef = useRef(null)
  const previousFocusRef = useRef(null)
  const actions = commandPaletteActions(activeSurface, query)

  useEffect(() => {
    previousFocusRef.current = document.activeElement
    inputRef.current?.focus()
    return () => previousFocusRef.current?.focus({ preventScroll: true })
  }, [])

  function execute(action) {
    onClose()
    // Let the dialog restore focus before an action opens another editor or overlay.
    requestAnimationFrame(() => onExecute(action.id))
  }

  return (
    <div className="keymap-reference-backdrop" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose()
    }}>
      <section ref={dialogRef} className="keymap-reference-dialog" role="dialog"
        aria-modal="true" aria-labelledby="command-palette-title" data-vim-ignore
        onKeyDown={(event) => {
          event.stopPropagation()
          if (event.key === 'Escape') {
            event.preventDefault()
            onClose()
          } else if (event.key === 'Tab') {
            const controls = [...dialogRef.current.querySelectorAll('input, button')]
            const index = controls.indexOf(document.activeElement)
            const next = (index + (event.shiftKey ? -1 : 1) + controls.length) % controls.length
            event.preventDefault()
            controls[next]?.focus()
          }
        }}>
        <header className="keymap-reference-header">
          <h2 id="command-palette-title">Commands</h2>
          <button type="button" onClick={onClose}>Close</button>
        </header>
        <div className="keymap-reference-body command-palette-body">
          <input ref={inputRef} aria-label="Search commands" placeholder="Search commands"
            value={query} onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && actions[0]) {
                event.preventDefault()
                execute(actions[0])
              }
            }} />
          <ul>
            {actions.map((action) => (
              <li key={action.id}>
                <button type="button" onClick={() => execute(action)}>{action.description}</button>
              </li>
            ))}
          </ul>
          {actions.length === 0 && <p>No matching commands.</p>}
        </div>
      </section>
    </div>
  )
}
