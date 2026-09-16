export default function CommentTypeSelect({
  id,
  types,
  value,
  disabled,
  onChange,
}) {
  if (types.length === 0) return null

  return (
    <div className="comment-type-control">
      <label htmlFor={id}>Type</label>
      <select
        id={id}
        value={value ?? ''}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value || null)}
      >
        <option value="">No type</option>
        {types.map((type) => <option key={type} value={type}>{type}</option>)}
      </select>
      <span className="comment-type-hint">Tab / Shift+Tab cycles types</span>
      <span className="visually-hidden" role="status" aria-live="polite">
        {value ? `Comment type ${value}` : 'No comment type'}
      </span>
    </div>
  )
}
