import { useEffect, useMemo, useRef } from 'react'
import { createKeymapReference } from '../actions/keymap-reference.js'

function sequenceLabel(sequence) {
  return sequence.join(' ')
}

export default function KeymapReference({ keymap, onClose }) {
  const dialogRef = useRef(null)
  const previousFocusRef = useRef(null)
  const groups = useMemo(() => createKeymapReference(keymap), [keymap])

  useEffect(() => {
    previousFocusRef.current = document.activeElement
    dialogRef.current?.focus({ preventScroll: true })
    return () => previousFocusRef.current?.focus({ preventScroll: true })
  }, [])

  function handleKeyDown(event) {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      onClose()
      return
    }
    if (event.key === 'Tab') {
      const button = dialogRef.current?.querySelector('button')
      if (button) {
        event.preventDefault()
        button.focus()
      }
      return
    }
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
            <p>Bindings currently in effect. Press Esc to close.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close keyboard reference">
            Close
          </button>
        </header>
        <div className="keymap-reference-body">
          {groups.map((group) => (
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
