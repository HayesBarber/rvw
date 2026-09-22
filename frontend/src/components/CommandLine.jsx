import { useLayoutEffect, useRef, useState } from 'react'
import { handleCommandLineKey } from '../actions/command-line.js'

export default function CommandLine({ controller, aliases, dispatch, error }) {
  const inputRef = useRef(null)
  const [value, setValue] = useState('')
  useLayoutEffect(() => { inputRef.current?.focus({ preventScroll: true }) }, [])
  return (
    <div className="command-line" data-vim-ignore data-command-line>
      <label htmlFor="command-line-input">:</label>
      <input
        id="command-line-input"
        ref={inputRef}
        aria-label="Application command"
        aria-invalid={Boolean(error)}
        aria-describedby={error ? 'command-line-error' : undefined}
        autoComplete="off"
        spellCheck={false}
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onBlur={() => controller.cancel()}
        onKeyDown={(event) => handleCommandLineKey(event, {
          cancel: controller.cancel,
          submit: () => controller.submit(value, aliases, dispatch, () => inputRef.current?.focus()),
        })}
      />
      {error && <span id="command-line-error" role="alert">{error}</span>}
    </div>
  )
}
