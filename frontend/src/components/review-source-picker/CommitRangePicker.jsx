import { useLayoutEffect } from 'react'
import { blockingOverlayActions } from '../../actions/overlay-actions.js'

export default function CommitRangePicker({ registerActionAdapter }) {
  useLayoutEffect(() => registerActionAdapter(blockingOverlayActions), [registerActionAdapter])
  return <p>Commit range selection is not available yet.</p>
}
