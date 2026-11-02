import { useLayoutEffect } from 'react'
import { blockingOverlayActions } from '../../actions/overlay-actions.js'

export default function WorkingTreePicker({ registerActionAdapter }) {
  useLayoutEffect(() => registerActionAdapter(blockingOverlayActions), [registerActionAdapter])
  return <p>Working tree selection is not available yet.</p>
}
