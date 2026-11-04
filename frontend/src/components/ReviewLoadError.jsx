export default function ReviewLoadError({ error, onRetry }) {
  return (
    <div className="review-load-error" role="alert">
      <p>Unable to load review: {error}</p>
      <button type="button" onClick={onRetry}>Retry</button>
    </div>
  )
}
