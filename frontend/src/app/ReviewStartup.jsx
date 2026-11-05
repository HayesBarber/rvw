import { Fragment, useEffect, useState, useSyncExternalStore } from 'react'
import ReviewLoadError from '../components/ReviewLoadError.jsx'
import { createStartupRequest } from '../review/startup-request.js'
import { RequestStatus } from '../review/request-state.js'

export function ReviewStartupContent({ state, onRetry, children }) {
  if (state.status === RequestStatus.SUCCESS) {
    return <Fragment key={state.attempt}>{children(onRetry, state.openReviewSourcePicker)}</Fragment>
  }
  return (
    <div className="application-shell">
      <main className="fatal-error">
        {state.status === RequestStatus.ERROR
          ? <ReviewLoadError error={state.error} onRetry={onRetry} />
          : <span role="status">Loading review…</span>}
      </main>
    </div>
  )
}

export default function ReviewStartup({ children }) {
  const [request] = useState(createStartupRequest)
  const state = useSyncExternalStore(request.subscribe, request.getSnapshot, request.getSnapshot)
  useEffect(() => { request.load() }, [request])
  return <ReviewStartupContent state={state} onRetry={request.load}>{children}</ReviewStartupContent>
}
