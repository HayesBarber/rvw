export const CommentKeyboardAction = Object.freeze({
  CANCEL: 'cancel',
  SUBMIT: 'submit',
})

export function commentKeyboardAction(event, saving) {
  if (event.key === 'Escape' && !saving) {
    return CommentKeyboardAction.CANCEL
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
