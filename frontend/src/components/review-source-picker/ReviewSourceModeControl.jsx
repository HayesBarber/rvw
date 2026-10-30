const modes = [
  { value: 'commits', label: 'Commits' },
  { value: 'pull-requests', label: 'Pull requests' },
  { value: 'working-tree', label: 'Working tree' },
]

export default function ReviewSourceModeControl({ mode, onChange }) {
  return (
    <div className="review-source-mode-control" role="group" aria-label="Review source mode" data-vim-ignore>
      {modes.map(({ value, label }) => (
        <button
          key={value}
          type="button"
          aria-pressed={mode === value}
          onClick={() => onChange(value)}
        >
          {label}
        </button>
      ))}
    </div>
  )
}
