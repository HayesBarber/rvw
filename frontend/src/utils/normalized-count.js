/** Returns a positive safe integer count, or one for invalid input. */
export function normalizedCount(count) {
  return Number.isSafeInteger(count) && count > 0 ? count : 1
}
