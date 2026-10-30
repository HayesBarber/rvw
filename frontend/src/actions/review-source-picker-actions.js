export function openReviewSourcePicker(dispatchWorkspace, reviewAvailable) {
  if (!reviewAvailable) return false
  dispatchWorkspace({ type: 'review_source_picker_opened' })
  return true
}
