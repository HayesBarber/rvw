import { reviewSourceModes } from '../../actions/review-source-picker-actions.js'

export default function ReviewSourceModeControl({ mode, onChange, disabled = false }) {
  return (
    <div className="review-source-mode-control" role="group" aria-label="Review source mode">
      {reviewSourceModes.map(({ value, label }) => (
        <button
          key={value}
          type="button"
          data-vim-native-activation
          aria-pressed={mode === value}
          disabled={disabled}
          onClick={() => onChange(value)}
        >
          {label}
        </button>
      ))}
    </div>
  )
}
