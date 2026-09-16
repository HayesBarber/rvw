export const CommentKeyboardAction = Object.freeze({
  CANCEL: 'cancel',
  CYCLE_NEXT_TYPE: 'cycle_next_type',
  CYCLE_PREVIOUS_TYPE: 'cycle_previous_type',
  FOCUS_CONTROLS: 'focus_controls',
  SUBMIT: 'submit',
})

export function cycleCommentType(currentType, types, direction) {
  const choices = [null, ...types]
  const currentIndex = choices.indexOf(currentType)
  const startIndex = currentIndex === -1 ? 0 : currentIndex
  return choices[(startIndex + direction + choices.length) % choices.length]
}

export function commentKeyboardAction(event, saving, typesEnabled = false) {
  if (event.key === 'Escape' && !saving) {
    return CommentKeyboardAction.CANCEL
  }

  if (
    event.key === 'ArrowDown' &&
    event.altKey &&
    !event.ctrlKey &&
    !event.metaKey &&
    typesEnabled &&
    !saving
  ) {
    return CommentKeyboardAction.FOCUS_CONTROLS
  }

  if (event.key === 'Tab' && typesEnabled && !saving) {
    if (!event.altKey && !event.ctrlKey && !event.metaKey) {
      return event.shiftKey
        ? CommentKeyboardAction.CYCLE_PREVIOUS_TYPE
        : CommentKeyboardAction.CYCLE_NEXT_TYPE
    }
  }

  if (
    event.key === 'Enter' &&
    !event.shiftKey &&
    !event.altKey &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.isComposing &&
    !saving
  ) {
    return CommentKeyboardAction.SUBMIT
  }

  return null
}
