function diagnosticText(diagnostic) {
  if (!diagnostic) return null
  return `Keyboard configuration: ${diagnostic.message}. Fix ${diagnostic.path}, then restart rvw. The current keymap remains active.`
}

export default function KeyboardStatus({ diagnostic, vimState }) {
  const pending = vimState.pendingKeys.join(' ')
  const problem = diagnosticText(diagnostic)

  return (
    <footer className="keyboard-status">
      {problem && (
        <span className="keyboard-diagnostic" role="alert" title={problem}>
          {problem}
        </span>
      )}
      <span className="keyboard-input-status" aria-live="polite">
        <strong>{vimState.mode.toUpperCase()}</strong>
        {vimState.count && <span>count {vimState.count}</span>}
        {pending && <span>pending {pending}</span>}
        {!vimState.count && !pending && <span>ready</span>}
      </span>
    </footer>
  )
}
