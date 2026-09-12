export const commentScrollMargin = 24

/** Returns the minimal scrollTop that keeps a form fully visible in a viewport. */
export function commentScrollTarget({
  scrollTop,
  viewportHeight,
  elementTop,
  elementHeight,
  margin = commentScrollMargin,
}) {
  const targetTop = scrollTop + elementTop - margin
  const targetBottom = scrollTop + elementTop + elementHeight + margin
  if (targetTop < scrollTop) return targetTop
  if (targetBottom > scrollTop + viewportHeight) return targetBottom - viewportHeight
  return scrollTop
}

/** Scrolls a scrollable container so an element is fully visible. */
export function scrollCommentIntoView(container, element, margin = commentScrollMargin) {
  if (!container || !element) return false

  const containerRect = container.getBoundingClientRect()
  const elementRect = element.getBoundingClientRect()
  const elementTop = elementRect.top - containerRect.top
  const nextScrollTop = commentScrollTarget({
    scrollTop: container.scrollTop,
    viewportHeight: container.clientHeight,
    elementTop,
    elementHeight: elementRect.height,
    margin,
  })
  if (nextScrollTop === container.scrollTop) return false

  container.scrollTo({ top: nextScrollTop })
  return true
}
