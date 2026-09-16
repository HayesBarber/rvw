import { forwardRef } from 'react'

const CommentTypeSelect = forwardRef(function CommentTypeSelect({
  id,
  types,
  value,
  disabled,
  onChange,
}, ref) {
  if (types.length === 0) return null

  return (
    <div className="comment-type-control">
      <label htmlFor={id}>Type</label>
      <select
        ref={ref}
        id={id}
        value={value ?? ''}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value || null)}
      >
        <option value="">No type</option>
        {types.map((type) => <option key={type} value={type}>{type}</option>)}
      </select>
      <span className="comment-type-hint">Tab cycles · Alt+Down moves to controls</span>
      <span className="visually-hidden" role="status" aria-live="polite">
        {value ? `Comment type ${value}` : 'No comment type'}
      </span>
    </div>
  )
})

export default CommentTypeSelect
