import { ApplicationAction } from './application-actions.js'
import { blockingOverlayActions } from './overlay-actions.js'

export const reviewSourceModes = Object.freeze([
  Object.freeze({ value: 'commits', label: 'Commits' }),
  Object.freeze({ value: 'pull-requests', label: 'Pull requests' }),
  Object.freeze({ value: 'working-tree', label: 'Working tree' }),
])

/** The shell owns mode navigation; the active component owns list actions. */
export function createReviewSourcePickerActionAdapter({ mode, modeActions = blockingOverlayActions, onChange }) {
  function moveMode(direction, count) {
    const index = reviewSourceModes.findIndex(({ value }) => value === mode)
    if (index < 0) return false
    const steps = Number.isSafeInteger(count) && count > 0 ? count : 1
    const length = reviewSourceModes.length
    const nextIndex = (index + direction * (steps % length) + length) % length
    if (nextIndex !== index) onChange(reviewSourceModes[nextIndex].value)
    return true
  }

  return {
    ...modeActions,
    [ApplicationAction.OPEN_NEXT_FILE]: (count) => moveMode(1, count),
    [ApplicationAction.OPEN_PREVIOUS_FILE]: (count) => moveMode(-1, count),
  }
}

export function openReviewSourcePicker(dispatchWorkspace, reviewAvailable) {
  if (!reviewAvailable) return false
  dispatchWorkspace({ type: 'review_source_picker_opened' })
  return true
}
