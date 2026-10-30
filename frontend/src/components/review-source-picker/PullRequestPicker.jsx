import { useLayoutEffect } from 'react'
import { blockingOverlayActions } from '../../actions/overlay-actions.js'

export default function PullRequestPicker({ registerActionAdapter }) {
  useLayoutEffect(() => registerActionAdapter(blockingOverlayActions), [registerActionAdapter])
  return <p>Pull request selection is not available yet.</p>
}
